/* ============ 弹层 ============ */
const SHEET_IDS = ['seedModal','shopModal','storeModal','decorModal','settingsModal',
                   'achievementModal','noticeModal','kitchenModal','slotsModal','transferModal','leaderboardModal'];
function openSheet(name){
  closeSheet();
  const el = document.getElementById(name + 'Modal');
  if(!el) return;
  el.classList.add('show');
  if(name === 'seed')        renderSeedList();
  if(name === 'shop')        renderShop();
  if(name === 'store')       renderStore();
  if(name === 'decor')       renderDecorBag();
  if(name === 'settings')    renderSettings();
  if(name === 'achievement'){ renderAchievements(); renderTaskList(); }
  if(name === 'notice')      renderChangelog();
  if(name === 'kitchen')     renderKitchen();
  if(name === 'slots')       renderSlots();
  if(name === 'leaderboard') lbOpen();
  if(name === 'transfer')    renderTransfer();
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
    btn.textContent = '✕';
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

/* 卖掉装饰物：给金币 + 音效 + 刷新 */
function sellDecorUI(type, qty){
  const gain = sellDecor(type, qty);
  if(gain <= 0) return 0;
  SFX.play('coin');
  renderHUD(); renderDecorBag(); save();
  toast(`卖出装饰 +${gain} 金`);
  return gain;
}

/* ---------- 装饰仓库 ---------- */
function renderDecorBag(){
  const el = document.getElementById('decorList');
  if(!el) return;
  el.innerHTML = '';
  const hint = document.createElement('div');
  hint.className = 'r-meta';
  hint.style.padding = '0 4px 8px';
  hint.textContent = '锄头会把地里的装饰物收回这里；选中后点击空地即可摆回去。';
  el.appendChild(hint);
  let any = false;
  for(const id of DECOR_IDS){
    const meta = DECOR_META[id];
    const free = decorIsFree(id);            /* 免费铺装（小路）：不占仓库格子，∞ 使用 */
    const n = state.decorBag[id] || 0;
    if(!free && n <= 0) continue;
    any = true;
    const row = document.createElement('div');
    row.className = 'row clickable' + (state.selectedDecor === id && state.tool === 'decor' ? ' active' : '');
    row.innerHTML = `
      <div class="r-ico">${meta.icon}</div>
      <div style="flex:1">
        <div class="r-name">${meta.name}${meta.ground ? ' · 地面' : ''}${free ? ' · 免费铺装' : ''}</div>
        <div class="r-meta">${free
          ? '无限使用：选中后在地块上刷，点已有小路可换连接面'
          : '卖 ' + (DECOR_SELL[id] || 0) + ' 金（商店买 ' + (DECOR_PRICE[id] || 0) + '）· ' + (state.selectedDecor === id && state.tool === 'decor' ? '已选中，点击地块摆放' : '点击选中')}</div>
      </div>
      <div class="r-count">${free ? '∞' : '×' + n}</div>`;
    if(!free){
      const s1 = document.createElement('button');
      s1.className = 'mini sell'; s1.textContent = '卖1';
      s1.onclick = e => { e.stopPropagation(); sellDecorUI(id, 1); };
      const sAll = document.createElement('button');
      sAll.className = 'mini sell'; sAll.textContent = '全卖';
      sAll.onclick = e => { e.stopPropagation(); sellDecorUI(id, n); };
      row.append(s1, sAll);
    }
    row.onclick = () => {
      state.selectedDecor = id;
      state.tool = 'decor';
      SFX.play('click');
      renderToolbar(); renderDecorBag(); save();
      closeSheet();
      toast(`已选中 ${meta.name}，点空地摆放`);
    };
    el.appendChild(row);
  }
  if(!any) el.innerHTML = '<div class="empty">装饰仓库空空如也 🏡<br><span class="r-meta">用锄头锄掉地里的树/石头/灌木/花就能收进来</span></div>';
}
