/* 商店 */
function renderShop(){
  const el = document.getElementById('shopList');
  if(!el) return;
  el.innerHTML = '';

  const mk = (icon, name, meta, price, onBuy, buyMany) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <div class="r-ico">${icon}</div>
      <div style="flex:1">
        <div class="r-name">${name}</div>
        <div class="r-meta">${meta}</div>
      </div>`;
    const b1 = document.createElement('button');
    b1.className = 'mini'; b1.textContent = `买 ${price} 金`;
    b1.onclick = e => { e.stopPropagation(); onBuy(1); };
    row.appendChild(b1);
    if(buyMany){
      const b10 = document.createElement('button');
      b10.className = 'mini'; b10.textContent = `×10`;
      b10.onclick = e => { e.stopPropagation(); onBuy(10); };
      row.appendChild(b10);
    }
    el.appendChild(row);
  };

  mk('🧪', '普通肥料', `生长速度 ×1.5，可与浇水叠加 · 现有 ${state.fertilizer}`, FERT_COST, n => {
    const cost = FERT_COST * n;
    if(state.coins < cost){ toast('金币不够'); SFX.play('error'); return; }
    state.coins -= cost; state.fertilizer += n;
    SFX.play('buy'); renderHUD(); renderShop(); save(); toast(`买入肥料 ×${n}`);
  }, true);

  mk('✨', '高级肥料', `直接催熟当前作物 · 主要靠每日任务获得 · 现有 ${state.premium}`, PREMIUM_COST, n => {
    const cost = PREMIUM_COST * n;
    if(state.coins < cost){ toast('金币不够'); SFX.play('error'); return; }
    state.coins -= cost; state.premium += n;
    SFX.play('buy'); renderHUD(); renderShop(); save(); toast(`买入高级肥料 ×${n}`);
  }, false);

  const tip = document.createElement('div');
  tip.className = 'r-meta';
  tip.style.padding = '10px 4px 0';
  tip.textContent = '提示：每日任务的奖励就是这两种肥料，高级肥料能省下一整个生长周期。';
  el.appendChild(tip);

  /* ---------- 装饰品 ---------- */
  const sep = document.createElement('div');
  sep.className = 'shop-sep';
  sep.textContent = '🏡 装饰品（买完进装饰仓库，摆在农场外的地面或石头地上）';
  el.appendChild(sep);

  for(const id of DECOR_IDS){
    const meta = DECOR_META[id];
    if(!DECOR_PRICE[id]) continue;
    mk(meta.icon, meta.name, `装饰物 · 现有 ${state.decorBag[id] || 0} · 回收价 ${DECOR_SELL[id] || 0} 金`, DECOR_PRICE[id], n => {
      const cost = DECOR_PRICE[id] * n;
      if(state.coins < cost){ toast('金币不够'); SFX.play('error'); return; }
      state.coins -= cost;
      state.decorBag[id] = (state.decorBag[id] || 0) + n;
      SFX.play('buy');
      renderHUD(); renderShop(); renderDecorBag(); save();
      toast(`买入 ${meta.name} ×${n}`);
    }, true);
  }
}
