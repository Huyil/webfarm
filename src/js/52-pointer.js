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

/* ============ 双指缩放（手机 / 触屏） ============
 * 合拢 = 缩小，张开 = 放大；锚点是**两指中点**（中点底下那块地保持不动），
 * 两指整体平移也能带着地图走 —— 手机上这就是最自然的"地图手势"。
 *
 * 屏幕↔世界的换算（和 render 的变换一致）：
 *     deviceX = W0/2 + zoom * (camera.x + sx*SCALE)
 * 中点固定时：camera.x = camX0 + (midX - W0/2) * (1/z1 - 1/z0)
 * 两指整体移动 dx 时，再补一个 dx/z1 的平移。
 *
 * 捏合期间单指那套全部让路：不刷地、不进框选、抬手指也不当成单击。
 */
const ptrs = new Map();
let pinch = null, pinchUsed = false;
/* 指针表随时可能"脏"：浏览器偶尔丢 pointerup、切后台时手指全没了、
   或者三根手指同时按。任何一次都可能让捏合判断错乱，所以给几个兜底清空点。 */
function ptrsClear(){ ptrs.clear(); pinch = null; pinchUsed = false; }
const PINCH_TOL = 6;                 /* 两指间距变化超过这么多像素才算"在缩放" */
function pinchDist(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); }
function pinchBegin(){
  const all = [...ptrs.values()];
  if(all.length < 2) return;
  const rect = canvas.getBoundingClientRect();
  pinch = {
    d0: Math.max(1, pinchDist(all[0], all[1])),
    z0: viewZoom(),
    camX: state.camera.x, camY: state.camera.y,
    mx: (all[0].x + all[1].x) / 2 - (rect.left || 0),
    my: (all[0].y + all[1].y) / 2 - (rect.top || 0),
  };
  pinchUsed = false;
  /* 把单指那套收干净：长按计时器、框选、平移、拖拽刷地全都停 */
  pointerDown = false; pointerMoved = true;
  clearTimeout(pressTimer);
  if(boxMode){ boxMode = false; boxStart = null; state.box = null; }
  panMode = false;
}
function pinchMove(){
  const all = [...ptrs.values()];
  if(!pinch || all.length < 2) return false;
  const d = Math.max(1, pinchDist(all[0], all[1]));
  if(!pinchUsed && Math.abs(d - pinch.d0) < PINCH_TOL) return true;   /* 还在"准备"，别抖 */
  pinchUsed = true;
  const W0 = window.innerWidth, H0 = window.innerHeight;
  const rect = canvas.getBoundingClientRect();
  const mx = (all[0].x + all[1].x) / 2 - (rect.left || 0);
  const my = (all[0].y + all[1].y) / 2 - (rect.top || 0);
  setZoom(pinch.z0 * (d / pinch.d0), true);
  const z1 = viewZoom();
  const k = 1 / z1 - 1 / pinch.z0;
  state.camera.x = pinch.camX + (mx - W0 / 2) * k + (mx - pinch.mx) / z1;
  state.camera.y = pinch.camY + (my - H0 / 2) * k + (my - pinch.my) / z1;
  state.cameraAuto = false;
  return true;
}

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
  if(ptrs.size >= 2) ptrsClear();                 /* 已经有两指在按（多半是脏数据）→ 重来 */
  ptrs.set(e.pointerId == null ? 'p0' : e.pointerId, { x:e.clientX, y:e.clientY });
  if(ptrs.size >= 2){ pinchBegin(); return; }     /* 第二根手指落下 → 进捏合，不干别的 */
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
  if(ptrs.has(e.pointerId == null ? 'p0' : e.pointerId)) ptrs.set(e.pointerId == null ? 'p0' : e.pointerId, { x:e.clientX, y:e.clientY });
  if(pinch){ pinchMove(); return; }               /* 捏合期间不悬停、不刷地 */
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
  const wasPinch = !!pinch;
  ptrs.delete(e.pointerId == null ? 'p0' : e.pointerId);
  if(wasPinch){
    /* 捏合收尾：松掉一根就结束本次手势，剩下的手指也不当点击 */
    if(ptrs.size < 2){ pinch = null; pinchUsed = false; pointerDown = false; pointerMoved = true; }
    try { canvas.releasePointerCapture(e.pointerId); } catch(_) {}
    return;
  }
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
    if(state.afPicking && b){                    /* 「框选区域」模式：这一框拿来定自动农活的区域 */
      state.afPicking = false;
      afSetArea(b);
      openAutoFarm();
    } else if(b) applyToolToRect(b.x0, b.y0, b.x1, b.y1);
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
/* 切后台 / 失焦：手指位置信息全作废，别留着脏指针影响回来后的手势 */
window.addEventListener('blur', ptrsClear);
document.addEventListener('visibilitychange', () => { if(document.hidden) ptrsClear(); });
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
  /* 自动农活的作业区域：常驻虚线框（和一次性框选的实线区分开） */
  if(!boxNow && state.autoFarm && state.autoFarm.box){
    const ab = state.autoFarm.box;
    const o = [[ab.x0 - 0.5, ab.y0 - 0.5], [ab.x1 + 0.5, ab.y0 - 0.5], [ab.x1 + 0.5, ab.y1 + 0.5], [ab.x0 - 0.5, ab.y1 + 0.5]];
    g.save();
    g.beginPath();
    for(let i = 0; i < 4; i++){
      const { sx, sy } = iso(o[i][0], o[i][1]);
      const px = cx + sx * SCALE, py = cy + sy * SCALE;
      if(i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    if(g.setLineDash) g.setLineDash([7, 5]);
    g.strokeStyle = 'rgba(127,208,255,.8)';
    g.lineWidth = 2;
    g.stroke();
    if(g.setLineDash) g.setLineDash([]);
    g.font = 'bold 12px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(200,236,255,.95)';
    const c0 = iso((ab.x0 + ab.x1) / 2, ab.y0 - 0.5);
    g.fillText('🤖 ' + (ab.x1 - ab.x0 + 1) + '×' + (ab.y1 - ab.y0 + 1),
      cx + c0.sx * SCALE, cy + c0.sy * SCALE - 4);
    g.restore();
  }
  /* 框选范围：**一个平行四边形**，不再逐格画菱形。
   * 以前是「每个格子各画一遍填充 + 一遍描边」——40×40 的选区就是 3200 次路径操作/帧，
   * 这正是"框选开始干活之后特别卡"的主因；现在无论多大选区都只有 1 条路径。
   * 另外：任务已经在跑（jobBox）时**只画边框**，不铺半透明覆盖层 —— 地块本身看得更清楚。 */
  if(boxNow){
    const b = boxNow;
    const ax = Math.min(b.x0, b.x1), bx = Math.max(b.x0, b.x1);
    const ay = Math.min(b.y0, b.y1), by = Math.max(b.y0, b.y1);
    g.save();
    /* 半格偏移取的是外轮廓：iso(ax-0.5, ay-0.5) 正好是这个矩形左上角格的顶点 */
    const o = [[ax - 0.5, ay - 0.5], [bx + 0.5, ay - 0.5], [bx + 0.5, by + 0.5], [ax - 0.5, by + 0.5]];
    g.beginPath();
    for(let i = 0; i < 4; i++){
      const { sx, sy } = iso(o[i][0], o[i][1]);
      const px = cx + sx * SCALE, py = cy + sy * SCALE;
      if(i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    if(!state.jobBox){                       /* 只有"正在拖"的时候铺一点面积感 */
      g.fillStyle = 'rgba(143,224,122,.14)';
      g.fill();
    }
    g.strokeStyle = state.jobBox ? 'rgba(190,255,170,.9)' : 'rgba(190,255,170,.95)';
    g.lineWidth = state.jobBox ? 3 : 2;
    g.stroke();
    g.font = 'bold 13px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center';
    g.fillStyle = '#eaffe6';
    const { sx, sy } = iso((ax + bx) / 2, (ay + by) / 2);
    const left = (state.player.queue ? state.player.queue.length : 0) + (state.player.pendingOp ? 1 : 0);
    g.fillText(left > 0 ? `${bx - ax + 1}×${by - ay + 1} · 剩 ${left}` : `${bx - ax + 1}×${by - ay + 1}`, cx + sx * SCALE, cy + sy * SCALE - h * 0.7);
    g.restore();
  }
}
