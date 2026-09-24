/* ============ 面板渲染 ============ */
function renderAchievements(){
  const el = document.getElementById('achList');
  if(!el) return;
  el.innerHTML = '';
  const done = unlockedAchCount();
  const head = document.createElement('div');
  head.className = 'r-meta';
  head.style.padding = '0 4px 10px';
  head.textContent = `已解锁 ${done}/${ACHIEVEMENTS.length} · 每个成就让挂机收益 +${IDLE_PER_ACH} 金/分（当前 ${idleRate().toFixed(1)} 金/分）`;
  el.appendChild(head);
  const claimable = claimableAchCount();
  const head2 = document.createElement('div');
  head2.className = 'r-meta';
  head2.style.padding = '0 4px 6px';
  head2.textContent = claimable > 0 ? `有 ${claimable} 个成就奖励可领取（肥料 / 高级肥料 / 装饰地砖）` : '解锁后记得回来领奖励：肥料、高级肥料、装饰地砖';
  el.appendChild(head2);

  ACHIEVEMENTS.forEach(a => {
    const unlocked = !!state.achievements[a.id];
    const claimed = achClaimed(a.id);
    const card = document.createElement('div');
    card.className = 'ach-card' + (unlocked ? ' unlocked' : '') + (claimed ? ' claimed' : '');
    card.innerHTML = `
      <div class="ach-icon">${a.icon}</div>
      <div class="ach-info">
        <div class="ach-name">${a.name}</div>
        <div class="ach-desc">${a.desc}</div>
        <div class="ach-reward">🎁 ${achRewardText(a.reward)}</div>
        ${unlocked ? '' : `<div class="ach-progress">${getAchProgress(a.id)}</div>`}
      </div>`;
    const btn = document.createElement('button');
    btn.className = 'mini ach-claim' + (unlocked && !claimed ? ' primary' : '');
    btn.textContent = claimed ? '已领' : unlocked ? '领取' : '未解锁';
    btn.disabled = !unlocked || claimed;
    btn.onclick = e => { e.stopPropagation(); claimAchievement(a.id); };
    card.appendChild(btn);
    el.appendChild(card);
  });

  const allBtn = document.getElementById('claimAllAchBtn');
  if(allBtn){
    allBtn.style.display = claimable ? '' : 'none';
    allBtn.textContent = `🏆 一键领取成就奖励（${claimable}）`;
  }
}
function getAchProgress(id){
  const s = state.stats.total;
  const bar = (a, b) => `${a} / ${b}`;
  switch(id){
    case 'first_harvest': return bar(s.harvest, 1);
    case 'harvest_10':    return bar(s.harvest, 10);
    case 'harvest_50':    return bar(s.harvest, 50);
    case 'harvest_100':   return bar(s.harvest, 100);
    case 'coins_100':     return bar(s.coins, 100);
    case 'coins_500':     return bar(s.coins, 500);
    case 'coins_2000':    return bar(s.coins, 2000);
    case 'all_crops':     return bar(Object.keys(s.cropTypes || {}).length, 7);
    case 'water_master':  return bar(s.water, 20);
    case 'fert_master':   return bar(s.fert, 10);
    case 'till_master':   return bar(s.till, 20);
    case 'first_cook':    return bar(s.cook, 1);
    case 'cook_25':       return bar(s.cook, 25);
    case 'mill_20':       return bar(s.mill, 20);
    case 'perfect_dish':  return bar(s.perfect, 1);
    case 'dish_types':    return bar(Object.keys(s.dishTypes || {}).length, 5);
    case 'idle_500':      return bar(s.idle || 0, 500);
    case 'idle_2000':     return bar(s.idle || 0, 2000);
    case 'harvest_500':   return bar(s.harvest, 500);
    case 'coins_5000':    return bar(s.coins, 5000);
    case 'water_100':     return bar(s.water, 100);
    case 'expand_10':     return bar(s.expand || 0, 10);
    case 'expand_25':     return bar(s.expand || 0, 25);
    case 'weed_20':       return bar(s.decorGot || 0, 20);
    case 'weed_60':       return bar(s.decorGot || 0, 60);
    case 'sold_100':      return bar(s.sold || 0, 100);
    case 'cook_100':      return bar(s.cook, 100);
    case 'roast_10':      return bar(s.roast || 0, 10);
    case 'perfect_25':    return bar(s.perfect, 25);
    case 'burnt_10':      return bar(s.burnt || 0, 10);
    case 'dish_types_10': return bar(Object.keys(s.dishTypes || {}).length, 10);
  }
  return '';
}
function renderTaskList(){
  const el = document.getElementById('taskList');
  if(!el) return;
  if(state.tasks.date !== todayStr()) checkTasks();
  el.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'r-meta';
  head.style.padding = '0 4px 10px';
  head.textContent = '每天刷新 3 个任务，奖励是普通肥料 / 高级肥料（✨ 高级肥料可直接催熟）。';
  el.appendChild(head);

  state.tasks.list.forEach(t => {
    const def = TASK_POOL.find(x => x.id === t.id);
    if(!def) return;
    const cur = getTaskProgress(def.id);
    const done = cur >= def.target;
    const row = document.createElement('div');
    row.className = 'task-row' + (t.claimed ? ' claimed' : done ? ' done' : '');
    row.innerHTML = `
      <div class="task-main">
        <div class="task-desc">${def.desc}</div>
        <div class="task-bar"><i style="width:${Math.min(100, cur / def.target * 100)}%"></i></div>
        <div class="r-meta">${cur} / ${def.target} · 奖励 ${rewardText(def.reward)}</div>
      </div>`;
    const btn = document.createElement('button');
    btn.className = 'mini' + (done && !t.claimed ? ' primary' : '');
    btn.textContent = t.claimed ? '已领' : done ? '领取' : '未完成';
    btn.disabled = !done || t.claimed;
    btn.onclick = () => claimTask(def.id);
    row.appendChild(btn);
    el.appendChild(row);
  });

  const claimAll = document.getElementById('claimAllBtn');
  if(claimAll){
    const n = state.tasks.list.filter(t => {
      const def = TASK_POOL.find(x => x.id === t.id);
      return def && !t.claimed && getTaskProgress(t.id) >= def.target;
    }).length;
    claimAll.style.display = n ? '' : 'none';
    claimAll.textContent = `✨ 一键领取（${n}）`;
  }
}
function renderChangelog(){
  const el = document.getElementById('logList');
  if(!el) return;
  el.innerHTML = '';
  for(const log of CHANGELOG){
    const box = document.createElement('div');
    box.className = 'log-box';
    box.innerHTML = `
      <div class="log-head"><span class="log-ver">${log.version}</span><span class="log-title">${log.title}</span><span class="log-date">${log.date}</span></div>
      <ul class="log-items">${log.items.map(i => `<li>${i}</li>`).join('')}</ul>`;
    el.appendChild(box);
  }
}
function updateHudDots(){
  const achBtn = document.getElementById('achBtn');
  if(achBtn){
    let dot = achBtn.querySelector('.badge');
    const anyClaim = (typeof claimableAchCount === 'function') ? claimableAchCount() > 0 : false;
    if((state.achRead === false || anyClaim) && !dot){
      dot = document.createElement('span'); dot.className = 'badge'; dot.textContent = '!';
      achBtn.appendChild(dot);
    } else if(state.achRead !== false && !anyClaim && dot) dot.remove();
  }
  const taskBtn = document.getElementById('tabTask');
  if(taskBtn){
    const hasClaimable = state.tasks.list.some(t => {
      if(t.claimed) return false;
      const def = TASK_POOL.find(x => x.id === t.id);
      return def && getTaskProgress(t.id) >= def.target;
    });
    let dot = taskBtn.querySelector('.badge');
    if(hasClaimable && !dot){
      dot = document.createElement('span'); dot.className = 'badge'; dot.textContent = '!';
      taskBtn.appendChild(dot);
    } else if(!hasClaimable && dot) dot.remove();
  }
}
function updateNoticeDot(){
  const btn = document.getElementById('noticeBtn');
  if(!btn) return;
  const unread = CHANGELOG.some(l => !state.noticeRead[l.version]);
  let dot = btn.querySelector('.badge');
  if(unread && !dot){
    dot = document.createElement('span'); dot.className = 'badge'; dot.textContent = '!';
    btn.appendChild(dot);
  } else if(!unread && dot) dot.remove();
}
