/* 68-kitchen — 拖拽厨房 UI（做菜逻辑在 69-dishes.js，只读不改）
 *
 * 契约：
 *   updateKitchen(dt)  每帧：先 kitchenLogicTick(dt) 推进逻辑，再节流刷新界面
 *   renderKitchen()    幂等渲染 #kitchenBody（元素不存在时直接 return）
 *   openKitchen()      打开厨房面板
 *   window.KitchenDebug 无头测试用的拖拽 / 取货接口
 *
 * 结构：顶部食材货架（收藏/拖拽）→ 四个工位（石磨/烤箱/切菜板/锅）→ 菜品仓库（卖菜）
 * 交互：Pointer Events（鼠标+触屏）。两条等价路径共用 kDropItem：
 *       ① 拖拽：按住卡片拖到工位；
 *       ② 单击选中 → 连点工位：点卡片选中（再点取消），之后连点工位批量投料。
 *       菜板是瞬时的（没有进度条），每次投入只「咔」一下并飞块菜块。
 * 图标全部离屏预渲染成 dataURL。
 */

/* ---------- 模块内状态（顶层只用字面量初始化，KITCHEN 是 69 的 const，不能在求值期读） ---------- */
let kUI = null;                 // { el, sig, n:{...} } 当前渲染出的节点引用
let kAcc = 0;                   // 刷新节流累计（ms）
let kHeldUntil = 0;             // 指针按下中：暂停整块重建，避免 click 落空
let kBound = false;             // 事件只绑定一次
let kDrag = null;               // 进行中的按压/拖拽
let kGhostEl = null;            // 拖拽替身
let kSuppressClick = false;     // 吞掉拖拽结束那一次 click
let kSel = null;                // 当前选中的货架 key（全屏唯一；null = 没选）
let kTapGuard = 0;              // pointerup 已按「点击」处理过的时间戳（吞掉紧随其后的 click）
let kFlyN = 0;                  // 进行中的飞行动效数量（连点保护）
let kLastTakeAt = 0;            // 手动取出的时间戳（区分逻辑层的自动取出）
let kRepTimer = 0;              // 长按持续添加：进入重复前的延时
let kRepIv = 0;                 // 重复定时器
let kRepStation = null;         // 正在长按的工位
let kRepDid = false;            // 这一按已经触发过重复（抬手时别再补一次点击）
let kPrev = { millBusy:false, boardBusy:false, boardSrc:null, ovenBusy:false,
              potLen:0, potPieces:[], dishes:0 };
const K_ICON_CACHE = Object.create(null);
const K_ICON_SIZES = { card:42, station:38, dish:30, ghost:46, pot:22 };
const K_TAP_SLOP = 8;           // 位移 <8px 视为点击（容忍手指抖动）
const K_REP_DELAY = 420;        // 按住多久开始"持续添加"
const K_REP_EVERY = 170;        // 之后每隔多久再来一次
const K_FLY_MAX = 8;            // 同时存在的飞行动效上限（连点不卡顿）

/* ============================================================
 * 一、图标：离屏 canvas 预渲染
 * ============================================================ */
function kIconURL(key, size){
  const ck = key + '#' + size;
  if(K_ICON_CACHE[ck] !== undefined) return K_ICON_CACHE[ck];
  let url = '';
  try{
    const cv = document.createElement('canvas');
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr);
    const g = cv.getContext('2d');
    if(g){
      if(g.setTransform) g.setTransform(dpr, 0, 0, dpr, 0, 0); else if(g.scale) g.scale(dpr, dpr);
      drawItemIcon(g, key, size / 2, size / 2, size);
      url = cv.toDataURL('image/png') || '';
    }
  }catch(e){ url = ''; }
  if(url === 'data:,') url = '';          // 无 canvas 环境（jsdom）→ 回退 emoji
  K_ICON_CACHE[ck] = url;
  return url;
}
function kIconEmoji(key){
  const raw = String(key == null ? '' : key);
  const i = raw.indexOf(':');
  const kind = i < 0 ? 'crop' : raw.slice(0, i);
  const id = i < 0 ? raw : raw.slice(i + 1);
  if(kind === 'crop' && CROPS[id]) return CROPS[id].emoji;
  if(kind === 'piece' && CROPS[id]) return '🔪';
  if(kind === 'prep') return EXTRA_ITEMS[id] ? EXTRA_ITEMS[id].emoji : '🥣';
  if(kind === 'dish') return kDishInfo(id).emoji || '🍲';
  return '🍲';
}
function kIconHTML(key, size, cls){
  const url = kIconURL(key, size);
  const c = 'k-ico' + (cls ? ' ' + cls : '');
  if(url) return '<img class="' + c + '" alt="" draggable="false" src="' + url + '">';
  return '<span class="' + c + ' k-ico-em">' + kIconEmoji(key) + '</span>';
}
function kEsc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function kSec(ms){ return Math.max(0, ms) / 1000; }
function kSecText(ms){ return kSec(ms).toFixed(1) + 's'; }
function kRatio(t, dur){ return dur > 0 ? Math.max(0, Math.min(1, t / dur)) : 0; }

function kItemLabel(key){
  const raw = String(key == null ? '' : key);
  const i = raw.indexOf(':');
  const kind = i < 0 ? 'crop' : raw.slice(0, i);
  const id = i < 0 ? raw : raw.slice(i + 1);
  if(kind === 'crop' && CROPS[id]) return CROPS[id].produce;
  if(kind === 'piece' && CROPS[id]) return CROPS[id].produce + '块';
  if(kind === 'prep') return EXTRA_ITEMS[id] ? EXTRA_ITEMS[id].name : '加工品';
  if(kind === 'dish') return kDishInfo(id).name || '菜';
  return id;
}
function kPiecesSummary(){
  const parts = [];
  for(const id of CROP_IDS){
    const n = state.pieces[id] || 0;
    if(n > 0) parts.push(CROPS[id].produce + '×' + n);
  }
  return parts.length ? parts.join(' ') : '无';
}
function kDishValueTotal(){
  let sum = 0;
  for(const key in state.dishes) sum += state.dishes[key].value * state.dishes[key].n;
  return Math.round(sum);
}

/* ============================================================
 * 二、拖拽规则：什么能放到哪里
 * ============================================================ */
function kDropCheck(key, station){
  const raw = String(key == null ? '' : key);
  const i = raw.indexOf(':');
  const kind = i < 0 ? '' : raw.slice(0, i);
  const id = i < 0 ? raw : raw.slice(i + 1);
  if(station === 'mill'){
    if(kind === 'crop' && id === 'wheat') return { ok:true };
    if(kind === 'crop') return { ok:false, msg:'石磨只吃小麦' };
    if(kind === 'piece') return { ok:false, msg:'菜块不能磨面' };
    return { ok:false, msg:'面粉已经磨好了' };
  }
  if(station === 'oven'){
    if(kind === 'prep' && id === 'flour') return { ok:true };
    if(kind === 'piece' && CROPS[id]) return { ok:true };      /* 切过的东西都能烤 */
    if(kind === 'crop' && id === 'wheat') return { ok:false, msg:'小麦要先磨成面粉' };
    if(kind === 'crop') return { ok:false, msg:'生食材要先切块再烤' };
    return { ok:false, msg:'烤箱只烤面粉或菜块' };
  }
  if(station === 'board'){
    if(kind === 'dish') return canSliceDish(id) ? { ok:true } : { ok:false, msg:'这道菜不能切片（目前只有面包能）' };
    if(kind === 'crop' && CROPS[id] && CROPS[id].noChop) return { ok:false, msg:CROPS[id].name + '不能切块，只能磨面' };
    if(kind === 'crop' && CROPS[id]) return { ok:true };
    if(kind === 'piece') return { ok:false, msg:'已经切好了，直接下锅吧' };
    if(kind === 'prep') return { ok:false, msg:'面粉不用切' };
    return { ok:false, msg:'这东西切不了' };
  }
  if(station === 'pot'){
    if(kind === 'piece' && CROPS[id]) return { ok:true };
    if(kind === 'crop' && POT_RAW_OK.indexOf(id) >= 0) return { ok:true };
    if(kind === 'crop') return { ok:false, msg:'生食材要先切块' };
    if(kind === 'prep') return { ok:false, msg:'面粉要先烤成面包' };
    return { ok:false, msg:'这不能下锅' };
  }
  return { ok:false, msg:'没有这个工位' };
}
/* 切菜板已是瞬时产出（没有 busy / 进度条）；这里做兼容读取，新旧逻辑层都不会报错 */
function kBoardBusy(){ const b = KITCHEN.board; return !!(b && b.busy); }
/* 仓库里还有可切作物吗（菜板状态字用） */
function kHasCrop(){
  for(let i = 0; i < CROP_IDS.length; i++) if((state.bag[CROP_IDS[i]] || 0) > 0) return true;
  return false;
}

/* ---------- 长按持续添加：按住工位不放，就按节奏一直投（材料没了自己停） ---------- */
function kRepeatStop(){
  if(kRepTimer){ clearTimeout(kRepTimer); kRepTimer = 0; }
  if(kRepIv){ clearInterval(kRepIv); kRepIv = 0; }
  kRepStation = null;
}
/* 按住某个工位 → 延迟 K_REP_DELAY 后开始按 K_REP_EVERY 一直投；只在"已选中食材"时启用 */
function kRepeatArm(station){
  kRepeatStop();
  if(!station || !kSel || !kShelfItem(kSel)) return false;
  kRepStation = station;
  kRepTimer = setTimeout(() => {
    kRepTimer = 0;
    if(kRepeatOnce()) kRepIv = setInterval(kRepeatOnce, K_REP_EVERY);
  }, K_REP_DELAY);
  return true;
}
function kRepeatOnce(){
  const st = kRepStation;
  if(!st || !kSel) { kRepeatStop(); return false; }
  if(!kShelfItem(kSel)) { kRepeatStop(); return false; }   // 货架用完了
  const res = kDropItem(kSel, st);
  kRepDid = true;                                          /* 抬手时别再补一次点击（kTapGuard 兜住） */
  if(!res || !res.ok){ kRepeatStop(); return false; }      // 缺料/满了 → 停下
  return true;
}

