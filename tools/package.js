#!/usr/bin/env node
/* 打包发布：构建 → 归集 dist/<版本>/ → 打 tar.gz/zip → 打印上传指引
 *
 *   node tools/package.js              # 构建 + 打包「上线包」（默认压缩产物作为 index.html）
 *   node tools/package.js --readable   # 用未压缩产物作为 index.html
 *   node tools/package.js --skip-build # 不重新构建（直接用现有 farm.html / farm.min.html）
 *   node tools/package.js --src        # 打「源码包」（转交源码用）
 *   node tools/package.js --all        # 两个都打
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const has = k => argv.includes('--' + k);

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'build.manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VER = pkg.version || manifest.version || '0.0.0';
const OUT = path.join(ROOT, 'dist', 'farm-v' + VER);
const SITE = 'https://mcu.huyil.cn/farm/';

function sh(cmd, args, opts) {
  const out = execFileSync(cmd, args, Object.assign({ stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }, opts || {}));
  return (out == null) ? '' : String(out).trim();
}
function kb(p) { return (fs.statSync(p).size / 1024).toFixed(1) + ' KB'; }
function copy(from, to) { fs.copyFileSync(from, to); }

/* ---------- 1. 构建 ---------- */
if (!has('skip-build')) {
  console.log('▶ 构建');
  sh('node', [path.join(ROOT, 'build.js')], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
}
const devHtml = path.join(ROOT, 'farm.html');
const minHtml = path.join(ROOT, 'farm.min.html');
for (const f of [devHtml, minHtml]) {
  if (!fs.existsSync(f)) { console.error('✗ 缺少 ' + f + '（先跑 node build.js）'); process.exit(1); }
}

/* ---------- 2. 归集 ---------- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
copy(devHtml, path.join(OUT, 'farm.html'));
copy(minHtml, path.join(OUT, 'farm.min.html'));
/* 服务器上直接当 index.html 用的那一份 */
copy(has('readable') ? devHtml : minHtml, path.join(OUT, 'index.html'));
copy(path.join(ROOT, 'README.md'), path.join(OUT, 'README.md'));

const guide = `小田园 v${VER} · 发布包
========================

包内文件
  index.html      直接上线用的单文件（${has('readable') ? '未压缩版' : '压缩版'}）
  farm.html       未压缩版（好读、好改，体积大一点）
  farm.min.html   压缩版（体积小，线上推荐）
  README.md       玩法数值、验证栈与扩展指南

上线（三种任选其一）
--------------------
A. 有 SSH 私钥的机器（一条命令，自动找 docroot 并上传）
     cd <项目目录> && ./deploy/deploy.sh push auto

B. 手动 scp（把 docroot 换成该站真实路径，宝塔一般是 /www/wwwroot/mcu.huyil.cn）
     scp -P 2233 index.html root@www.huyil.cn:/www/wwwroot/mcu.huyil.cn/farm/index.html
     ssh -p 2233 root@www.huyil.cn "chmod 644 /www/wwwroot/mcu.huyil.cn/farm/index.html"
     curl -I ${SITE}

C. 宝塔 / 云控制台「文件管理」：进 mcu.huyil.cn 的网站目录 → 新建 farm/ → 上传 index.html

验证判据
--------
  curl -I ${SITE}   应当返回 HTTP 200 且 content-type: text/html

本包由 tools/package.js 生成；重新生成：node tools/package.js
`;
fs.writeFileSync(path.join(OUT, 'DEPLOY.txt'), guide, 'utf8');

/* ---------- 2.5 源码包（--src / --all） ---------- */
function buildSrcPackage() {
  const NAME = `xiao-tianyuan-src-v${VER}`;
  const OUT_SRC = path.join(ROOT, 'dist', NAME);
  /* 明确列出要转交的东西：源码 + 构建/开发/发布工具 + 文档，不含生成物与缓存 */
  const ITEMS = ['src', 'tools', 'deploy', 'legacy', 'build.js', 'build.manifest.json', 'package.json', 'README.md'];
  fs.rmSync(OUT_SRC, { recursive: true, force: true });
  fs.mkdirSync(OUT_SRC, { recursive: true });
  for (const it of ITEMS) {
    const from = path.join(ROOT, it);
    if (!fs.existsSync(from)) continue;
    const to = path.join(OUT_SRC, it);
    const st = fs.statSync(from);
    if (st.isDirectory()) sh('cp', ['-R', from, to]);
    else copy(from, to);
  }
  const srcGuide = `小田园 v${VER} · 源码包
======================

目录
  src/                  源码：index.html 模板 + 11 个 css + 45 个 js（按 build.manifest.json 顺序拼接）
  tools/                工具：smoke(无头冒烟) / pixelcheck(像素回归) / render(真渲染出图) / iconshot /
                        serve(本地服务器) / devbundle(源码版拼接) / package(打包) / ascii
  deploy/               部署到 mcu.huyil.cn 的脚本与说明
  legacy/               历史版本（v8 单文件）
  build.js              构建脚本（拼 CSS/JS 进模板 → farm.html + farm.min.html）
  build.manifest.json   文件清单与版本号（加文件就往这里加一行）
  package.json          npm scripts

跑起来（零依赖，只要有 node ≥18）
--------------------------------
  node build.js                # 构建 → farm.html（未压缩）+ farm.min.html（压缩）
  node build.js --dry --smoke   # 只构建到临时文件并跑 609 项无头断言，不覆盖产物
  node tools/serve.js 8123      # 本地服务器：
                                #   http://127.0.0.1:8123/            构建版
                                #   http://127.0.0.1:8123/dev         源码版（改完刷新即生效，不用构建）
                                #   http://127.0.0.1:8123/farm.min.html 压缩版

  也可以直接双击 src/index.html（file://）——它引的是 src/dev-bundle.css / src/dev-bundle.js，
  这两个是 tools/devbundle.js 生成的「源码拼接产物」。改完源码后：
      node tools/devbundle.js            # 重新生成，再刷新浏览器
  或者干脆开着 tools/serve.js 访问 /dev，服务器每次请求都会按需重新拼接。

  压缩器：有 esbuild 就用 esbuild，没有就自动退回 build.js 内置的保守压缩器（--fallback 可强制）。

转交 / 打包
-----------
  node tools/package.js --src    # 打这个源码包（tar.gz）
  node tools/package.js          # 打上线包 dist/farm-v${VER}/（index.html + 两个产物 + 上传指引）
  npm run release                # 打包后直接 ./deploy/deploy.sh push auto 推服务器

注意
----
  src/js/*.js 是被拼进**同一个 IIFE** 才有意义的（00-header.js 的 'use strict'、后面文件里定义的
  函数被更早的文件在加载期直接调用，靠的是同一作用域里的函数提升），所以：
    · 不要给 src/index.html 挂一堆 <script src="js/xxx.js">，必须走 dev-bundle.js；
    · IIFE 的括号由 build.js / tools/devbundle.js 补，源码文件里不要自己写。
`;
  fs.writeFileSync(path.join(OUT_SRC, 'SOURCE.md'), srcGuide, 'utf8');
  const tar = path.join(ROOT, 'dist', NAME + '.tar.gz');
  fs.rmSync(tar, { force: true });
  sh('tar', ['-czf', tar, '-C', path.join(ROOT, 'dist'), NAME]);
  const zip = path.join(ROOT, 'dist', NAME + '.zip');
  fs.rmSync(zip, { force: true });
  const zr = require('./zip.js').zipDir(OUT_SRC, zip);
  const files = parseInt(sh('bash', ['-c', `find ${OUT_SRC} -type f | wc -l`]), 10) || 0;
  console.log('\n✅ 源码包就绪  dist/' + NAME + '/   （' + files + ' 个文件）');
  console.log('   ' + kb(tar).padStart(10) + '   dist/' + NAME + '.tar.gz');
  console.log('   ' + kb(zip).padStart(10) + '   dist/' + NAME + '.zip');
  console.log('   收到后：解压 → node build.js → node tools/serve.js 8123 → 打开 http://127.0.0.1:8123/dev');
  return tar;
}

/* ---------- 3. 打包 ---------- */
const tarPath = path.join(ROOT, 'dist', `farm-v${VER}.tar.gz`);
const zipPath = path.join(ROOT, 'dist', `farm-v${VER}.zip`);
fs.rmSync(tarPath, { force: true });
fs.rmSync(zipPath, { force: true });
sh('tar', ['-czf', tarPath, '-C', path.join(ROOT, 'dist'), path.basename(OUT)]);
let zipOk = true;
try { require('./zip.js').zipDir(OUT, zipPath); }
catch (e) { zipOk = false; console.warn('（zip 生成失败：' + e.message + '）'); }

/* ---------- 4. 汇报 ---------- */
if (has('src') || has('all')) {
  const tar = buildSrcPackage();
  if (has('src') && !has('all')) {
    console.log('\n   源码包：' + tar);
    process.exit(0);
  }
}
const rows = [
  ['index.html', path.join(OUT, 'index.html')],
  ['farm.html', path.join(OUT, 'farm.html')],
  ['farm.min.html', path.join(OUT, 'farm.min.html')],
  ['DEPLOY.txt', path.join(OUT, 'DEPLOY.txt')],
  ['tar.gz', tarPath],
];
if (zipOk) rows.push(['zip', zipPath]);
console.log('\n✅ 发布包就绪  dist/farm-v' + VER + '/');
for (const [name, p] of rows) console.log('   ' + name.padEnd(14) + kb(p).padStart(10) + '   ' + path.relative(ROOT, p));
console.log('\n   上线目标：' + SITE);
console.log('   一条命令：./deploy/deploy.sh push auto      （需要能登录 root@www.huyil.cn:2233 的私钥）');
if (has('all')) console.log('   源码包也在 dist/ 里（xiao-tianyuan-src-v' + VER + '.tar.gz）');
