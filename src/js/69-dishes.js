/* ============ 做菜逻辑（UI 见 68-kitchen.js） ============
 * 石磨：1 小麦 → 1 面粉
 * 烤箱：1 面粉 → 面包（有进度条，取晚了会焦）
 * 切菜板：1 作物 → 3 块菜块
 * 锅：随便放菜块（可掺大米），每放一次重置进度条；进度条走完即可出锅
 * 火候：完美窗口内取出 = 精品（+25%）；太久 = 焦糊（×0.4）；勾选自动出锅则只会得到正常
 */
const KITCHEN = {
  mill:  { busy:false, t:0, dur:MILL_MS, queued:0 },     /* queued = 已装入待磨的小麦；busy/t 只给「自动磨粉」的进度条用 */

  oven:  { busy:false, t:0, dur:OVEN_MS, ready:false, auto:false, item:null, items:[], lastItem:null },
  board: { busy:false, t:0, dur:CHOP_MS, src:null },
  pot:   { pieces:[], t:0, dur:POT_MS, done:false, auto:false, lastPieces:[] },
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
const MILL_CAP = 5;                        /* 一次最多装几份小麦待磨 */
function millQueued(){ return KITCHEN.mill.queued || 0; }
function canMillLoad(){ return millQueued() < MILL_CAP && (state.bag.wheat || 0) > 0; }
function canMill(){ return millQueued() > 0; }          /* 手动磨：只要装了料就能立刻磨 */
/* 装一份小麦进石磨（不耗时，先攒着，想磨再磨） */
function millLoad(){
  if(millQueued() >= MILL_CAP) return { ok:false, msg:`石磨里最多放 ${MILL_CAP} 份，先磨了再放` };
  if((state.bag.wheat || 0) <= 0) return { ok:false, msg:'仓库里没有小麦' };
  state.bag.wheat--;
  KITCHEN.mill.queued = millQueued() + 1;
  save();
  return { ok:true, msg:`小麦入磨（${millQueued()}/${MILL_CAP}）` };
}
/* 把装好的小麦取回来（换配方 / 关面板时用） */
function millUnload(){
  const n = millQueued();
  if(!n) return 0;
  state.bag.wheat = (state.bag.wheat || 0) + n;
  KITCHEN.mill.queued = 0;
  save();
  return n;
}
/* 手动磨粉：**不需要计时**，一把磨完（计时只在自动磨粉上用） */
function mill(){
  const n = millQueued();
  if(!n) return { ok:false, msg:'石磨是空的（先放小麦）' };
  state.prep.flour = (state.prep.flour || 0) + n;
  KITCHEN.mill.queued = 0;
  for(let i = 0; i < n; i++) trackAction('mill');
  save();
  return { ok:true, n, msg:`磨好面粉 ×${n}` };
}
function millOld(){
  if(KITCHEN.mill.busy) return { ok:false, msg:'石磨还在转' };
  if((state.bag.wheat || 0) <= 0) return { ok:false, msg:'没有小麦' };
  state.bag.wheat--;
  KITCHEN.mill.busy = true; KITCHEN.mill.t = 0;
  save();
  return { ok:true, msg:'开始磨面…' };
}

/* ---------- 烤箱：面粉烤面包，切过的菜块也能烤 ---------- */
function ovenPieceStock(){ return CROP_IDS.filter(id => (state.pieces[id] || 0) > 0); }
/* 烤箱槽位：可花钱升级，一次能烤多份 */
function ovenCap(){ return Math.max(1, Math.min(OVEN_SLOT_MAX, state.ovenSlots || 1)); }
function ovenSlotPrice(){ return Math.round(OVEN_SLOT_PRICE0 * Math.pow(OVEN_SLOT_RATE, ovenCap() - 1)); }
function ovenCanUpgrade(){ return ovenCap() < OVEN_SLOT_MAX; }
function ovenUpgrade(){
  if(!ovenCanUpgrade()) return { ok:false, msg:`烤箱已经满级（${OVEN_SLOT_MAX} 槽）` };
  const price = ovenSlotPrice();
  if(state.coins < price) return { ok:false, msg:`金币不够（升级需要 ${price} 金）` };
  state.coins -= price;
  state.ovenSlots = ovenCap() + 1;
  renderHUD(); renderKitchen(); save();
  return { ok:true, msg:`烤箱升级：现在一次能烤 ${state.ovenSlots} 份（下一级 ${Math.round(OVEN_SLOT_PRICE0 * Math.pow(OVEN_SLOT_RATE, state.ovenSlots - 1))} 金）` };
}
function canOvenPut(){
  return KITCHEN.oven.items.length < ovenCap() && ((state.prep.flour || 0) > 0 || ovenPieceStock().length > 0);
}
function roastRecipe(id){
  return { id:'roast', name:'烤' + itemName(id), emoji:'🍢',
           base: Math.max(1, Math.round(pieceValue(id) * 2)), pieces:[id] };
}
/* arg 省略 = 优先面粉；也可以显式 { piece:id } / { flour:true } */
/* strict = 只认指定的那样东西（全自动循环用）：没有就失败，不会"顺手"抓别的原料顶上 */
function ovenPut(arg, strict){
  if(KITCHEN.oven.items.length >= ovenCap()) return { ok:false, msg:`烤箱满了（${ovenCap()} 个槽位，可以升级）` };
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
  KITCHEN.oven.items.push(item);
  KITCHEN.oven.item = KITCHEN.oven.items[0];              /* 兼容旧字段：图标/预览取第一份 */
  /* 记住「这次烤的是什么」：全自动循环时照这个配方再放一次 */
  KITCHEN.oven.lastItem = item.type === 'piece' ? { piece: item.id } : { prep: 'flour' };
  KITCHEN.oven.busy = true;
  /* 每加一份都重新计时：方便一次装几份再一起烤（跟锅一样） */
  KITCHEN.oven.ready = false; KITCHEN.oven.t = 0;
  save();
  const n = KITCHEN.oven.items.length;
  return { ok:true, msg: (item.type === 'flour' ? '面包进炉了' : itemName(item.id) + '块进炉了') +
                 (n > 1 ? `（共 ${n}/${ovenCap()} 份）` : '') };
}
function ovenTake(auto){
  const items = KITCHEN.oven.items;
  if(!items.length) return { ok:false, msg:'烤箱是空的' };
  if(!KITCHEN.oven.ready) return { ok:false, msg:'还没烤好' };
  /* 手动出炉（auto=false）会按当前火候判定：自动出炉开着也随时可以手动取，卡在精品段就是精品 */
  const q = auto ? 'normal' : gradeOf(KITCHEN.oven.t, KITCHEN.oven.dur, OVEN_PERFECT_MS, OVEN_BURN_MS);
  const out = [];
  let last = null;
  for(const src of items){
    const isRoast = !!(src && src.type === 'piece');
    const recipe = isRoast ? roastRecipe(src.id) : ovenRecipe();
    last = addDish(recipe, q, 1);
    out.push(last);
    trackAction('cook');
    if(isRoast) trackAction('roast');
    if(q === 'perfect') trackAction('perfect');
  }
  KITCHEN.oven.busy = false; KITCHEN.oven.ready = false; KITCHEN.oven.t = 0;
  KITCHEN.oven.items = []; KITCHEN.oven.item = null;
  save();
  const n = out.length;
  return { ok:true, quality:q, dish:last, dishes:out, n,
           msg:`${QUALITY[q].tag}${last.name}（${QUALITY[q].name}）` + (n > 1 ? ` ×${n}` : '') };
}
function ovenPreview(){
  const items = KITCHEN.oven.items;
  const src = items[0] || null;
  const isRoast = !!(src && src.type === 'piece');
  const recipe = isRoast ? roastRecipe(src.id) : ovenRecipe();
  return { recipe, quality: KITCHEN.oven.ready ? gradeOf(KITCHEN.oven.t, KITCHEN.oven.dur, OVEN_PERFECT_MS, OVEN_BURN_MS) : null };
}

/* ---------- 限时自动化设备（金币买、只能跑一段时间） ---------- */
const AUTO_DEVICES = {
  donkey:  { id:'donkey',  name:'拉磨的驴',   icon:'🐴', price:600, rate:1.6, durMs:5*60*1000, per:MILL_MS,
             desc:'自动磨面：进度条走完一次，每头驴产 1 份面粉' },
  chopper: { id:'chopper', name:'自动切块机', icon:'🔪', price:900, rate:1.6, durMs:5*60*1000, per:1500,
             desc:'自动切块：进度条走完一次，每台切 1 份（优先切最多的作物）' },
};
const AUTO_IDS = Object.keys(AUTO_DEVICES);
const AUTO_MAX = 5;                                   /* 每种最多同时养几台 */
function autoCountOf(id){ return (state.autoCount && state.autoCount[id]) || 0; }
/* 第 n 台的价格：指数上涨（600 → 960 → 1536 …） */
function autoPrice(id){
  const dev = AUTO_DEVICES[id];
  return Math.round(dev.price * Math.pow(dev.rate || 1.6, autoCountOf(id)));
}
function autoUntilOf(id){ return (state.autoUntil && state.autoUntil[id]) || 0; }
function autoLeftMs(id){ return Math.max(0, autoUntilOf(id) - Date.now()); }
function autoActive(id){ return autoLeftMs(id) > 0; }
function autoBuy(id){
  const dev = AUTO_DEVICES[id];
  if(!dev) return { ok:false, msg:'没有这个设备' };
  if(autoCountOf(id) >= AUTO_MAX) return { ok:false, msg:`${dev.name} 已经养满 ${AUTO_MAX} 台了` };
  const price = autoPrice(id);
  if(state.coins < price) return { ok:false, msg:`金币不够（第 ${autoCountOf(id) + 1} 台需要 ${price} 金）` };
  state.coins -= price;
  state.autoCount[id] = autoCountOf(id) + 1;
  const base = Math.max(Date.now(), autoUntilOf(id));       /* 还在跑就顺延 */
  state.autoUntil[id] = base + dev.durMs;
  state.autoAcc[id] = state.autoAcc[id] || 0;
  SFX.play('buy');
  trackAction('coins', 0);
  renderHUD(); renderKitchen(); save();
  const mins = Math.round(dev.durMs / 60000);
  const n = state.autoCount[id];
  return { ok:true, msg:`${dev.name} ×${n} 上线 ${mins} 分钟（剩余 ${Math.ceil(autoLeftMs(id) / 60000)} 分钟，每轮产 ${n} 份）` };
}
/* 每帧推进：到点产出一次；原料不足就空转（时间照走，界面提示缺料） */
function autoTick(dt){
  const K = KITCHEN;
  const audible = (typeof kKitchenOpen === 'function') && kKitchenOpen();   /* 开着厨房面板才出声 */
  /* 石磨的进度条画的是「自动磨面」的进度（手动磨粉是瞬时的，不占进度条） */
  if(autoActive('donkey')){
    K.mill.busy = true; K.mill.dur = AUTO_DEVICES.donkey.per;
    K.mill.t = state.autoAcc.donkey || 0;
  } else {
    K.mill.busy = false;                     /* 驴停了/没买：进度条归零，别一直显示成"还在磨" */
    K.mill.t = 0;
  }
  for(const id of AUTO_IDS){
    if(!autoActive(id)) continue;
    state.autoAcc[id] = (state.autoAcc[id] || 0) + dt;
    const dev = AUTO_DEVICES[id];
    if(state.autoAcc[id] < dev.per) continue;
    state.autoAcc[id] -= dev.per;
    const n = autoCountOf(id);                 /* 养了几台，一轮就产几份 */
    if(id === 'donkey'){
      let made = 0;
      for(let i = 0; i < n; i++){
        if((state.bag.wheat || 0) <= 0) break;
        state.bag.wheat--;
        state.prep.flour = (state.prep.flour || 0) + 1;
        trackAction('mill');
        made++;
      }
      if(made){ if(audible) SFX.play('mill'); save(); }
    } else if(id === 'chopper'){
      let cut = 0;
      for(let i = 0; i < n; i++){
        let pick = null, best = 0;
        for(const c of CROP_IDS){
          if(CROPS[c].noChop) continue;
          const m = state.bag[c] || 0;
          if(m > best){ best = m; pick = c; }
        }
        if(!pick) break;
        state.bag[pick]--;
        state.pieces[pick] = (state.pieces[pick] || 0) + CHOP_PIECES;
        KITCHEN.board.src = pick;
        trackAction('chop', CHOP_PIECES);
        cut++;
      }
      if(cut){ if(audible) SFX.play('chop'); save(); }
    }
  }
}
/* 全自动循环：原料没了就自己关掉并说一声 */
/* 全自动：同一个开关同时负责「自动取出」和「自动投料」（到原料不足才停） */
function autoLoopFeed(){
  const K = KITCHEN;
  if(K.oven.auto && !K.oven.busy){
    if(!K.oven.lastItem) return;             /* 还没烤过东西，没什么可重复的 */
    /* 先把槽位装满（有几槽就装几份），装不下/没原料就按情况收手 */
    let fed = 0;
    while(K.oven.items.length < ovenCap()){
      if(!ovenPut(K.oven.lastItem, true).ok){
        if(fed === 0){
          K.oven.auto = false;               /* 原料不足：自动关掉，免得一直空转 */
          toast('🥣 原料用完了：烤箱全自动已停');
        }
        break;
      }
      fed++;
    }
    return;
  }
  if(K.pot.auto && !K.pot.pieces.length){
    const last = K.pot.lastPieces || [];
    if(!last.length) return;
    let ok = true;
    for(const id of last) if(!potAdd({ piece: id }).ok) ok = false;
    if(!ok){
      K.pot.auto = false;
      toast('🔪 菜块用完了：锅全自动已停（原料不足）');
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
  /* 石磨不再有计时逻辑：手动磨粉是瞬时的（见 mill()），
     mill.busy/t/dur 只是「自动磨面」进度条的显示状态，由 autoTick 写入 */
  if(K.board.busy){
    K.board.busy = false; K.board.t = 0; K.board.src = null;   /* 切菜已改为瞬时，这里只兜底清状态 */
  }
  if(K.oven.busy){
    K.oven.t += dt;
    if(K.oven.t >= K.oven.dur && !K.oven.ready) K.oven.ready = true;
    /* 全自动取出：**精品窗口一结束就取**（dur + perfect），拿到的是「一般」，但不用一直占着炉子 */
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
