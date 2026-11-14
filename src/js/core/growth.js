/* ============ 生长 / 田间操作 ============ */

function growthSpeed(t){
  let s = 1;
  if(t.watered) s *= WATER_MULT;
  if(t.fertile) s *= FERT_MULT;
  return s;
}
function tileProgress(t){
  if(!t.crop || !CROPS[t.crop]) return 0;
  return Math.max(0, Math.min(1, t.growth / cropReadyMs(CROPS[t.crop])));
}
function tileStage(t){
  const p = tileProgress(t);
  return p < 0.33 ? 0 : p < 0.66 ? 1 : p < 1 ? 2 : 3;
}

/* 每帧生长；rate 用于后台/离线补偿（按较低速率折算） */
function advanceGrowth(dtMs, rate){
  const r = (rate == null) ? 1 : rate;
  for(const t of state.tiles){
    if(t.state !== 'growing') continue;
    const def = CROPS[t.crop]; if(!def) continue;
    t.growth += dtMs * growthSpeed(t) * r;
    if(t.growth >= cropReadyMs(def)){
      t.growth = cropReadyMs(def);
      t.state = 'ready';
      save();
    }
  }
}

/* 播种：返回 {ok, msg} */
function plantSeed(t, seedId){
  const def = CROPS[seedId];
  if(!def) return { ok:false, msg:'没有这种种子' };
  if(t.stone) return { ok:false, msg: STONE_ONLY_DECOR };
  if(!inFarm(t.gx, t.gy)) return { ok:false, msg:'这块地还没扩建' };
  if(t.state === 'wild')  return { ok:false, msg:'先开垦' };
  if(t.state !== 'tilled') return { ok:false, msg:'已有作物' };
  if(state.coins < def.seedCost) return { ok:false, msg:'金币不够' };
  state.coins -= def.seedCost;
  t.state = 'growing'; t.crop = seedId; t.growth = 0;
  t.watered = (ATMOS.weather === 'rain');    /* 雨天种下去就是湿的，不用等下一帧的雨检 */
  t.fertile = false;
  t.harvestsLeft = def.harvests || 0;
  pushRecentSeed(seedId);
  trackAction('plant', seedId);
  return { ok:true, msg:`种下 ${def.name}` };
}

function waterTile(t){
  if(t.state !== 'growing') return { ok:false, msg:'只能浇生长中的' };
  if(t.watered) return { ok:false, msg:'已经浇过' };
  t.watered = true;
  trackAction('water');
  return { ok:true, msg:'💧 浇水完成' };
}

function fertilizeTile(t, premium){
  if(t.state !== 'growing') return { ok:false, msg: premium ? '只能催熟生长中的' : '只能施给生长中的' };
  if(premium){
    if(state.premium <= 0) return { ok:false, msg:'高级肥料不足' };
    state.premium--;
    const def = CROPS[t.crop];
    t.growth = cropReadyMs(def);
    t.state = 'ready';
    /* 高级肥料除了催熟，还给 5 次「收完不返草地」 */
    t.fertLeft = Math.max(t.fertLeft || 0, PREMIUM_KEEP);
    trackAction('premium');
    return { ok:true, msg:'✨ 高级肥料：立刻催熟！（这块地还能收 ' + t.fertLeft + ' 次不返草地）', ripened:true };
  }
  if(t.fertile) return { ok:false, msg:'已施过肥' };
  if(state.fertilizer <= 0) return { ok:false, msg:'肥料不足' };
  state.fertilizer--;
  t.fertile = true;
  t.fertLeft = Math.max(t.fertLeft || 0, FERT_KEEP);
  trackAction('fert');
  return { ok:true, msg:'🧪 施肥完成（这块地还能收 ' + t.fertLeft + ' 次不返草地）' };
}

/* 收获：多次收获作物会原地复熟 */
function harvestTile(t){
  if(t.state !== 'ready') return { ok:false, msg:'还没成熟' };
  const cropId = t.crop, def = CROPS[cropId];
  const n = 1;
  if(state.warehouseEnabled){
    state.bag[cropId] = (state.bag[cropId] || 0) + n;
  } else {
    const gain = def.sellPrice * n;
    state.coins += gain;
    trackAction('coins', gain);
  }
  trackAction('harvest', cropId);
  let multi = false, kept = false;
  if(cropIsMulti(def) && t.harvestsLeft > 1){
    t.harvestsLeft--;
    t.state = 'growing';
    t.growth = cropReadyMs(def) - def.regrowMs;   // 复熟只需 regrowMs
    t.watered = (ATMOS.weather === 'rain');       // 雨天复熟后自动保持湿润
    t.fertile = false;
    multi = true;
  } else if((t.fertLeft || 0) > 0){
    /* 施过肥的地：收完还是耕地（可以直接补种），次数用完才返草地 */
    t.fertLeft--;
    t.state = 'tilled'; t.crop = null; t.growth = 0;
    t.watered = false; t.fertile = false; t.harvestsLeft = 0;
    kept = true;
  } else {
    t.state = 'wild'; t.terrain = 'grass'; t.crop = null;
    t.growth = 0; t.watered = false; t.fertile = false; t.harvestsLeft = 0; t.fertLeft = 0;
  }
  return { ok:true, cropId, n, multi, kept, fertLeft: t.fertLeft || 0, gain: def.sellPrice * n };
}

/* ============ 离线结算 ============ */
function applyOffline(st, offlineMs){
  const out = { grown:0, ripened:0, idle:0 };
  if(offlineMs < 1000) return out;
  const capped = Math.min(offlineMs, OFFLINE_CAP);
  for(const t of st.tiles){
    if(t.state !== 'growing') continue;
    const def = CROPS[t.crop]; if(!def) continue;
    let speed = OFFLINE_RATE;
    if(t.watered) speed *= WATER_MULT;
    if(t.fertile) speed *= FERT_MULT;
    t.growth += capped * speed;
    out.grown++;
    if(t.growth >= cropReadyMs(def)){ t.growth = cropReadyMs(def); t.state = 'ready'; out.ripened++; }
  }
  out.idle = idleOffline(st, offlineMs);
  return out;
}

/* ============ 雨天自动浇水 ============ */
let rainDone = false;
function onRainStart(){ rainDone = false; }
function applyRainWatering(){
  const raining = ATMOS.weather === 'rain';
  if(!raining){ rainDone = false; return; }
  /* 雨天是**持续**湿润：不只是下雨那一刻浇一遍 ——
     雨中新种下的、多次收获复熟后 watered 被重置的，都会立刻喝饱水，
     所以雨天玩家完全不用碰水壶（框选浇水也会因为「没有需要浇水的作物」自己跳过）。 */
  let n = 0;
  for(const t of state.tiles){
    if(t.state === 'growing' && !t.watered){ t.watered = true; n++; }
  }
  if(n > 0){
    if(!rainDone){ rainDone = true; toast(`🌧️ 下雨了，${n} 块地自动喝饱水（雨天不用浇水）`); }
    save();
  }
}
