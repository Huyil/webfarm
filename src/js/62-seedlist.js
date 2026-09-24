/* 最近用过的种子（工具栏「种子」小凸起里先给这几个，再点「更多」开完整列表） */
function pushRecentSeed(id){
  if(!id || !CROPS[id]) return;
  const list = state.recentSeeds || (state.recentSeeds = []);
  const i = list.indexOf(id);
  if(i >= 0) list.splice(i, 1);
  list.unshift(id);
  if(list.length > 6) list.length = 6;
}
function kSeedBtnRow(id){
  const def = CROPS[id];
  if(!def) return '';
  const cur = state.selectedSeed === id;
  const afford = state.coins >= def.seedCost;
  return '<button class="tp-row' + (cur ? ' on' : '') + (afford ? '' : ' poor') + '" data-seed="' + id + '">' +
    '<span class="tp-ico">' + def.emoji + '</span>' +
    '<span class="tp-txt"><b>' + def.name + '</b><i>' + def.seedCost + ' 金 · 成熟 ' + Math.round(cropReadyMs(def) / 1000) + 's</i></span>' +
    (cur ? '<span class="tp-cur">已选</span>' : '') + '</button>';
}
function renderSeedPop(){
  const el = document.getElementById('seedPop');
  if(!el) return;
  const list = (state.recentSeeds || []).filter(id => !!CROPS[id]);
  const rows = list.length
    ? list.map(kSeedBtnRow).join('')
    : '<div class="tp-empty">还没有种过东西 —— 点「更多」挑一种种子</div>';
  el.innerHTML = rows +
    '<button class="tp-more" data-act="seed-more">更多种子 ›</button>';
}
/* 工具栏「肥料」的小凸起：普通肥料 / 高级肥料（原来的「催熟」按键并到这里） */
function renderFertPop(){
  const el = document.getElementById('fertPop');
  if(!el) return;
  const opt = (tool, ico, name, desc, n) =>
    '<button class="tp-row' + (state.tool === tool ? ' on' : '') + (n > 0 ? '' : ' poor') + '" data-tool-pick="' + tool + '">' +
      '<span class="tp-ico">' + ico + '</span>' +
      '<span class="tp-txt"><b>' + name + '</b><i>' + desc + '</i></span>' +
      '<span class="tp-n">×' + n + '</span></button>';
  el.innerHTML =
    opt('fert', '🧪', '肥料', '生长 ×' + FERT_MULT + ' · 收完还留 ' + FERT_KEEP + ' 次耕地', state.fertilizer) +
    opt('premium', '✨', '高级肥料', '立刻催熟 · 留 ' + PREMIUM_KEEP + ' 次耕地', state.premium);
}
function renderToolPops(){ renderFertPop(); renderSeedPop(); }
function toggleToolPop(which){
  const el = document.getElementById(which === 'fert' ? 'fertPop' : 'seedPop');
  const other = document.getElementById(which === 'fert' ? 'seedPop' : 'fertPop');
  if(other) other.classList.remove('show');
  if(!el) return false;
  const on = !el.classList.contains('show');
  el.classList.toggle('show', on);
  if(on){ if(which === 'fert') renderFertPop(); else renderSeedPop(); }
  return on;
}
function closeToolPops(){
  ['fertPop', 'seedPop'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.classList.remove('show');
  });
}

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
      pushRecentSeed(id);
      SFX.play('click'); renderToolbar(); closeSheet(); closeToolPops();
      toast(`已选 ${def.name}`);
    };
    el.appendChild(row);
  }
}
