/* ============ 性能面板（v9.32） ============
 *
 * 目标不是"猜"哪里慢，而是随时能看到：
 *   · FPS / 渲染耗时 p50·p95
 *   · 每帧主画布 draw call 数 + 每秒调用 + 分项排行
 *   · 场景规模（地块/装饰/粒子/作业）与精灵烘焙、图层缓存命中
 *
 * 默认关闭。打开方式：设置里「性能面板」、Shift+P、URL 加 ?perf 或 #perf。
 * 只有打开时才会给主 canvas ctx 套计数代理；关闭后恢复原对象，零额外开销。
 */
const PERF = {
  enabled: false,
  realCtx: null,
  probe: null,
  calls: 0,
  byName: Object.create(null),
  frameCalls: 0,
  frameBy: Object.create(null),
  frameMs: 0,
  msBuf: [],
  fps: 0,
  fpsFrames: 0,
  fpsAt: 0,
  lastHudAt: 0,
  hud: null,
  text: null,
};
const PERF_BUF_MAX = 180;

function perfMakeProbe(target){
  const wrapped = Object.create(null);
  return new Proxy(target, {
    get(t, k){
      if(k === 'canvas') return t.canvas;
      const v = t[k];
      if(typeof v !== 'function') return v;
      let f = wrapped[k];
      if(!f){
        f = function(...args){
          PERF.calls++;
          PERF.byName[k] = (PERF.byName[k] || 0) + 1;
          return v.apply(t, args);
        };
        wrapped[k] = f;
      }
      return f;
    },
    set(t, k, v){ t[k] = v; return true; },
    has(t, k){ return k in t; },
  });
}
function perfSetEnabled(on){
  on = !!on;
  if(on === PERF.enabled) return;
  PERF.enabled = on;
  if(on){
    PERF.realCtx = ctx;
    PERF.probe = perfMakeProbe(ctx);
    ctx = PERF.probe;
    if(!PERF.hud) perfCreateHud();
    if(PERF.hud) PERF.hud.style.display = 'block';
    PERF.msBuf.length = 0;
    PERF.calls = 0;
    for(const k in PERF.byName) delete PERF.byName[k];
  } else {
    if(PERF.probe && ctx === PERF.probe) ctx = PERF.realCtx;
    if(PERF.hud) PERF.hud.style.display = 'none';
  }
  perfHudUpdate(true);
}
function perfToggle(){
  const on = !PERF.enabled;
  if(typeof state !== 'undefined' && state) state.perfHud = on;
  perfSetEnabled(on);
  if(typeof toast === 'function') toast(on ? '性能面板：开（Shift+P 关闭）' : '性能面板：关', on ? 'chart' : null);
  if(typeof save === 'function') save();
}
function perfCreateHud(){
  try{
    const box = document.createElement('div');
    box.id = 'perfHud';
    box.className = 'perf-hud';
    const pre = document.createElement('pre');
    pre.className = 'perf-hud-text';
    box.appendChild(pre);
    document.body.appendChild(box);
    PERF.hud = box;
    PERF.text = pre;
  }catch(e){ PERF.hud = null; }
}
function perfPct(arr, p){
  if(!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))];
}
function perfFrame(t0, t1){
  if(!PERF.enabled) return;
  const ms = t1 - t0;
  PERF.frameMs = ms;
  PERF.msBuf.push(ms);
  if(PERF.msBuf.length > PERF_BUF_MAX) PERF.msBuf.shift();
  PERF.frameCalls = PERF.calls;
  PERF.frameBy = PERF.byName;
  PERF.calls = 0;
  PERF.byName = Object.create(null);
  renderStats.frames++;
  perfHudUpdate(false, t1);
}
function perfTick(now){
  if(!PERF.enabled){
    PERF.fpsFrames = 0;
    PERF.fpsAt = now;
    return;
  }
  PERF.fpsFrames++;
  const dt = now - PERF.fpsAt;
  if(dt >= 500){
    PERF.fps = Math.round(PERF.fpsFrames * 1000 / dt);
    PERF.fpsFrames = 0;
    PERF.fpsAt = now;
  }
}
function perfHudUpdate(force, now){
  if(!PERF.enabled || !PERF.text) return;
  const t = now || ((typeof performance !== 'undefined') ? performance.now() : Date.now());
  if(!force && t - PERF.lastHudAt < 250) return;
  PERF.lastHudAt = t;
  const by = PERF.frameBy || {};
  const top = Object.keys(by).sort((a, b) => by[b] - by[a]).slice(0, 8);
  const total = PERF.frameCalls;
  const perSec = Math.round(total * (PERF.fps || 0));
  const scene = (typeof state !== 'undefined' && state) ? state : null;
  const q = scene && scene.player ? ((scene.player.queue ? scene.player.queue.length : 0) +
    (scene.player.pendingOp ? 1 : 0)) : 0;
  const cropDraw = (typeof cropSpriteStats !== 'undefined') ? cropSpriteStats.drawn : 0;
  const cropBake = (typeof cropSpriteStats !== 'undefined') ? cropSpriteStats.baked : 0;
  const lines = [];
  lines.push('FPS ' + (PERF.fps || 0) + '    每帧 ' + fmtK(total));
  lines.push('渲染耗时 p50 ' + perfPct(PERF.msBuf, 0.5).toFixed(1) + 'ms  p95 ' + perfPct(PERF.msBuf, 0.95).toFixed(1) + 'ms');
  lines.push('每秒调用 ' + fmtK(perSec));
  lines.push('── 每帧调用');
  lines.push('总计      ' + fmtK(total));
  for(const k of top) lines.push(k.padEnd(9, ' ') + ' ' + fmtK(by[k]));
  lines.push('── 场景');
  lines.push('地块 ' + (scene ? scene.tiles.length : 0) + '    装饰 ' + (scene ? scene.decorations.length : 0));
  lines.push('粒子 ' + (typeof particles !== 'undefined' ? particles.length : 0) + '    作业队列 ' + q);
  lines.push('精灵 画/烘 ' + fmtK(cropDraw) + ' / ' + fmtK(cropBake));
  lines.push('装饰 画/烘 ' + fmtK(renderStats.decorDraw) + ' / ' + fmtK(renderStats.decorBake));
  lines.push('层缓存 地形 ' + fmtK(renderStats.terrainHit) + '/' + fmtK(renderStats.terrainBake) +
    '  天空 ' + fmtK(renderStats.skyHit) + '/' + fmtK(renderStats.skyBake));
  PERF.text.textContent = lines.join('\n');
}
function fmtK(n){
  n = n || 0;
  if(n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if(n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(Math.round(n));
}
function perfSnapshot(){
  return {
    enabled: PERF.enabled,
    fps: PERF.fps,
    frameCalls: PERF.frameCalls,
    frameMs: PERF.frameMs,
    p50: perfPct(PERF.msBuf, 0.5),
    p95: perfPct(PERF.msBuf, 0.95),
    byName: Object.assign({}, PERF.frameBy),
    scene: (typeof state !== 'undefined' && state) ? {
      tiles: state.tiles.length,
      decorations: state.decorations.length,
      particles: (typeof particles !== 'undefined') ? particles.length : 0,
      queue: (state.player && state.player.queue) ? state.player.queue.length : 0,
    } : null,
    sprite: (typeof cropSpriteStats !== 'undefined') ? Object.assign({}, cropSpriteStats) : null,
    layers: Object.assign({}, renderStats),
  };
}
function perfAutoEnable(){
  let on = false;
  try{
    const s = (location.search || '') + (location.hash || '');
    on = /[?&#]perf\b/.test(s);
  }catch(e){}
  if(!on && typeof state !== 'undefined' && state) on = !!state.perfHud;
  if(on) perfSetEnabled(true);
}
/* Shift+P：避开已经占用的 P（平移） */
if(typeof window !== 'undefined' && window.addEventListener){
  window.addEventListener('keydown', e => {
    if(!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    if(e.key !== 'P' && e.key !== 'p') return;
    const tag = (e.target && e.target.tagName) || '';
    if(tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;
    e.preventDefault();
    perfToggle();
  });
}
