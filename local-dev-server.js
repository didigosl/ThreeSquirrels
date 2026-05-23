const http = require('http');
const https = require('https');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { URL } = require('url');

const rootDir = __dirname;
const port = 8000;
const targetUrl = new URL(process.env.TS_PROXY_TARGET || 'http://127.0.0.1:18080');
const enableFallback = process.env.TS_PROXY_ENABLE_FALLBACK === '1';
const fallbackTargetUrl = enableFallback && process.env.TS_PROXY_FALLBACK_TARGET
  ? new URL(process.env.TS_PROXY_FALLBACK_TARGET)
  : null;
const tunnelHost = process.env.TS_PROXY_TUNNEL_HOST || 'root@8.220.74.149';
const tunnelRemoteHost = process.env.TS_PROXY_TUNNEL_REMOTE_HOST || '127.0.0.1';
const tunnelRemotePort = String(process.env.TS_PROXY_TUNNEL_REMOTE_PORT || '18080');
const canAutoTunnel = ['127.0.0.1', 'localhost'].includes(targetUrl.hostname);
const preferTunnel = process.env.TS_PROXY_PREFER_TUNNEL !== '0';
const requestTimeoutMs = Math.max(500, parseInt(process.env.TS_PROXY_TIMEOUT_MS || '6500', 10) || 6500);
const localTunnelPort = Number(targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80));
let tunnelProcess = null;
let tunnelPromise = null;

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

function ensureTunnel() {
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

  const proxyReq = getRequestLib(target).request(options, proxyRes => {
    if (allowFallback && fallbackTargetUrl && target.origin !== fallbackTargetUrl.origin && [502, 503, 504].includes(proxyRes.statusCode || 0)) {
      proxyRes.resume();
      console.warn(`Proxy fallback by status ${proxyRes.statusCode}: ${target.origin} -> ${fallbackTargetUrl.origin}`);
      forwardProxy(fallbackTargetUrl, req, res, bodyBuffer, false);
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
    if (!preferTunnel && allowFallback && fallbackTargetUrl && target.origin !== fallbackTargetUrl.origin) {
      console.warn(`Proxy fallback by error: ${target.origin} -> ${fallbackTargetUrl.origin}`);
      forwardProxy(fallbackTargetUrl, req, res, bodyBuffer, false);
      return;
    }
    if (allowFallback && target.origin === targetUrl.origin) {
      const tunnelReady = await ensureTunnel();
      if (tunnelReady) {
        console.warn(`Proxy auto-tunnel retry: ${target.origin}`);
        forwardProxy(target, req, res, bodyBuffer, false);
        return;
      }
    }
    if (allowFallback && fallbackTargetUrl && target.origin !== fallbackTargetUrl.origin) {
      console.warn(`Proxy fallback by error: ${target.origin} -> ${fallbackTargetUrl.origin}`);
      forwardProxy(fallbackTargetUrl, req, res, bodyBuffer, false);
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
      if (canAutoTunnel) {
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

  if (urlPath === '/__proxy_status') {
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
  console.log(`Local dev server running at http://localhost:${port}/`);
  console.log(`Proxy target: ${targetUrl.origin}`);
  if (fallbackTargetUrl) console.log(`Proxy fallback target: ${fallbackTargetUrl.origin}`);
  if (canAutoTunnel) console.log(`Proxy auto tunnel: ${targetUrl.port || 80} -> ${tunnelRemoteHost}:${tunnelRemotePort} via ${tunnelHost}`);
  if (canAutoTunnel) ensureTunnel().then(ok => console.log(`Proxy tunnel ready: ${ok ? 'yes' : 'no'}`)).catch(() => {});
});
