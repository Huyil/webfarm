/* ============ 侧栏拖拽 ============ */
const sidePanel = document.getElementById('sidePanel');
/* 手机上顶栏铺满屏宽、底部还有提示条与飘字，所以侧栏的可放区间不能是「整屏」：
   上界＝顶栏下沿，下界＝提示条上沿（再留一点缝）。桌面端维持原来的居中习惯。 */
function sidePanelBounds(){
  const panelH = sidePanel.offsetHeight || 60;
  const mobile = window.matchMedia
    ? window.matchMedia('(orientation: portrait), (max-width: 620px)').matches
    : (window.innerWidth <= 620);
  const rectOf = id => { const e = document.getElementById(id); return e ? e.getBoundingClientRect() : null; };
  const hud = rectOf('hud');
  const hint = rectOf('toolHint');
  const vh = window.innerHeight;
  const minTop = Math.max(8, (hud ? hud.bottom : 0) + (mobile ? 10 : 0));
  let maxTop = vh - panelH - Math.max(8, panelH * 0 + 10);
  if(mobile && hint && hint.top > 0) maxTop = Math.min(maxTop, hint.top - 10 - panelH);
  return { panelH, mobile, minTop, maxTop: Math.max(minTop, maxTop) };
}
const SIDE_PANEL_VER = 2;
/* 手机（竖屏 / 窄屏）：侧栏是右上角浮窗抽屉，位置交给 CSS，JS 不掺和 */
function sideIsDrawer(){
  try { return window.matchMedia('(orientation: portrait), (max-width: 620px)').matches; }
  catch(e){ return window.innerWidth <= 620; }
}
function sideDrawerClose(){
  if(sidePanel) sidePanel.classList.remove('open');
  const tg = document.getElementById('sideToggle');
  if(tg) tg.setAttribute('aria-expanded', 'false');
}
function bindSideDrawer(){
  const tg = document.getElementById('sideToggle');
  if(!tg) return;
  tg.addEventListener('click', e => {
    if(e && e.preventDefault) e.preventDefault();
    const open = sidePanel.classList.toggle('open');
    tg.setAttribute('aria-expanded', open ? 'true' : 'false');
    try { SFX.play('click'); } catch(_){}
    if(open && sidePanel.scrollTop) sidePanel.scrollTop = 0;
  });
  /* 点游戏画面 / 按 Esc 收起 */
  const cv = document.getElementById('game');
  if(cv) cv.addEventListener('pointerdown', sideDrawerClose);
  document.addEventListener('keydown', ev => { if(ev.key === 'Escape') sideDrawerClose(); });
}    /* 布局版本：手机端改过默认位置后 +1，老存档会重算一次 */
function placeSidePanel(){
  if(!sidePanel) return;
  if(sideIsDrawer()){                 /* 抽屉模式：位置由 CSS 决定，清掉之前算出来的内联 top */
    sidePanel.style.top = '';
    return;
  }
  const b = sidePanelBounds();
  let y = state.sidePanelY;
  if(state.sidePanelVer !== SIDE_PANEL_VER){ y = null; state.sidePanelVer = SIDE_PANEL_VER; }
  /* 手机默认往中下摆放（原来正中央会正好压住农场，把地挡掉一半） */
  if(y == null) y = b.mobile ? b.minTop + (b.maxTop - b.minTop) * 0.62 : window.innerHeight / 2 - b.panelH / 2;
  y = Math.max(b.minTop, Math.min(b.maxTop, y));
  state.sidePanelY = y;
  sidePanel.style.top = y + 'px';
}
let panelDragging = false, panelStartY = 0, panelStartTop = 0;
function bindSidePanelDrag(){
  if(!sidePanel) return;
  sidePanel.addEventListener('pointerdown', e => {
    if(e.target.closest('button')) return;
    if(sideIsDrawer()) return;        /* 抽屉模式不拖拽 */
    panelDragging = true;
    panelStartY = e.clientY;
    panelStartTop = state.sidePanelY || 0;
    try { sidePanel.setPointerCapture(e.pointerId); } catch(_) {}
    e.preventDefault();
  });
  sidePanel.addEventListener('pointermove', e => {
    if(!panelDragging) return;
    const b = sidePanelBounds();
    let newY = panelStartTop + (e.clientY - panelStartY);
    newY = Math.max(b.minTop, Math.min(b.maxTop, newY));
    state.sidePanelY = newY;
    sidePanel.style.top = newY + 'px';
  });
  const end = e => {
    if(!panelDragging) return;
    panelDragging = false;
    try { sidePanel.releasePointerCapture(e.pointerId); } catch(_) {}
    save();
  };
  sidePanel.addEventListener('pointerup', end);
  sidePanel.addEventListener('pointercancel', end);
}
