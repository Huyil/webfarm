/* ============ 画布 ============ */
const canvas = document.getElementById('game');
let ctx = canvas.getContext('2d');          /* let：地表缓存要把同一套绘制临时画进离屏 canvas */
let W = 0, H = 0, UI_SCALE = 1, DPR = 1;
/* 把全局 ctx 临时换成别的（只为地表缓存服务；里面只画地块，不会碰到别的层） */
function withCtx(tmp, fn){
  const old = ctx;
  ctx = tmp;
  try { fn(); } finally { ctx = old; }
}
function resize(){
  const dpr = window.devicePixelRatio || 1;
  DPR = dpr;
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function applyUIScale(){
  const s = Math.min(1, Math.min(window.innerWidth / 900, window.innerHeight / 700));
  UI_SCALE = Math.max(0.6, s);
  document.documentElement.style.setProperty('--ui-scale', UI_SCALE.toFixed(3));
}
function centerOn(gx, gy){
  const { sx, sy } = iso(gx, gy);
  state.camera.x = -sx * SCALE; state.camera.y = -sy * SCALE;
}

/* ============ 视角缩放 ============ */
/* 窄屏（手机 / 竖屏）：和手机版 UI 用同一套判定 */
function isNarrowView(){
  try {
    if(window.matchMedia && window.matchMedia('(orientation: portrait), (max-width: 620px)').matches) return true;
  } catch(_){}
  return window.innerWidth <= 620;
}
/* 自动倍率：
 *   宽屏 —— 让整块农场落在视口内（两者取小，封顶 ZOOM_AUTO_MAX）。
 *   窄屏 —— **铺满宽度**为准：以前被 1.6x 封顶，小农场在手机上两侧留一大片空白；
 *           铺满宽度后如果上下超出视口，就交给「卷轴式」渲染（相机跟随小人 + 可拖看），
 *           而不是把整个农场缩成中间一小块。 */
function autoZoom(){
  const f = state.farm;
  const spanX = Math.max(1, (f.w + f.h) * HALF_W * SCALE);
  const spanY = Math.max(1, (f.w + f.h) * HALF_H * SCALE);
  const zx = (W * ZOOM_AUTO_PAD) / spanX;
  const zy = (H * ZOOM_AUTO_PAD) / spanY;
  if(isNarrowView()){
    const z = (spanY * zx <= H * ZOOM_AUTO_PAD) ? Math.min(zx, zy) : zx;
    return Math.max(ZOOM_MIN, Math.min(ZOOM_FILL_MAX, z));
  }
  return Math.max(ZOOM_MIN, Math.min(ZOOM_AUTO_MAX, Math.min(zx, zy)));
}
/* 当前倍率下农场是否比屏幕还高（= 该用卷轴式了） */
function viewOverflows(){
  const f = state.farm, z = viewZoom();
  const spanY = (f.w + f.h) * HALF_H * SCALE * z;
  const spanX = (f.w + f.h) * HALF_W * SCALE * z;
  return spanY > H * 0.98 || spanX > W * 0.98;
}
/* 把相机夹在「农场包围盒覆盖视口」的范围内（卷轴式：不会拖到地图外的虚空） */
function clampCamera(){
  const f = state.farm, z = viewZoom();
  const c = iso(f.x0 + (f.w - 1) / 2, f.y0 + (f.h - 1) / 2);
  const cfx = c.sx * SCALE, cfy = c.sy * SCALE;
  const bw = (f.w + f.h) * HALF_W * SCALE, bh = (f.w + f.h) * HALF_H * SCALE;
  const vw = W / z, vh = H / z;
  /* camera = -C，C = 屏幕中心对应的世界坐标（centerOn 就是这么定的） */
  const axis = (cam, cf, box, view) => {
    /* 视口必须落在农场包围盒内：C ∈ [cf-box/2+view/2, cf+box/2-view/2] */
    const lo = cf - box / 2 + view / 2, hi = cf + box / 2 - view / 2;
    if(lo > hi) return -cf;                        /* 盒子比视口小 → 居中 */
    return -Math.max(lo, Math.min(hi, -cam));
  };
  state.camera.x = axis(state.camera.x, cfx, bw, vw);
  state.camera.y = axis(state.camera.y, cfy, bh, vh);
}
function viewZoom(){
  return (state.zoomMode === 'auto') ? autoZoom() : state.zoomMode;
}
function renderZoomBtn(){
  const badge = document.getElementById('zoomState');
  const btn = document.getElementById('btnZoom');
  if(btn) btn.classList.toggle('active', state.zoomMode === 'auto');
  if(badge) badge.textContent = (state.zoomMode === 'auto') ? '自动' : state.zoomMode + 'x';
}
/* 点一下循环：自动 → 1x → 2x → 5x → 10x → 自动 */
function cycleZoom(){
  const order = ['auto'].concat(ZOOM_STEPS);
  const i = Math.max(0, order.indexOf(state.zoomMode));
  state.zoomMode = order[(i + 1) % order.length];
  state.cameraAuto = (state.zoomMode === 'auto');
  renderZoomBtn();
  toast(state.zoomMode === 'auto' ? '缩放：自动适配农场' : '缩放：' + state.zoomMode + 'x');
  save();
}
/* 滚轮微调（会退出自动模式）；接近某个档位时吸附过去 */
function setZoom(z){
  z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  let snapped = Math.round(z * 100) / 100;
  for(const st of ZOOM_STEPS) if(Math.abs(z - st) < st * 0.06) snapped = st;
  state.zoomMode = snapped;
  state.cameraAuto = false;
  renderZoomBtn();
}

