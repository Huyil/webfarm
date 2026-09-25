/* ============ 自动农活（自动任务菜单 · v9.28） ============
 *
 * 用**小人自己的作业队列**干活（不另造装置）：
 *   框一块地 → 定一条轮作流水线（耕地 → 播种 → 施肥 → 收获）→ 队列空了自动排下一趟。
 *   每一趟用一种种子，收过一轮之后换下一种（轮作）。
 *
 * **每次操作消耗 1 点饱食度**（耕地/播种/施肥/收获都算）：
 *   饱食度来自"预备口粮"里勾选的**成品菜**，自动吃（先吃小的，少浪费）。
 *   · 菜能提供多少点 = 材料块数 × 10 × 品质系数（精品 ×1.5 / 一般 ×1 / 焦糊 ×0.5）
 *   · **原材料、菜块、面粉都不算**（只有做好的菜能当饭）
 *   · 价值 > 2000 金的菜**不能**被选成口粮（留着卖钱）
 *   · 口粮吃完 / 没种子 / 没肥料 → 自动停机并说明原因，不会偷偷空转
 *
 * 只在页面开着时跑（离线不结算，免得平衡崩掉）。
 */
const AF_AREA_MAX = 12;                 /* 框选边长上限（12×12 = 144 格） */
const AF_RATION_MAX_VALUE = 2000;       /* 超过这个价值的菜不参与口粮 */
const AF_SAT_PER_MATERIAL = 10;         /* 每块材料的基础饱食度 */
const AF_STEP_TOOL = { till:'hoe', seed:'seed', fert:'fert', harvest:'sickle' };
const AF_STEPS = ['till', 'seed', 'fert', 'harvest'];
const AF_RETRY_MS = 700;                /* 没活干时的重试间隔（别每帧重排） */
let afRetryAt = 0;

/* ---------- 默认状态（newState 里挂一份） ---------- */
function afDefaults(){
  return {
    on:false, box:null,
    till:true, seed:true, fert:true, harvest:true,
    seeds:['wheat'], seedIx:0,
    ration:{}, satiety:0, eats:0, worked:0, lastMsg:'',
  };
}
function afGet(){
  if(!state.autoFarm) state.autoFarm = afDefaults();
  const A = state.autoFarm;
  if(!A.seeds || !A.seeds.length) A.seeds = ['wheat'];
  if(!A.ration) A.ration = {};
  return A;
}

/* ---------- 饱食度 ---------- */
function afDishMaterials(d){
  if(!d) return 0;
  if(d.counts){
    let n = 0;
    for(const k in d.counts) n += (d.counts[k] | 0);
    return n;
  }
  return (d.pieces || []).length;
}
/* 一道菜能提供多少点饱食度 */
function afDishSatietyByRecord(d){
  const mats = afDishMaterials(d);
  const q = (d && QUALITY[d.quality]) || QUALITY.normal;
  return Math.max(1, Math.round(mats * AF_SAT_PER_MATERIAL * q.mult));
}
function afDishSatiety(dishKey){
  return afDishSatietyByRecord(state.dishes[dishKey]);
}
/* 能不能当口粮：成品菜 且 价值不超过上限 */
function afRationOK(dishKey){
  const d = state.dishes[dishKey];
  if(!d) return false;
  return (d.value | 0) <= AF_RATION_MAX_VALUE;
}
/* 预备口粮清单（按"饱食度从少到多"排，先吃小的少浪费） */
function afRationList(){
  const A = afGet(), out = [];
  for(const key in A.ration){
    if(!A.ration[key]) continue;
    const d = state.dishes[key];
    if(!d) continue;                       /* 已经吃光/卖掉的不再算 */
    out.push({ key, dish:d, satiety:afDishSatiety(key) });
  }
  out.sort((a, b) => a.satiety - b.satiety);
  return out;
}
function afSatietyLeft(){ return afGet().satiety || 0; }
/* 吃一道预备口粮 → 加饱食度。返回吃到的点数（0 = 没得吃） */
function afEatOne(){
  const list = afRationList();
  for(const it of list){
    const gain = it.satiety;
    sellDish(it.key, 1);                   /* 从菜品仓库扣掉一份（不走卖钱） */
    const A = afGet();
    A.satiety += gain; A.eats++;
    if(!state.dishes[it.key]) delete A.ration[it.key];   /* 吃光了就把口粮勾选也去掉 */
    if(typeof toast === 'function') toast('🍚 吃了一份 ' + it.dish.name + '（+' + gain + ' 饱食度）');
    return gain;
  }
  return 0;
}
/* 花掉 n 点饱食度；不够就先吃口粮，再不够返回 false */
function afSpend(n){
  const A = afGet();
  while(A.satiety < n){
    if(!afEatOne()) return false;
  }
  A.satiety -= n;
  return true;
}

