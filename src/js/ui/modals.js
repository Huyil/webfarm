/* ============ 弹层 ============ */
const SHEET_IDS = ['seedModal','shopModal','storeModal','settingsModal',
                   'achievementModal','noticeModal','kitchenModal','slotsModal','transferModal','leaderboardModal',
                   'autofarmModal'];
function openSheet(name){
  closeSheet();
  const el = document.getElementById(name + 'Modal');
  if(!el) return;
  el.classList.add('show');
  if(name === 'seed')        renderSeedList();
  if(name === 'shop')        renderShop();
  if(name === 'store')       renderStore();
  if(name === 'settings')    renderSettings();
  if(name === 'achievement'){ renderAchievements(); renderTaskList(); }
  if(name === 'notice')      renderChangelog();
  if(name === 'kitchen')     renderKitchen();
  if(name === 'slots')       renderSlots();
  if(name === 'leaderboard') lbOpen();
  if(name === 'transfer')    renderTransfer();
  if(name === 'autofarm')    renderAutoFarm();
}
function closeSheet(){
  if(typeof state !== 'undefined') state.expandPreview = null;
  SHEET_IDS.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.classList.remove('show');
  });
}
/* 给每个弹层右上角塞一个 ✕（复用 data-close 的关闭逻辑） */
function ensureModalX(){
  document.querySelectorAll('.modal .modal-box').forEach(box => {
    const first = box.firstElementChild;
    if(first && first.classList && first.classList.contains('modal-x')) return;
    const btn = document.createElement('button');
    btn.className = 'modal-x';
    btn.type = 'button';
    btn.setAttribute('data-close', '');
    btn.setAttribute('aria-label', '关闭');
    btn.innerHTML = iconHTML('x');
    box.insertBefore(btn, box.firstChild);
  });
}
function bindSheetEvents(){
  ensureModalX();                        /* 必须在绑 data-close 之前建好 */
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSheet));
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', e => { if(e.target === m) closeSheet(); });
  });
}

/* 卖掉装饰物：给金币 + 音效 + 刷新（装饰在仓库的「装饰」分类里） */
function sellDecorUI(type, qty){
  const gain = sellDecor(type, qty);
  if(gain <= 0) return 0;
  SFX.play('coin');
  renderHUD(); renderStore(); save();
  toast(`卖出装饰 +${gain} 金`);
  return gain;
}
