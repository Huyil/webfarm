#!/usr/bin/env node
/* 源码版自检：不构建，直接以浏览器方式加载 src/index.html（外链 11 个 css + 45 个 js），
 * 确认「源码也能直接跑」。jsdom 用 resources:'usable' 真的去读这些相对路径。
 *   node tools/devcheck.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
function loadJsdom() {
  const tries = [() => require('jsdom'), () => require(path.join('/home/loli/deepseek-harness/node_modules', 'jsdom'))];
  for (const t of tries) { try { return t(); } catch (e) {} }
  console.error('✗ 找不到 jsdom'); process.exit(2);
}
const { JSDOM, VirtualConsole } = loadJsdom();
const FILE = path.join(__dirname, '..', 'src', 'index.html');

function ctxStub() {
  const grad = { addColorStop() {} };
  const base = { canvas: { width: 800, height: 600 }, createLinearGradient: () => grad, createRadialGradient: () => grad,
    createPattern: () => ({}), measureText: () => ({ width: 10 }), getImageData: () => ({ data: new Uint8ClampedArray(4) }), getLineDash: () => [] };
  const noop = function () {};
  return new Proxy(base, { get(t, k) { if (k in t) return t[k]; if (k === 'then' || typeof k === 'symbol') return undefined; return noop; },
    set(t, k, v) { t[k] = v; return true; }, has() { return true; } });
}

let pass = 0, fail = 0;
const bad = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { const m = String((e && e.message) || e); if (!/Not implemented/.test(m)) bad.push('jsdomError: ' + m); });
vc.on('error', (...a) => bad.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(fs.readFileSync(FILE, 'utf8'), {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8123/src/index.html', virtualConsole: vc,
  beforeParse(w) { w.HTMLCanvasElement.prototype.getContext = () => ctxStub(); },
});
const W = dom.window;
function ok(c, label, extra) { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + label); } else { fail++; bad.push(label + (extra ? ' → ' + extra : '')); console.log('  \x1b[31m✗\x1b[0m ' + label + (extra ? '  ' + extra : '')); } }

setTimeout(() => {
  const D = W.FarmDebug;
  ok(!!D, '源码版启动了（window.FarmDebug 存在）');
  const links = [...W.document.querySelectorAll('link[rel=stylesheet]')].map(l => l.getAttribute('href'));
  ok(links.length === 1 && links[0] === 'dev-bundle.css', '样式走 src/dev-bundle.css（拼接产物）', links.join(','));
  const srcs = [...W.document.scripts].filter(s => s.src).map(s => s.getAttribute('src'));
  ok(srcs.length === 1 && srcs[0] === 'dev-bundle.js', '脚本走 src/dev-bundle.js（单个 IIFE，不是 45 个 script）', srcs.join(','));
  /* 拼接产物必须真的含清单里的每个文件（顺序也对） */
  {
    const fs2 = require('fs'), path2 = require('path');
    const man = JSON.parse(fs2.readFileSync(path2.join(__dirname, '..', 'build.manifest.json'), 'utf8'));
    const bundle = fs2.readFileSync(path2.join(__dirname, '..', 'src', 'dev-bundle.js'), 'utf8');
    const missing = man.js.filter(f => bundle.indexOf('js/' + f) < 0);
    ok(missing.length === 0, '拼接产物包含清单里的全部 js', missing.join(','));
    const pos = man.js.map(f => bundle.indexOf('js/' + f));
    ok(pos.every((v, i) => i === 0 || v > pos[i - 1]), '拼接顺序与清单一致');
    ok(bundle.trimEnd().endsWith('})();'), '拼接产物收口在一个 IIFE 里');
  }
  if (D) {
    const api = D.api;
    ok(!!api && typeof api.getTile === 'function', 'FarmDebug.api 可用');
    ok(W.document.querySelectorAll('.side-panel button').length === 11, '侧栏 11 个按钮都在（多了「长按框选」）');
    ok(W.document.querySelectorAll('.toolbar button').length === 5, '工具栏 5 个工具都在（催熟并进肥料小凸起）');
    ok(!!W.document.getElementById('fertPop') && !!W.document.getElementById('seedPop'), '两个工具小凸起容器都在');
    ok(!!W.document.getElementById('btnLongPress'), '侧栏「长按框选」开关在');
    ok(!!W.document.getElementById('hudFarmM') && !!W.document.getElementById('hudClockM') && !!W.document.getElementById('hudIdleM'),
      '手机顶栏的田块/时间/挂机速率元素都在');
    ok(!!api.CROPS && Object.keys(api.CROPS).length === 11, '11 种作物数据都在');
    const t = api.getTile(D.state.farm.x0, D.state.farm.y0);
    ok(!!t && t.state === 'wild', '地图与开局状态正常');
    ok(typeof api.viewZoom === 'function', '主循环/渲染模块都装配上了');
    /* 真跑几帧，确认没有运行时异常 */
    for (let i = 0; i < 5; i++) W.dispatchEvent(new W.Event('resize'));
    ok(bad.filter(b => /jsdomError|console.error/.test(b)).length === 0, '加载与初始化期间没有未捕获异常');
  }
  console.log(`\n  ${fail === 0 ? '\x1b[32m源码版自检通过\x1b[0m' : '\x1b[31m失败 ' + fail + ' 项\x1b[0m'}  (${pass} 项)`);
  if (bad.length) { console.log('\x1b[31m问题\x1b[0m'); bad.slice(0, 8).forEach(b => console.log('  - ' + b)); }
  dom.window.close();
  process.exit(fail === 0 ? 0 : 1);
}, 900);
