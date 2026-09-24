/* ============ 做菜逻辑（UI 见 68-kitchen.js） ============
 * 石磨：1 小麦 → 1 面粉
 * 烤箱：1 面粉 → 面包（有进度条，取晚了会焦）
 * 切菜板：1 作物 → 3 块菜块
 * 锅：随便放菜块（可掺大米），每放一次重置进度条；进度条走完即可出锅
 * 火候：完美窗口内取出 = 精品（+25%）；太久 = 焦糊（×0.4）；勾选自动出锅则只会得到正常
 */
const KITCHEN = {
  mill:  { busy:false, t:0, dur:MILL_MS },
  oven:  { busy:false, t:0, dur:OVEN_MS, ready:false, auto:false, item:null, autoLoop:false, lastItem:null },
  board: { busy:false, t:0, dur:CHOP_MS, src:null },
  pot:   { pieces:[], t:0, dur:POT_MS, done:false, auto:false, autoLoop:false, lastPieces:[] },
};

function gradeOf(t, dur, perfectMs, burnMs){
  if(t >= dur + burnMs) return 'burnt';
  if(t < dur + perfectMs) return 'perfect';
  return 'normal';
}
function addDish(recipe, qualityId, n){
  n = n || 1;
  const q = QUALITY[qualityId] || QUALITY.normal;
  const value = applyQuality(recipe.base, qualityId);
  const key = recipe.id + '|' + qualityId + '|' + recipe.pieces.join(',');
  let cur = state.dishes[key];
  if(cur) cur.n += n;
  else {
    cur = state.dishes[key] = { n, name: recipe.name, emoji: recipe.emoji, value,
      quality: qualityId, qname: q.name, qtag: q.tag, pieces: recipe.pieces.slice(), id: recipe.id };
  }
  state.stats.total.dishTypes[recipe.id] = true;
  return cur;
}

/* ---------- 石磨 ---------- */
function canMill(){ return !KITCHEN.mill.busy && (state.bag.wheat || 0) > 0; }
function mill(){
  if(KITCHEN.mill.busy) return { ok:false, msg:'石磨还在转' };
  if((state.bag.wheat || 0) <= 0) return { ok:false, msg:'没有小麦' };
  state.bag.wheat--;
  KITCHEN.mill.busy = true; KITCHEN.mill.t = 0;
  save();
  return { ok:true, msg:'开始磨面…' };
}

/* ---------- 烤箱：面粉烤面包，切过的菜块也能烤 ---------- */
function ovenPieceStock(){ return CROP_IDS.filter(id => (state.pieces[id] || 0) > 0); }
function canOvenPut(){
  return !KITCHEN.oven.busy && ((state.prep.flour || 0) > 0 || ovenPieceStock().length > 0);
}
function roastRecipe(id){
  return { id:'roast', name:'烤' + itemName(id), emoji:'🍢',
           base: Math.max(1, Math.round(pieceValue(id) * 2)), pieces:[id] };
}
/* arg 省略 = 优先面粉；也可以显式 { piece:id } / { flour:true } */
/* strict = 只认指定的那样东西（全自动循环用）：没有就失败，不会"顺手"抓别的原料顶上 */
function ovenPut(arg, strict){
  if(KITCHEN.oven.busy) return { ok:false, msg:'烤箱里还有东西' };
  let item = null;
  if(arg && arg.piece){
    if((state.pieces[arg.piece] || 0) <= 0) return { ok:false, msg:'没有' + itemName(arg.piece) + '块' };
    state.pieces[arg.piece]--; item = { type:'piece', id:arg.piece };
  } else if((state.prep.flour || 0) > 0){
    state.prep.flour--; item = { type:'flour' };
  } else if(strict){
    return { ok:false, msg:'没有面粉了' };
  } else {
    const list = ovenPieceStock();
    if(!list.length) return { ok:false, msg:'没有可烤的东西（先磨面粉或切菜）' };
    state.pieces[list[0]]--; item = { type:'piece', id:list[0] };
  }
  KITCHEN.oven.item = item;
  /* 记住「这次烤的是什么」：全自动循环时照这个配方再放一次 */
  KITCHEN.oven.lastItem = item.type === 'piece' ? { piece: item.id } : { prep: 'flour' };
  KITCHEN.oven.busy = true; KITCHEN.oven.ready = false; KITCHEN.oven.t = 0;
  save();
  return { ok:true, msg: item.type === 'flour' ? '面包进炉了' : itemName(item.id) + '块进炉了' };
}
function ovenTake(auto){
  if(!KITCHEN.oven.busy) return { ok:false, msg:'烤箱是空的' };
  if(!KITCHEN.oven.ready) return { ok:false, msg:'还没烤好' };
  const q = auto ? 'normal' : gradeOf(KITCHEN.oven.t, KITCHEN.oven.dur, OVEN_PERFECT_MS, OVEN_BURN_MS);
  const src = KITCHEN.oven.item;
  const isRoast = !!(src && src.type === 'piece');
  const recipe = isRoast ? roastRecipe(src.id) : ovenRecipe();
  const item = addDish(recipe, q, 1);
  KITCHEN.oven.busy = false; KITCHEN.oven.ready = false; KITCHEN.oven.t = 0;
  KITCHEN.oven.item = null;
  trackAction('cook');
  if(isRoast) trackAction('roast');
  if(q === 'perfect') trackAction('perfect');
  save();
  return { ok:true, quality:q, dish:item, msg:`${QUALITY[q].tag}${item.name}（${QUALITY[q].name}）` };
}
function ovenPreview(){
  const src = KITCHEN.oven.item;
  const isRoast = !!(src && src.type === 'piece');
  const recipe = isRoast ? roastRecipe(src.id) : ovenRecipe();
  return { recipe, quality: KITCHEN.oven.ready ? gradeOf(KITCHEN.oven.t, KITCHEN.oven.dur, OVEN_PERFECT_MS, OVEN_BURN_MS) : null };
}