/* ---------- 区域 ---------- */
function afSetArea(b){
  if(!b) return false;
  const ax = Math.min(b.x0, b.x1), bx = Math.max(b.x0, b.x1);
  const ay = Math.min(b.y0, b.y1), by = Math.max(b.y0, b.y1);
  const w = Math.min(AF_AREA_MAX, bx - ax + 1), h = Math.min(AF_AREA_MAX, by - ay + 1);
  const A = afGet();
  A.box = { x0:ax, y0:ay, x1:ax + w - 1, y1:ay + h - 1 };
  A.lastMsg = '';
  save(); renderAutoFarm();
  toast(`自动农活区域：${w}×${h}` + ((bx - ax + 1 > w || by - ay + 1 > h) ? `（已按上限 ${AF_AREA_MAX}×${AF_AREA_MAX} 截断）` : ''));
  return true;
}
function afClearArea(){
  const A = afGet();
  A.box = null; A.lastMsg = ''; A.on = false;
  save(); renderAutoFarm();
}

/* ---------- 一条流水线 ---------- */
function afStepWanted(step, t){
  if(!t) return false;
  if(t.stone) return false;
  if(step === 'till')    return t.state === 'wild' && !decorAt(t.gx, t.gy);
  if(step === 'seed')    return t.state === 'tilled' && !t.crop && inFarm(t.gx, t.gy);
  if(step === 'fert')    return t.state === 'growing' && !t.fertile && (state.fertilizer || 0) > 0;
  if(step === 'harvest') return t.state === 'ready';
  return false;
}
/* 这一趟要干的活：按 耕地→播种→施肥→收获 的固定顺序收集（同一步骤内的格子再走近路） */
function afPlanPass(){
  const A = afGet(), b = A.box;
  if(!b) return [];
  const list = [];
  for(const step of AF_STEPS){
    if(!A[step]) continue;
    for(let y = b.y0; y <= b.y1; y++){
      for(let x = b.x0; x <= b.x1; x++){
        const t = getTile(x, y);
        if(afStepWanted(step, t)) list.push({ gx:x, gy:y, tool:AF_STEP_TOOL[step], afStep:step });
      }
    }
  }
  return list;
}
function afStop(msg, quiet){
  const A = afGet();
  A.on = false; A.lastMsg = msg || '';
  save(); renderAutoFarm();
  if(msg && !quiet) toast('🤖 自动农活已停：' + msg);
}
function afStatusText(){
  const A = afGet();
  if(!A.box) return '还没框地';
  if(!A.on) return A.lastMsg ? ('已停：' + A.lastMsg) : '待启动';
  const p = state.player;
  if(p.queue && p.queue.length) return '干活中 · 还剩 ' + p.queue.length + ' 格';
  if(A.satiety > 0) return '盯着地里 · 饱食度 ' + A.satiety;
  return '盯着地里 · 没饱食度了（会自动吃口粮）';
}
/* 每帧驱动：小人闲着 + 有活 → 排下一趟（带重试间隔，不在没活时空转排队） */
function afTick(dt){
  const A = afGet();
  if(!A.on) return;
  const p = state.player;
  if(!p) return;
  if(p.queue.length || p.pendingOp || p.moving) return;      /* 小人手上还有活 */
  const now = Date.now();
  if(now < afRetryAt) return;
  if(!A.box) return afStop('还没框地');
  /* 种子：轮作里选中的第一种先摆上，runTool('seed') 用的是 state.selectedSeed */
  const seedId = A.seeds[A.seedIx % A.seeds.length];
  if(A.seed && seedId && CROPS[seedId]) state.selectedSeed = seedId;
  const list = afPlanPass();
  if(!list.length){ afRetryAt = now + AF_RETRY_MS; return; }  /* 这趟没活：等作物长 */
  /* 饱食度先备一点：至少够这一趟开头几步（后面边干边吃，不够就停机） */
  if(afSatietyLeft() <= 0 && !afEatOne()){
    return afStop('没口粮了 —— 去厨房做点菜，或在菜单里勾选"预备口粮"');
  }
  p.queue = planPath(list, { gx:Math.round(p.x), gy:Math.round(p.y) })
    .map(q => Object.assign({ tool:q.tool, afStep:q.afStep, auto:true }, q));
  state.box = { x0:A.box.x0, y0:A.box.y0, x1:A.box.x1, y1:A.box.y1 };
  state.jobBox = Object.assign({}, state.box);
  afRetryAt = now + AF_RETRY_MS;
  renderHUD(); save();
}
/* 一次自动操作真的干完了：扣 1 点饱食度（扣不出来就停机并把队列清掉，绝不允许"白干"） */
function afOnWorkDone(op){
  const A = afGet();
  if(!A.on) return;
  if(!afSpend(1)){
    if(state.player) playerClearQueue();
    state.jobBox = null;
    return afStop('没口粮了 —— 去厨房做点菜，或在菜单里勾选"预备口粮"');
  }
  A.worked++;
  /* 收过一轮 → 换下一种种子（轮作） */
  if(op && op.afStep === 'harvest') A.seedIx = (A.seedIx + 1) % Math.max(1, A.seeds.length);
  save();
}

