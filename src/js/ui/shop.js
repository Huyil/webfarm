/* ============ 商店 ============
 * 上方分类 → 中间商品网格（图标 / 名称 / 单价）→ 下方滑条 + 数量 + 购买。
 * 滑条上限 = 当前金币买得起的最大数量（封顶 SHOP_QTY_MAX）。 */
const SHOP_TABS = [['fert', '肥料', '🧪'], ['decor', '装饰', '🏡'], ['machine', '机器', '⚙️']];
const SHOP_QTY_MAX = 99;
let shopTab = 'fert', shopSel = '', shopQty = 1;

/* 商品/物品卡片（商店、仓库共用）：上方图标、名称，下方单价或数量。
 * icon：厨房绘制键（'crop:carrot'）或 emoji（'🌳'）。 */
function goodsCard(opt){
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'g-card' + (opt.active ? ' active' : '');
  if(opt.title) card.title = opt.title;
  const ico = document.createElement('div');
  ico.className = 'g-ico';
  const key = String(opt.icon == null ? '' : opt.icon);
  ico.appendChild(iconNode(key, 30));
  const nm = document.createElement('div');
  nm.className = 'g-name'; nm.textContent = opt.name;
  const sub = document.createElement('div');
  sub.className = 'g-sub'; sub.textContent = opt.sub;
  card.append(ico, nm, sub);
  if(opt.onPick) card.onclick = opt.onPick;
  return card;
}
/* 分类页签（商店、仓库共用）；counts 可选，用来说明每类有多少件 */
function tradeTabs(box, tabs, cur, counts, onPick){
  box.innerHTML = '';
  for(const [key, label, ico] of tabs){
    const b = document.createElement('button');
    b.className = 'tab' + (cur === key ? ' active' : '');
    b.textContent = ico + ' ' + label + (counts && counts[key] ? ' ' + counts[key] : '');
    b.onclick = () => onPick(key);
    box.appendChild(b);
  }
}
/* 数量滑条（商店、仓库共用）：夹紧数量并回写滑条/文字，返回实际数量。
 * id 是「shop」/「store」：对应 #shopQty / #shopQtyText / #storeQty / #storeQtyText。 */
function syncQtyBar(id, o){
  const slider = document.getElementById(id + 'Qty');
  const txt = document.getElementById(id + 'QtyText');
  const max = Math.max(1, o.max || 1);
  const qty = Math.max(1, Math.min(o.qty || 1, max));
  slider.disabled = !!o.disabled;
  slider.max = max; slider.value = qty;
  txt.textContent = o.dash ? '—' : '×' + qty;
  slider.oninput = o.disabled ? null : () => {
    const v = Math.max(1, Math.round(+slider.value) || 1);
    if(v !== qty) o.onInput(v);
  };
  return qty;
}
/* 扣金币：够就扣并返回 true；不够只提示、不扣 */
function spendCoins(cost){
  if(state.coins < cost){ toast('金币不够'); SFX.play('error'); return false; }
  state.coins -= cost;
  return true;
}

