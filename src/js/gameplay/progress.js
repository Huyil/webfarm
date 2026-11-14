/* ============ 计数与检查 ============ */
function trackAction(type, payload){
  const today = todayStr();
  if(state.stats.today.date !== today){
    const fresh = newStats().today;
    state.stats.today = fresh;
  }
  const t = state.stats.today;
  const all = state.stats.total;

  switch(type){
    case 'till':    t.till++;    all.till++;    break;
    case 'plant':   t.plant++;   all.plant++;   all.cropTypes[payload] = true;
                    if(payload) t['plant_' + payload] = (t['plant_' + payload] || 0) + 1; break;
    case 'water':   t.water++;   all.water++;   break;
    case 'fert':    t.fert++;    all.fert++;    break;
    case 'premium': t.premium++; all.premium++; break;
    case 'harvest': t.harvest++; all.harvest++;
                    if(payload) t['harvest_' + payload] = (t['harvest_' + payload] || 0) + 1; break;
    case 'coins':   t.coins += payload; all.coins += payload; break;
    case 'mill':    t.mill++;    all.mill++;    break;
    case 'chop':    { const n = payload || 1; t.chop += n; all.chop += n; break; }
    case 'cook':    t.cook++;    all.cook++;    break;
    case 'perfect': t.perfect++; all.perfect++; break;
    case 'expand':  t.expand = (t.expand||0) + 1; all.expand = (all.expand||0) + 1; break;
    case 'decor':   all.decorGot = (all.decorGot||0) + 1; t.decor = (t.decor||0) + 1; break;
    case 'sold':    all.sold = (all.sold||0) + (payload || 1); break;
    case 'roast':   all.roast = (all.roast||0) + 1; t.roast = (t.roast||0) + 1; break;
    case 'pave':    all.pave = (all.pave||0) + 1; t.pave = (t.pave||0) + 1; break;
  }
  checkAchievements();
  checkTasks();
  updateHudDots();
}

function checkAchievements(){
  const unlocked = [];
  for(const a of ACHIEVEMENTS){
    if(state.achievements[a.id]) continue;
    if(a.cond(state.stats)){
      state.achievements[a.id] = Date.now();
      unlocked.push(a);
    }
  }
  if(unlocked.length){
    state.achRead = false;
    SFX.play('achieve');
    unlocked.forEach((a, i) => {
      setTimeout(() => { showAchToast(a); fxCelebrate(a.name, a.desc); }, i * 420);
    });
    renderHUD();
    save();
  }
}

function checkTasks(force){
  const today = todayStr();
  if(state.tasks.date === today && !force) return;
  state.tasks.date = today;
  const shuffle = arr => {
    const a = arr.slice();
    for(let i = a.length - 1; i > 0; i--){ const j = (Math.random() * (i + 1)) | 0; const tmp = a[i]; a[i] = a[j]; a[j] = tmp; }
    return a;
  };
  /* 每天：2 个简单 + 1 个困难；未解锁的（做菜/扩建类）不参与 */
  const easy = shuffle(TASK_POOL.filter(t => !t.hard && taskUnlocked(t)));
  const hard = shuffle(TASK_POOL.filter(t =>  t.hard && taskUnlocked(t)));
  const chosen = easy.slice(0, 2).map(t => t.id);
  if(hard.length) chosen.push(hard[0].id);
  if(chosen.length < 3) for(const t of easy) if(chosen.length < 3 && chosen.indexOf(t.id) < 0) chosen.push(t.id);
  state.tasks.list = chosen.slice(0, 3).map(id => ({ id, claimed: false }));
  save();
}

