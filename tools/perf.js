#!/usr/bin/env node
/* 渲染性能探针：数每帧 canvas 调用次数 + JS 耗时，用来定位和回归渲染热点。
 *   node tools/perf.js [农场边长=48] [帧数=30]
 * 关注「ops/帧」：它和真机帧率强相关，而且完全可重复 —— 优化前后比这个数最直观。
 * 背景：v9.24 就是这么找出来的（40×40 农场每帧 32 万次 canvas 调用，光地块砂粒 17.8 万次）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('/home/loli/deepseek-harness/node_modules/jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'farm.html'), 'utf8');
const N = parseInt(process.argv[2] || '48', 10);
const FRAMES = parseInt(process.argv[3] || '30', 10);

let ops = 0;
const byName = Object.create(null);
function countingCtx() {
  const grad = { addColorStop() {} };
  const base = {
    canvas: { width: 1200, height: 900 },
    createLinearGradient: () => { ops++; byName.linearGradient = (byName.linearGradient || 0) + 1; return grad; },
    createRadialGradient: () => { ops++; byName.radialGradient = (byName.radialGradient || 0) + 1; return grad; },
    createPattern: () => ({}),
    measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    getLineDash: () => [],
  };
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'then' || typeof k === 'symbol') return undefined;
      return function () { ops++; byName[k] = (byName[k] || 0) + 1; };
    },
    set(t, k, v) { t[k] = v; return true; },
    has() { return true; },
  });
}
const vc = new VirtualConsole();
vc.on('jsdomError', e => console.log('JSDOM ERR', String(e.message).slice(0, 160)));
vc.on('error', (...a) => console.log('ERR', a.map(String).join(' ').slice(0, 160)));
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => countingCtx();
    w.HTMLCanvasElement.prototype.toDataURL = () => 'data:,';
    w.Element.prototype.animate = () => ({ cancel() {}, finished: Promise.resolve(), onfinish: null });
    w.innerWidth = 1200; w.innerHeight = 900;
    w.devicePixelRatio = 1;
    if (!w.performance) w.performance = { now: () => Date.now(), timeOrigin: Date.now() };
  },
});
const W = dom.window;
const frames = n => new Promise(r => { let i = 0; const t = () => (++i >= n ? r() : W.requestAnimationFrame(t)); W.requestAnimationFrame(t); });
(async () => {
  await frames(6);
  const D = W.FarmDebug, api = D.api, st = () => D.state;
  /* 造一个大农场：直接铺地块（和真实结构一致） */
  st().farm.w = N; st().farm.h = N; st().map.w = N; st().map.h = N;
  const tiles = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    tiles.push({ gx: x, gy: y, terrain: 'tilled', state: 'growing', crop: 'carrot',
      growth: 1000 + (x * 7 + y * 13) % 30000, watered: (x + y) % 2 === 0, fertile: x % 3 === 0,
      harvestsLeft: 0, fertLeft: 0, stone: false });
  }
  st().tiles = tiles;
  st().map = { x0: 0, y0: 0, w: N, h: N };
  st().farm = { x0: 0, y0: 0, w: N, h: N };
  D.buildDrawOrder();          /* 关键：不重建的话只画原来那 9 块地，量出来是假的 */
  st().cameraAuto = false; st().zoomMode = 'auto';
  st().camera.x = 0; st().camera.y = 0;
  api.centerOnFarm();

  const run = (label, setup) => {
    if (setup) setup();
    ops = 0;
    for (const k in byName) delete byName[k];
    const t0 = Date.now();
    for (let i = 0; i < FRAMES; i++) D.render();
    const ms = (Date.now() - t0) / FRAMES;
    const top = Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([k, v]) => k + ':' + Math.round(v / FRAMES)).join(' ');
    console.log(label.padEnd(26), String(Math.round(ops / FRAMES)).padStart(7), 'ops/帧',
      String(ms.toFixed(2)).padStart(7), 'ms/帧   ', top);
  };
  console.log('农场', N + '×' + N, '=', st().tiles.length, '块地，画布 1200×900，', FRAMES, '帧平均');
  console.log('  zoom=' + Number(api.viewZoom()).toFixed(3) + ' → 屏幕格子宽 ' + (76.8 * Number(api.viewZoom())).toFixed(1) + 'px' +
    '（LOD 阈值：≥34px 全细节 / ≥30px 减半 / 更小只留底色）\n');
  run('① 耕地 + 作物（基准）');
  const restore = () => { for (const t of st().tiles) { t.state = 'growing'; t.crop = 'carrot'; t.growth = 8000 + ((t.gx * 13 + t.gy * 7) % 20000); } st().showCropBars = true; st().showGrid = false; };
  run('② 关掉作物进度条', () => { st().showCropBars = false; });
  run('③ 进度条恢复', () => { st().showCropBars = true; });
  run('④ 耕地无作物', () => { for (const t of st().tiles) t.crop = null; restore(); api.closeSheet && null; });
  run('⑤ 框选拖动中 8×8', () => { st().box = { x0: 2, y0: 2, x1: 9, y1: 9 }; });
  run('⑥ 作业中 24×24（只描边）', () => { st().box = null; st().jobBox = { x0: 2, y0: 2, x1: 25, y1: 25 }; });
  run('⑦ 雨天', () => { st().jobBox = null; api.ATMOS.weather = 'rain'; });
  /* 静态帧：相机/地块都不动 → 地表层命中缓存（这是"盯着看作物长/小人干活"时的真实开销） */
  st().showCropBars = true; api.ATMOS.weather = 'clear';
  const runStatic = (label, setup, jiggle) => {
    if (setup) setup();
    ops = 0; for (const k in byName) delete byName[k];
    D.render();                                   /* 预热，把缓存烧好 */
    ops = 0; for (const k in byName) delete byName[k];
    const t0 = Date.now();
    for (let i = 0; i < FRAMES; i++){
      if (jiggle) st().camera.x += 0.001;         /* 强制缓存未命中 */
      D.render();
    }
    const ms = (Date.now() - t0) / FRAMES;
    const top = Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, v]) => k + ':' + Math.round(v / FRAMES)).join(' ');
    console.log(label.padEnd(26), String(Math.round(ops / FRAMES)).padStart(7), 'ops/帧',
      String(ms.toFixed(2)).padStart(7), 'ms/帧   ', top);
  };
  runStatic('⑧ 静态帧（命中缓存）');
  runStatic('⑨ 静态帧·强制重画', null, true);
  runStatic('⑩ 静态·进度条关+命中', () => { st().showCropBars = false; });
  runStatic('⑪ 静态·无作物', () => { for (const t of st().tiles) { t.state = 'wild'; t.crop = null; } });
  runStatic('⑫ 静态·全草地命中', null, false);
  W.close();
})();