/* 拖拽/测试共用的投料入口：完全等价于「把货架上的 itemKey 拖到 station」 */
function kDropItem(itemKey, station){
  const check = kDropCheck(itemKey, station);
  if(!check.ok){ toast(check.msg); SFX.play('error'); return { ok:false, msg:check.msg }; }
  const raw = String(itemKey);
  const id = raw.slice(raw.indexOf(':') + 1);
  const kind = raw.slice(0, raw.indexOf(':'));
  let res;
  if(station === 'mill'){
    res = mill(1);                        /* 和菜板一样：点一下直接出 1 份面粉（瞬时，可连点） */
    if(res.ok) SFX.play('mill');
  } else if(station === 'oven'){
    res = ovenPut(kind === 'piece' ? { piece:id } : undefined);
    if(res.ok) SFX.play('cook');
  } else if(station === 'board'){
    res = (kind === 'dish') ? boardSliceBread(id) : boardPut(id);
    if(res.ok) SFX.play('chop');
  } else {
    res = potAdd(kind === 'piece' ? { piece:id } : { raw:id });
    if(res.ok) SFX.play('cook');
  }
  if(!res.ok){
    toast(res.msg || '做不了');
    SFX.play('error');
  } else {
    if(res.msg) toast(res.msg);
    /* 拖拽/投入之后**默认勾选**这一份：接着点别的工位可以直接继续投，不用再点一次卡片 */
    kSel = kShelfItem(itemKey) ? itemKey : null;
    save(); renderHUD();
  }
  renderKitchen();
  kDropFx(itemKey, station, res);      // 重建之后再放动画，节点才是新的
  return res;
}

/* 取出（手动；小游戏关闭时按自动处理，永远只出「一般」） */
function kTakeStation(station){
  const auto = state.miniGameEnabled === false;
  let res;
  if(station === 'oven')      res = ovenTake(auto);
  else if(station === 'pot')  res = potTake(auto);
  else return { ok:false, msg: station === 'mill' ? '石磨不用取' : '菜板不用取' };
  if(!res.ok){ toast(res.msg || '还不行'); SFX.play('error'); return { ok:false, msg:res.msg }; }
  kLastTakeAt = Date.now();
  if(res.quality === 'burnt'){ SFX.play('burn'); toast('🔥 焦糊了…'); }
  else { SFX.play('ding'); if(res.msg) toast(res.msg); }
  kFlyFromStation(station, 'dish:' + kFindDishKey(res.dish));
  renderHUD(); renderKitchen();
  return { ok:true, quality:res.quality, dish:res.dish, msg:res.msg };
}
function kFindDishKey(dish){
  if(!dish) return 'mix|normal|';
  for(const k in state.dishes) if(state.dishes[k] === dish) return k;
  return (dish.id || 'mix') + '|' + (dish.quality || 'normal') + '|' + (dish.pieces || []).join(',');
}
function kToggleFav(itemKey){
  const key = String(itemKey == null ? '' : itemKey);
  if(!key) return false;
  if(!state.fav) state.fav = {};
  state.fav[key] = !state.fav[key];
  save();
  renderKitchen();
  return !!state.fav[key];
}
/* 供无头测试观察四个工位的完整状态（返回新对象，不泄漏内部引用） */
function kStationState(){
  const K = KITCHEN;
  return {
    mill: { busy:K.mill.busy, t:K.mill.t, dur:K.mill.dur, progress:kRatio(K.mill.t, K.mill.dur), can:canMill(), stock:millStock(), batch:millBatch() },
    oven: { busy:K.oven.busy, t:K.oven.t, dur:K.oven.dur, ready:K.oven.ready, auto:K.oven.auto,
            quality:K.oven.ready ? gradeOf(K.oven.t, K.oven.dur, OVEN_PERFECT_MS, OVEN_BURN_MS) : null,
            progress:kRatio(K.oven.t, K.oven.dur), can:canOvenPut() },
    board:{ busy:kBoardBusy(), t:(K.board && K.board.t) || 0, dur:(K.board && K.board.dur) || CHOP_MS,
            src:(K.board && K.board.src) || null,
            progress:kRatio((K.board && K.board.t) || 0, (K.board && K.board.dur) || CHOP_MS) },
    pot:  { pieces:K.pot.pieces.slice(), t:K.pot.t, dur:K.pot.dur, done:K.pot.done, auto:K.pot.auto,
            quality:K.pot.done ? gradeOf(K.pot.t, K.pot.dur, POT_PERFECT_MS, POT_BURN_MS) : null,
            progress:kRatio(K.pot.t, K.pot.dur) },
  };
}

/* ============================================================
 * 二·五、单击选中 → 连点工位（与拖拽等价，共用 kDropItem）
 * ============================================================ */