function getTaskProgress(taskId){
  const def = TASK_POOL.find(x => x.id === taskId);
  if(!def) return 0;
  return Math.min(def.target, state.stats.today[def.type] || 0);
}
function grantReward(reward){
  const got = [];
  if(reward.fert){ state.fertilizer += reward.fert; got.push(`🧪×${reward.fert}`); }
  if(reward.premium){ state.premium += reward.premium; got.push(`✨×${reward.premium}`); }
  if(reward.decor){                       /* 每日任务也会送地砖 / 装饰 */
    for(const k in reward.decor){
      state.decorBag[k] = (state.decorBag[k] || 0) + reward.decor[k];
      got.push((DECOR_META[k] ? DECOR_META[k].icon : '🏡') + '×' + reward.decor[k]);
    }
  }
  return got.join(' ');
}
function claimAllTasks(){
  let claimed = 0; const all = [];
  state.tasks.list.forEach(t => {
    if(t.claimed) return;
    const def = TASK_POOL.find(x => x.id === t.id);
    if(!def) return;
    if(getTaskProgress(t.id) >= def.target){
      t.claimed = true; claimed++;
      state.stats.total.tasksDone = (state.stats.total.tasksDone || 0) + 1;
      all.push(grantReward(def.reward));
    }
  });
  if(!claimed) return;
  SFX.play('achieve');
  renderHUD(); renderTaskList(); updateHudDots(); checkAchievements(); save();
  toast(`领取 ${claimed} 个任务奖励：${all.join(' ')}`);
}
function claimTask(taskId){
  const t = state.tasks.list.find(x => x.id === taskId);
  if(!t || t.claimed) return;
  const def = TASK_POOL.find(x => x.id === taskId);
  if(!def) return;
  if(getTaskProgress(taskId) < def.target) return;
  t.claimed = true;
  state.stats.total.tasksDone = (state.stats.total.tasksDone || 0) + 1;   /* 排行榜要用 */
  const got = grantReward(def.reward);
  SFX.play('achieve');
  renderHUD(); renderTaskList(); updateHudDots(); checkAchievements(); save();
  toast(`任务完成！奖励 ${got}`);
}

/* ============ 成就奖励领取 ============ */
function achRewardText(reward){
  if(!reward) return '';
  const parts = [];
  if(reward.fert) parts.push('🧪×' + reward.fert);
  if(reward.premium) parts.push('✨×' + reward.premium);
  if(reward.decor) for(const k in reward.decor) parts.push((DECOR_META[k] ? DECOR_META[k].icon : '🏡') + '×' + reward.decor[k]);
  return parts.join(' ') || '—';
}
function grantAchReward(reward){
  if(!reward) return '';
  const got = [];
  if(reward.fert){ state.fertilizer += reward.fert; got.push('🧪×' + reward.fert); }
  if(reward.premium){ state.premium += reward.premium; got.push('✨×' + reward.premium); }
  if(reward.decor){
    for(const k in reward.decor){
      state.decorBag[k] = (state.decorBag[k] || 0) + reward.decor[k];
      got.push((DECOR_META[k] ? DECOR_META[k].icon : '🏡') + '×' + reward.decor[k]);
    }
  }
  return got.join(' ');
}
function achClaimed(id){ return !!(state.achClaimed && state.achClaimed[id]); }
function achClaimable(id){ return !!state.achievements[id] && !achClaimed(id); }
function claimableAchCount(){ return ACHIEVEMENTS.filter(a => achClaimable(a.id)).length; }
function claimAchievement(id){
  const a = ACHIEVEMENTS.find(x => x.id === id);
  if(!a || !achClaimable(id)) return { ok:false };
  state.achClaimed[a.id] = Date.now();
  const got = grantAchReward(a.reward);
  SFX.play('achieve');
  renderHUD(); renderAchievements(); updateHudDots(); save();
  toast(`🏆 ${a.name} 奖励：${got}`);
  return { ok:true, got };
}
function claimAllAchievements(){
  let n = 0; const got = [];
  for(const a of ACHIEVEMENTS){
    if(!achClaimable(a.id)) continue;
    state.achClaimed[a.id] = Date.now();
    n++; got.push(grantAchReward(a.reward));
  }
  if(!n) return 0;
  SFX.play('achieve');
  renderHUD(); renderAchievements(); updateHudDots(); save();
  toast(`领取 ${n} 个成就奖励：${got.join(' ')}`);
  return n;
}

/* ============ 成就 toast ============ */
function showAchToast(a){
  const el = document.createElement('div');
  el.className = 'ach-toast';
  el.innerHTML = `
    <span class="ach-toast-icon">${a.icon}</span>
    <div>
      <div class="ach-toast-label">🏆 成就解锁</div>
      <div class="ach-toast-name">${a.name}</div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 500);
  }, 2400);
}