/* ---------- 菜单界面 ---------- */
function afEsc(s){
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
let afBound = false;
function renderAutoFarm(){
  const el = document.getElementById('autoFarmBody');
  if(!el) return;
  const A = afGet();
  if(!afBound){
    afBound = true;
    el.addEventListener('click', afOnClick);
    el.addEventListener('change', afOnChange);
  }
  const p = state.player || {};
  const boxTxt = A.box ? `${A.box.x1 - A.box.x0 + 1}×${A.box.y1 - A.box.y0 + 1}（左上 ${A.box.x0},${A.box.y0}）` : '还没框';
  const stepRow = (id, label, hint) =>
    `<label class="af-step${A[id] ? ' on' : ''}"><input type="checkbox" data-af-step="${id}" ${A[id] ? 'checked' : ''}>` +
    `<span>${label}</span><i>${hint}</i></label>`;
  /* 种子顺序（按勾选顺序轮作） */
  const seedChips = SEED_ORDER.map(id => {
    const on = A.seeds.indexOf(id) >= 0;
    const ix = A.seeds.indexOf(id);
    return `<button class="af-seed${on ? ' on' : ''}" data-af-seed="${id}" title="${afEsc(CROPS[id].name)}">` +
      (on ? '<b>' + (ix + 1) + '</b>' : '') + CROPS[id].emoji + '</button>';
  }).join('');
  /* 预备口粮：列出仓库里的菜 */
  const keys = Object.keys(state.dishes);
  const rows = keys.map(k => {
    const d = state.dishes[k];
    const ok = afRationOK(k);
    const sat = afDishSatiety(k);
    const on = !!A.ration[k];
    return `<label class="af-ration${on ? ' on' : ''}${ok ? '' : ' poor'}">` +
      `<input type="checkbox" data-af-ration="${afEsc(k)}" ${on ? 'checked' : ''} ${ok ? '' : 'disabled'}>` +
      `<span class="af-r-name">${afEsc(d.name)}${d.qtag ? ' ' + d.qtag : ''}` +
      `<i>×${d.n} · 🍚${sat} 点 · ${d.value} 金${ok ? '' : ' · 太贵了，留着卖'}</i></span></label>`;
  }).join('');
  const eligible = keys.filter(afRationOK).length;
  el.innerHTML = `
    <div class="af-wrap">
      ${A.lastMsg ? '<div class="af-warn">上次停机：' + afEsc(A.lastMsg) + '</div>' : ''}
      <section class="af-sec">
        <div class="k-sec-title">🤖 自动农活<span class="k-hint">小人自己干 · 每步扣 1 点饱食度</span></div>
        <label class="af-on${A.on ? ' on' : ''}"><input type="checkbox" data-af-on ${A.on ? 'checked' : ''}><span>启动</span></label>
        <div class="af-line">区域：<b>${boxTxt}</b>（上限 ${AF_AREA_MAX}×${AF_AREA_MAX}）</div>
        <div class="af-btns">
          <button class="mini primary" data-af-act="pick">${state.afPicking ? '在地图上拖出范围…' : '框选区域'}</button>
          <button class="mini" data-af-act="clear">清空区域</button>
        </div>
      </section>
      <section class="af-sec">
        <div class="k-sec-title">🔄 轮作流水线</div>
        ${stepRow('till', '耕地', '荒地 → 耕地')}
        ${stepRow('seed', '播种', '按下面顺序轮换')}
        ${stepRow('fert', '施肥', '有肥料才施')}
        ${stepRow('harvest', '收获', '熟了才收')}
        <div class="af-line">种子顺序（点选，数字是轮作次序）：</div>
        <div class="af-seeds">${seedChips}</div>
      </section>
      <section class="af-sec">
        <div class="k-sec-title">🍚 预备口粮<span class="k-hint">当前 ${A.satiety} 点 · 已吃 ${A.eats} 份</span></div>
        <div class="af-line">勾选要用来抵扣的菜（**只有成品菜算**；价值 >${AF_RATION_MAX_VALUE} 金的不能选）</div>
        <div class="af-btns">
          <button class="mini" data-af-act="all">全选（${eligible} 道）</button>
          <button class="mini" data-af-act="none">全不选</button>
        </div>
        <div class="af-rations">${rows || '<div class="r-meta">仓库里还没有做好的菜 —— 去厨房做几道</div>'}</div>
      </section>
      <section class="af-sec">
        <div class="k-sec-title">📊 状态</div>
        <div class="af-line">${afEsc(afStatusText())}</div>
        <div class="af-line r-meta">累计自动耕作 ${A.worked} 次 · 小人${p.queue && p.queue.length ? '正在干活' : '空闲'}</div>
      </section>
    </div>`;
}
function afOnChange(e){
  const t = e.target;
  if(!t || !t.dataset) return;
  const A = afGet();
  if(t.dataset.afOn !== undefined){
    A.on = !!t.checked;
    A.lastMsg = '';
    if(A.on && !A.box){ A.on = false; toast('先框一块地'); }
    else if(A.on && !A.rationList().length && afSatietyLeft() <= 0) toast('提醒：还没勾选预备口粮，饿了会自动停');
    else if(A.on) toast('🤖 自动农活启动');
  } else if(t.dataset.afStep){
    A[t.dataset.afStep] = !!t.checked;
  } else if(t.dataset.afRation !== undefined){
    const k = t.dataset.afRation;
    if(t.checked){
      if(!afRationOK(k)){ t.checked = false; toast('这道菜太贵了（>' + AF_RATION_MAX_VALUE + ' 金），留着卖钱'); }
      else A.ration[k] = true;
    } else delete A.ration[k];
  }
  save(); renderAutoFarm();
}
function afOnClick(e){
  const b = e.target.closest('[data-af-act], [data-af-seed]');
  if(!b) return;
  const A = afGet();
  if(b.dataset.afSeed){
    const id = b.dataset.afSeed;
    const i = A.seeds.indexOf(id);
    if(i >= 0) A.seeds.splice(i, 1);
    else A.seeds.push(id);
    if(!A.seeds.length) A.seeds = ['wheat'];
    SFX.play('click'); save(); renderAutoFarm();
    return;
  }
  const act = b.dataset.afAct;
  if(act === 'pick'){
    state.afPicking = true;
    SFX.play('click');
    closeSheet();
    toast('在地图上拖出一个范围（松手生效）');
    return;
  }
  if(act === 'clear'){ SFX.play('click'); afClearArea(); return; }
  if(act === 'all'){
    for(const k of Object.keys(state.dishes)) if(afRationOK(k)) A.ration[k] = true;
    SFX.play('click'); save(); renderAutoFarm();
    return;
  }
  if(act === 'none'){
    A.ration = {}; SFX.play('click'); save(); renderAutoFarm();
  }
}
function openAutoFarm(){ openSheet('autofarm'); }

window.AutoFarmDebug = {
  get state(){ return afGet(); },
  setArea: b => afSetArea(b),
  clearArea: afClearArea,
  plan: () => afPlanPass(),
  planSize(){ return afPlanPass().length; },
  tick: ms => afTick(ms == null ? 16 : ms),
  resetRetry: () => { afRetryAt = 0; },
  workDone: op => afOnWorkDone(op),
  spend: n => afSpend(n),
  eatOne: afEatOne,
  satietyLeft: afSatietyLeft,
  dishSatiety: k => afDishSatiety(k),
  rationOK: k => afRationOK(k),
  rationList: () => afRationList().map(x => x.key),
  status: afStatusText,
  stop: (m) => afStop(m, true),
  stepWanted: afStepWanted,
  AF_AREA_MAX, AF_RATION_MAX_VALUE, AF_SAT_PER_MATERIAL,
};
