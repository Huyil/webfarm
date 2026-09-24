/* ============ 画布 ============ */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, UI_SCALE = 1;
function resize(){
  const dpr = window.devicePixelRatio || 1;
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
/* 自动倍率：让整块农场（菱形包围盒）落在视口内 */
function autoZoom(){
  const f = state.farm;
  const spanX = Math.max(1, (f.w + f.h) * HALF_W * SCALE);
  const spanY = Math.max(1, (f.w + f.h) * HALF_H * SCALE);
  const z = Math.min((W * ZOOM_AUTO_PAD) / spanX, (H * ZOOM_AUTO_PAD) / spanY);
  return Math.max(ZOOM_MIN, Math.min(ZOOM_AUTO_MAX, z));   /* 自动倍率封顶 1.6x */
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

