/* ============ 指针：悬停指示 / 拖拽刷地 / 长按框选 ============
 * - 悬停：鼠标移到哪一格，哪一格高亮（手机没有悬停，自动不显示）
 * - 拖拽：按住划过多格 → 逐格静默施用当前工具（人物跟手）
 * - 长按 380ms：进入框选模式，拖出矩形松手 → 批量施加当前工具
 */
let pointerDown=false, pointerMoved=false, startX=0, startY=0;
let lastTileKey='', toolApplied=false, panMode=false, panStartX=0, panStartY=0;
let pressTimer=0, boxMode=false, boxStart=null, hoverOn=false;

const LONG_PRESS_MS = 380;
const MOVE_TOL = 8;

function setHover(gx, gy){
  if(gx == null){ state.hover = null; return; }
  const t = getTile(gx, gy);
  state.hover = t ? { gx, gy } : null;
}
canvas.addEventListener('contextmenu', e => e.preventDefault());
/* 滚轮缩放（Ctrl+滚轮留给浏览器页面缩放） */
canvas.addEventListener('wheel', e => {
  if(e.ctrlKey) return;
  e.preventDefault();
  setZoom(viewZoom() * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
}, { passive: false });

canvas.addEventListener('pointerdown', e => {
  if(e.button !== 0 && e.pointerType === 'mouse') return;
  e.preventDefault();
  pointerDown = true; pointerMoved = false;
  toolApplied = false; lastTileKey = '';
  startX = e.clientX; startY = e.clientY;
  boxMode = false; boxStart = null;
  try { canvas.setPointerCapture(e.pointerId); } catch(_) {}
  /* 扩建模式：点地图上的发光长条购买，小人不会走过去 */
  if(state.expandMode){
    panMode = false; boxMode = false;
    const c0 = screenToGrid(e.clientX, e.clientY);
    state.expandPreview = expandDirAt(c0.gx, c0.gy);
    return;
  }
  if(state.tool === 'pan'){
    panMode = true;
    state.cameraAuto = false;                 /* 手动平移 → 不再自动居中 */
    panStartX = e.clientX - state.camera.x;
    panStartY = e.clientY - state.camera.y;
    return;
  }
  panMode = false;
  const { gx, gy } = screenToGrid(e.clientX, e.clientY);
  setHover(gx, gy);
  clearTimeout(pressTimer);
  if(state.longPressBox === false) return;      /* 开关关掉：长按不划范围（免得和"走过去"打架） */
  pressTimer = setTimeout(() => {
    if(!pointerDown || pointerMoved) return;
    boxMode = true; boxStart = { gx, gy };
    state.box = { x0:gx, y0:gy, x1:gx, y1:gy };
    try { if(navigator.vibrate) navigator.vibrate(15); } catch(_){}
    toast('框选模式：拖出范围后松手，只处理该处理的格子');
  }, LONG_PRESS_MS);
});

canvas.addEventListener('pointermove', e => {
  const c = screenToGrid(e.clientX, e.clientY);
  hoverOn = true;
  setHover(c.gx, c.gy);
  if(state.expandMode){ state.expandPreview = expandDirAt(c.gx, c.gy); return; }
  if(!pointerDown) return;
  if(panMode){
    state.camera.x = e.clientX - panStartX;
    state.camera.y = e.clientY - panStartY;
    return;
  }
  if(boxMode){
    if(boxStart) state.box = { x0:boxStart.gx, y0:boxStart.gy, x1:c.gx, y1:c.gy };
    return;
  }
  const moved = Math.hypot(e.clientX - startX, e.clientY - startY) >= MOVE_TOL;
  if(state.longPressBox !== false){
    /* 「长按框选」开着 = 精确模式：按住期间**什么都不做**（不刷地、小人也不跟手），
       松手才算一次单击；一直按着到 380ms 就进框选，拖出的范围在松手时统一处理。
       （以前按住拖动会立刻派活 → 小人跟着鼠标跑，长按和框选互相打架） */
    return;
  }
  if(!moved) return;
  clearTimeout(pressTimer);
  pointerMoved = true;
  const key = c.gx + ',' + c.gy;
  if(key !== lastTileKey){
    lastTileKey = key; toolApplied = true;
    applyToolAt(c.gx, c.gy, true);
  }
});

function onPointerEnd(e){
  if(!pointerDown) return;
  pointerDown = false;
  clearTimeout(pressTimer);
  if(state.expandMode){
    if(Math.hypot(e.clientX - startX, e.clientY - startY) < MOVE_TOL){
      const c = screenToGrid(e.clientX, e.clientY);
      const dir = expandDirAt(c.gx, c.gy);
      if(dir) buyExpand(dir);
      else toast('请点在地图上发光的长条上购买扩建');
    }
    try { canvas.releasePointerCapture(e.pointerId); } catch(_) {}
    return;
  }
  if(panMode){
    panMode = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch(_) {}
    return;
  }
  if(boxMode){
    const b = state.box;
    boxMode = false; boxStart = null; state.box = null;
    if(b) applyToolToRect(b.x0, b.y0, b.x1, b.y1);
    try { canvas.releasePointerCapture(e.pointerId); } catch(_) {}
    return;
  }
  if(!toolApplied){
    /* 手上有框选批量作业时，点地图（非 UI）＝取消，而不是再派一个活 */
    if(jobActive()){
      cancelJob();
      try { canvas.releasePointerCapture(e.pointerId); } catch(_) {}
      return;
    }
    const { gx, gy } = screenToGrid(e.clientX, e.clientY);
    applyToolAt(gx, gy, false);
  }
  toolApplied = false; lastTileKey = '';
  try { canvas.releasePointerCapture(e.pointerId); } catch(_) {}
}
canvas.addEventListener('pointerup', onPointerEnd);
canvas.addEventListener('pointercancel', onPointerEnd);
canvas.addEventListener('pointerleave', () => { hoverOn = false; setHover(null); state.expandPreview = null; });

/* ---------- 交互指示绘制（由 50-render.js 调用） ---------- */
function drawInteractionUI(g, cx, cy){
  const w = TILE_W * SCALE, h = TILE_H * SCALE;
  const diamond = (px, py) => {
    g.beginPath();
    g.moveTo(px, py - h / 2); g.lineTo(px + w / 2, py);
    g.lineTo(px, py + h / 2); g.lineTo(px - w / 2, py);
    g.closePath();
  };
  /* 悬停格（框选作业期间不显示悬停，避免和选区打架） */
  const boxNow = state.box || state.jobBox;
  if(state.hover && !boxNow){
    const { gx, gy } = state.hover;
    const { sx, sy } = iso(gx, gy);
    const px = cx + sx * SCALE, py = cy + sy * SCALE;
    g.save();
    diamond(px, py);
    g.fillStyle = 'rgba(255,255,255,.13)'; g.fill();
    g.strokeStyle = 'rgba(255,255,255,.78)'; g.lineWidth = 2; g.stroke();
    /* 工具图标浮在格子上方 */
    const meta = TOOL_META[state.tool];
    if(meta){
      g.font = '14px serif'; g.textAlign = 'center';
      g.fillText(meta.icon, px, py - h * 0.34);
    }
    g.restore();
  }
  /* 框选范围（作业期间保持高亮） */
  if(boxNow){
    const b = boxNow;
    const ax = Math.min(b.x0, b.x1), bx = Math.max(b.x0, b.x1);
    const ay = Math.min(b.y0, b.y1), by = Math.max(b.y0, b.y1);
    g.save();
    g.globalAlpha = 0.25; g.fillStyle = '#8fe07a';
    for(let y = ay; y <= by; y++) for(let x = ax; x <= bx; x++){
      const { sx, sy } = iso(x, y);
      diamond(cx + sx * SCALE, cy + sy * SCALE);
      g.fill();
    }
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(190,255,170,.95)'; g.lineWidth = 2;
    for(let y = ay; y <= by; y++) for(let x = ax; x <= bx; x++){
      const { sx, sy } = iso(x, y);
      diamond(cx + sx * SCALE, cy + sy * SCALE);
      g.stroke();
    }
    g.font = 'bold 13px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center';
    g.fillStyle = '#eaffe6';
    const { sx, sy } = iso((ax + bx) / 2, (ay + by) / 2);
    const left = (state.player.queue ? state.player.queue.length : 0) + (state.player.pendingOp ? 1 : 0);
    g.fillText(left > 0 ? `${bx - ax + 1}×${by - ay + 1} · 剩 ${left}` : `${bx - ax + 1}×${by - ay + 1}`, cx + sx * SCALE, cy + sy * SCALE - h * 0.7);
    g.restore();
  }
}
