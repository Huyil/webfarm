#!/usr/bin/env node
/* 把 legacy/farm-v8.0.html 机械切片成 src/ 多文件源码（Phase 1，行为等价）。
 * 切片是"连续无缝隙"的：所有 js 片段按顺序拼回去必须逐字符等于原 script 内容。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const LEGACY = path.join(ROOT, 'legacy', 'farm-v8.0.html');

const lines = fs.readFileSync(LEGACY, 'utf8').split('\n');
const at = n => lines[n - 1];                 // 1-based
const slice = (a, b) => lines.slice(a - 1, b).join('\n');

/* ---------- CSS：[start, end, file] ---------- */
const CSS = [
  [8, 19, 'base.css'],
  [20, 57, 'hud.css'],
  [58, 78, 'toolbar.css'],
  [79, 108, 'sidepanel.css'],
  [109, 197, 'modal.css'],
  [198, 219, 'warehouse.css'],
  [220, 252, 'fx.css'],
  [253, 392, 'panels.css'],
  [393, 413, 'fx.css', true],
];

/* ---------- JS：[start, end, file] 连续覆盖 535..2242 ---------- */
const JS = [
  [535, 537, '00-header.js'],
  [538, 550, '10-const.js'],
  [551, 577, '11-decor-data.js'],
  [578, 607, '12-changelog.js'],
  [608, 621, '13-achievements.js'],
  [622, 642, '14-tasks.js'],
  [643, 690, '20-audio.js'],
  [691, 736, '21-particles.js'],
  [737, 784, '30-state.js'],
  [785, 877, '31-save.js'],
  [878, 884, '32-iso.js'],
  [885, 901, '33-growth.js'],
  [902, 922, '34-canvas.js'],
  [923, 1020, '40-tiles.js'],
  [1021, 1180, '41-crop-art.js'],
  [1181, 1286, '42-decor-art.js'],
  [1287, 1372, '43-player.js'],
  [1373, 1446, '50-render.js'],
  [1447, 1546, '51-tools.js'],
  [1547, 1593, '52-pointer.js'],
  [1594, 1622, '60-hud.js'],
  [1623, 1645, '61-modals.js'],
  [1646, 1673, '62-seedlist.js'],
  [1674, 1699, '63-shop.js'],
  [1700, 1759, '64-warehouse.js'],
  [1760, 1790, '65-settings.js'],
  [1791, 1834, '66-sidepanel.js'],
  [1835, 1881, '70-toast.js'],
  [1882, 1894, '71-loop.js'],
  [1895, 2013, '72-progress.js'],
  [2014, 2163, '73-panels.js'],
  [2164, 2208, '74-bindings.js'],
  [2209, 2242, '99-init.js'],
];

/* ---------- 输出 ---------- */
fs.mkdirSync(path.join(SRC, 'css'), { recursive: true });
fs.mkdirSync(path.join(SRC, 'js'), { recursive: true });

for (const [a, b, file, append] of CSS) {
  const p = path.join(SRC, 'css', file);
  const text = slice(a, b) + '\n';
  fs.writeFileSync(p, append && fs.existsSync(p) ? fs.readFileSync(p, 'utf8') + text : text);
}

const jsOut = new Map();
for (const [a, b, file] of JS) {
  jsOut.set(file, (jsOut.get(file) || '') + slice(a, b) + '\n');
}
for (const [file, text] of jsOut) fs.writeFileSync(path.join(SRC, 'js', file), text);

/* ---------- index.html 模板 ---------- */
const html = [
  lines.slice(0, 7).join('\n'),          // 1..7  doctype -> <style>
  '/*@INJECT_CSS@*/',
  at(414),                                // </style>
  at(415),                                // </head>
  lines.slice(415, 533).join('\n'),      // 416..533 body
  at(534),                                // <script>
  '/*@INJECT_JS@*/',
  lines.slice(2242).join('\n'),          // 2243..  </script></body></html>
  '',
].join('\n');
fs.writeFileSync(path.join(SRC, 'index.html'), html);

/* ---------- 校验：拼回去 == 原 script ---------- */
const order = [...new Set(JS.map(x => x[2]))];
const rebuilt = order.map(f => fs.readFileSync(path.join(SRC, 'js', f), 'utf8')).join('');
const original = slice(535, 2242) + '\n';
const norm = s => s.replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
const ok = norm(rebuilt) === norm(original);

console.log('css files :', [...new Set(CSS.map(x => x[2]))].join(', '));
console.log('js  files :', order.length);
console.log('parity    :', ok ? 'OK (JS 与原版逐行一致)' : 'FAIL');
if (!ok) {
  const A = norm(rebuilt).split('\n'), B = norm(original).split('\n');
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (A[i] !== B[i]) { console.log('first diff at line', i + 1); console.log('  built:', JSON.stringify(A[i])); console.log('  orig :', JSON.stringify(B[i])); break; }
  }
  process.exit(1);
}
