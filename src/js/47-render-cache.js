/* ============ 渲染引擎（v9.32）：分层缓存 ============
 *
 * 老渲染每一帧都把整个世界重画一遍：地块 3 个面 + 上千粒砂土、每格的地面细节、
 * 每株作物的曲线、每棵树的矢量树冠……即使画面完全不动也在重复光栅化。
 * 真机上卡的不是"JS 算不过来"，而是 canvas 光栅化 + draw call 太多。
 *
 * 新引擎按「变化的频率」分层：
 *   ① 天空层   —— 只随小时/天气/尺寸变；量化后缓存成一张图（drawImage ×1）
 *   ② 地表层   —— 地块 + 静态地面细节 + 边界/网格，只在相机/缩放/地块外观变时重画；
 *                 相机平移带 margin，小范围拖动直接平移缓存，不重画
 *   ③ 作物层   —— 每株作物按 (作物, 生长档, 浇水/施肥/多收/成熟) 预渲染成小精灵
 *   ④ 装饰层   —— 每件装饰按 (类型, seed 档, 连接掩码, 夜间点亮) 预渲染成小精灵
 *   ⑤ 动态层   —— 小人、粒子、雨、云影、交互 UI 每帧照画（本来就该动）
 *
 * 渐变类（太阳/月亮/云影/悬浮岛光晕）也烧成小图，每帧只 drawImage；
 * 星星按透明度分桶，一条路径一次填充。
 *
 * 质量阀门：window.FARM_RENDER_CONFIG / ?render=high|balanced|fast。
 * high = 关掉所有缓存（矢量重画，最清晰但最慢），fast = 全部缓存。
 */
const RENDER_CONFIG = {
  staticGround: true,      /* 地表整层缓存 */
  groundMargin: 128,       /* 相机平移 margin（CSS px），小范围拖动不重画地表 */
  skyCache: true,          /* 天空渐变缓存 */
  glowSprites: true,       /* 太阳/月亮/云影/光晕烧成小图 */
  cropSprites: true,       /* 作物精灵 */
  cropBarSprites: true,    /* 把生长进度条也烘进作物精灵（低倍率下 12 档，省 2 次 fillRect/株） */
  decorSprites: true,      /* 装饰精灵 */
  decorMaxZoom: 1.05,      /* 超过这个倍率装饰走矢量（放大不糊） */
  spriteDPR: 2,            /* 精灵最多按 2x 设备像素烘焙 */
};
(function applyRenderQuality(){
  const q = (typeof location !== 'undefined') ? (location.search + location.hash) : '';
  const m = /[?&#]render=(high|balanced|fast)/.exec(q);
  const preset = m ? m[1] : '';
  if(preset === 'high'){
    RENDER_CONFIG.staticGround = false;
    RENDER_CONFIG.skyCache = false;
    RENDER_CONFIG.glowSprites = false;
    RENDER_CONFIG.cropSprites = false;
    RENDER_CONFIG.decorSprites = false;
  } else if(preset === 'fast'){
    RENDER_CONFIG.groundMargin = 192;
  }
  /* 允许页面/插件覆盖（调试用），不写存档 */
  if(typeof window !== 'undefined' && window.FARM_RENDER_CONFIG){
    for(const k in window.FARM_RENDER_CONFIG) RENDER_CONFIG[k] = window.FARM_RENDER_CONFIG[k];
  }
})();

const renderStats = {
  frames: 0,
  terrainHit: 0, terrainBake: 0,
  skyHit: 0, skyBake: 0,
  decorDraw: 0, decorBake: 0, decorHit: 0, decorMiss: 0,
  lastBakeMs: 0,
};

function invalidateRenderCaches(){
  if(typeof terrainCache !== 'undefined' && terrainCache) terrainCache.sig = null;
  if(typeof skyCache !== 'undefined' && skyCache) skyCache.sig = 0;
  if(typeof decorSpriteCache !== 'undefined' && decorSpriteCache) decorSpriteCache.clear();
  if(typeof cropSpriteCache === 'object' && cropSpriteCache){
    for(const k in cropSpriteCache) delete cropSpriteCache[k];
  }
}
/* ============================================================
 * 图层工具
 * ============================================================ */
function newLayerCanvas(w, h){
  try{
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w));
    cv.height = Math.max(1, Math.ceil(h));
    const g = cv.getContext('2d');
    if(!g) return null;
    return { canvas: cv, g };
  }catch(e){ return null; }
}
/* 离屏缓存的分辨率上限：普通屏按 DPR，4K/超宽屏按像素预算降一点，
 * 避免一张地表缓存就吃掉上百 MB（主画布本身已经很大了）。 */
