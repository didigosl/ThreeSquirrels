const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = require('fs/promises');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { URL } = require('url');
const os = require('os');
const crypto = require('crypto');

const rootDir = __dirname;
const port = Number(process.env.PORT || '8000');
const defaultLocalTarget = 'http://127.0.0.1:18080';
const configuredTarget = process.env.TS_PROXY_TARGET || process.env.TS_TARGET_ORIGIN || defaultLocalTarget;
const targetUrl = new URL(configuredTarget);
const dockerBin = process.env.TS_DOCKER_BIN || '/usr/local/bin/docker';
const localStageContainer = process.env.TS_LOCAL_STAGE_CONTAINER || 'ts-stage-server';
const localStageInnerUrl = process.env.TS_LOCAL_STAGE_INNER_URL || 'http://127.0.0.1:8080';
const enableFallback = process.env.TS_PROXY_ENABLE_FALLBACK === '1';
const fallbackTargetRaw = process.env.TS_PROXY_FALLBACK_TARGET || '';
const fallbackTargetUrl = enableFallback && fallbackTargetRaw ? new URL(fallbackTargetRaw) : null;
const tunnelHost = process.env.TS_PROXY_TUNNEL_HOST || 'root@8.220.74.149';
const tunnelRemoteHost = process.env.TS_PROXY_TUNNEL_REMOTE_HOST || '127.0.0.1';
const tunnelRemotePort = String(process.env.TS_PROXY_TUNNEL_REMOTE_PORT || '8080');
const enableTunnel = process.env.TS_PROXY_ENABLE_TUNNEL === '1';
const canAutoTunnel = enableTunnel && ['127.0.0.1', 'localhost'].includes(targetUrl.hostname);
const preferTunnel = process.env.TS_PROXY_PREFER_TUNNEL === '1';
const requestTimeoutMs = Math.max(500, parseInt(process.env.TS_PROXY_TIMEOUT_MS || '6500', 10) || 6500);
const localTunnelPort = Number(targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80));
let tunnelProcess = null;
let tunnelPromise = null;
let localStageEnsurePromise = null;
const pdfPreviewStore = new Map();
const pdfDownloadStore = new Map();
const pdfDownloadDir = path.join(os.tmpdir(), 'ts-pdf-downloads');

// #region debug-point helper:dev-login-error
function reportDebug(hypothesisId, location, msg, data = {}) {
  let debugUrl = 'http://127.0.0.1:7779/event';
  let sessionId = 'dev-login-error';
  try {
    const envText = fs.readFileSync(path.join(rootDir, '.dbg', 'dev-login-error.env'), 'utf8');
    debugUrl = envText.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || debugUrl;
    sessionId = envText.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || sessionId;
  } catch {}
  fetch(debugUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, runId: 'pre-fix', hypothesisId, location, msg, data, ts: Date.now() })
  }).catch(() => {});
}
// #endregion

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon'
};

function checkPortOpen(host, port, timeoutMs = 600) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });
  });
}

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function cleanupExpiredPdfPreviewEntries() {
  const now = Date.now();
  for (const [token, record] of pdfPreviewStore.entries()) {
    if (!record || Number(record.expiresAt || 0) <= now) pdfPreviewStore.delete(token);
  }
}

async function cleanupExpiredPdfDownloadEntries() {
  const now = Date.now();
  for (const [token, record] of pdfDownloadStore.entries()) {
    if (!record || Number(record.expiresAt || 0) > now) continue;
    pdfDownloadStore.delete(token);
    if (record.filePath) await fsp.rm(record.filePath, { force: true }).catch(() => {});
  }
}

async function fileExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch (e) {
    return false;
  }
}

function sanitizePdfExportFileName(name, fallback = 'document') {
  const base = String(name || '').trim().replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
  return (base || fallback).slice(0, 120);
}