/* ---------- 限时自动化设备（金币买、只能跑一段时间） ---------- */
const AUTO_DEVICES = {
  donkey:  { id:'donkey',  name:'拉磨的驴',   icon:'🐴', price:600, durMs:5*60*1000, per:MILL_MS,
             desc:'自动把小麦磨成面粉（不用手点石磨）' },
  chopper: { id:'chopper', name:'自动切块机', icon:'🔪', price:900, durMs:5*60*1000, per:1500,
             desc:'自动把仓库里的作物切成菜块（优先切最多的那种）' },
};
const AUTO_IDS = Object.keys(AUTO_DEVICES);
function autoUntilOf(id){ return (state.autoUntil && state.autoUntil[id]) || 0; }
function autoLeftMs(id){ return Math.max(0, autoUntilOf(id) - Date.now()); }
function autoActive(id){ return autoLeftMs(id) > 0; }
function autoBuy(id){
  const dev = AUTO_DEVICES[id];
  if(!dev) return { ok:false, msg:'没有这个设备' };
  if(state.coins < dev.price) return { ok:false, msg:`金币不够（需要 ${dev.price} 金）` };
  state.coins -= dev.price;
  const base = Math.max(Date.now(), autoUntilOf(id));       /* 还在跑就顺延 */
  state.autoUntil[id] = base + dev.durMs;
  state.autoAcc[id] = state.autoAcc[id] || 0;
  SFX.play('buy');
  trackAction('coins', 0);
  renderHUD(); renderKitchen(); save();
  const mins = Math.round(dev.durMs / 60000);
  return { ok:true, msg:`${dev.name} 上线 ${mins} 分钟（剩余 ${Math.ceil(autoLeftMs(id) / 60000)} 分钟）` };
}
/* 每帧推进：到点产出一次；原料不足就空转（时间照走，界面提示缺料） */
function autoTick(dt){
  const now = Date.now();
  for(const id of AUTO_IDS){
    if(!autoActive(id)) continue;
    state.autoAcc[id] = (state.autoAcc[id] || 0) + dt;
    const dev = AUTO_DEVICES[id];
    if(state.autoAcc[id] < dev.per) continue;
    state.autoAcc[id] -= dev.per;
    if(id === 'donkey'){
      if((state.bag.wheat || 0) > 0){
        state.bag.wheat--;
        state.prep.flour = (state.prep.flour || 0) + 1;
        trackAction('mill');
        save();
      }
    } else if(id === 'chopper'){
      let pick = null, best = 0;
      for(const c of CROP_IDS){
        if(CROPS[c].noChop) continue;
        const n = state.bag[c] || 0;
        if(n > best){ best = n; pick = c; }
      }
      if(pick){
        state.bag[pick]--;
        state.pieces[pick] = (state.pieces[pick] || 0) + CHOP_PIECES;
        KITCHEN.board.src = pick;
        trackAction('chop', CHOP_PIECES);
        save();
      }
    }
  }
}
/* 全自动循环：原料没了就自己关掉并说一声 */
function autoLoopFeed(){
  const K = KITCHEN;
  if(K.oven.autoLoop && !K.oven.busy){
    if(!K.oven.lastItem){ K.oven.autoLoop = false; return; }
    if(!ovenPut(K.oven.lastItem, true).ok){
      K.oven.autoLoop = false;
      toast('🥣 面粉烤完了：全自动出炉已停（原料不足）');
    }
    return;
  }
  if(K.pot.autoLoop && !K.pot.pieces.length){
    const last = K.pot.lastPieces || [];
    if(!last.length){ K.pot.autoLoop = false; return; }
    let ok = true;
    for(const id of last) if(!potAdd({ piece: id }).ok) ok = false;
    if(!ok){
      K.pot.autoLoop = false;
      toast('🔪 菜块用完了：全自动出锅已停（原料不足）');
    }
  }
}

