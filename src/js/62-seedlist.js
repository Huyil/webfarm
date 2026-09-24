/* 种子列表 */
function renderSeedList(){
  const el = document.getElementById('seedList');
  if(!el) return;
  el.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'r-meta';
  head.style.padding = '0 4px 8px';
  head.textContent = '浇水 ×2 免费，成熟前均可浇；多次收获作物收完还能继续长。';
  el.appendChild(head);

  for(const id of SEED_ORDER){
    const def = CROPS[id];
    if(!def) continue;
    const affordable = state.coins >= def.seedCost;
    const isCur = state.selectedSeed === id;
    const row = document.createElement('div');
    row.className = 'row clickable' + (isCur ? ' active' : '');
    if(!affordable) row.style.opacity = '0.45';
    const multi = cropIsMulti(def);
    row.innerHTML = `
      <div class="r-ico">${def.emoji}</div>
      <div style="flex:1">
        <div class="r-name">${def.name}${isCur ? ' · 已选' : ''} <span class="tag">${def.tag}</span></div>
        <div class="r-meta">成熟 ${Math.round(cropReadyMs(def) / 1000)}s · 卖 ${def.sellPrice} 金${multi ? ` · 收获 ×${def.harvests}（复熟 ${Math.round(def.regrowMs / 1000)}s）` : ''}</div>
        <div class="r-meta">整周期 ${Math.round(cropTotalMs(def) / 1000)}s · 净赚 ${cropProfit(def)} · 回本 ${cropROI(def)}% · ${cropRate(def).toFixed(2)} 金/秒</div>
      </div>
      <div class="r-price">${def.seedCost} 金</div>`;
    row.onclick = () => {
      if(!affordable){ toast('金币不够'); SFX.play('error'); return; }
      state.selectedSeed = id; state.tool = 'seed';
      SFX.play('click'); renderToolbar(); closeSheet();
      toast(`已选 ${def.name}`);
    };
    el.appendChild(row);
  }
}