function cacheDprFor(w, h, dpr){
  const area = Math.max(1, w * h);
  const byBudget = Math.sqrt(12e6 / area);      /* 约 48MB RGBA */
  return Math.max(1, Math.min(dpr || 1, 3, byBudget));
}
/* ============================================================
 * ① 地表层缓存
 * ============================================================ */
let terrainCache = null;
/* 地块外观码：tileColors() 用到的字段 + 地形边界用到的 terrain。
   任何一个变了都必须重画（漏一个就会留下肉眼可见的错画面）。 */
function groundTileCode(t){
  let c = 0;
  if(t.terrain === 'tilled') c |= 1;
  else if(t.terrain === 'stone') c |= 2;
  if(t.stone) c |= 4;
  if(t.state === 'ready') c |= 8;
  else if(t.state === 'wild') c |= 16;
  else if(t.state === 'growing') c |= 32;
  else if(t.state === 'tilled') c |= 64;
  if(t.state === 'growing' && t.harvestsLeft > 0) c |= 128;
  if(t.watered) c |= 256;
  if(t.fertile || (t.fertLeft || 0) > 0) c |= 512;
  return c;
}
function hashMix(h, v){ return Math.imul(h ^ (v | 0), 16777619); }
function terrainSignature(zoom, dpr, W0, H0){
  let h = 2166136261;
  h = hashMix(h, state.tiles.length);
  h = hashMix(h, state.map.x0); h = hashMix(h, state.map.y0);
  h = hashMix(h, state.map.w); h = hashMix(h, state.map.h);
  h = hashMix(h, state.showGrid ? 1 : 0);
  h = hashMix(h, Math.round(zoom * 1000));
  h = hashMix(h, dpr * 100);
  h = hashMix(h, W0); h = hashMix(h, H0);
  const list = drawOrder;
  const n = list.length;
  for(let i = 0; i < n; i++){
    const t = state.tiles[list[i]];
    if(!t) continue;
    h = hashMix(h, t.gx * 73856093 + t.gy * 19349663);
    h = hashMix(h, groundTileCode(t));
  }
  /* 水塘的湿润光晕烘在地表缓存里：水塘位置/seed 变了必须重画 */
  const decos = state.decorations || [];
  for(let i = 0; i < decos.length; i++){
    const d = decos[i];
    if(d.type !== 'pond') continue;
    h = hashMix(h, d.gx * 31 + d.gy * 17 + (d.seed | 0));
  }
  return h | 0;
}
function terrainCacheFor(W0, H0, zoom, dpr){
  const P = Math.max(0, RENDER_CONFIG.groundMargin | 0);
  const eff = cacheDprFor(W0 + P * 2, H0 + P * 2, dpr);
  const cw = Math.ceil((W0 + P * 2) * eff), ch = Math.ceil((H0 + P * 2) * eff);
  if(terrainCache && terrainCache.canvas.width === cw && terrainCache.canvas.height === ch &&
     terrainCache.dpr === eff){
    return terrainCache;
  }
  const layer = newLayerCanvas(cw, ch);
  if(!layer) return null;
  terrainCache = {
    canvas: layer.canvas, g: layer.g,
    sig: null, camX: 0, camY: 0, zoom: 0, dpr: eff, W0: 0, H0: 0, P,
  };
  return terrainCache;
}
/* 把静态地表画进缓存。目标映射：cache 像素 = 主画布像素 + P（同一台相机时），
 * 这样四周各留 P 像素的平移余量。推导见下面函数内注释。
 * 因此放大时仍用「以画布中心为锚点」的缩放，左右/上下各多出 P 像素。 */