/* ---------- 切菜板：瞬时出料（没有计时条，方便连续快速切） ---------- */
function canBoard(id){ return (CROPS[id] && !CROPS[id].noChop) ? (state.bag[id] || 0) > 0 : false; }
function boardPut(id){
  if(!CROPS[id]) return { ok:false, msg:'这不能切' };
  if(CROPS[id].noChop) return { ok:false, msg:CROPS[id].name + '不能切块，只能拿去磨面' };
  if((state.bag[id] || 0) <= 0) return { ok:false, msg:'仓库里没有' + CROPS[id].produce };
  state.bag[id]--;
  state.pieces[id] = (state.pieces[id] || 0) + CHOP_PIECES;
  KITCHEN.board.busy = false; KITCHEN.board.t = 0;
  KITCHEN.board.src = id;          /* 留个记录：界面可以显示「上一次切的是什么」 */
  trackAction('chop', CHOP_PIECES);
  save();
  return { ok:true, pieces:CHOP_PIECES, msg:`${CROPS[id].produce} +${CHOP_PIECES} 块` };
}

/* ---------- 锅 ---------- */
/* kind: {piece:'carrot'} 或 {raw:'rice'} */
function potRawAllowed(id){ return POT_RAW_OK.includes(id); }
function canPotAdd(kind){
  if(!kind) return false;
  if(kind.piece) return (state.pieces[kind.piece] || 0) > 0;
  if(kind.raw)   return potRawAllowed(kind.raw) && (state.bag[kind.raw] || 0) > 0;
  return false;
}
function potAdd(kind){
  if(!canPotAdd(kind)){
    return { ok:false, msg: kind && kind.raw && !potRawAllowed(kind.raw) ? '生食材要先切块' : '没有这份食材' };
  }
  let id;
  if(kind.piece){ state.pieces[kind.piece]--; id = kind.piece; }
  else { state.bag[kind.raw]--; id = kind.raw; }
  KITCHEN.pot.pieces.push(id);
  KITCHEN.pot.t = 0; KITCHEN.pot.done = false;     // 每加一样就重置进度条
  KITCHEN.pot.lastPieces = KITCHEN.pot.pieces.slice();   // 记住配方：全自动照着再做一锅
  save();
  return { ok:true, msg:`下锅：${itemName(id)}` };
}
function potPreview(){
  const pieces = KITCHEN.pot.pieces;
  if(!pieces.length) return null;
  const recipe = potRecipe(pieces);
  return { recipe, quality: KITCHEN.pot.done ? gradeOf(KITCHEN.pot.t, KITCHEN.pot.dur, POT_PERFECT_MS, POT_BURN_MS) : null };
}
function potTake(auto){
  const pieces = KITCHEN.pot.pieces;
  if(!pieces.length) return { ok:false, msg:'锅里是空的' };
  if(!KITCHEN.pot.done) return { ok:false, msg:'还没好' };
  const q = auto ? 'normal' : gradeOf(KITCHEN.pot.t, KITCHEN.pot.dur, POT_PERFECT_MS, POT_BURN_MS);
  const recipe = potRecipe(pieces);
  const item = addDish(recipe, q, 1);
  KITCHEN.pot.pieces = []; KITCHEN.pot.t = 0; KITCHEN.pot.done = false;
  trackAction('cook');
  if(q === 'perfect') trackAction('perfect');
  save();
  return { ok:true, quality:q, dish:item, msg:`${QUALITY[q].tag}${item.name}（${QUALITY[q].name}）` };
}

