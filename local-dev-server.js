const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { URL } = require('url');

const rootDir = __dirname;
const port = 8000;
const targetUrl = new URL(process.env.TS_PROXY_TARGET || 'http://8.220.74.149:18080');
const fallbackTargetUrl = process.env.TS_PROXY_FALLBACK_TARGET
  ? new URL(process.env.TS_PROXY_FALLBACK_TARGET)
  : (targetUrl.origin === 'http://8.220.74.149:18080' ? null : new URL('http://8.220.74.149:18080'));
const tunnelHost = process.env.TS_PROXY_TUNNEL_HOST || 'root@8.220.74.149';
const tunnelRemoteHost = process.env.TS_PROXY_TUNNEL_REMOTE_HOST || '127.0.0.1';
const tunnelRemotePort = String(process.env.TS_PROXY_TUNNEL_REMOTE_PORT || '18080');
const canAutoTunnel = ['127.0.0.1', 'localhost'].includes(targetUrl.hostname);
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
  if (tunnelProcess && !tunnelProcess.killed) return Promise.resolve(true);
  if (tunnelPromise) return tunnelPromise;
  tunnelPromise = new Promise(resolve => {
    const localPort = String(targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80));
    const child = spawn('ssh', ['-N', '-L', `${localPort}:${tunnelRemoteHost}:${tunnelRemotePort}`, tunnelHost], {
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
      setTimeout(() => finish(true), 1200);
    });
  });
  return tunnelPromise;
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
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', async () => {
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
    forwardProxy(targetUrl, req, res, Buffer.concat(chunks));
  });
  req.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Gateway');
  });
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

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
});