async function getUniqueDesktopPdfPath(fileName) {
  const desktopDir = path.join(os.homedir(), 'Desktop');
  await fsp.mkdir(desktopDir, { recursive: true });
  const safeBase = sanitizePdfExportFileName(fileName, 'document');
  let candidate = path.join(desktopDir, `${safeBase}.pdf`);
  let index = 2;
  while (await fileExists(candidate)) {
    candidate = path.join(desktopDir, `${safeBase}-${index}.pdf`);
    index += 1;
  }
  return candidate;
}

async function getTempPdfPath(fileName) {
  const tempDir = pdfDownloadDir;
  await fsp.mkdir(tempDir, { recursive: true });
  const safeBase = sanitizePdfExportFileName(fileName, 'document');
  return path.join(tempDir, `${safeBase}-${crypto.randomUUID()}.pdf`);
}

async function resolvePdfBrowserExecutable() {
  const absoluteCandidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];
  for (const target of absoluteCandidates) {
    if (await fileExists(target)) return target;
  }
  return '';
}

function runExecFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', ...options });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`exit_${code}`));
    });
  });
}

async function waitForFileReady(targetPath, timeoutMs = 15000, stableChecks = 2) {
  const start = Date.now();
  let lastSize = -1;
  let stableCount = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const stats = await fsp.stat(targetPath);
      const size = Number(stats.size || 0);
      if (size > 0) {
        if (size === lastSize) stableCount += 1;
        else stableCount = 0;
        lastSize = size;
        if (stableCount >= stableChecks) return true;
      }
    } catch (e) {
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  return false;
}

function runPdfBrowserExport(command, args, pdfPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (child.pid) {
        try { process.kill(child.pid, 'SIGTERM'); } catch (e) {}
      }
      if (err) reject(err);
      else resolve();
    };
    child.once('error', (err) => finish(err));
    child.once('exit', async (code) => {
      if (settled) return;
      if (code === 0 || await fileExists(pdfPath)) finish();
      else finish(new Error(`exit_${code}`));
    });
    waitForFileReady(pdfPath).then((ok) => {
      if (ok) finish();
    }).catch((err) => finish(err));
    setTimeout(async () => {
      if (settled) return;
      if (await fileExists(pdfPath)) finish();
      else finish(new Error('pdf_export_timeout'));
    }, 20000);
  });
}