/* ---------- 卖菜 ---------- */
function sellDish(key, n){
  const d = state.dishes[key];
  if(!d) return 0;
  const qty = Math.max(0, Math.min(n, d.n));
  if(qty <= 0) return 0;
  const gain = d.value * qty;
  d.n -= qty;
  if(d.n <= 0) delete state.dishes[key];
  state.coins += gain;
  trackAction('coins', gain);
  return gain;
}
function dishTotal(){
  return Object.values(state.dishes).reduce((a, b) => a + b.n, 0);
}

/* ---------- 备料台（供 UI 渲染可拖拽的食材） ---------- */
function kitchenShelf(){
  const list = [];
  for(const id of CROP_IDS){
    const n = state.bag[id] || 0;
    if(n > 0) list.push({ key:'crop:' + id, kind:'crop', id, name:CROPS[id].produce, emoji:CROPS[id].emoji, n, color:CROPS[id].color });
  }
  for(const id of CROP_IDS){
    const n = state.pieces[id] || 0;
    if(n > 0) list.push({ key:'piece:' + id, kind:'piece', id, name:CROPS[id].produce + '块', emoji:'🔪', n, color:CROPS[id].color });
  }
  const fl = state.prep.flour || 0;
  if(fl > 0) list.push({ key:'prep:flour', kind:'prep', id:'flour', name:'面粉', emoji:'🥣', n:fl, color:'#f0e6d2' });
  const fav = state.fav || {};
  list.sort((a, b) => {
    const fa = fav[a.key] ? 1 : 0, fb = fav[b.key] ? 1 : 0;
    if(fa !== fb) return fb - fa;
    return b.n - a.n;
  });
  return list;
}

/* ---------- 每帧推进（由 68-kitchen.js 的 updateKitchen 调用） ---------- */
function kitchenLogicTick(dt){
  const K = KITCHEN;
  autoTick(dt);            /* 限时自动化设备（驴 / 切块机） */
  if(K.mill.busy){
    K.mill.t += dt;
    if(K.mill.t >= K.mill.dur){
      K.mill.busy = false; K.mill.t = 0;
      state.prep.flour = (state.prep.flour || 0) + 1;
      trackAction('mill');
      save();
    }
  }
  if(K.board.busy){
    K.board.busy = false; K.board.t = 0; K.board.src = null;   /* 切菜已改为瞬时，这里只兜底清状态 */
  }
  if(K.oven.busy){
    K.oven.t += dt;
    if(K.oven.t >= K.oven.dur && !K.oven.ready) K.oven.ready = true;
    /* 自动出炉：**精品窗口一结束就取**（dur + perfect），拿到的是「正常」，但不用一直占着炉子 */
    if(K.oven.ready && K.oven.auto && K.oven.t >= K.oven.dur + OVEN_PERFECT_MS) ovenTake(true);
  }
  if(K.pot.pieces.length){
    /* 到点（done）之后必须继续计时：进度条才走得满、才会进入焦糊，
       自动出锅也才有机会触发（原来 done 之后 t 冻在 4s，锅永远停在精品窗口） */
    K.pot.t += dt;
    if(!K.pot.done && K.pot.t >= K.pot.dur) K.pot.done = true;
    /* 锅同理：精品窗口一结束就出锅 */
    if(K.pot.done && K.pot.auto && K.pot.t >= K.pot.dur + POT_PERFECT_MS) potTake(true);
  }
  autoLoopFeed();          /* 全自动：自动投下一份，直到原料不足 */
}
