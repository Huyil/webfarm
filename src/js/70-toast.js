/* ============ Toast / 飘字 / 飞行动画 ============ */
let toastTimer = 0;
function toast(msg){
  const el = document.getElementById('toast');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}
/* 把收获物飞向仓库/厨房按钮 */
function flyTo(t, emoji, targetId){
  const btn = document.getElementById(targetId || 'btnStore');
  if(!btn) return;
  const r = btn.getBoundingClientRect();
  const from = worldToScreen(t);
  const el = document.createElement('div');
  el.className = 'fly-item';
  el.textContent = emoji;
  el.style.left = from.x + 'px';
  el.style.top = (from.y - TILE_H * SCALE * 0.3) + 'px';
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = `translate(${r.left + r.width / 2 - from.x}px, ${r.top + r.height / 2 - from.y}px) scale(.5)`;
    el.style.opacity = '0.1';
  });
  setTimeout(() => el.remove(), 720);
}
function flyToStore(t, emoji){ flyTo(t, emoji, 'btnStore'); }
function flyToKitchen(t, emoji){ flyTo(t, emoji, 'btnKitchen'); }
function floatPlus(t, n){ floatTextAt(worldToScreen(t), '+' + n, 'float-plus'); }
function floatPlusText(t, text){ floatTextAt(worldToScreen(t), text, 'float-plus'); }
function floatTextAt(pos, text, cls){
  const el = document.createElement('div');
  el.className = cls || 'float-plus';
  el.textContent = text;
  el.style.left = pos.x + 'px';
  el.style.top = (pos.y - TILE_H * SCALE * 0.3) + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 980);
}
