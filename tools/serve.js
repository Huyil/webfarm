#!/usr/bin/env node
/* 极简静态服务器：只为把构建产物按正确的 Content-Type 交给浏览器（0 依赖）。
 *   node tools/serve.js [port] [root]
 * 默认端口 8123，根目录 /home/loli/web，绑定 127.0.0.1。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '8123', 10);
const ROOT = path.resolve(process.argv[3] || path.join(__dirname, '..'));

/* /dev 用到的拼接产物按需重新生成：改完源码直接刷新，不用跑构建 */
let lastBundleAt = 0;
function refreshDevBundle() {
  const now = Date.now();
  if (now - lastBundleAt < 400) return;          /* 400ms 节流：一次刷新会请求 css+js 两个 */
  lastBundleAt = now;
  try { require('./devbundle.js').write(); }
  catch (e) { console.warn('源码版产物生成失败: ' + e.message); }
}
const DEV_BUNDLES = ['/src/dev-bundle.js', '/src/dev-bundle.css'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); }
  catch { res.writeHead(400).end('bad request'); return; }
  if (urlPath === '/') {
    /* 根路径直接给游戏本体：避免落到不存在的 index.html 上 */
    urlPath = fs.existsSync(path.join(ROOT, 'index.html')) ? '/index.html' : '/farm.html';
  }
  /* /dev 直接开「源码版」：src/index.html 引 dev-bundle.*，服务器每次按需重新拼接 */
  if (urlPath === '/dev' || urlPath === '/dev/') urlPath = '/src/index.html';
  if (urlPath === '/src/index.html' || DEV_BUNDLES.indexOf(urlPath) >= 0) refreshDevBundle();
  const file = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 ' + urlPath);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`小田园静态服务器已启动:`);
  console.log(`  构建版  http://127.0.0.1:${PORT}/farm.html`);
  console.log(`  压缩版  http://127.0.0.1:${PORT}/farm.min.html`);
  console.log(`  源码版  http://127.0.0.1:${PORT}/dev   （= src/index.html，外链 css/js，改完刷新即可）`);
  console.log(`根目录: ${ROOT}`);
});