function kShelfItem(key){
  const list = kitchenShelf();
  for(let i = 0; i < list.length; i++) if(list[i].key === key) return list[i];
  return null;
}
/* 静默设置选中（无音效无提示）：传空 或 再选同一个 = 取消。返回当前选中 key */
function kSetSel(itemKey){
  const raw = itemKey == null ? '' : String(itemKey);
  kSel = (!raw || kSel === raw) ? null : raw;
  kApplySelection();
  return kSel;
}
/* 卡片点击（带反馈） */
function kSelectCard(key){
  const before = kSel;
  const now = kSetSel(key);
  SFX.play('click');
  if(now){
    const it = kShelfItem(now);
    toast('已选中：' + (it ? it.name : kItemLabel(now)) + ' · 连点工位投入');
  } else if(before){
    toast('已取消选择');
  }
  return now;
}
/* 「点击工位」：有选中 → 投料（校验失败只 toast、不清选中）；没选中 → 烤箱/锅 = 取出 */
function kClickStation(station){
  if(!station) return { ok:false, msg:'没有这个工位' };
  if(kSel){
    const chk = kDropCheck(kSel, station);
    if(!chk.ok){ toast(chk.msg); SFX.play('error'); return { ok:false, msg:chk.msg }; }
    return kDropItem(kSel, station);
  }
  /* 石磨只吃小麦，没有歧义：没选卡片也直接磨 1 份（和菜板一样"点一下就有产出"） */
  if(station === 'mill' && canMill()) return kDropItem('crop:wheat', 'mill');
  if(station === 'oven' || station === 'pot') return kTakeStation(station);
  const msg = '先在货架选一份食材';
  toast(msg);
  SFX.play('error');
  return { ok:false, msg };
}
/* 选中高亮不参与整块重建（连点时避免 DOM 抖动），每次渲染后统一补一次 */
function kApplySelection(){
  if(!kUI || !kUI.el || !kUI.el.querySelectorAll) return;
  const cards = kUI.el.querySelectorAll('.k-card[data-key]');
  for(let i = 0; i < cards.length; i++){
    const card = cards[i];
    const on = !!kSel && !!card.dataset && card.dataset.key === kSel;
    if(card.classList) card.classList.toggle('k-sel', on);
    if(card.setAttribute) card.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  const bar = kUI.el.querySelector ? kUI.el.querySelector('[data-selbar]') : null;
  if(!bar) return;
  const it = kSel ? kShelfItem(kSel) : null;
  let txt;
  if(it) txt = '已选 ' + it.name + ' ×' + it.n;
  else if(kSel) txt = '已选 ' + kItemLabel(kSel) + '（已用完）';
  else txt = '拖 / 点选';
  const span = bar.querySelector ? bar.querySelector('[data-seltext]') : null;
  if(span){
    if(span.textContent !== txt) span.textContent = txt;      // 只在变化时改文本，避免每帧重建节点
  } else if(bar.textContent !== txt) bar.textContent = txt;
  if(bar.dataset){
    bar.dataset.on = it ? '1' : '';      // 有货 → 高亮色
    bar.dataset.sel = kSel ? '1' : '';   // 有选中 → 显示「取消选中」按钮
  }
}

/* ============================================================
 * 三、渲染
 * ============================================================ */
function kKitchenOpen(){
  const m = document.getElementById('kitchenModal');
  if(!m) return false;
  if(m.classList && m.classList.contains) return m.classList.contains('show');
  return !!m.className && String(m.className).indexOf('show') >= 0;
}
/* ---------- 结构签名：变了才重建 DOM ---------- */
/* 锅里内容的紧凑签名：种类 + 数量（最多 11 项），不再 join 上千个元素 */
function kPotSig(){
  const list = KITCHEN.pot.pieces;
  if(!list.length) return '0';
  const cnt = {};
  for(let i = 0; i < list.length; i++) cnt[list[i]] = (cnt[list[i]] || 0) + 1;
  const keys = Object.keys(cnt).sort();
  let s = String(list.length);
  for(const k of keys) s += ',' + k + ':' + cnt[k];
  return s;
}
function kKitchenSig(){
  const K = KITCHEN;
  const shelf = kitchenShelf().map(it => it.key + ':' + it.n + (state.fav && state.fav[it.key] ? '*' : '')).join(',');
  const dishes = Object.keys(state.dishes).map(k => k + ':' + state.dishes[k].n).join(',');
  return [
    shelf, dishes, kPiecesSummary(),
    K.mill.busy ? 1 : 0, K.mill.queued || 0,
    K.oven.busy ? 1 : 0, K.oven.ready ? 1 : 0, K.oven.auto ? 1 : 0,
    (K.oven.items || []).length, state.ovenSlots || 1,
    AUTO_IDS.map(id => (autoActive(id) ? 1 : 0) + ':' + autoCountOf(id) + ':' + autoSlotOf(id).length).join(''),
    (state.autoCrop && state.autoCrop.chopper) || '',
    kBoardBusy() ? 1 : 0, (K.board && K.board.src) || '',
    kPotSig(), K.pot.done ? 1 : 0, K.pot.auto ? 1 : 0,
    state.prep.flour || 0, state.bag.wheat || 0,
    state.miniGameEnabled === false ? 0 : 1,
    kExpandOf('prep') ? 1 : 0, kExpandOf('cook') ? 1 : 0,
  ].join('|');
}
/* 两行工位的展开状态（缩略行 ↔ 大界面），存在存档里 */
function kExpandOf(line){
  if(!state.kExpand) state.kExpand = { prep:false, cook:false };
  return !!state.kExpand[line];
}
function kExpandToggle(line){
  if(line !== 'prep' && line !== 'cook') return false;
  if(!state.kExpand) state.kExpand = { prep:false, cook:false };
  state.kExpand[line] = !state.kExpand[line];
  if(state.kExpand[line]) toast(kLineSummary(line));   /* 额外信息走浮动通知，不堆在卡片上 */
  save();
  if(kUI) kUI.sig = '';
  renderKitchen();
  return state.kExpand[line];
}
/* 展开时用一条浮动通知把「额外的显示信息」说清楚 */
function kLineSummary(line){
  const K = KITCHEN;
  if(line === 'prep'){
    const act = AUTO_IDS.filter(id => autoActive(id))
      .map(id => AUTO_DEVICES[id].icon + '×' + autoCountOf(id));
    return '🧰 备料台 · 仓库小麦 ×' + millStock() + ' · 面粉 ×' + (state.prep.flour || 0) + ' · 菜块 ' + kPiecesSummary() +
           ' · ' + (act.length ? '自动设备 ' + act.join(' ') : '自动设备未启用');
  }
  const pv = K.pot.pieces.length ? potRecipe(K.pot.pieces) : null;
  const ovenN = (K.oven.items || []).length;
  return '🍳 烹饪台 · 锅：' + (pv ? pv.name + '（' + pv.pieces.length + ' 种 ' + pv.n + ' 块）' : '空') +
         ' · 烤箱：' + (ovenN ? ovenN + ' 份在烤' : '空') +
         ' · 面粉 ×' + (state.prep.flour || 0) + ' · 菜块 ×' + kPieceStock();
}

/* ---------- 缩略工位卡（一行放好几个，进度用「绕边框转圈」四段） ---------- */
function kRingHTML(id){
  return '<span class="k-ring" data-ring="' + id + '"><i></i><i></i><i></i><i></i></span>';
}
function kCellHeadHTML(ico, name, stateKey, chip){
  return '<div class="k-cell-head"><span class="k-cell-ico">' + ico + '</span>' +
    '<span class="k-cell-name">' + kEsc(name) + '</span>' + (chip || '') +
    '<span class="k-cell-state" data-state="' + stateKey + '"></span></div>';
}
function kCellBoardHTML(){
  return '<div class="k-station k-cell" data-station="board" title="菜板是瞬发的：点一下作物卡 → 连点这里，每点出 ' + CHOP_PIECES + ' 块菜块">' +
    kCellHeadHTML('🔪', '切菜板', 'board') +
    '<div class="k-cell-sub" data-sub="board"></div></div>';
}
function kCellMillHTML(){
  return '<div class="k-station k-cell" data-station="mill" title="石磨和切菜板一个操作：点/拖小麦过来就立刻出 1 份面粉（可连点）；卡上的「磨 ×N」是一把磨多份">' +
    kCellHeadHTML('🪨', '石磨', 'mill', '<span class="k-mill-mini" data-wheel-mini="mill"></span>') +
    '<div class="k-cell-sub" data-sub="mill"></div>' +
    '<div class="k-cell-btns"><button class="mini primary" data-act="grind" data-grind>磨粉</button></div></div>';
}
/* 自动化设备（驴 / 切块机）：缩略卡 + 环形进度（这一轮走到哪了） */
function kCellAutoHTML(id){
  const dev = AUTO_DEVICES[id];
  return '<div class="k-cell k-dev" data-dev="' + id + '" title="' + kEsc(dev.desc) + '">' +
    kCellHeadHTML(dev.icon, dev.name, 'auto-' + id) +
    '<div class="k-cell-sub" data-sub="auto-' + id + '"></div>' +
    '<div class="k-slot-line" data-slot="' + id + '"></div>' +
    '<div class="k-cell-btns"><button class="mini" data-act="buy-auto" data-dev="' + id + '" data-buy="' + id + '"></button>' +
    '<label class="k-mini-sw" title="停：不产出也不吃料，租期冻结（回来接着用）">' +
      '<input type="checkbox" data-dev-on="' + id + '"><span>开</span></label></div>' +
    kRingHTML('auto-' + id) + '</div>';
}
/* 锅 / 烤箱缩略卡：状态 + 一行缩略信息 + 环形进度 + 取出按钮 */
function kCellCookHTML(station){
  const oven = station === 'oven';
  const hint = oven
    ? '烤箱：面粉烤面包、切过的菜块能烤；勾「自动烹饪」就自己出炉＋自己补料'
    : '锅：菜块 / 大米随便配，每加一样进度条重置；勾「自动烹饪」就自己出锅＋自己补料';
  return '<div class="k-station k-cell" data-station="' + station + '" title="' + hint + '">' +
    kCellHeadHTML(oven ? '🔥' : '🍲', oven ? '烤箱' : '锅', station) +
    '<div class="k-cell-sub" data-sub="' + station + '"></div>' +
    '<div class="k-cell-btns"><button class="mini primary" data-act="take" data-station="' + station + '">' + (oven ? '出炉' : '出锅') + '</button>' +
    '<label class="k-mini-sw" title="自动烹饪：精品窗口一过就取 + 同配方一直做，原料不足自动停">' +
      '<input type="checkbox" data-auto="' + station + '"' + (KITCHEN[station].auto ? ' checked' : '') + '><span>自动</span></label></div>' +
    kRingHTML(station) + '</div>';
}
/* 一行工位：左侧小展开按钮 + 若干缩略卡；展开的大界面放在下方 */
function kLineHTML(line){
  const prep = line === 'prep';
  const open = kExpandOf(line);
  const cells = prep
    ? kCellBoardHTML() + kCellMillHTML() + kCellAutoHTML('donkey') + kCellAutoHTML('chopper')
    : kCellCookHTML('pot') + kCellCookHTML('oven');
  const body = prep
    ? '<div class="k-stations">' + kStationMillHTML() + kStationBoardHTML() + '</div>' +
      '<section class="k-auto">' + AUTO_IDS.map(kAutoRowHTML).join('') + '</section>'
    : '<div class="k-stations">' + kStationOvenHTML() + kStationPotHTML() + '</div>';
  return '<section class="k-line-sec" data-line="' + line + '">' +
      '<button class="k-exp' + (open ? ' on' : '') + '" data-act="expand" data-line="' + line + '"' +
        ' aria-expanded="' + (open ? 'true' : 'false') + '"' +
        ' title="' + (open ? '收起' : '展开') + (prep ? '备料台详细界面' : '烹饪台详细界面') + '">' + (open ? '▼' : '▶') + '</button>' +
      '<div class="k-cells k-cells-' + (prep ? 4 : 2) + '">' + cells + '</div>' +
    '</section>' +
    '<div class="k-expand' + (open ? ' open' : '') + '" data-expand="' + line + '">' + body + '</div>';
}

function kShelfCardHTML(it){
  const fav = state.fav && state.fav[it.key];
  const sel = kSel === it.key;
  return `
    <div class="k-card${fav ? ' fav' : ''}${sel ? ' k-sel' : ''}" data-key="${kEsc(it.key)}" aria-pressed="${sel ? 'true' : 'false'}">
      <button class="k-star${fav ? ' on' : ''}" data-fav="${kEsc(it.key)}" title="收藏">${fav ? '★' : '☆'}</button>
      <div class="k-card-ico">${kIconHTML(it.key, K_ICON_SIZES.card)}</div>
      <div class="k-card-name">${kEsc(it.name)}</div>
      <div class="k-card-n">×${it.n}</div>
    </div>`;
}
function kStationMillHTML(){
  const K = KITCHEN;
  return `
    <div class="k-station" data-station="mill">
      <div class="k-st-head"><span class="k-st-ico">🪨</span><span class="k-st-name">石磨</span><span class="k-st-state" data-state="mill-x"></span></div>
      <div class="k-st-body">
        <div class="k-mill"><div class="k-mill-wheel" data-wheel="mill"></div></div>
        <div class="k-pot-slot k-mill-slots">
          <span class="k-chip">${kIconHTML('crop:wheat', K_ICON_SIZES.pot)}</span><span class="k-flow-n" data-mill-stock></span>
          <span class="k-arrow">→</span>
          <span class="k-chip">${kIconHTML('prep:flour', K_ICON_SIZES.pot)}</span><span class="k-flow-n" data-mill-flour></span>
        </div>
      </div>
      <div class="k-progress" data-bar="mill"><i></i></div>
      <div class="k-st-actions">
        <button class="mini primary" data-act="grind" data-grind>磨粉</button>
        <span class="k-st-hint" data-flour-hint></span>
      </div>
    </div>`;
}
/* 锅里的食材：按种类聚合（图标 + ×数量），再给一个总数标签。上限与块数无关。 */
function kPotChipsHTML(){
  const list = KITCHEN.pot.pieces;
  if(!list.length) return '';
  const cnt = {};
  for(let i = 0; i < list.length; i++) cnt[list[i]] = (cnt[list[i]] || 0) + 1;
  const K_POT_CHIP_KINDS = 12;                      /* 种类最多 11（作物数），留一点余量 */
  const kinds = Object.keys(cnt).slice(0, K_POT_CHIP_KINDS);
  let out = '';
  for(const id of kinds){
    out += '<span class="k-chip k-chip-n" title="' + kEsc(kItemLabel('piece:' + id)) + ' ×' + cnt[id] + '">' +
      kIconHTML('piece:' + id, K_ICON_SIZES.pot) +
      '<i class="k-chip-num">' + (cnt[id] > 1 ? '×' + cnt[id] : '') + '</i></span>';
  }
  if(Object.keys(cnt).length > K_POT_CHIP_KINDS) out += '<span class="k-slots-num">…</span>';
  out += '<span class="k-slots-num">共 ' + list.length + ' 块 / ' + Object.keys(cnt).length + ' 种</span>';
  return out;
}
/* 烤箱里的原料 chips（可多份）+ 槽位计数 */
function kOvenChipsHTML(){
  const items = KITCHEN.oven.items || [];
  if(!items.length) return '<span class="k-add" title="拖入面粉 / 菜块：输入槽不限量，先来先烤">＋</span>';
  const round = Math.min(ovenCap(), items.length);
  return items.map((it, i) => '<span class="k-chip' + (i < round ? ' k-chip-round' : '') + '">' +
      kIconHTML(it.type === 'piece' ? ('dish:roast|normal|' + it.id) : 'dish:bread|normal|flour', K_ICON_SIZES.pot) +
    '</span>').join('') +
    `<span class="k-slots-num">队列 ${items.length} · 本轮 ${round}/${ovenCap()}</span>`;
}
function kPieceStock(){ let n = 0; for(const id of CROP_IDS) n += (state.pieces[id] || 0); return n; }
/* 三段进度条刻度：可收 / 精品窗口结束 / 焦糊 三个分界
 * 注意：焦糊刻度要贴在**最右端**（dur+burn = 走满）。以前把它错标在
 * (dur + perfect) 即 50% 的位置，看起来就像"走到一半就该焦糊"。 */
function kSegTicks(dur, perfect, burn){
  const total = dur + burn;
  const a = Math.min(96, dur / total * 100).toFixed(1);
  const b = Math.min(97.5, (dur + perfect) / total * 100).toFixed(1);
  return `<span class="k-tick" style="left:${a}%"></span>` +
         `<span class="k-tick k-tick-gold" style="left:${b}%"></span>` +
         `<span class="k-tick k-tick-burn" style="left:99.4%"></span>`;
}
function kAutoRowHTML(id){
  const dev = AUTO_DEVICES[id];
  const running = autoActive(id);
  const n = autoCountOf(id);
  const maxed = n >= AUTO_MAX;
  return `<div class="k-auto-row" data-auto-row="${id}">
    <span class="k-auto-ico">${dev.icon}</span>
    <span class="k-auto-info">
      <span class="k-auto-name">${dev.name}${n ? ' ×' + n : ''}</span>
      <span class="k-auto-desc" title="${kEsc(dev.desc)}">${dev.desc}</span>
    </span>
    <span class="k-auto-slot" data-slot="${id}"></span>
    ${id === 'chopper' ? kAutoCropPickerHTML() : ''}
    <span class="k-auto-state" data-dev-state="${id}"></span>
    <button class="mini${running ? '' : ' primary'}" data-act="buy-auto" data-dev="${id}" data-buy="${id}" ${maxed ? 'disabled' : ''}></button>
  </div>`;
}
/* 切块机：指定只切哪一种作物（'' = 自动挑最多的） */
function kAutoCropPickerHTML(){
  const want = (state.autoCrop && state.autoCrop.chopper) || '';
  const ids = CROP_IDS.filter(c => CROPS[c] && !CROPS[c].noChop);
  let out = '<span class="k-crop-pick">' +
    '<button class="k-crop-chip' + (want ? '' : ' on') + '" data-act="pick-crop" data-crop="" title="自动：切仓库里最多的那种">自动</button>';
  for(const c of ids){
    const n = state.bag[c] || 0;
    out += '<button class="k-crop-chip' + (want === c ? ' on' : '') + (n ? '' : ' poor') + '" data-act="pick-crop" data-crop="' + c + '" title="' +
      kEsc(CROPS[c].produce) + '（仓库 ' + n + '）">' + CROPS[c].emoji + (n ? '<i>' + n + '</i>' : '') + '</button>';
  }
  out += '</span>';
  return out;
}
function kStationOvenHTML(){
  const K = KITCHEN;
  return `
    <div class="k-station" data-station="oven">
      <div class="k-st-head"><span class="k-st-ico">🔥</span><span class="k-st-name">烤箱</span><span class="k-st-state" data-state="oven-x"></span></div>
      <div class="k-st-body">
        <div class="k-pot-slot k-oven-slots">${kOvenChipsHTML()}</div>
        <div class="k-st-info">
          <label class="k-check" title="窗口一过就取 · 同配方一直烤，原料不足自动停"><input type="checkbox" data-auto="oven" ${K.oven.auto ? 'checked' : ''}><span>自动烹饪</span></label>
          <div class="k-st-line" data-stock-hint></div>
        </div>
      </div>
      <div class="k-progress k-seg3" data-bar="oven">${kSegTicks(OVEN_MS, OVEN_PERFECT_MS, OVEN_BURN_MS)}<i></i></div>
      <div class="k-st-actions">
        <button class="mini primary" data-act="take" data-station="oven">出炉</button>
        <button class="mini" data-act="upgrade-oven" data-up="oven"></button>
        <span class="k-st-hint" data-oven-hint></span>
      </div>
    </div>`;
}
function kStationBoardHTML(){
  const K = KITCHEN;
  const src = K.board && K.board.src;
  const slot = src ? kIconHTML('crop:' + src, K_ICON_SIZES.station) : '<span class="k-slot k-slot-dim" title="点作物卡后再点这里">＋</span>';
  return `
    <div class="k-station" data-station="board">
      <div class="k-st-head"><span class="k-st-ico">🔪</span><span class="k-st-name">切菜板</span><span class="k-st-state" data-state="board-x"></span></div>
      <div class="k-st-body">
        <div class="k-slot k-board-slot">${slot}</div>
        <div class="k-st-info"><div class="k-st-line" data-pieces-hint></div></div>
      </div>
      <div class="k-st-hint" title="瞬发：点一下作物卡 → 连点这里，每点「咔」出 ${CHOP_PIECES} 块菜块">瞬发 · 每点 ${CHOP_PIECES} 块</div>
    </div>`;
}
function kStationPotHTML(){
  const K = KITCHEN;
  const has = K.pot.pieces.length > 0;
  /* v9.27：按种类聚合 + 数量角标。
   * 以前一块一个 chip —— 塞 1000 块南瓜就是 1000 个 <img> 节点，每次刷新都要重排整片，
   * "菜越多越卡"的一大半来自这里。现在无论塞多少块，节点数 = **有几种**（最多 11 种 + 总数）。 */
  const chips = has ? kPotChipsHTML() : '<span class="k-add" title="拖入菜块 / 大米">＋</span>';
  return `
    <div class="k-station" data-station="pot">
      <div class="k-st-head"><span class="k-st-ico">🍲</span><span class="k-st-name">锅</span><span class="k-st-state" data-state="pot-x"></span></div>
      <div class="k-st-body">
        <div class="k-pot-slot k-pot-slot-x">${chips}</div>
        <div class="k-st-info">
          <label class="k-check" title="窗口一过就取 · 同配方一直煮，原料不足自动停"><input type="checkbox" data-auto="pot" ${K.pot.auto ? 'checked' : ''}><span>自动烹饪</span></label>
          <div class="k-st-line" data-recipe-hint></div>
        </div>
      </div>
      <div class="k-progress k-seg3" data-bar="pot">${kSegTicks(POT_MS, POT_PERFECT_MS, POT_BURN_MS)}<i></i></div>
      <div class="k-st-actions">
        <button class="mini primary" data-act="take" data-station="pot">出锅</button>
        <span class="k-st-hint" data-cook-hint></span>
      </div>
    </div>`;
}
/* 菜品仓库（右侧栏）：一行一道菜，按钮窄一点免得把内容顶出去 */
/* 菜品的配料文案：有 counts 就显示 名称×数量；老存档只有名字数组，按老样子显示 */
function kDishPiecesText(d){
  const list = d.pieces || [];
  if(d.counts){
    const keys = Object.keys(d.counts);
    if(keys.length) return keys.map(id => itemName(id) + (d.counts[id] > 1 ? '×' + d.counts[id] : '')).join(' + ');
  }
  return list.slice(0, 12).map(itemName).join(' + ') + (list.length > 12 ? ' …' : '');
}
function kDishListHTML(){
  const keys = Object.keys(state.dishes);
  if(!keys.length){
    return '<div class="empty">还没有做好的菜 🍳<br><span class="r-meta">烤箱能烤面包，锅里能自由配菜</span></div>';
  }
  let rows = '';
  for(const key of keys){
    const d = state.dishes[key];
    const q = QUALITY[d.quality] || QUALITY.normal;
    const pieces = kDishPiecesText(d);
    rows += `
      <div class="row k-dish-row">
        <div class="r-ico k-dish-ico">${kIconHTML('dish:' + key, K_ICON_SIZES.dish)}</div>
        <div class="k-dish-main">
          <div class="r-name">${kEsc(d.name)}${d.qtag ? ' ' + d.qtag : ''}<span class="tag">${kEsc(q.name)}</span></div>
          <div class="r-meta">${kEsc(pieces)} · 单价 ${d.value} 金</div>
        </div>
        <div class="r-count">×${d.n}</div>
        <div class="k-dish-btns">
          <button class="mini sell" data-act="sell" data-key="${kEsc(key)}" data-n="1">卖1</button>
          <button class="mini sell" data-act="sell" data-key="${kEsc(key)}" data-n="${d.n}">全卖</button>
        </div>
      </div>`;
  }
  return rows;
}
/* 顶部：左边食材、右边菜品（两块各占一半，各自内部滚动，宽度绝不外扩） */
function kIngPaneHTML(){
  const shelf = kitchenShelf();
  const cards = shelf.length
    ? shelf.map(kShelfCardHTML).join('')
    : '<div class="empty">货架空空 🧺<br><span class="r-meta">收获的作物、切好的菜块、磨好的面粉都会出现在这里</span></div>';
  /* 「已选 / 取消选中」挪到标题行右侧（原来单独占一行，太浪费高度） */
  return '<div class="k-sec-title">🧺 食材' +
      '<span class="k-hint" data-selbar title="拖到工位 · 或点一下选中后连点工位 · 点 ★ 收藏">' +
        '<span data-seltext>拖 / 点选</span>' +
        '<button class="k-selclear" type="button" data-act="unsel">✕ 取消选中</button>' +
      '</span></div>' +
    '<div class="k-scroll k-cards">' + cards + '</div>';
}
function kDishPaneHTML(){
  return '<div class="k-sec-title">🍽️ 菜品<span class="k-hint">总价 ' + kDishValueTotal() + ' 金 · ' + dishTotal() + ' 份</span></div>' +
    '<div class="k-scroll k-dish-list">' + kDishListHTML() + '</div>' +
    '<div class="k-actions"><button class="mini sell" data-act="sellall">💸 一键全卖</button></div>';
}
function kKitchenHTML(){
  const banner = state.miniGameEnabled === false
    ? '<div class="k-banner">🎛️ 小游戏已关闭：取出动作一律按自动处理（永远「一般」，没有精品 / 焦糊判定）</div>'
    : '';
  return `
    <div class="k-wrap">
      ${banner}
      <section class="k-top" data-patch-group="top">
        <div class="k-pane k-pane-ing">${kIngPaneHTML()}</div>
        <div class="k-pane k-pane-dish">${kDishPaneHTML()}</div>
      </section>
      ${kLineHTML('prep')}
      ${kLineHTML('cook')}
    </div>`;
}
/* 逐块替换：HTML 完全没变的 section 直接保留旧节点。
 * 这样「放入 / 出锅」只会更新变化的那一块，图标（canvas 画的）不会跟着重画，不闪、不跳、不丢滚动位置。 */
function kGroupKey(node){ return (node && node.dataset && node.dataset.patchGroup) || ''; }
/* 逐块替换：同位置、同标签、HTML 一模一样的节点原样保留（身份不变，滚动位置与 canvas 图标都不丢） */
function kPatchNodes(oldWrap, freshWrap){
  const fresh = Array.prototype.slice.call(freshWrap.children);
  const olds = Array.prototype.slice.call(oldWrap.children);
  for(let i = 0; i < fresh.length; i++){
    const node = fresh[i], old = olds[i];
    if(old && old.tagName === node.tagName){
      const gk = kGroupKey(node);
      /* 分组容器（顶部「食材 | 菜品」）：深入到子节点再比一次，
         这样货架变化时右边的菜品仓库不会被连坐重画 */
      if(gk && gk === kGroupKey(old)){ kPatchNodes(old, node); continue; }
      if(!gk && old.outerHTML === node.outerHTML) continue;
    }
    if(old) oldWrap.replaceChild(node, old);
    else oldWrap.appendChild(node);
  }
  for(let i = fresh.length; i < olds.length; i++) oldWrap.removeChild(olds[i]);
}
function kPatchHTML(el, html){
  const tpl = document.createElement('div');
  tpl.innerHTML = html;
  const freshWrap = tpl.firstElementChild;
  if(!freshWrap){ el.innerHTML = html; return; }
  const oldWrap = el.firstElementChild;
  if(!oldWrap || oldWrap.tagName !== freshWrap.tagName){ el.innerHTML = html; return; }
  kPatchNodes(oldWrap, freshWrap);
}
function kBuildKitchen(el, sig){
  const box = el.closest ? el.closest('.modal-box') : null;
  const scrollTop = box ? box.scrollTop : 0;
  kPatchHTML(el, kKitchenHTML());
  const q = s => el.querySelector(s);
  kUI = {
    el, sig,
    n: {
      millBar: q('[data-bar="mill"]'), millWheel: q('[data-wheel="mill"]'),
      ovenBar: q('[data-bar="oven"]'),
      ovenBtn: q('[data-act="take"][data-station="oven"]'),
      potBar: q('[data-bar="pot"]'),
      ovenUp: q('[data-act="upgrade-oven"]'),
      potBtn: q('[data-act="take"][data-station="pot"]'),
    },
  };
  /* 重建出来的进度条 <i> 初始宽度是 0（样式表里定的），直接设宽度会从 0 补间过去 ——
     用别的工位时看起来就像"进度条被刷新了一下"。这里先关掉过渡把宽度落到位，下一帧再恢复。 */
  if(el.querySelectorAll){
    el.querySelectorAll('.k-progress i').forEach(i => { i.style.transition = 'none'; });
    setTimeout(() => {
      if(!el.querySelectorAll) return;
      el.querySelectorAll('.k-progress i').forEach(i => { i.style.transition = ''; });
    }, 60);
  }
  if(box) box.scrollTop = scrollTop;
}
/* 幂等：结构没变就只做轻量刷新，绝不每帧重建整个 DOM */
function renderKitchen(){
  const el = document.getElementById('kitchenBody');
  if(!el) return;
  kEnsureBindings(el);
  const sig = kKitchenSig();
  if(!kUI || kUI.el !== el || kUI.sig !== sig || !el.firstChild) kBuildKitchen(el, sig);
  kUpdateLive();
  kApplySelection();          // 选中高亮不参与重建，重建后补一次
}
function kSetBar(bar, r, tone){
  if(!bar) return;
  /* 注意：进度条里现在还有分界刻度 <span class="k-tick">，所以必须显式找 <i>，
     用 firstElementChild 会一直去改刻度的宽度（表现为进度条显示歪掉）。 */
  const i = bar.querySelector('i');
  if(!i) return;
  i.style.width = (Math.max(0, Math.min(1, r)) * 100).toFixed(1) + '%';
  bar.dataset.tone = tone || '';
}
/* 缩略卡的环形进度：边框拆成 4 段（上→右→下→左），顺时针依次点亮 */
function kSetRing(ring, r, tone){
  if(!ring) return;
  const v = Math.max(0, Math.min(1, r || 0));
  /* 支持 mask-composite 的浏览器用 conic-gradient 描边（真正贴着圆角走）；
     不支持的走下面那四段兜底，所以两条路各写一份。 */
  ring.style.setProperty('--p', v.toFixed(4));
  ring.dataset.tone = tone || '';
  if(!ring.children || ring.children.length < 4) return;
  const segs = ring.children;
  for(let k = 0; k < 4; k++){
    const p = Math.max(0, Math.min(1, v * 4 - k));
    segs[k].style.transform = (k === 0 || k === 2) ? 'scaleX(' + p + ')' : 'scaleY(' + p + ')';
  }
}
function kSetState(node, tone, text){
  if(!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
  if(node.classList){ node.classList.remove('busy', 'ok', 'off', 'ready', 'perfect', 'burnt'); node.classList.add(tone); }
}
function kClock(ms){
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
/* 配方缓存：kUpdateLive 每帧都要用（名字/基础价），但锅内容不变时结果也不变。
 * 以前每帧都算一遍 + 复制一份 pieces 数组，塞满 1000 块时纯属浪费（也喂 GC）。 */
let kPvCache = { key:'', pv:null };
function kPotRecipeCached(){
  const list = KITCHEN.pot.pieces;
  const cnt = {};
  for(let i = 0; i < list.length; i++) cnt[list[i]] = (cnt[list[i]] || 0) + 1;
  const keys = Object.keys(cnt).sort();
  const key = list.length + '|' + keys.map(k => k + ':' + cnt[k]).join(',');
  if(kPvCache.key === key) return kPvCache.pv;
  const pv = potRecipe(list);
  kPvCache = { key, pv };
  return pv;
}
/* 每帧的轻量刷新：缩略卡 / 环形进度 / 状态字 / 按钮可用性（不重建 DOM） */
function kUpdateLive(){
  if(!kUI || !kUI.n) return;
  const K = KITCHEN;
  const el_ = sel => (kUI.el && kUI.el.querySelector) ? kUI.el.querySelector(sel) : null;
  const all = sel => (kUI.el && kUI.el.querySelectorAll) ? kUI.el.querySelectorAll(sel) : [];
  const setAll = (sel, tone, text) => { const l = all(sel); for(let i = 0; i < l.length; i++) kSetState(l[i], tone, text); };
  const sub = (name, text) => { const l = all('[data-sub="' + name + '"]'); for(let i = 0; i < l.length; i++) if(l[i].textContent !== text) l[i].textContent = text; };
  const setChk = (sel, on) => { const l = all(sel); for(let i = 0; i < l.length; i++) if(!!l[i].checked !== !!on) l[i].checked = !!on; };
  const rings = (name, r, tone) => { const l = all('[data-ring="' + name + '"]'); for(let i = 0; i < l.length; i++) kSetRing(l[i], r, tone); };
  const buyBtns = (id, tight, wide) => {
    const l = all('[data-buy="' + id + '"]');
    for(let i = 0; i < l.length; i++){
      const b = l[i];
      const text = (b.dataset && b.dataset.buyTight !== undefined) ? tight : wide;
      if(b.textContent !== text) b.textContent = text;
      b.disabled = !!l[i].dataset && l[i].dataset.buyTight !== undefined ? (autoCountOf(id) >= AUTO_MAX || state.coins < autoPrice(id))
                                                                       : (autoCountOf(id) >= AUTO_MAX);
    }
  };

  /* ---- 切菜板（瞬发，没有进度条）---- */
  const crop = kHasCrop();
  setAll('[data-state="board"]', crop ? 'ok' : 'off', crop ? '就绪' : '缺作物');
  setAll('[data-state="board-x"]', kBoardBusy() ? 'busy' : (crop ? 'ok' : 'off'),
    kBoardBusy() ? '切菜中…' : (crop ? '就绪' : '缺作物'));
  sub('board', '菜块 ×' + kPieceStock() + (K.board && K.board.src ? ' · 上次切' + CROPS[K.board.src].produce : ''));
  { const h = el_('[data-pieces-hint]'); if(h) h.textContent = '🍴 菜块：' + kPiecesSummary(); }

  /* ---- 石磨（手动瞬时；进度条只画「自动磨面」）---- */
  const millR = kRatio(K.mill.t, K.mill.dur);
  const wheat = millStock(), batch = millBatch();
  if(autoActive('donkey')) setAll('[data-state="mill"]', 'busy', '驴磨面中');
  else setAll('[data-state="mill"]', wheat > 0 ? 'ok' : 'off', wheat > 0 ? '就绪' : '缺小麦');
  sub('mill', '小麦 ×' + wheat + ' → 面粉 ×' + (state.prep.flour || 0));
  { const g = el_('[data-grind]'); if(g){ g.textContent = batch > 0 ? '磨 ×' + batch : '磨粉'; g.disabled = batch <= 0; } }
  { const a = el_('[data-mill-stock]'); if(a) a.textContent = '×' + wheat;
    const b = el_('[data-mill-flour]'); if(b) b.textContent = '×' + (state.prep.flour || 0); }
  kSetBar(kUI.n.millBar, millR, K.mill.busy ? 'run' : 'idle');
  const wheelDeg = 'rotate(' + Math.round(K.mill.busy ? millR * 720 : 0) + 'deg)';
  { const list = all('[data-wheel="mill"],[data-wheel-mini="mill"]');
    for(let i = 0; i < list.length; i++){
      list[i].style.transform = wheelDeg;
      if(list[i].classList) list[i].classList.toggle('spin', K.mill.busy);
    }
  }
  if(autoActive('donkey')) setAll('[data-state="mill-x"]', 'busy', '自动磨面 ×' + autoCountOf('donkey') + ' · ' + kSecText((K.mill.dur - K.mill.t) / 1000));
  else setAll('[data-state="mill-x"]', wheat > 0 ? 'ok' : 'off', wheat > 0 ? '就绪（点一下磨 1 份）' : '缺小麦');
  { const h = el_('[data-flour-hint]'); if(h) h.textContent = '点/拖小麦 = 立刻磨 1 份 · 「磨 ×' + Math.max(batch, 1) + '」= 一把最多磨 ' + MILL_BATCH_MAX + ' 份'; }

  /* ---- 自动化设备（缩略卡 + 大界面同一套数据）---- */
  for(const id of AUTO_IDS){
    const dev = AUTO_DEVICES[id];
    const running = autoActive(id);
    const n = autoCountOf(id);
    const slotNow = autoSlotOf(id);
    const lack = slotNow.length === 0 && !autoSlotCan(id);
    const per = dev.per;
    const acc = (state.autoAcc && state.autoAcc[id]) || 0;
    const slot = autoSlotOf(id);
    const slotText = slot.length ? slot.map(c => CROPS[c] ? CROPS[c].emoji : '?').join('') : '空';
    const slotKey = slot.length + ':' + slot.join(',');
    { const l = all('[data-slot="' + id + '"]');
      for(let i = 0; i < l.length; i++){
        const node = l[i];
        if(node.dataset && node.dataset.slotKey === slotKey) continue;   /* 内容没变就不动 innerHTML */
        if(node.dataset) node.dataset.slotKey = slotKey;
        node.innerHTML = slot.length
          ? slot.map(c => '<span class="k-chip">' + kIconHTML('crop:' + c, 18) + '</span>').join('') +
            '<span class="k-slots-num">' + slot.length + '/' + AUTO_SLOT_MAX + '</span>'
          : '<span class="k-add" title="料斗空了 · 仓库有料会自动补">＋</span>';
      }
    }
    const paused = autoPaused(id);
    setChk('[data-dev-on="' + id + '"]', running && !paused);
    if(!running){
      setAll('[data-state="auto-' + id + '"]', 'off', '未启用');
      rings('auto-' + id, 0, 'off');
      sub('auto-' + id, '料斗 ' + slotText + ' · 未启用');
    } else if(paused){
      setAll('[data-state="auto-' + id + '"]', 'off', '已停');
      rings('auto-' + id, kRatio(acc, per), 'off');
      sub('auto-' + id, '料斗 ' + slotText + ' · 已停（租期冻结 ' + kClock(autoLeftMs(id)) + '）');
    } else {
      setAll('[data-state="auto-' + id + '"]', lack ? 'off' : 'busy', (lack ? '缺原料' : '×' + n + ' ' + kClock(autoLeftMs(id))));
      rings('auto-' + id, kRatio(acc, per), lack ? 'off' : 'run');
      sub('auto-' + id, '料斗 ' + slotText + ' · 每轮 ' + (id === 'donkey' ? '+1' : '+' + CHOP_PIECES) + '×' + n +
        (id === 'chopper' ? ' · ' + ((state.autoCrop && state.autoCrop.chopper) ? ('只切' + CROPS[state.autoCrop.chopper].produce) : '自动选') : ''));
    }
    const wide = (n >= AUTO_MAX) ? ('已满 ' + AUTO_MAX + ' 台') : ('＋第 ' + (n + 1) + ' 台 ' + autoPrice(id) + ' 金');
    const tight = (n >= AUTO_MAX) ? ('已满 ' + AUTO_MAX) : ('＋' + autoPrice(id) + '金');
    buyBtns(id, tight, wide);
    const stNode = el_('[data-dev-state="' + id + '"]');
    if(stNode){
      if(!running) kSetState(stNode, 'off', '未启用');
      else kSetState(stNode, lack ? 'off' : 'busy',
        (lack ? '缺原料 · ' : '运行中 ×' + n + ' · ') + kSecText(autoLeftMs(id) / 1000));
    }
  }

  /* ---- 锅 ---- */
  const potHas = K.pot.pieces.length > 0;
  const pv = potHas ? kPotRecipeCached() : null;
  const pTotal = K.pot.dur + POT_BURN_MS;
  if(!potHas){
    kSetBar(kUI.n.potBar, 0, 'idle');
    rings('pot', 0, 'idle');
    setAll('[data-state="pot"]', 'off', '空锅');
    setAll('[data-state="pot-x"]', 'off', '空锅');
    sub('pot', '空锅 · 拖菜块 / 大米进来');
  } else {
    const q = K.pot.done ? gradeOf(K.pot.t, K.pot.dur, POT_PERFECT_MS, POT_BURN_MS) : null;
    const tone = q || 'run';
    kSetBar(kUI.n.potBar, kRatio(K.pot.t, pTotal), tone);
    rings('pot', kRatio(K.pot.t, pTotal), tone);
    if(!K.pot.done){
      setAll('[data-state="pot"]', 'busy', '炖煮 ' + kSecText(K.pot.dur - K.pot.t));
      setAll('[data-state="pot-x"]', 'busy', '炖煮中 · 还剩 ' + kSecText(K.pot.dur - K.pot.t) + ' 到精品窗口');
    } else if(q === 'perfect'){
      setAll('[data-state="pot"]', 'perfect', '✨ 精品');
      setAll('[data-state="pot-x"]', 'perfect', '✨ 精品窗口 ' + kSecText(K.pot.dur + POT_PERFECT_MS - K.pot.t));
    } else if(q === 'normal'){
      setAll('[data-state="pot"]', 'ready', '可出锅');
      setAll('[data-state="pot-x"]', 'ready', '可出锅 · ' + kSecText(K.pot.dur + POT_BURN_MS - K.pot.t) + '后焦糊');
    } else {
      setAll('[data-state="pot"]', 'burnt', '🔥 焦糊');
      setAll('[data-state="pot-x"]', 'burnt', '🔥 已焦糊');
    }
    sub('pot', (pv ? pv.name + ' · ' + pv.pieces.length + ' 种 ' + pv.n + ' 块' : '杂烩 · ' + K.pot.pieces.length + ' 块')
      + ' · ' + kSecText(K.pot.dur - K.pot.t) + ' 到点');
  }
  if(kUI.n.potBtn) kUI.n.potBtn.disabled = !(potHas && K.pot.done);
  { setChk('[data-auto="pot"]', K.pot.auto);
    const h = el_('[data-recipe-hint]'); if(h) h.textContent = pv ? ('＝ ' + pv.name + '（基础 ' + pv.base + ' 金）') : '每加一样食材，进度条会重置';
    const c = el_('[data-cook-hint]'); if(c) c.textContent = state.miniGameEnabled === false ? '小游戏已关：直接出一般' : kSecText(K.pot.dur) + ' 走完即可出锅'; }

  /* ---- 烤箱 ---- */
  const ovenN = (K.oven.items || []).length;
  const oTotal = K.oven.dur + OVEN_BURN_MS;
  if(K.oven.busy){
    if(!K.oven.ready){
      kSetBar(kUI.n.ovenBar, kRatio(K.oven.t, oTotal), 'run');
      rings('oven', kRatio(K.oven.t, oTotal), 'run');
      setAll('[data-state="oven"]', 'busy', '烤制 ' + kSecText(K.oven.dur - K.oven.t));
      setAll('[data-state="oven-x"]', 'busy', '烤制中 ' + kSecText(K.oven.dur - K.oven.t) +
        '（本轮 ' + ovenRoundSize() + '/' + ovenCap() + ' 份 · 队列 ' + ovenN + '）');
    } else {
      const q = gradeOf(K.oven.t, K.oven.dur, OVEN_PERFECT_MS, OVEN_BURN_MS);
      kSetBar(kUI.n.ovenBar, kRatio(K.oven.t, oTotal), q);
      rings('oven', kRatio(K.oven.t, oTotal), q);
      if(q === 'perfect'){
        setAll('[data-state="oven"]', 'perfect', '✨ 精品');
        setAll('[data-state="oven-x"]', 'perfect', '✨ 精品窗口 ' + kSecText(K.oven.dur + OVEN_PERFECT_MS - K.oven.t));
      } else if(q === 'normal'){
        setAll('[data-state="oven"]', 'ready', '可出炉');
        setAll('[data-state="oven-x"]', 'ready', '可出炉 · ' + kSecText(K.oven.dur + OVEN_BURN_MS - K.oven.t) + '后焦糊');
      } else {
        setAll('[data-state="oven"]', 'burnt', '🔥 焦糊');
        setAll('[data-state="oven-x"]', 'burnt', '🔥 已焦糊');
      }
    }
    sub('oven', '本轮 ' + ovenRoundSize() + '/' + ovenCap() + ' · 队列 ' + ovenN + ' · ' + kSecText(Math.max(0, K.oven.dur - K.oven.t)) + ' 到点');
  } else {
    kSetBar(kUI.n.ovenBar, 0, 'idle');
    rings('oven', 0, 'idle');
    const can = (state.prep.flour || 0) > 0;
    setAll('[data-state="oven"]', can ? 'ok' : 'off', can ? '可进炉' : '空');
    setAll('[data-state="oven-x"]', can ? 'ok' : 'off', can ? '可进炉' : '空');
    sub('oven', '空 · 面粉 ×' + (state.prep.flour || 0) + ' / 菜块 ×' + kPieceStock() + ' · 每轮 ' + ovenCap() + ' 份');
  }
  if(kUI.n.ovenBtn) kUI.n.ovenBtn.disabled = !(K.oven.busy && K.oven.ready);
  /* 烤箱升级按钮：显示下一级价格，钱不够或满级就禁用 */
  const up = kUI.n.ovenUp;
  if(up){
    const cap = ovenCap();
    if(!ovenCanUpgrade()){ up.textContent = `已满级（${cap} 槽）`; up.disabled = true; }
    else {
      const price = ovenSlotPrice();
      up.textContent = `升级 ${price} 金（每轮 ${cap}→${cap + 1} 份）`;
      up.disabled = state.coins < price;
    }
  }
  { setChk('[data-auto="oven"]', K.oven.auto);
    const h = el_('[data-stock-hint]'); if(h) h.textContent = '🥣 面粉 ×' + (state.prep.flour || 0) + ' · 🔪 菜块 ×' + kPieceStock();
    const oh = el_('[data-oven-hint]');
    if(oh) oh.textContent = '输入不限量（先来先烤）· 每轮出炉 ' + ovenCap() + ' 份 · 队列 ' + ovenN + ' 份'; }
}

/* ============================================================
 * 四、动效：飞向货架 / 星光 / 切菜「咔」
 * ============================================================ */
/* 重启一个 CSS 动画类（先移除 → 强制回流 → 再加），连点也能次次触发 */
function kRestartAnim(el, cls){
  if(!el || !el.classList || !cls) return;
  el.classList.remove(cls);
  void (el.offsetWidth || 0);
  el.classList.add(cls);
}
function kStationEl(station){
  if(!kUI || !kUI.el || !kUI.el.querySelector) return null;
  return kUI.el.querySelector('.k-station[data-station="' + station + '"]');
}
/* 投料成功后的短反馈：菜板「咔」+ 飞块，其它工位弹一下，卡片也弹一下 */
function kDropFx(itemKey, station, res){
  if(!res || !res.ok) return;
  const raw = String(itemKey == null ? '' : itemKey);
  const id = raw.slice(raw.indexOf(':') + 1);
  if(station === 'board') kChopFx(id, (typeof CHOP_PIECES === 'number') ? CHOP_PIECES : 3);
  else kRestartAnim(kStationEl(station), 'k-pulse');
  if(kUI && kUI.el && kUI.el.querySelector){
    kRestartAnim(kUI.el.querySelector('.k-card[data-key="' + kEsc(itemKey) + '"]'), 'k-pop');
  }
}
/* 切菜「咔」：工位弹一下 + 槽位冒出作物图标 + 「咔 +N」气泡 + 菜块飞向货架（有数量上限，连点不卡） */
function kChopFx(srcId, n){
  const st = kStationEl('board');
  if(!st) return;
  kRestartAnim(st, 'k-chop');
  /* 缩略卡里没有 .k-board-slot（那块在展开区），就弹缩略卡自己的图标 */
  const slot = st.querySelector ? (st.querySelector('.k-board-slot') || st.querySelector('.k-cell-ico')) : null;
  if(slot){
    slot.innerHTML = kIconHTML(CROPS[srcId] ? ('crop:' + srcId) : srcId, K_ICON_SIZES.station);
    kRestartAnim(slot, 'k-pop');
  }
  let badge = st.querySelector ? st.querySelector('[data-chopbadge]') : null;
  if(!badge && st.appendChild){
    badge = document.createElement('span');
    badge.className = 'k-chop-badge';
    if(badge.setAttribute) badge.setAttribute('data-chopbadge', '1');
    st.appendChild(badge);
  }
  if(badge){
    badge.textContent = '咔 +' + n;
    kRestartAnim(badge, 'k-chop-go');
  }
  if(kFlyN < K_FLY_MAX){
    kFlyN++;
    kFlyFromStation('board', CROPS[srcId] ? ('piece:' + srcId) : srcId, () => { kFlyN--; });
  }
}
function kFlyFromStation(station, key, onDone){
  const done = () => { if(onDone){ const f = onDone; onDone = null; f(); } };
  if(!kUI || !kUI.el || !kUI.el.querySelector){ done(); return; }
  const from = kUI.el.querySelector('.k-station[data-station="' + station + '"]');
  /* 出品飞向顶部对应那一栏：菜 → 右（菜品），其余（面粉/菜块）→ 左（食材） */
  const to = String(key).indexOf('dish:') === 0
    ? (kUI.el.querySelector('.k-pane-dish') || kUI.el.querySelector('.k-top'))
    : (kUI.el.querySelector('.k-pane-ing') || kUI.el.querySelector('.k-top'));
  if(!from || !to || !from.getBoundingClientRect || !to.getBoundingClientRect){ done(); return; }
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  if(!a.width || !b.width){ done(); return; }      // 不可见 / 无头环境：跳过动画
  const el = document.createElement('div');
  el.className = 'k-fly';
  el.innerHTML = kIconHTML(key, 30);
  el.style.left = (a.left + a.width / 2) + 'px';
  el.style.top = (a.top + a.height / 2) + 'px';
  document.body.appendChild(el);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  if(window.requestAnimationFrame) window.requestAnimationFrame(() => {
    el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.55)';
    el.style.opacity = '0.12';
  });
  setTimeout(() => { el.remove(); done(); }, 640);
}

/* ============================================================
 * 五、每帧：推进逻辑 + 节流刷新
 * ============================================================ */
function updateKitchen(dt){
  kitchenLogicTick(dt);
  const visible = kKitchenOpen();
  if(visible && kUI) kUpdateLive();
  kFrameEvents(visible);
  if(!visible){ kAcc = 0; return; }
  kAcc += dt;
  const held = Date.now() < kHeldUntil;
  if(kAcc >= 100 && !held && !(kDrag && kDrag.active)){
    kAcc = 0;
    renderKitchen();
  }
}
/* 逻辑层静默完成的事情（石磨/菜板完工、自动出锅）在这里补上反馈 */
function kFrameEvents(visible){
  const K = KITCHEN;
  if(visible && kPrev.millBusy && !K.mill.busy) kFlyFromStation('mill', 'prep:flour');
  if(visible && kPrev.boardBusy && !kBoardBusy() && kPrev.boardSrc) kFlyFromStation('board', 'piece:' + kPrev.boardSrc);
  const dishes = dishTotal();
  const manual = (Date.now() - kLastTakeAt) < 300;
  if(dishes > kPrev.dishes && !manual){
    if(kPrev.ovenBusy && !K.oven.busy){
      SFX.play('ding');
      if(visible){ toast('自动出炉：面包（正常）'); kFlyFromStation('oven', 'dish:bread|normal|flour'); }
    } else if(kPrev.potLen > 0 && K.pot.pieces.length === 0){
      SFX.play('ding');
      if(visible){
        const recipe = kPrev.potPieces.length ? potRecipe(kPrev.potPieces) : null;
        toast('自动出锅：' + (recipe ? recipe.name : '杂烩') + '（正常）');
        kFlyFromStation('pot', recipe ? 'dish:' + recipe.id + '|normal|' + recipe.pieces.join(',') : 'dish:mix|normal|');
      }
    }
  }
  kPrev.millBusy = K.mill.busy;
  kPrev.boardBusy = kBoardBusy();
  kPrev.boardSrc = (K.board && K.board.src) || null;
  kPrev.ovenBusy = K.oven.busy;
  kPrev.potLen = K.pot.pieces.length;
  kPrev.potPieces = kPotSig();          /* 存签名，别再每帧复制上千个元素 */
  kPrev.dishes = dishes;
}

/* ============================================================
 * 六、交互：Pointer Events（鼠标 + 触屏）
 * ============================================================ */
function kEnsureBindings(el){
  if(kBound) return;
  kBound = true;
  el.addEventListener('click', kOnKitchenClick);
  el.addEventListener('change', kOnKitchenChange);
  el.addEventListener('contextmenu', kOnKitchenContext);
  el.addEventListener('pointerdown', kOnPointerDown);
  window.addEventListener('pointermove', kOnPointerMove);
  window.addEventListener('pointerup', kOnPointerUp);
  window.addEventListener('pointercancel', kOnPointerCancel);
  /* 指针按下期间暂停整块重建：否则 click 可能落在被替换掉的按钮上 */
  document.addEventListener('pointerdown', () => { kHeldUntil = Date.now() + 2000; kAcc = 0; }, true);
  document.addEventListener('pointerup', () => { kHeldUntil = 0; kAcc = 999; }, true);
}
/* 长按不呼出浏览器菜单（触屏） */
function kOnKitchenContext(e){ if(e && e.preventDefault) e.preventDefault(); }
/* 一次「点击」的统一分流（卡片 → 选中/取消；工位 → 投料/取出） */
function kHandleTap(t){
  if(!t || !t.closest) return;
  if(t.closest('.k-star') || t.closest('[data-act]') || t.closest('.k-check') || t.closest('.k-mini-sw')) return;
  const card = t.closest('.k-card[data-key]');
  if(card){ kSelectCard(card.dataset.key); return; }
  const st = t.closest('.k-station');
  if(st) kClickStation(st.dataset.station);
}
function kOnKitchenClick(e){
  const t = e.target;
  if(!t || !t.closest) return;
  if(kSuppressClick){ kSuppressClick = false; return; }   // 吞掉拖拽抬手那一次 click
  const star = t.closest('.k-star');
  if(star){ if(e.preventDefault) e.preventDefault(); kToggleFav(star.dataset.fav); return; }
  const btn = t.closest('[data-act]');
  if(!btn){
    /* pointerup 已按「点击」处理过 → 吞掉这次 click，避免选中被反手取消 */
    if(Date.now() - kTapGuard < 600) return;
    kHandleTap(t);
    return;
  }
  const act = btn.dataset.act;
  if(act === 'take'){ SFX.play('click'); kTakeStation(btn.dataset.station); return; }
  if(act === 'grind'){
    const r = mill(MILL_BATCH_MAX);
    if(r.ok){ SFX.play('mill'); toast(r.msg); kFlyFromStation('mill', 'prep:flour'); }
    else { SFX.play('error'); toast(r.msg); }
    if(kUI) kUI.sig = '';
    renderKitchen(); renderHUD();
    return;
  }
  if(act === 'upgrade-oven'){
    const r = ovenUpgrade();
    toast(r.msg);
    if(!r.ok) SFX.play('error'); else SFX.play('buy');
    if(kUI) kUI.sig = '';
    renderKitchen();
    return;
  }
  if(act === 'buy-auto'){
    const r = autoBuy(btn.dataset.dev);
    toast(r.msg);
    if(!r.ok) SFX.play('error');
    if(kUI) kUI.sig = '';
    renderKitchen();
    return;
  }
  if(act === 'expand'){ SFX.play('click'); kExpandToggle(btn.dataset.line); return; }
  if(act === 'pick-crop'){
    const c = btn.dataset.crop || '';
    if(!state.autoCrop) state.autoCrop = { chopper:'' };
    state.autoCrop.chopper = c;
    SFX.play('click');
    toast(c ? ('🔪 切块机：只切 ' + CROPS[c].produce + '（没货就停）') : '🔪 切块机：自动挑库存最多的作物');
    save();
    if(kUI) kUI.sig = '';
    renderKitchen();
    return;
  }
  if(act === 'unsel'){ if(e.preventDefault) e.preventDefault(); kSetSel(null); SFX.play('click'); renderKitchen(); return; }
  if(act === 'sell'){
    const gain = sellDish(btn.dataset.key, parseInt(btn.dataset.n, 10) || 1);
    if(gain > 0){ SFX.play('coin'); toast('+' + gain + ' 金'); renderHUD(); save(); }
    else toast('没有可卖的菜');
    renderKitchen();
    return;
  }
  if(act === 'sellall'){
    let gain = 0;
    for(const key of Object.keys(state.dishes)) gain += sellDish(key, state.dishes[key].n);
    if(gain > 0){ SFX.play('coin'); toast('+' + gain + ' 金'); renderHUD(); save(); }
    else toast('还没有可卖的菜');
    renderKitchen();
  }
}
function kOnKitchenChange(e){
  const box = e.target;
  const ds = (box && box.dataset) || {};
  /* 兼容老界面：data-loop 也当成全自动开关（现在两者是同一个） */
  if(ds.loop === 'oven' || ds.loop === 'pot'){
    const st2 = ds.loop;
    KITCHEN[st2].auto = !!box.checked;
    save();
    toast(box.checked
      ? (st2 === 'oven' ? '烤箱：全自动（窗口一过就取，同配方做到原料不足）' : '锅：全自动（窗口一过就取，同配方做到原料不足）')
      : (st2 === 'oven' ? '烤箱：改回手动' : '锅：改回手动'));
    if(kUI) kUI.sig = '';
    renderKitchen();
    return;
  }
  const dev = ds.devOn || '';
  if(dev){
    const r = autoSetOn(dev, !!box.checked);
    toast(r.msg);
    if(kUI) kUI.sig = '';
    renderKitchen(); renderHUD();
    return;
  }
  const st = ds.auto || '';
  if(st !== 'oven' && st !== 'pot') return;
  KITCHEN[st].auto = !!box.checked;
  save();
  const on = !!box.checked;
  if(st === 'oven') toast(on ? '烤箱：烤好自动出炉（只会是正常）' : '烤箱：改回手动出炉');
  else toast(on ? '锅：好了自动出锅（只会是正常）' : '锅：改回手动出锅');
  if(kUI) kUI.sig = '';
  renderKitchen();
}
function kOnPointerDown(e){
  if(e.button != null && e.button !== 0) return;
  kSuppressClick = false;
  const t = e.target;
  if(!t || !t.closest) return;
  /* 按钮 / 收藏 / 勾选框不参与拖拽与工位点击，交给 click 处理 */
  if(t.closest('.k-star') || t.closest('[data-act]') || t.closest('.k-check') || t.closest('.k-mini-sw')) return;
  const card = t.closest('.k-card[data-key]');
  const station = t.closest('.k-station');
  if(!card && !station) return;
  if(e.preventDefault) e.preventDefault();
  kDrag = {
    key: card ? card.dataset.key : null,     // 拖拽的物品 key（工位上为 null）
    el: t,                                    // 按下目标：抬手判定「点击」用
    draggable: !!card,
    id: e.pointerId, sx: e.clientX, sy: e.clientY,
    active: false, over: null,
  };
  if(card && card.classList) card.classList.add('k-pressing');
  kRepDid = false;
  if(station && !card) kRepeatArm(station.dataset ? station.dataset.station : '');
  kAcc = 0;
}
function kOnPointerMove(e){
  if(!kDrag || e.pointerId !== kDrag.id) return;
  if(!kDrag.active){
    if(Math.hypot(e.clientX - kDrag.sx, e.clientY - kDrag.sy) < K_TAP_SLOP) return;
    if(!kDrag.draggable){ kDrag = null; return; }   // 工位上的滑动 = 滚动页面，不算点击
    kDrag.active = true;
    kRepeatStop();                    /* 真拖起来了：长按重复让位给拖拽 */
    kGhostShow(kDrag.key);
  }
  if(e.preventDefault) e.preventDefault();
  kGhostMove(e.clientX, e.clientY);
  const hit = kStationAt(e.clientX, e.clientY);
  kDrag.over = hit && hit.dataset ? hit.dataset.station : null;
  kDropHighlight(kDrag.over, kDrag.key);
}
function kOnPointerUp(e){
  if(!kDrag) return;
  if(e && e.pointerId != null && e.pointerId !== kDrag.id) return;
  const d = kDrag;
  kDrag = null;
  kGhostRemove();
  kRepeatStop();
  kDropHighlight(null, d.key);
  kClearPressing(d.key);
  if(kRepDid){ kRepDid = false; kTapGuard = Date.now(); return; }   /* 长按已经投过了，别再补一次点击 */
  if(!d.active){
    /* 位移 <8px → 算一次点击（鼠标 click / 触屏 tap 共用这条路径） */
    kTapGuard = Date.now();
    kHandleTap(d.el);
    return;
  }
  kSuppressClick = true;
  if(d.over){
    const chk = kDropCheck(d.key, d.over);
    if(chk.ok) kDropItem(d.key, d.over);
    else { toast(chk.msg); SFX.play('error'); }
  }
}
/* pointercancel：手势被系统/滚动抢走 → 只收尾，绝不当点击 */
function kOnPointerCancel(e){
  if(!kDrag) return;
  if(e && e.pointerId != null && e.pointerId !== kDrag.id) return;
  const d = kDrag;
  kDrag = null;
  kGhostRemove();
  kRepeatStop();
  kRepDid = false;                   /* 手势被抢走：不清掉的话会吞掉下一次点击 */
  kDropHighlight(null, d.key);
  kClearPressing(d.key);
}
function kClearPressing(key){
  if(!key || !kUI || !kUI.el || !kUI.el.querySelector) return;
  const card = kUI.el.querySelector('.k-card[data-key="' + kEsc(key) + '"]');
  if(card && card.classList) card.classList.remove('k-pressing');
}
function kStationAt(x, y){
  if(!kUI || !kUI.el || !kUI.el.querySelectorAll) return null;
  const list = kUI.el.querySelectorAll('.k-station');
  for(let i = 0; i < list.length; i++){
    const el = list[i];
    if(!el.getBoundingClientRect) continue;
    const r = el.getBoundingClientRect();
    if(r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
  }
  return null;
}
function kDropHighlight(station, key){
  if(!kUI || !kUI.el || !kUI.el.querySelectorAll) return;
  const list = kUI.el.querySelectorAll('.k-station');
  for(let i = 0; i < list.length; i++){
    const el = list[i];
    const name = el.dataset ? el.dataset.station : '';
    const on = !!station && name === station;
    const ok = on && kDropCheck(key, name).ok;
    if(el.classList){
      el.classList.toggle('k-drop', on && ok);
      el.classList.toggle('k-drop-bad', on && !ok);
    }
  }
}
function kGhostShow(key){
  kGhostRemove();
  const el = document.createElement('div');
  el.id = 'kDragGhost';
  el.className = 'k-ghost';
  el.innerHTML = '<span class="k-ghost-ico">' + kIconHTML(key, K_ICON_SIZES.ghost) + '</span>'
               + '<span class="k-ghost-name">' + kEsc(kItemLabel(key)) + '</span>';
  el.style.transform = 'translate(-999px,-999px)';
  document.body.appendChild(el);
  kGhostEl = el;
}
function kGhostMove(x, y){
  if(!kGhostEl) return;
  kGhostEl.style.transform = 'translate(' + (x + 14) + 'px,' + (y - 18) + 'px)';
}
function kGhostRemove(){
  if(kGhostEl && kGhostEl.remove) kGhostEl.remove();
  kGhostEl = null;
}

/* ============================================================
 * 七、打开面板 / 无头测试接口
 * ============================================================ */
function openKitchen(){ openSheet('kitchen'); }

window.KitchenDebug = {
  /* 等价于把货架上的 itemKey 拖到该工位；返回逻辑层结果 { ok, ... } */
  drop(itemKey, station){ return kDropItem(itemKey, station); },
  /* 出锅 / 出炉（手动，可出精品）；小游戏关闭时自动按正常处理 */
  take(station){ return kTakeStation(station); },
  /* 切换收藏，返回切换后的布尔值 */
  toggleFav(itemKey){ return kToggleFav(itemKey); },
  /* 货架上的 key 列表 */
  shelfKeys(){ return kitchenShelf().map(it => it.key); },
  /* 四个工位的状态快照（含 progress / quality / auto） */
  stationState(){ return kStationState(); },
  /* 选中 / 取消选中（静默，等价于点卡片）：传空或再传当前 key = 取消；返回当前选中 key */
  select(itemKey){ return kSetSel(itemKey); },
  /* 当前选中的货架 key（null = 没选） */
  selected(){ return kSel; },
  /* 等价于「点击工位」：有选中就投料（保持选中），没选中则烤箱/锅 = 取出 */
  clickStation(station){ return kClickStation(station); },
  /* 幂等渲染一次（无头测试用；连调不会让 DOM 增长） */
  render(){ renderKitchen(); },
  /* 长按持续添加：手工触发一次（等价于按住不放走到的那一步） */
  repeatOnce(station){ kRepStation = station; return kRepeatOnce(); },
  repeatArmed(){ return !!kRepTimer || !!kRepIv; },
};
