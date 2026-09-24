#!/usr/bin/env node
/* 生成「源码版」用的拼接产物：src/dev-bundle.css + src/dev-bundle.js
 *
 * 为什么需要它：src/js/*.js 是**拼进同一个 IIFE** 才有意义的（00-header 里的 'use strict'、
 * 后面文件里定义的函数被更早的文件在加载期直接调用，靠的是同一个作用域里的函数提升）。
 * 所以不能简单给 src/index.html 挂 45 个 <script src>，必须先把它们拼成一份再交给浏览器。
 *
 *   node tools/devbundle.js          # 写 src/dev-bundle.{css,js}
 *   node tools/devbundle.js --stdout # 只在标准输出打印（给本地服务器按需生成用）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'build.manifest.json'), 'utf8'));
}
function banner(kind, f) {
  const width = 74;
  const label = ` ${kind}/${f} `;
  const pad = Math.max(0, width - label.length - 4);
  const left = Math.floor(pad / 2);
  return `/* ${'='.repeat(left)}${label}${'='.repeat(pad - left)} */`;
}
function read(kind, f) {
  return fs.readFileSync(path.join(SRC, kind, f), 'utf8').replace(/\s+$/, '');
}

/* 与 build.js 完全同构：css 直接拼，js 包一个 IIFE（'use strict' 在 00-header.js 里） */
function buildBundles() {
  const M = readManifest();
  const css = M.css.map(f => banner('css', f) + '\n' + read('css', f) + '\n').join('\n');
  const jsBody = M.js.map(f => banner('js', f) + '\n' + read('js', f) + '\n').join('\n');
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const js = `/* 小田园 v${M.version} · 源码版拼接产物（自动生成，别手改）\n` +
             `   生成时间 ${stamp} · 改完源码跑 node tools/devbundle.js，或开着 node tools/serve.js 刷新 /dev */\n` +
             `(function(){\n` + jsBody + `})();\n`;
  return { css, js, version: M.version, files: M };
}

function write() {
  const b = buildBundles();
  fs.writeFileSync(path.join(SRC, 'dev-bundle.css'), b.css, 'utf8');
  fs.writeFileSync(path.join(SRC, 'dev-bundle.js'), b.js, 'utf8');
  return b;
}

module.exports = { buildBundles, write };

if (require.main === module) {
  const b = buildBundles();
  if (process.argv.includes('--stdout')) {
    process.stdout.write(JSON.stringify({ css: b.css, js: b.js }));
  } else {
    write();
    const kb = p => (fs.statSync(p).size / 1024).toFixed(1) + ' KB';
    console.log('✓ 源码版拼接产物已更新');
    console.log('  src/dev-bundle.css  ' + kb(path.join(SRC, 'dev-bundle.css')));
    console.log('  src/dev-bundle.js   ' + kb(path.join(SRC, 'dev-bundle.js')));
    console.log('  直接打开 src/index.html，或访问 http://127.0.0.1:8123/dev');
  }
}