function bakeTerrain(cache, W0, H0, zoom, sig){
  const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
  const P = cache.P;
  const Wc = (W0 + P * 2) / zoom, Hc = (H0 + P * 2) / zoom;
  const oldW = W, oldH = H, oldZoom = renderZoom;
  const g = cache.g;
  /* 先把整张缓存清干净（此时用设备像素变换），再切到「缓存原点 = 主视口左上角 - P」。
   * 绘制坐标系 p' 的原点因此比主画布多出 P/zoom 的世界距离；
   * 变换直接用 scale(zoom)（没有平移），所以 cache 像素 = zoom * p'，
   * 主画布中心 + P 正好落在缓存中心 —— 四周各留 P 像素平移余量。 */
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cache.canvas.width, cache.canvas.height);
  g.setTransform(cache.dpr * zoom, 0, 0, cache.dpr * zoom, 0, 0);
  W = Wc; H = Hc; renderZoom = zoom;
  const cx = Wc / 2 + state.camera.x;
  const cy = Hc / 2 + state.camera.y;
  withCtx(g, () => {
    drawTilePass(cx, cy);
    if(typeof drawGroundStatic === 'function') drawGroundStatic(g, cx, cy);
    if(state.showGrid) drawGridPass(cx, cy);
    else drawTerrainBoundaries(cx, cy);
  });
  W = oldW; H = oldH; renderZoom = oldZoom;
  cache.sig = sig;
  cache.camX = state.camera.x; cache.camY = state.camera.y;
  cache.zoom = zoom; cache.dpr = cache.dpr || DPR;
  renderStats.terrainBake++;
  renderStats.lastBakeMs = ((typeof performance !== 'undefined') ? performance.now() : 0) - t0;
}
/* 返回 true = 已画（命中或刚烘焙）；false = 不能用缓存，调用方走矢量直画 */
function drawTerrainCached(W0, H0, zoom, dpr){
  if(!RENDER_CONFIG.staticGround || !state.tiles.length) return false;
  const cache = terrainCacheFor(W0, H0, zoom, dpr);
  if(!cache) return false;
  const sig = terrainSignature(zoom, dpr, W0, H0);
  const dx = zoom * (state.camera.x - cache.camX);
  const dy = zoom * (state.camera.y - cache.camY);
  const P = cache.P;
  if(cache.sig !== sig || cache.zoom !== zoom || Math.abs(dx) > P || Math.abs(dy) > P){
    bakeTerrain(cache, W0, H0, zoom, sig);
  } else {
    renderStats.terrainHit++;
  }
  /* 缓存是设备像素，这里按 CSS 尺寸贴回去（浏览器负责 DPR 缩放） */
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.drawImage(cache.canvas, -P + dx, -P + dy, W0 + P * 2, H0 + P * 2);
  ctx.restore();
  return true;
}
/* ============================================================
 * ② 天空渐变缓存
 * ============================================================ */
let skyCache = null;
function drawSkyCached(g){
  if(!RENDER_CONFIG.skyCache) return false;
  const dpr = cacheDprFor(W, H, DPR), w = W, h = H;
  if(!skyCache || skyCache.w !== w || skyCache.h !== h || skyCache.dpr !== dpr){
    const layer = newLayerCanvas(w * dpr, h * dpr);
    if(!layer) return false;
    skyCache = { canvas: layer.canvas, g: layer.g, w, h, dpr, sig: '' };
  }
  /* 小时量化到 0.02h（约 1 秒游戏时间），天气变化立即重烧 */
  const sig = Math.round(ATMOS.hour * 50) + '|' + ATMOS.weather + '|' + w + '|' + h + '|' + dpr;
  if(skyCache.sig !== sig){
    const l = skyCache.g;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.clearRect(0, 0, skyCache.canvas.width, skyCache.canvas.height);
    l.setTransform(dpr, 0, 0, dpr, 0, 0);
    withCtx(l, () => atmDrawSky(l));
    skyCache.sig = sig;
    renderStats.skyBake++;
  } else {
    renderStats.skyHit++;
  }
  g.save();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.drawImage(skyCache.canvas, 0, 0, w, h);
  g.restore();
  return true;
}
/* ============================================================
 * ③ 渐变精灵（太阳 / 月亮 / 云影 / 悬浮岛光晕）
 * ============================================================ */
const glowSpriteCache = new Map();
const GLOW_SPRITE_SIZE = 192;
function glowSpriteFor(key, stops){
  const hit = glowSpriteCache.get(key);
  if(hit !== undefined) return hit;
  const layer = newLayerCanvas(GLOW_SPRITE_SIZE, GLOW_SPRITE_SIZE);
  if(!layer) { glowSpriteCache.set(key, null); return null; }
  const g = layer.g, r = GLOW_SPRITE_SIZE / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  for(let i = 0; i < stops.length; i++){
    const s = stops[i];
    grd.addColorStop(s[0], 'rgba(' + s[1] + ',' + s[2] + ')');
  }
  g.fillStyle = grd;
  g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  glowSpriteCache.set(key, layer.canvas);
  /* 上限：这些图都很小，正常只有十几种组合 */
  if(glowSpriteCache.size > 64){
    const first = glowSpriteCache.keys().next().value;
    glowSpriteCache.delete(first);
  }
  return layer.canvas;
}
function drawGlow(g, key, stops, cx, cy, rx, ry, alpha){
  if(!RENDER_CONFIG.glowSprites || !(alpha > 0.001)) return false;
  const spr = glowSpriteFor(key, stops);
  if(!spr) return false;
  const old = g.globalAlpha;
  g.globalAlpha = old * alpha;
  g.drawImage(spr, cx - rx, cy - ry, rx * 2, ry * 2);
  g.globalAlpha = old;
  return true;
}
/* ============================================================
 * ④ 装饰精灵缓存
 * ============================================================ */
/* 每种装饰的绘制包围盒（艺术坐标，基点 = 格子中心）。
 * 宁可留宽一点：裁掉一个角比多几像素内存严重得多。 */
