const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const targetHost = 'threesquirrels.didigo.es';
const port = 8000;

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
  fs.readFile(filePath, (err, data) => {
    if (err) {
      send404(res);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

function proxyRequest(req, res) {
  const options = {
    hostname: targetHost,
    port: 443,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetHost
    }
  };

  const proxyReq = https.request(options, proxyRes => {
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

  if (urlPath.startsWith('/api/') || urlPath.startsWith('/uploads/')) {
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
});
