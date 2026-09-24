#!/usr/bin/env node
/* 真实渲染验证：jsdom 提供 DOM，@napi-rs/canvas（Skia）提供真实 2D 上下文，
 * 跑若干帧后把主画布导出 PNG，用来肉眼检查画面。
 *
 *   node tools/render.js <html> <out.png> [--frames=8] [--hour=8] [--weather=clear] [--setup=js]
 * --setup 里可以写一小段 JS（在渲染前执行，可用 D = window.FarmDebug）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const FILE = argv[0] || path.join(__dirname, '..', 'farm.html');
const OUT = argv[1] || '/tmp/farm-shot.png';
const opt = (k, d) => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const FRAMES = parseInt(opt('frames', '10'), 10);
const HOUR = opt('hour', '');
const WEATHER = opt('weather', '');
const SETUP = opt('setup', '');

function req(name) {
  const cands = [name, path.join('/home/loli/deepseek-harness/node_modules', name)];
  /* pnpm 仓库里的包：node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg> */
  const pnpm = '/home/loli/deepseek-harness/node_modules/.pnpm';
  try {
    const flat = name.replace('/', '+');
    for (const d of fs.readdirSync(pnpm)) {
      if (d.startsWith(flat + '@')) cands.push(path.join(pnpm, d, 'node_modules', name));
    }
  } catch (e) {}
  for (const t of cands) { try { return require(t); } catch (e) {} }
  console.error('✗ 缺少依赖 ' + name + '（试过 ' + cands.length + ' 个路径）');
  process.exit(2);
}
const { JSDOM, VirtualConsole } = req('jsdom');
const napi = req('@napi-rs/canvas');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => { const m = String((e && e.message) || e); if (!/Not implemented/.test(m)) errors.push(m); });
vc.on('error', (...a) => errors.push(a.map(String).join(' ')));

const W0 = parseInt(opt('w', '1280'), 10), H0 = parseInt(opt('h', '800'), 10);

const dom = new JSDOM(fs.readFileSync(FILE, 'utf8'), {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole: vc,
  beforeParse(window) {
    const holders = new WeakMap();
    window.HTMLCanvasElement.prototype.getContext = function (type) {
      if (type !== '2d') return null;
      const el = this;
      if (!holders.has(el)) holders.set(el, { c: napi.createCanvas(el.width || W0, el.height || H0) });
      const h = holders.get(el);
      const sync = () => {
        const w = el.width || W0, hh = el.height || H0;
        if (h.c.width !== w || h.c.height !== hh) h.c = napi.createCanvas(w, hh);
      };
      const real = () => h.c.getContext('2d');
      return new Proxy({}, {
        get(_, k) {
          if (k === '__napi') return h.c;
          if (k === 'canvas') return { width: el.width || W0, height: el.height || H0 };
          if (k === 'setTransform') return (...a) => { sync(); return real().setTransform(...a); };
          const t = real();
          const v = t[k];
          return typeof v === 'function' ? (...a) => v.apply(t, a) : v;
        },
        set(_, k, v) { real()[k] = v; return true; },
        has() { return true; },
      });
    };
    window.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:,'; };
    window.Element.prototype.animate = function () { return { cancel() {}, finished: Promise.resolve(), onfinish: null }; };
    Object.defineProperty(window, 'innerWidth', { value: W0, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: H0, configurable: true });
  },
});

const W = dom.window;
const frames = n => new Promise(res => { let i = 0; const tick = () => (++i >= n ? res() : W.requestAnimationFrame(tick)); W.requestAnimationFrame(tick); });

(async () => {
  await frames(4);
  const D = W.FarmDebug;
  if (!D) { console.error('✗ 没有 FarmDebug'); process.exit(1); }
  if (HOUR || WEATHER) D.api.setAtmos(HOUR === '' ? null : parseFloat(HOUR), WEATHER || null);

  /* 造一点场景：先把岛扩到有地方摆，再种满几种作物 */
  const st = D.state;
  st.coins = 99999; st.fertilizer = 9; st.premium = 9;
  D.api.toggleExpandMode(false);
  for (let i = 0; i < 3; i++) { D.api.doExpand('xp'); D.api.doExpand('yp'); }
  const f = st.farm;
  D.api.setTool('hoe');
  const layout = [
    [f.x0 + 0, f.y0 + 0, 'carrot', 0.15], [f.x0 + 1, f.y0 + 0, 'potato', 0.5],
    [f.x0 + 2, f.y0 + 0, 'rice', 0.85],   [f.x0 + 3, f.y0 + 0, 'wheat', 1],
    [f.x0 + 0, f.y0 + 1, 'chili', 0.6],   [f.x0 + 1, f.y0 + 1, 'eggplant', 1],
    [f.x0 + 2, f.y0 + 1, 'tomato', 0.35], [f.x0 + 3, f.y0 + 1, 'carrot', 1],
  ];
  for (const [gx, gy, id, r] of layout) {
    const t = D.api.getTile(gx, gy);
    if (!t) continue;
    t.terrain = 'tilled'; t.state = 'growing'; t.crop = id; t.stone = false;
    t.growth = D.api.cropReadyMs(D.api.CROPS[id]) * r; t.watered = r < 0.5; t.harvestsLeft = D.api.CROPS[id].harvests || 0;
  }
  if (SETUP) { try { new Function('D', 'W', SETUP)(D, W); } catch (e) { console.error('setup 失败', e); } }

  await frames(FRAMES);

  /* 找到主画布对应的 napi canvas：直接再渲染一次并导出 */
  const game = W.document.getElementById('game');
  const ctxProxy = game.getContext('2d');
  ctxProxy.setTransform(1, 0, 0, 1, 0, 0);
  /* 触发一次 render：通过 requestAnimationFrame 已经渲染过，这里直接导出后备 canvas */
  const holders = (() => {
    const c = napi.createCanvas(game.width || W0, game.height || H0);
    const g = c.getContext('2d');
    g.drawImage(ctxProxy.__napi, 0, 0);
    return c;
  })();

  fs.writeFileSync(OUT, holders.toBuffer('image/png'));  console.log(`✓ 已渲染 ${FRAMES} 帧 → ${OUT}  (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)` +
    (HOUR ? ` hour=${HOUR}` : '') + (WEATHER ? ` weather=${WEATHER}` : ''));
  if (errors.length) console.log('⚠ 页面异常: ' + errors.slice(0, 3).join(' | '));
  dom.window.close();
  process.exit(0);
})().catch(e => { console.error('渲染崩溃', e); process.exit(1); });