const DECOR_SPR_BOX = {
  tree:      [-52, 52, -100, 22],
  rock:      [-28, 28, -32, 16],
  bush:      [-32, 32, -40, 16],
  flower:    [-28, 28, -44, 16],
  mushroom:  [-28, 28, -34, 16],
  sunflower: [-30, 30, -52, 16],
  bamboo:    [-40, 40, -62, 16],
  pine:      [-34, 34, -56, 16],
  lantern:   [-24, 24, -42, 16],
  well:      [-38, 38, -44, 18],
  statue:    [-34, 34, -58, 16],
  chair:     [-38, 38, -48, 20],
  table:     [-42, 42, -50, 22],
  bench:     [-44, 44, -50, 20],
  plant:     [-30, 30, -38, 16],
  fence:     [-104, 104, -84, 26],
  /* 铺装（地面）：本身是平地，但碎石/砖缝的矢量调用不少，缩小时也值得烘 */
  path:      [-48, 48, -30, 30],
  brick:     [-48, 48, -30, 30],
  tileRed:   [-44, 44, -26, 26],
  tileBlue:  [-44, 44, -26, 26],
  tileJade:  [-44, 44, -26, 26],
  marble:    [-44, 44, -26, 26],
};
const decorSpriteCache = new Map();
const DECOR_SPR_LIMIT = 480;
let decorSpriteDpr = 0;
function decorSpriteFor(d){
  if(!RENDER_CONFIG.decorSprites || !d || !DECOR_SPR_BOX[d.type]) return null;
  if(renderZoom > RENDER_CONFIG.decorMaxZoom) return null;
  const box = DECOR_SPR_BOX[d.type];
  if(decorSpriteDpr !== DPR){
    decorSpriteCache.clear();
    decorSpriteDpr = DPR;
  }
  const mask = (d.type === 'fence' && typeof fenceConnMask === 'function') ? fenceConnMask(d)
    : ((d.type === 'path' || d.type === 'brick') && typeof pathConnMask === 'function') ? pathConnMask(d) : 0;
  const lit = (d.type === 'lantern' && ATMOS && (ATMOS.hour >= 18.5 || ATMOS.hour < 5.5)) ? 1 : 0;
  const seedV = (d.seed >>> 0) & 7;
  const key = d.type + '|' + seedV + '|' + mask + '|' + lit;
  const hit = decorSpriteCache.get(key);
  if(hit !== undefined){
    if(!hit){ renderStats.decorMiss++; return null; }
    /* LRU：命中后挪到末尾 */
    decorSpriteCache.delete(key); decorSpriteCache.set(key, hit);
    renderStats.decorHit++;
    return hit;
  }
  const scale = Math.min(RENDER_CONFIG.spriteDPR, DPR || 1);
  const w = box[1] - box[0], h = box[3] - box[2];
  const layer = newLayerCanvas(w * scale, h * scale);
  if(!layer){ decorSpriteCache.set(key, null); return null; }
  const g = layer.g;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.translate(-box[0], -box[2]);
  const oldT = (typeof decorTimeOverride !== 'undefined') ? decorTimeOverride : undefined;
  if(typeof decorTimeOverride !== 'undefined') decorTimeOverride = 0;
  try{
    if(typeof decorDrawBody === 'function') decorDrawBody(g, 0, 0, d);
    else return null;
  } finally {
    if(typeof decorTimeOverride !== 'undefined') decorTimeOverride = oldT;
  }
  const sp = { canvas: layer.canvas, w, h, ox: box[0], oy: box[2] };
  decorSpriteCache.set(key, sp);
  renderStats.decorBake++;
  if(decorSpriteCache.size > DECOR_SPR_LIMIT){
    const first = decorSpriteCache.keys().next().value;
    decorSpriteCache.delete(first);
  }
  return sp;
}
/* ============================================================
 * 渲染质量切换（控制台 / 插件可用）
 * ============================================================ */
function setRenderQuality(name){
  const q = String(name || 'balanced');
  const on = q !== 'high';
  RENDER_CONFIG.staticGround = on;
  RENDER_CONFIG.skyCache = on;
  RENDER_CONFIG.glowSprites = on;
  RENDER_CONFIG.cropSprites = on;
  RENDER_CONFIG.cropBarSprites = on;
  RENDER_CONFIG.decorSprites = on;
  RENDER_CONFIG.groundMargin = (q === 'fast') ? 192 : 128;
  invalidateRenderCaches();
  return q;
}

/* 系统 emoji 字体是异步就绪的：若首帧在字体加载前烘了水滴/肥料图标，会缺字。
 * 字体一就绪就把精灵缓存全部作废，下一帧重烘（只发生一次）。 */
if(typeof document !== 'undefined' && document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function'){
  document.fonts.ready.then(() => { try{ invalidateRenderCaches(); }catch(e){} });
}
