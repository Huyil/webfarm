/* ============ 仓库（作物 / 备料 / 菜品 / 装饰） ============
 * 上方分类 → 中间物品网格（图标 / 名称 / 存储数量）→ 下方滑条 + 数量 + 售出。
 * 滑条上限 = 该物品的库存；装饰分类多一个「摆放」按钮。 */
let storeTab = 'crop', storeSel = '', storeQty = 1;

function renderWarehouseToggle(){
  const btn = document.getElementById('whBtn'), desc = document.getElementById('whDesc');
  if(!btn || !desc) return;
  const on = state.warehouseEnabled;
  btn.className = 'wh-btn ' + (on ? 'on' : 'off');
  btn.textContent = on ? '已开启' : '已关闭';
  desc.textContent = on ? '开启：收获作物存入仓库' : '关闭：收获作物自动出售';
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
/* 用厨房那套绘制函数把食材画成小图标（crop: / piece: / prep: / dish:） */
function itemIconEl(key, size){
  size = size || 30;
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(size * dpr); c.height = Math.round(size * dpr);
  c.style.width = size + 'px'; c.style.height = size + 'px';
  const g = c.getContext && c.getContext('2d');
  if(g) try{
    if(g.setTransform) g.setTransform(dpr, 0, 0, dpr, 0, 0);
    else if(g.scale) g.scale(dpr, dpr);
    drawItemIcon(g, key, size / 2, size / 2, size);
  }catch(e){}
  return c;
}
function iconNode(keyOrEmoji, size){
  const s = String(keyOrEmoji == null ? '' : keyOrEmoji);
  if(/^(crop|piece|prep|dish):/.test(s) && typeof drawItemIcon === 'function') return itemIconEl(s, size);
  const sp = document.createElement('span');
  sp.textContent = s;
  return sp;
}
/* 某一分类下的物品：key / icon / name / count / price / sell(qty)（null = 不能卖） */
function storeCatalog(tab){
  const out = [];
  if(tab === 'crop'){
    for(const id of CROP_IDS){
      const n = state.bag[id] || 0;
      if(n <= 0) continue;
      const def = CROPS[id];
      out.push({
        key: 'crop:' + id, icon: 'crop:' + id, name: def.produce, count: n, price: def.sellPrice,
        meta: `单价 ${def.sellPrice} 金 · 库存 ${n} 件（共 ${n * def.sellPrice} 金）`,
        sell: q => sellCrop(id, q),
      });
    }
    return out;
  }
  if(tab === 'prep'){
    const flour = state.prep.flour || 0;
    if(flour > 0){
      out.push({
        key: 'prep:flour', icon: 'prep:flour', name: '面粉', count: flour, price: EXTRA_ITEMS.flour.sellPrice,
        meta: `单价 ${EXTRA_ITEMS.flour.sellPrice} 金 · 库存 ${flour} 份 · 也能直接进烤箱`,
        sell: q => sellPrep('flour', q),
      });
    }
    for(const id of CROP_IDS){
      const n = state.pieces[id] || 0;
      if(n <= 0) continue;
      out.push({
        key: 'piece:' + id, icon: 'piece:' + id, name: CROPS[id].produce + '块', count: n, price: 0,
        meta: `库存 ${n} 块 · 可下锅，也可进烤箱（精品/一般/焦糊）· 不能直接出售`,
        sell: null,
      });
    }
    return out;
  }
  if(tab === 'decor'){
    /* 锄头收回来的树/石头/铺装：选中后「摆放」或卖掉；免费铺装显示 ∞、不能卖 */
    for(const id of DECOR_IDS){
      const meta = DECOR_META[id];
      if(!meta) continue;
      const free = decorIsFree(id);
      const n = free ? 1 : (state.decorBag[id] || 0);
      if(!free && n <= 0) continue;
      out.push({
        key: 'decor:' + id, decorId: id, icon: meta.icon, name: meta.name,
        count: n, sub: free ? '∞' : '', price: DECOR_SELL[id] || 0,
        meta: `${meta.ground ? '地面层' : '立体层'} · 回收价 ${DECOR_SELL[id] || 0} 金（商店买 ${DECOR_PRICE[id] || 0} 金）`
          + (free ? ' · 免费铺装，无限使用' : ` · 库存 ${n} 件`) + ' · 选「摆放」后在地块上点一下',
        sell: free ? null : (q => sellDecorUI(id, q)),
      });
    }
    return out;
  }
  for(const key of Object.keys(state.dishes)){
    const d = state.dishes[key];
    if(!d || !(d.n > 0)) continue;
    out.push({
      key: 'dish:' + key, icon: 'dish:' + key, name: d.name + ' ' + (d.qname || '一般'), count: d.n, price: d.value,
      meta: `${d.qname || '一般'} · 单价 ${d.value} 金 · 用料：${(d.pieces || []).map(itemName).join('+') || '—'}`,
      sell: q => sellDishUI(key, q),
    });
  }
  return out;
}
/* 进装饰分类时优先选中「当前拿在手上的那件」，别把摆放手感打断 */
function storeSelectCurrentDecor(){
  if(state.tool !== 'decor' || !state.selectedDecor) return false;
  if((state.decorBag[state.selectedDecor] || 0) <= 0 && !decorIsFree(state.selectedDecor)) return false;
  storeSel = 'decor:' + state.selectedDecor;
  return true;
}
const STORE_EMPTY = {
  crop: '仓库空空如也 ' + '🌱' + '<br><span class="r-meta">去种点东西吧</span>',
  prep: '还没有备料 ' + '🔪' + '<br><span class="r-meta">去厨房把小麦磨成面粉、把菜切块</span>',
  dish: '还没有做好的菜 ' + '🍳' + '<br><span class="r-meta">打开厨房试试</span>',
  decor: '装饰仓库空空如也 ' + '🏡' + '<br><span class="r-meta">用锄头锄掉地里的树/石头/灌木/花就能收进来</span>',
};
const STORE_TABS = [['crop','作物','carrot'],['prep','备料','knife'],['dish','菜品','pan'],['decor','装饰','house']];
function renderStore(){
  renderWarehouseToggle();
  const tabs = document.getElementById('storeTabs'), el = document.getElementById('storeList');
  if(!el) return;
  if(tabs){
    const counts = {
      crop: CROP_IDS.reduce((a, id) => a + (state.bag[id] || 0), 0),
      prep: Object.values(state.pieces).reduce((a, b) => a + b, 0) + (state.prep.flour || 0),
      dish: dishTotal(),
      decor: decorBagTotal(),
    };
    tradeTabs(tabs, STORE_TABS, storeTab, counts, key => {
      storeTab = key; storeSel = ''; storeQty = 1;
      if(key === 'decor') storeSelectCurrentDecor();
      SFX.play('click'); renderStore();
    });
  }
  const items = storeCatalog(storeTab);
  if(!items.some(it => it.key === storeSel)){ storeSel = items.length ? items[0].key : ''; storeQty = 1; }
  el.innerHTML = '';
  if(!items.length) el.innerHTML = '<div class="empty">' + STORE_EMPTY[storeTab] + '</div>';
  for(const it of items){
    el.appendChild(goodsCard({
      icon: it.icon, name: it.name, sub: it.sub || ('×' + it.count), title: it.meta,
      active: it.key === storeSel,
      onPick: () => { storeSel = it.key; storeQty = 1; SFX.play('click'); renderStore(); },
    }));
  }
  if(storeTab === 'decor') gridNote(el, '锄头会把地里的装饰物收回这里；选中一件点「摆放」，再点地块就能摆回去。');
  renderStoreExtra(items);
  syncStoreBar(items);
}
/* 各分类的「一键全卖」：run() 返回 { gain, msg }（备料不能直接卖，所以没有） */
const SELL_ALL = {
  crop: {
    run(){
      let gain = 0, cnt = 0;
      for(const id of CROP_IDS){
        const n = state.bag[id] || 0;
        if(n > 0){ state.bag[id] = 0; gain += n * CROPS[id].sellPrice; cnt += n; }
      }
      return { gain, msg: `卖出 ${cnt} 件，+${gain} 金` };
    },
  },
  dish: {
    run(){
      let gain = 0;
      for(const key of Object.keys(state.dishes)) gain += sellDish(key, state.dishes[key].n);
      return { gain, msg: `+${gain} 金` };
    },
  },
  decor: {
    run(){
      let gain = 0;
      for(const id of DECOR_IDS) gain += sellDecor(id, state.decorBag[id] || 0);
      return { gain, msg: `卖出装饰 +${gain} 金` };
    },
  },
};
function renderStoreExtra(items){
  const box = document.getElementById('storeExtra');
  if(!box) return;
  box.innerHTML = '';
  const sellAll = SELL_ALL[storeTab];
  if(!items.length || !sellAll) return;
  const all = document.createElement('button');
  all.className = 'mini sell';
  all.innerHTML = '💰' + ' 一键全卖';
  all.onclick = () => {
    const r = sellAll.run();
    if(r.gain <= 0) return;
    if(storeTab === 'crop'){ state.coins += r.gain; trackAction('coins', r.gain); }
    SFX.play('coin'); renderHUD(); renderStore(); save(); toast(r.msg);
  };
  box.appendChild(all);
}
/* 操作条：滑条上限 = 库存，按钮上直接写卖出去能拿多少金 */
function syncStoreBar(items){
  const btn = document.getElementById('storeSell'), place = document.getElementById('storePlace');
  const it = items.find(x => x.key === storeSel);
  if(place){
    place.hidden = !(it && it.decorId);
    place.onclick = it && it.decorId ? () => {
      state.selectedDecor = it.decorId;
      state.tool = 'decor';
      SFX.play('click'); renderToolbar(); save(); closeSheet();
      toast(`已选中 ${it.name}，点空地摆放`);
    } : null;
  }
  if(!it){
    syncQtyBar('store', { disabled: true, dash: true });
    btn.disabled = true; btn.textContent = '售出'; btn.onclick = null;
    return;
  }
  storeQty = syncQtyBar('store', { max: it.count, qty: storeQty, disabled: !it.sell,
    onInput: v => { storeQty = v; syncStoreBar(items); } });
  if(!it.sell){
    /* 菜块这种只能在厨房用的东西、或免费铺装：库存照常显示，但按钮点不动 */
    btn.disabled = true; btn.textContent = '不可出售'; btn.onclick = null;
    return;
  }
  btn.disabled = false;
  btn.textContent = '售出 +' + (it.price * storeQty) + ' 金';
  btn.onclick = () => it.sell(storeQty);
}
/* 从库存对象里卖 n 件：扣库存 + 进金币 + 刷新，返回收入 */
function sellStock(store, id, unitPrice, qty, trackSold){
  const n = Math.min(qty, store[id] || 0);
  if(n <= 0) return 0;
  const gain = n * unitPrice;
  store[id] -= n; state.coins += gain;
  trackAction('coins', gain);
  if(trackSold) trackAction('sold', n);
  SFX.play('coin'); renderHUD(); renderStore(); save();
  toast(`卖出 ×${n}，+${gain} 金`);
  return gain;
}
function sellCrop(id, qty){ return sellStock(state.bag, id, CROPS[id].sellPrice, qty, true); }
function sellPrep(id, qty){ return sellStock(state.prep, id, EXTRA_ITEMS[id].sellPrice, qty); }
function sellDishUI(key, qty){
  const gain = sellDish(key, qty);
  if(gain > 0){ SFX.play('coin'); renderHUD(); renderStore(); save(); toast(`+${gain} 金`); }
}
