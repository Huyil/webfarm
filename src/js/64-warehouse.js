/* ============ 仓库（作物 / 备料 / 菜品） ============ */
let storeTab = 'crop';

function renderWarehouseToggle(){
  const btn = document.getElementById('whBtn'), desc = document.getElementById('whDesc');
  if(!btn || !desc) return;
  if(state.warehouseEnabled){
    btn.className = 'wh-btn on'; btn.textContent = '已开启';
    desc.textContent = '开启：收获作物存入仓库';
  } else {
    btn.className = 'wh-btn off'; btn.textContent = '已关闭';
    desc.textContent = '关闭：收获作物自动出售';
  }
}
function bindWarehouseToggle(){
  const btn = document.getElementById('whBtn');
  if(!btn) return;
  btn.onclick = () => {
    state.warehouseEnabled = !state.warehouseEnabled;
    SFX.play('click'); renderWarehouseToggle(); renderSettings(); save();
    toast(state.warehouseEnabled ? '仓储已开启' : '仓储已关闭（收获自动卖）');
  };
}
function renderStore(){
  renderWarehouseToggle();
  const tabs = document.getElementById('storeTabs');
  const el = document.getElementById('storeList');
  if(!el) return;
  if(tabs){
    tabs.innerHTML = '';
    const counts = { crop: CROP_IDS.reduce((a, id) => a + (state.bag[id] || 0), 0),
                     prep: Object.values(state.pieces).reduce((a, b) => a + b, 0) + (state.prep.flour || 0),
                     dish: dishTotal() };
    for(const [key, label] of [['crop','🥕 作物'],['prep','🔪 备料'],['dish','🍳 菜品']]){
      const b = document.createElement('button');
      b.className = 'tab' + (storeTab === key ? ' active' : '');
      b.textContent = `${label}${counts[key] ? ' ' + counts[key] : ''}`;
      b.onclick = () => { storeTab = key; SFX.play('click'); renderStore(); };
      tabs.appendChild(b);
    }
  }
  el.innerHTML = '';
  if(storeTab === 'crop')  renderStoreCrops(el);
  if(storeTab === 'prep')  renderStorePrep(el);
  if(storeTab === 'dish')  renderStoreDishes(el);
}
/* 用厨房那套绘制函数把食材画成小图标（crop: / piece: / prep: / dish:），
   拿不到 canvas 时退回 emoji。 */
