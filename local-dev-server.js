const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const rootDir = __dirname;
const port = 8000;
const targetUrl = new URL(process.env.TS_PROXY_TARGET || 'http://8.220.74.149:18080');
const requestLib = targetUrl.protocol === 'https:' ? https : http;

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

function proxyRequest(req, res) {
  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetUrl.host
    }
  };

  const proxyReq = requestLib.request(options, proxyRes => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
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
});