/* 网格末尾的说明行（商店、仓库共用） */
function gridNote(el, text){
  const note = document.createElement('div');
  note.className = 'g-note';
  note.textContent = text;
  el.appendChild(note);
}
/* 某一分类下的商品：key / icon / name / price / buy(n) / meta(悬停说明) */
function shopCatalog(tab){
  const out = [];
  const mkFert = (key, icon, name, label, price, note, get, add) => ({
    key, icon, name, price,
    meta: `${note} · 每份 ${price} 金 · 现有 ${get()}`,
    buy(n){
      if(!spendCoins(price * n)) return false;
      add(n);
      SFX.play('buy'); renderHUD(); save();
      toast(`买入${label} ×${n}`);
      return true;
    },
  });
  if(tab === 'fert'){
    out.push(
      mkFert('fert', '🧪', '普通肥料', '肥料', FERT_COST, '生长速度 ×1.5，可与浇水叠加',
             () => state.fertilizer, n => { state.fertilizer += n; }),
      mkFert('premium', '✨', '高级肥料', '高级肥料', PREMIUM_COST,
             '直接催熟当前作物 · 主要靠每日任务获得',
             () => state.premium, n => { state.premium += n; }),
    );
    return out;
  }
  if(tab === 'machine'){
    /* 石磨 / 切菜板 / 烤箱的机器升级：一次只买 1 台，买完卡片改名成下一台 */
    const mkAuto = (id, icon) => {
      const dev = AUTO_DEVICES[id];
      const n = autoCountOf(id);
      if(n >= AUTO_MAX) return;
      out.push({
        key: 'machine:' + id, icon, name: '添加第' + (n + 1) + '台' + dev.name,
        price: autoPrice(id), single: true,
        meta: dev.desc + ' · 现有 ' + n + ' 台（最多 ' + AUTO_MAX + ' 台）',
        buy(){
          const r = autoBuy(id);
          if(!r.ok){ toast(r.msg); SFX.play('error'); return false; }
          toast(r.msg);
          return true;
        },
      });
    };
    mkAuto('donkey', '🐴');
    mkAuto('chopper', '🔪');
    if(ovenCanUpgrade()){
      const cap = ovenCap();
      out.push({
        key: 'machine:oven', icon: '🔥', name: '添加第' + (cap + 1) + '台烤箱',
        price: ovenSlotPrice(), single: true,
        meta: '烤箱增加 1 个烤位：每轮多出炉 1 份 · 现在每轮 ' + cap + ' 份（最多 ' + OVEN_SLOT_MAX + ' 份）',
        buy(){
          const r = ovenUpgrade();
          toast(r.msg);
          if(!r.ok){ SFX.play('error'); return false; }
          SFX.play('buy');
          return true;
        },
      });
    }
    return out;
  }
  /* 装饰品：买完进仓库的「装饰」分类，摆在农场外的地面或石头地上 */
  for(const id of DECOR_IDS){
    const meta = DECOR_META[id];
    if(!DECOR_PRICE[id]) continue;
    out.push({
      key: 'decor:' + id, icon: meta.icon, name: meta.name, price: DECOR_PRICE[id],
      meta: `装饰物 · 每件 ${DECOR_PRICE[id]} 金 · 回收价 ${DECOR_SELL[id] || 0} 金 · 现有 ${state.decorBag[id] || 0}`,
      buy(n){
        if(!spendCoins(DECOR_PRICE[id] * n)) return false;
        state.decorBag[id] = (state.decorBag[id] || 0) + n;
        SFX.play('buy'); renderHUD(); renderStore(); save();
        toast(`买入 ${meta.name} ×${n}`);
        return true;
      },
    });
  }
  return out;
}
function renderShop(){
  const tabs = document.getElementById('shopTabs'), el = document.getElementById('shopList');
  if(!el) return;
  const items = shopCatalog(shopTab);
  if(!items.some(it => it.key === shopSel)){ shopSel = items.length ? items[0].key : ''; shopQty = 1; }
  if(tabs) tradeTabs(tabs, SHOP_TABS, shopTab, null, key => {
    shopTab = key; shopSel = ''; shopQty = 1;
    SFX.play('click'); renderShop();
  });
  el.innerHTML = '';
  for(const it of items){
    el.appendChild(goodsCard({
      icon: it.icon, name: it.name, sub: it.price + ' 金', title: it.meta,
      active: it.key === shopSel,
      onPick: () => { shopSel = it.key; shopQty = 1; SFX.play('click'); renderShop(); },
    }));
  }
  if(shopTab === 'fert') gridNote(el, '提示：每日任务的奖励就是这两种肥料，高级肥料能省下一整个生长周期。');
  else if(shopTab === 'machine') gridNote(el, '机器在厨房工位里启用：驴 / 切块机有 5 分钟租期，重复添加会顺延；烤箱升级增加每轮出炉份数。');
  syncShopBar(items);
}
/* 操作条：滑条上限 = 金币买得起的数量（至少 1），按钮上直接写总价 */
function syncShopBar(items){
  const btn = document.getElementById('shopBuy');
  if(!btn) return;
  const it = (items || shopCatalog(shopTab)).find(x => x.key === shopSel);
  const single = !!(it && it.single);
  const slider = document.getElementById('shopQty');
  const qtyText = document.getElementById('shopQtyText');
  if(slider) slider.style.display = single ? 'none' : '';
  if(qtyText) qtyText.style.display = single ? 'none' : '';
  const bar = btn.parentElement;
  if(bar && bar.classList) bar.classList.toggle('single', single);
  if(!it){
    syncQtyBar('shop', { disabled: true, dash: true });
    btn.disabled = true; btn.textContent = '购买'; btn.onclick = null;
    return;
  }
  const maxQ = single ? 1 : Math.min(SHOP_QTY_MAX, Math.floor(state.coins / it.price));
  shopQty = syncQtyBar('shop', { max: maxQ, qty: single ? 1 : shopQty, disabled: single,
    onInput: v => { shopQty = v; syncShopBar(items); } });
  const cost = it.price * shopQty;
  btn.disabled = state.coins < cost;
  btn.textContent = btn.disabled ? '金币不足' : ('购买 ' + cost + ' 金');
  btn.onclick = btn.disabled ? null : () => { if(it.buy(shopQty)) renderShop(); };
}