function itemIconEl(key, size){
  size = size || 30;
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(size * dpr); c.height = Math.round(size * dpr);
  c.style.width = size + 'px'; c.style.height = size + 'px';
  const g = c.getContext && c.getContext('2d');
  if(g){
    try{
      if(g.setTransform) g.setTransform(dpr, 0, 0, dpr, 0, 0);
      else if(g.scale) g.scale(dpr, dpr);
      drawItemIcon(g, key, size / 2, size / 2, size);
    }catch(e){}
  }
  return c;
}
function iconNode(keyOrEmoji, size){
  const s = String(keyOrEmoji == null ? '' : keyOrEmoji);
  if(/^(crop|piece|prep|dish):/.test(s) && typeof drawItemIcon === 'function') return itemIconEl(s, size);
  const sp = document.createElement('span');
  sp.textContent = s;
  return sp;
}
function storeRow(el, icon, name, meta, count, buttons){
  const row = document.createElement('div');
  row.className = 'row';
  const icoText = String(icon == null ? '' : icon);
  const hasKey = /^(crop|piece|prep|dish):/.test(icoText);
  row.innerHTML = `
    <div class="r-ico">${hasKey ? '' : icoText}</div>
    <div style="flex:1">
      <div class="r-name">${name}</div>
      <div class="r-meta">${meta}</div>
    </div>
    <div class="r-count">×${count}</div>`;
  if(hasKey){
    const holder = row.querySelector('.r-ico');
    if(holder) holder.appendChild(iconNode(icoText, 30));
  }
  (buttons || []).forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'mini sell'; btn.textContent = b.label;
    btn.onclick = e => { e.stopPropagation(); b.fn(); };
    row.appendChild(btn);
  });
  el.appendChild(row);
  return row;
}
function renderStoreCrops(el){
  let any = false;
  for(const id of CROP_IDS){
    const n = state.bag[id] || 0;
    if(n <= 0) continue;
    any = true;
    const def = CROPS[id];
    storeRow(el, 'crop:' + id, def.produce, `单价 ${def.sellPrice} 金`, n, [
      { label:'卖1',  fn:() => sellCrop(id, 1) },
      { label:'全卖', fn:() => sellCrop(id, n) },
    ]);
  }
  if(!any) el.innerHTML = '<div class="empty">仓库空空如也 🌱<br><span class="r-meta">去种点东西吧</span></div>';
  else {
    const bar = document.createElement('div');
    bar.className = 'wh-actions';
    const all = document.createElement('button');
    all.className = 'mini sell'; all.textContent = '💸 一键全卖作物';
    all.onclick = () => {
      let gain = 0, cnt = 0;
      for(const id of CROP_IDS){
        const n = state.bag[id] || 0;
        if(n > 0){ gain += n * CROPS[id].sellPrice; cnt += n; state.bag[id] = 0; }
      }
      if(cnt > 0){ state.coins += gain; trackAction('coins', gain); SFX.play('coin'); renderHUD(); renderStore(); save(); toast(`卖出 ${cnt} 件，+${gain} 金`); }
    };
    bar.appendChild(all);
    el.appendChild(bar);
  }
}
function renderStorePrep(el){
  let any = false;
  const flour = state.prep.flour || 0;
  if(flour > 0){
    any = true;
    storeRow(el, 'prep:flour', '面粉', `单价 ${EXTRA_ITEMS.flour.sellPrice} 金 · 也能直接进烤箱`, flour, [
      { label:'卖1',  fn:() => sellPrep('flour', 1) },
      { label:'全卖', fn:() => sellPrep('flour', flour) },
    ]);
  }
  for(const id of CROP_IDS){
    const n = state.pieces[id] || 0;
    if(n <= 0) continue;
    any = true;
    storeRow(el, 'piece:' + id, CROPS[id].produce + '块', '可下锅 · 也可进烤箱烤（精品/一般/焦糊）· 不可直接出售', n, []);
  }
  if(!any) el.innerHTML = '<div class="empty">还没有备料 🔪<br><span class="r-meta">去厨房把小麦磨成面粉、把菜切块</span></div>';
}
function renderStoreDishes(el){
  const keys = Object.keys(state.dishes);
  if(!keys.length){ el.innerHTML = '<div class="empty">还没有做好的菜 🍳<br><span class="r-meta">打开厨房试试</span></div>'; return; }
  for(const key of keys){
    const d = state.dishes[key];
    const pieces = (d.pieces || []).map(itemName).join('+') || '—';
    storeRow(el, 'dish:' + key, `${d.name}${d.qtag || ''}`, `${d.qname || '一般'} · 单价 ${d.value} 金 · 用料：${pieces}`, d.n, [
      { label:'卖1',  fn:() => sellDishUI(key, 1) },
      { label:'全卖', fn:() => sellDishUI(key, d.n) },
    ]);
  }
  const bar = document.createElement('div');
  bar.className = 'wh-actions';
  const all = document.createElement('button');
  all.className = 'mini sell'; all.textContent = '💸 一键全卖菜品';
  all.onclick = () => {
    let gain = 0;
    for(const key of Object.keys(state.dishes)) gain += sellDish(key, state.dishes[key].n);
    if(gain > 0){ SFX.play('coin'); renderHUD(); renderStore(); save(); toast(`+${gain} 金`); }
  };
  bar.appendChild(all);
  el.appendChild(bar);
}
function sellCrop(cropId, qty){
  const have = state.bag[cropId] || 0;
  const n = Math.max(0, Math.min(qty, have));
  if(n <= 0) return 0;
  const gain = n * CROPS[cropId].sellPrice;
  state.bag[cropId] -= n; state.coins += gain;
  trackAction('coins', gain);
  trackAction('sold', n);
  SFX.play('coin');
  renderHUD(); renderStore(); save();
  toast(`卖出 ×${n}，+${gain} 金`);
  return gain;
}
function sellPrep(id, qty){
  const have = state.prep[id] || 0;
  const n = Math.max(0, Math.min(qty, have));
  if(n <= 0) return 0;
  const gain = n * EXTRA_ITEMS[id].sellPrice;
  state.prep[id] -= n; state.coins += gain;
  trackAction('coins', gain);
  SFX.play('coin'); renderHUD(); renderStore(); save();
  toast(`卖出 ×${n}，+${gain} 金`);
  return gain;
}
function sellDishUI(key, qty){
  const gain = sellDish(key, qty);
  if(gain > 0){ SFX.play('coin'); renderHUD(); renderStore(); save(); toast(`+${gain} 金`); }
}