async function handlePdfExportDesktop(req, res) {
  cleanupExpiredPdfPreviewEntries();
  let body = {};
  try {
    body = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { error: 'bad_request' });
    return;
  }
  const html = String(body.html || '').trim();
  const fileName = sanitizePdfExportFileName(body.fileName || 'document', 'document');
  if (!html) {
    sendJson(res, 400, { error: 'bad_request' });
    return;
  }
  const browserExecutable = await resolvePdfBrowserExecutable();
  if (!browserExecutable) {
    sendJson(res, 500, { error: 'pdf_browser_not_found' });
    return;
  }
  const token = crypto.randomUUID();
  pdfPreviewStore.set(token, { html, expiresAt: Date.now() + 5 * 60 * 1000 });
  const pdfPath = await getTempPdfPath(fileName);
  const chromeUserDataDir = path.join(os.tmpdir(), `ts-pdf-export-${token}`);
  const previewUrl = `http://127.0.0.1:${port}/__pdf_preview/${encodeURIComponent(token)}`;
  try {
    await fsp.mkdir(chromeUserDataDir, { recursive: true });
    await runPdfBrowserExport(browserExecutable, [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${chromeUserDataDir}`,
      '--virtual-time-budget=2000',
      `--print-to-pdf=${pdfPath}`,
      previewUrl
    ], pdfPath);
    const pdfBuffer = await fsp.readFile(pdfPath);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${fileName}.pdf`)}`
    });
    res.end(pdfBuffer);
  } catch (e) {
    await fsp.rm(pdfPath, { force: true }).catch(() => {});
    sendJson(res, 500, { error: 'pdf_export_failed' });
  } finally {
    pdfPreviewStore.delete(token);
    await fsp.rm(chromeUserDataDir, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(pdfPath, { force: true }).catch(() => {});
  }
}

function serveFile(filePath, res) {
  fs.stat(filePath, (err, stats) => {
    if (err) {
      send404(res);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': filePath.includes(`${path.sep}uploads${path.sep}`) ? 'public, max-age=86400' : 'no-store'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function getRequestLib(target) {
  return target.protocol === 'https:' ? https : http;
}

function canWriteResponse(res) {
  return res && !res.headersSent && !res.writableEnded && !res.destroyed;
}

function forwardViaStageContainer(req, res, bodyBuffer) {
  return new Promise(resolve => {
    const payload = Buffer.from(JSON.stringify({
      url: req.url,
      method: req.method,
      headers: req.headers || {},
      bodyBase64: bodyBuffer.length ? bodyBuffer.toString('base64') : ''
    }), 'utf8').toString('base64');
    const script = `
      (async () => {
        const raw = Buffer.from(process.argv[1] || '', 'base64').toString('utf8');
        const reqData = JSON.parse(raw || '{}');
        const headers = { ...(reqData.headers || {}) };
        delete headers.host;
        delete headers.connection;
        delete headers['content-length'];
        const init = { method: reqData.method || 'GET', headers };
        if (reqData.bodyBase64) init.body = Buffer.from(reqData.bodyBase64, 'base64');
        const r = await fetch(${JSON.stringify(localStageInnerUrl)} + String(reqData.url || '/'), init);
        const buf = Buffer.from(await r.arrayBuffer());
        process.stdout.write(JSON.stringify({ status: r.status, headers: Object.fromEntries(r.headers.entries()), bodyBase64: buf.toString('base64') }));
      })().catch(err => {
        process.stderr.write(String(err && err.stack || err || 'container_proxy_failed'));
        process.exit(1);
      });
    `;
    const child = spawn(dockerBin, ['exec', '-i', localStageContainer, 'node', '-e', script, payload], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', () => {
      // #region debug-point G:container-proxy-error
      reportDebug('C', 'local-dev-server.js:forwardViaStageContainer:error', '[DEBUG] stage container proxy spawn failed', { container: localStageContainer, dockerBin });
      // #endregion
      resolve(false);
    });
    child.once('exit', code => {
      if (code !== 0 || !stdout.trim()) {
        // #region debug-point H:container-proxy-exit
        reportDebug('C', 'local-dev-server.js:forwardViaStageContainer:exit', '[DEBUG] stage container proxy exit failed', { code, stderr: String(stderr || '').slice(0, 500), container: localStageContainer });
        // #endregion
        resolve(false);
        return;
      }
      try {
        const result = JSON.parse(stdout);
        const headers = { ...(result.headers || {}) };
        delete headers['content-encoding'];
        delete headers['content-length'];
        headers['x-ts-proxy-target'] = `${localStageContainer}:${localStageInnerUrl}`;
        res.writeHead(Number(result.status || 500), headers);
        res.end(Buffer.from(String(result.bodyBase64 || ''), 'base64'));
        // #region debug-point I:container-proxy-success
        if ((req.url || '').startsWith('/api/auth/login')) reportDebug('C', 'local-dev-server.js:forwardViaStageContainer:success', '[DEBUG] stage container proxy success', { status: Number(result.status || 0), container: localStageContainer });
        // #endregion
        resolve(true);
      } catch {
        resolve(false);
      }
    });
  });
}

function ensureLocalStageTarget() {
  const isLocalStageTarget = ['127.0.0.1', 'localhost'].includes(targetUrl.hostname) && String(targetUrl.port || '80') === '18080';
  if (!isLocalStageTarget) return Promise.resolve(true);
  return checkPortOpen('127.0.0.1', 18080, 500).then(open => {
    if (open) return true;
    if (localStageEnsurePromise) return localStageEnsurePromise;
    // #region debug-point F:ensure-local-stage
    reportDebug('C', 'local-dev-server.js:ensureLocalStageTarget', '[DEBUG] local stage unavailable, trying to start docker compose', { target: targetUrl.origin, cwd: rootDir });
    // #endregion
    localStageEnsurePromise = new Promise(resolve => {
      const child = spawn('docker', ['compose', '-f', 'docker-compose.staging.yml', 'up', '-d', 'ts-stage-db', 'ts-stage-server', 'ts-stage-nginx'], {
        env: process.env,
        cwd: rootDir,
        stdio: 'ignore'
      });
      const finish = async () => {
        const ok = await checkPortOpen('127.0.0.1', 18080, 1500);
        localStageEnsurePromise = null;
        resolve(ok);
      };
      child.once('error', finish);
      child.once('exit', () => {
        setTimeout(finish, 1200);
      });
    });
    return localStageEnsurePromise;
  });
}

function ensureTunnel() {
  if (!enableTunnel) return Promise.resolve(false);
  if (!canAutoTunnel) return Promise.resolve(false);
  return checkPortOpen('127.0.0.1', localTunnelPort, 300).then(alreadyOpen => {
    if (alreadyOpen) return true;
  if (tunnelProcess && !tunnelProcess.killed) {
    return checkPortOpen('127.0.0.1', localTunnelPort, 300).then(ok => {
      if (ok) return true;
      try { tunnelProcess.kill(); } catch {}
      tunnelProcess = null;
      return ensureTunnel();
    });
  }
  if (tunnelPromise) return tunnelPromise;
  tunnelPromise = new Promise(resolve => {
    const localPort = String(localTunnelPort);
    const child = spawn('ssh', [
      '-N',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=3',
      '-o', 'ServerAliveInterval=3',
      '-o', 'ServerAliveCountMax=1',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'StrictHostKeyChecking=no',
      '-L', `${localPort}:${tunnelRemoteHost}:${tunnelRemotePort}`,
      tunnelHost
    ], {
      stdio: 'ignore'
    });
    tunnelProcess = child;
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      tunnelPromise = null;
      if (!ok && tunnelProcess === child) tunnelProcess = null;
      resolve(ok);
    };
    child.once('error', () => finish(false));
    child.once('exit', () => {
      if (tunnelProcess === child) tunnelProcess = null;
      finish(false);
    });
    child.once('spawn', () => {
      setTimeout(async () => {
        const ok = await checkPortOpen('127.0.0.1', localTunnelPort, 1500);
        if (!ok) {
          try { child.kill(); } catch {}
        }
        finish(ok);
      }, 2200);
    });
  });
    return tunnelPromise;
  });
}

function forwardProxy(target, req, res, bodyBuffer, allowFallback = true) {
  // #region debug-point A:proxy-forward-start
  if ((req.url || '').startsWith('/api/auth/login')) reportDebug('A', 'local-dev-server.js:forwardProxy:start', '[DEBUG] proxy login forward start', { method: req.method, url: req.url, target: target.origin, allowFallback, preferTunnel, fallbackTarget: fallbackTargetUrl ? fallbackTargetUrl.origin : '' });
  // #endregion
  const options = {
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: target.host,
      'content-length': bodyBuffer.length
    }
  };

  let retrying = false;
  const retryTo = nextTarget => {
    if (retrying || !canWriteResponse(res)) {
      return false;
    }
    retrying = true;
    forwardProxy(nextTarget, req, res, bodyBuffer, false);
    return true;
  };

  const proxyReq = getRequestLib(target).request(options, proxyRes => {
    // #region debug-point C:proxy-forward-response
    if ((req.url || '').startsWith('/api/auth/login')) reportDebug('C', 'local-dev-server.js:forwardProxy:response', '[DEBUG] proxy login response', { statusCode: proxyRes.statusCode || 0, target: target.origin, responseTarget: proxyRes.headers?.['x-ts-proxy-target'] || '', allowFallback });
    // #endregion
    if (allowFallback && fallbackTargetUrl && target.origin !== fallbackTargetUrl.origin && [502, 503, 504].includes(proxyRes.statusCode || 0)) {
      proxyRes.resume();
      console.warn(`Proxy fallback by status ${proxyRes.statusCode}: ${target.origin} -> ${fallbackTargetUrl.origin}`);
      retryTo(fallbackTargetUrl);
      return;
    }
    if (!canWriteResponse(res)) {
      proxyRes.resume();
      return;
    }
    const headers = { ...(proxyRes.headers || {}), 'x-ts-proxy-target': target.origin };
    res.writeHead(proxyRes.statusCode || 500, headers);
    proxyRes.pipe(res);
  });

  proxyReq.setTimeout(requestTimeoutMs, () => {
    proxyReq.destroy(new Error('proxy_timeout'));
  });

  proxyReq.on('error', async () => {
    // #region debug-point D:proxy-forward-error
    if ((req.url || '').startsWith('/api/auth/login')) reportDebug('D', 'local-dev-server.js:forwardProxy:error', '[DEBUG] proxy login error', { target: target.origin, allowFallback, preferTunnel, fallbackTarget: fallbackTargetUrl ? fallbackTargetUrl.origin : '' });
    // #endregion
    if (!preferTunnel && allowFallback && fallbackTargetUrl && target.origin !== fallbackTargetUrl.origin) {
      console.warn(`Proxy fallback by error: ${target.origin} -> ${fallbackTargetUrl.origin}`);
      retryTo(fallbackTargetUrl);
      return;
    }
    if (allowFallback && target.origin === targetUrl.origin) {
      const tunnelReady = await ensureTunnel();
      if (tunnelReady) {
        console.warn(`Proxy auto-tunnel retry: ${target.origin}`);
        retryTo(target);
        return;
      }
    }
    if (!canWriteResponse(res)) {
      return;
    }
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Gateway');
  });

  if (bodyBuffer.length) proxyReq.write(bodyBuffer);
  proxyReq.end();
}

function proxyRequest(req, res) {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    (async () => {
      const localTargetReady = await ensureLocalStageTarget();
      if (!localTargetReady && targetUrl.origin === defaultLocalTarget) {
        const tunnelReady = await ensureTunnel();
        if (tunnelReady) {
          forwardProxy(targetUrl, req, res, Buffer.concat(chunks), false);
          return;
        }
        const bridged = await forwardViaStageContainer(req, res, Buffer.concat(chunks));
        if (bridged) return;
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: 'local_stage_unavailable', detail: 'docker_and_tunnel_unavailable' }));
        return;
      }
      if (canAutoTunnel && preferTunnel) {
        const ok = await ensureTunnel();
        if (!ok) {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'proxy_tunnel_unavailable' }));
          return;
        }
      }
      forwardProxy(targetUrl, req, res, Buffer.concat(chunks), true);
    })();
  });
  req.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Gateway');
  });
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  if (req.method === 'GET' && urlPath.startsWith('/__pdf_preview/')) {
    cleanupExpiredPdfPreviewEntries();
    const token = decodeURIComponent(urlPath.slice('/__pdf_preview/'.length));
    const record = pdfPreviewStore.get(token);
    if (!record) {
      send404(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(String(record.html || ''));
    return;
  }

  if (req.method === 'GET' && urlPath.startsWith('/__pdf_tmp/')) {
    const baseName = path.basename(decodeURIComponent(urlPath.slice('/__pdf_tmp/'.length)));
    const filePath = path.join(pdfDownloadDir, baseName);
    if (!filePath.startsWith(pdfDownloadDir)) {
      send404(res);
      return;
    }
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        send404(res);
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(baseName)}`
      });
      const stream = fs.createReadStream(filePath);
      stream.on('error', () => {
        if (!res.headersSent) send404(res);
        else res.end();
      });
      stream.pipe(res);
    });
    return;
  }

  if (req.method === 'GET' && urlPath.startsWith('/__pdf_download/')) {
    cleanupExpiredPdfDownloadEntries();
    const token = decodeURIComponent(urlPath.slice('/__pdf_download/'.length));
    const record = pdfDownloadStore.get(token);
    if (!record || !record.filePath) {
      send404(res);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(record.fileName || 'document.pdf')}`
    });
    const stream = fs.createReadStream(record.filePath);
    stream.on('error', () => {
      if (!res.headersSent) send404(res);
      else res.end();
    });
    stream.on('close', async () => {
      pdfDownloadStore.delete(token);
      await fsp.rm(record.filePath, { force: true }).catch(() => {});
    });
    stream.pipe(res);
    return;
  }

  if (req.method === 'POST' && urlPath === '/api/pdf-export-desktop') {
    handlePdfExportDesktop(req, res);
    return;
  }

  if (urlPath === '/__proxy_status') {
    // #region debug-point B:proxy-status
    reportDebug('B', 'local-dev-server.js:proxy-status', '[DEBUG] proxy status requested', { port, proxyTarget: targetUrl.origin, canAutoTunnel, preferTunnel, fallbackEnabled: !!fallbackTargetUrl, fallbackTarget: fallbackTargetUrl ? fallbackTargetUrl.origin : '', tunnelPort: localTunnelPort, tunnelRunning: !!(tunnelProcess && !tunnelProcess.killed) });
    // #endregion
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      ok: true,
      proxyTarget: targetUrl.origin,
      canAutoTunnel,
      preferTunnel,
      fallbackEnabled: !!fallbackTargetUrl,
      fallbackTarget: fallbackTargetUrl ? fallbackTargetUrl.origin : null,
      tunnelPort: localTunnelPort,
      tunnelRunning: !!(tunnelProcess && !tunnelProcess.killed)
    }));
    return;
  }

  if (urlPath.startsWith('/uploads/')) {
    const uploadPath = path.join(rootDir, urlPath.replace(/^\/+/, ''));
    if (uploadPath.startsWith(path.join(rootDir, 'uploads'))) {
      fs.stat(uploadPath, (err, stats) => {
        if (!err && stats.isFile()) {
          serveFile(uploadPath, res);
          return;
        }
        proxyRequest(req, res);
      });
      return;
    }
  }

  if (urlPath.startsWith('/api/')) {
    proxyRequest(req, res);
    return;
  }

  let filePath = path.join(rootDir, urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, ''));
  if (!filePath.startsWith(rootDir)) {
    send404(res);
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isDirectory()) {
      serveFile(path.join(filePath, 'index.html'), res);
      return;
    }
    if (!err && stats.isFile()) {
      serveFile(filePath, res);
      return;
    }
    if (path.extname(filePath)) {
      send404(res);
      return;
    }
    serveFile(path.join(rootDir, 'index.html'), res);
  });
}).listen(port, () => {
  // #region debug-point E:server-listen
  reportDebug('E', 'local-dev-server.js:listen', '[DEBUG] local dev server started', { port, proxyTarget: targetUrl.origin, canAutoTunnel, preferTunnel, fallbackEnabled: !!fallbackTargetUrl, fallbackTarget: fallbackTargetUrl ? fallbackTargetUrl.origin : '', tunnelPort: localTunnelPort });
  // #endregion
  console.log(`Local dev server running at http://localhost:${port}/`);
  console.log(`Proxy target: ${targetUrl.origin}`);
  if (fallbackTargetUrl) console.log(`Proxy fallback target: ${fallbackTargetUrl.origin}`);
  if (canAutoTunnel && preferTunnel) console.log(`Proxy auto tunnel: ${targetUrl.port || 80} -> ${tunnelRemoteHost}:${tunnelRemotePort} via ${tunnelHost}`);
  if (canAutoTunnel && preferTunnel) ensureTunnel().then(ok => console.log(`Proxy tunnel ready: ${ok ? 'yes' : 'no'}`)).catch(() => {});
});
