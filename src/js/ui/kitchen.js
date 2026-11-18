/* kitchen — 拖拽厨房 UI（做菜逻辑在 dishes.js，只读不改）
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
              potLen:0, potPieces:[], dishes:0, flour:null };
const K_ICON_CACHE = Object.create(null);
const K_ICON_SIZES = { card:42, station:38, dish:30, ghost:46, pot:22 };
const K_TAP_SLOP = 8;           // 位移 <8px 视为点击（容忍手指抖动）
const K_REP_DELAY = 420;        // 按住多久开始"持续添加"
const K_REP_EVERY = 170;        // 之后每隔多久再来一次
const K_FLY_MAX = 8;            // 同时存在的飞行动效上限（连点不卡顿）
/* 状态字里常用的小图标：只在启动时拼一次字符串，别每帧重拼 */
const K_ICO_PERFECT = iconHTML('sparkles'), K_ICO_BURNT = iconHTML('fire');

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
  if(url === 'data:,') url = '';          // 无 canvas 环境（jsdom）→ 回退 SVG
  K_ICON_CACHE[ck] = url;
  return url;
}
/* canvas 画不出来时的回落（jsdom / 没有 canvas 的环境）：统一用通用图标。
 * 作物、菜块、加工品、菜品的具体形状只在 canvas 上画，图标库不再为每种留一份 SVG。 */
const K_ICON_FALLBACK = { piece:'knife', prep:'pot', dish:'pot' };
function kIconName(key){
  const s = String(key == null ? '' : key);
  const i = s.indexOf(':');
  return (i > 0 && K_ICON_FALLBACK[s.slice(0, i)]) || 'sprout';
}
function kIconHTML(key, size, cls){
  const url = kIconURL(key, size);
  const c = 'k-ico' + (cls ? ' ' + cls : '');
  if(url) return '<img class="' + c + '" alt="" draggable="false" src="' + url + '">';
  return iconHTML(kIconName(key), c + ' k-ico-em');
}
/* 一个参数就够的图标渲染：'crop:carrot' / 'decor:tree' 这类绘制键交给 canvas，
 * 其余（Lucide 图标名）还是 SVG。toast / 飞行动画 / 奖励文案都用它。 */
function kDrawnHTML(key, size, cls){
  const s = String(key == null ? '' : key);
  if(s.indexOf(':') > 0) return kIconHTML(s, size || 20, cls);
  return iconHTML(s, cls);
}

/* ============================================================
 * 一之二、四个工位图标（石磨 / 切菜板 / 烤箱 / 锅）：精灵图切片
 * 每个工位先把 K_STATION_FRAMES 帧画进**同一张横向精灵图**（离屏 canvas，烘一次常驻），
 * 标题前放一个 <canvas class="k-st-cv">，播放时只 drawImage 切其中一格：
 *   · 没有 base64 dataURL，也没有「每帧一个 <img>」；
 *   · 加工中按相位翻帧，停下来 / 空着就停在空闲帧（第 0 帧）；
 *   · 同一块 canvas + 同一帧号不重画（kStationPaint 里比对），静止时零绘制开销。
 * 瞬发动作（手动磨粉、切一刀）用 kStationBurst() 演一小段再停。
 * ============================================================ */
const K_ST_FRAME = 72;                   /* 每帧画布边长：显示 36px（.k-st-ico 的 --k-ico 同步）
                                            留 2× 余量，DPR 2 的屏上切片也不虚 */
const K_ST_IDS = ['mill', 'board', 'oven', 'pot'];
const K_ST_RATE = { mill:1.6, board:2.4, oven:0.9, pot:1.2 };   /* 加工时每秒循环几次 */
const K_ST_BURST_SEC = 0.42;             /* 瞬发动作演多久 */
const K_ST_SHEETS = Object.create(null); /* id → 精灵图 canvas */
const K_ST_PHASE = { mill:0, board:0, oven:0, pot:0 };
const K_ST_BURST = { mill:0, board:0, oven:0, pot:0 };
const K_ST_DRAWN = Object.create(null);  /* id → { el, f } 上次切片的 canvas 与帧号 */

function kStationSheet(id){
  if(K_ST_SHEETS[id] !== undefined) return K_ST_SHEETS[id];
  let sheet = null;
  try{
    const cv = document.createElement('canvas');
    cv.width = K_ST_FRAME * K_STATION_FRAMES;
    cv.height = K_ST_FRAME;
    const g = cv.getContext && cv.getContext('2d');
    if(g){
      const half = K_ST_FRAME / 2;
      for(let f = 0; f < K_STATION_FRAMES; f++){
        drawItemIcon(g, 'station:' + id + '|' + f, f * K_ST_FRAME + half, half, K_ST_FRAME);
      }
      sheet = cv;
    }
  }catch(e){ sheet = null; }
  K_ST_SHEETS[id] = sheet;
  return sheet;
}
function kStationIcoHTML(id){
  return '<canvas class="k-st-cv" data-st-ico="' + id + '" width="' + K_ST_FRAME +
    '" height="' + K_ST_FRAME + '"></canvas>';
}
/* 把某工位的第 f 帧切到它的 <canvas> 上；同一块 canvas 画同一帧就跳过 */
function kStationPaint(id, f){
  const el = kUI && kUI.st && kUI.st[id];
  if(!el || !el.getContext) return;
  const done = K_ST_DRAWN[id];
  if(done && done.el === el && done.f === f) return;
  if(el.dataset) el.dataset.frame = String(f);
  const g = el.getContext('2d');
  if(!g) return;                       /* jsdom：没有 2d 上下文，只留帧号 */
  const sheet = kStationSheet(id);
  if(!sheet) return;
  g.clearRect(0, 0, K_ST_FRAME, K_ST_FRAME);
  g.drawImage(sheet, f * K_ST_FRAME, 0, K_ST_FRAME, K_ST_FRAME, 0, 0, K_ST_FRAME, K_ST_FRAME);
  K_ST_DRAWN[id] = { el, f };
}
/* 瞬发动作：演一小段动画（切一刀 / 磨一下后停在空闲帧） */
function kStationBurst(id){
  K_ST_BURST[id] = K_ST_BURST_SEC;
}
/* 每帧（面板打开时）：谁在加工谁翻帧，其余的回到空闲帧 */
function kUpdateStationAnim(dt){
  if(!kUI || !kUI.st) return;
  const K = KITCHEN;
  const sec = Math.max(0, dt || 0) / 1000;
  /* 谁「真的在干活」谁才播动画：
   *   石磨 —— 有驴、没被停、而且还有小麦可磨（只是租着没料 / 停了都不该转）；
   *   切菜板 —— 自动切块开着、并且料斗或仓库里还有能切的东西；
   *   烤箱 / 锅 —— 正在烤 / 正在煮（空着、已经好了就停下）。 */
  const donkeyOn = autoActive('donkey') && !autoPaused('donkey');
  const chopperOn = autoActive('chopper') && !autoPaused('chopper');
  const busy = {
    mill: !!(K.mill && K.mill.busy) && donkeyOn && millStock() > 0,
    board: chopperOn && (autoSlotOf('chopper').length > 0 || kHasCrop()),
    oven: !!(K.oven && K.oven.busy),
    pot: K.pot.pieces.length > 0 && !K.pot.done,
  };
  for(const id of K_ST_IDS){
    let moving = busy[id];
    if(!moving && K_ST_BURST[id] > 0){
      K_ST_BURST[id] = Math.max(0, K_ST_BURST[id] - sec);
      moving = K_ST_BURST[id] > 0;
    }
    if(moving) K_ST_PHASE[id] = (K_ST_PHASE[id] + sec * K_ST_RATE[id]) % 1;
    else if(K_ST_PHASE[id] !== 0) K_ST_PHASE[id] = 0;
    kStationPaint(id, moving ? Math.floor(K_ST_PHASE[id] * K_STATION_FRAMES) % K_STATION_FRAMES : 0);
  }
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
/* 仓库里还有可切作物吗（菜板状态字用）——小麦这类 noChop 的不能切，不算「就绪」 */
function kHasCrop(){
  for(let i = 0; i < CROP_IDS.length; i++){
    const id = CROP_IDS[i];
    if(CROPS[id].noChop) continue;
    if((state.bag[id] || 0) > 0) return true;
  }
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
  if(res.quality === 'burnt'){ SFX.play('burn'); toast('焦糊了…', 'fire'); }
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
/* ============================================================
 * 点槽位选材料：单材料直接投；多材料弹一个小菜单；没材料时
 * 烤箱 / 锅仍然回退成「取出」（和点整张工位卡一个行为）。
 * ============================================================ */
let kPicker = null;             // { el, station } 当前弹出的材料菜单
function kStationName(station){
  return station === 'mill' ? '石磨' : station === 'board' ? '切菜板' :
         station === 'oven' ? '烤箱' : station === 'pot' ? '锅' : '工位';
}
/* 当前仓库里能放进这个工位的材料（顺序跟厨房货架一致） */
function kSlotMaterials(station){
  return kitchenShelf().filter(it => kDropCheck(it.key, station).ok);
}
function kClosePicker(){
  const p = kPicker;
  kPicker = null;
  if(p && p.el && p.el.parentNode) p.el.parentNode.removeChild(p.el);
}
function kPickerOpen(station, anchor, list){
  const el = document.createElement('div');
  el.className = 'k-picker';
  el.dataset.picker = station;
  el.innerHTML = '<div class="k-picker-head">放入材料 · ' + kEsc(kStationName(station)) + '</div>' +
    list.map(it => '<button type="button" class="k-picker-item" data-pick-key="' + kEsc(it.key) + '">' +
      kIconHTML(it.key, 22) + '<span class="k-picker-name">' + kEsc(it.name) + '</span>' +
      '<span class="k-picker-n">×' + it.n + '</span></button>').join('');
  document.body.appendChild(el);
  /* 贴在槽位下方；放不下就翻到上方，再不行就贴边 */
  let x = 8, y = 8;
  const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
  if(r){ x = r.left; y = r.bottom + 4; }
  const w = el.offsetWidth || 0, h = el.offsetHeight || 0;
  const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
  if(vw && x + w > vw - 8) x = Math.max(8, vw - 8 - w);
  if(vh && y + h > vh - 8) y = Math.max(8, r ? r.top - 4 - h : vh - 8 - h);
  el.style.left = Math.round(x) + 'px';
  el.style.top = Math.round(y) + 'px';
  /* 菜单项直接投料（菜单挂在 body 上，不经过厨房的点击分流） */
  const items = el.querySelectorAll('[data-pick-key]');
  for(let i = 0; i < items.length; i++){
    items[i].addEventListener('click', ev => {
      if(ev.preventDefault) ev.preventDefault();
      if(ev.stopPropagation) ev.stopPropagation();
      const key = items[i].dataset ? items[i].dataset.pickKey : '';
      kClosePicker();
      if(key) kDropItem(key, station);
    });
  }
  kPicker = { el, station };
  return el;
}
/* 点某个槽位（石磨 / 切菜板 / 烤箱 / 锅）：每次点击都打开材料菜单 */
function kPickSlotMaterial(station, anchor){
  if(!station) return { ok:false, msg:'没有这个工位' };
  const list = kSlotMaterials(station);
  if(!list.length){
    kClosePicker();
    if(station === 'oven' || station === 'pot') return kTakeStation(station);
    const msg = station === 'mill' ? '仓库里没有小麦' : '仓库里没有能切的作物';
    toast(msg);
    SFX.play('error');
    return { ok:false, msg };
  }
  kClosePicker();
  kPickerOpen(station, anchor, list);
  return { ok:true, opened:true, n:list.length };
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
    (K.oven.items && K.oven.items[0]) ? (K.oven.items[0].type === 'piece' ? 'p:' + K.oven.items[0].id : 'f') : '',
    AUTO_IDS.map(id => (autoActive(id) ? 1 : 0) + ':' + autoCountOf(id)).join(''),
    kBoardBusy() ? 1 : 0, (K.board && K.board.src) || '',
    kPotSig(), K.pot.done ? 1 : 0, K.pot.auto ? 1 : 0,
    state.prep.flour || 0, state.bag.wheat || 0,
    state.miniGameEnabled === false ? 0 : 1,
  ].join('|');
}
/* 两行工位（备料台 / 烹饪台）直接常驻显示，不再有「缩略卡 ↔ 详细界面」的折叠层 */

/* 自动化开关：一颗按钮，和「磨粉 / 切块 / 出炉 / 出锅」并排放在工位的动作行里。
 * 关着显示「自动磨面 / 自动切块 / 自动烹饪」，开着变成红色的「停止」。
 * 按下：开始（autoSetOn(id, true)）；开着再按：停（不产出、不吃料，租期冻结）。 */
function kAutoBtnHTML(attrs, on, label, title){
  return '<button type="button" class="mini k-auto-btn' + (on ? ' stop' : '') + '"' + attrs +
    ' title="' + kEsc(title) + '">' + (on ? '停止' : kEsc(label)) + '</button>';
}
/* 台数：厨房里那台基础设备始终算 1 台（买自动石磨 / 自动切菜板是解锁自动加工，
 * 第 1 台自动机接手后仍是「1 台」，再买才变成 2 台、3 台）。
 * 早期版本没买自动设备时显示「共0台」，看起来像厨房里根本没有石磨 / 切菜板。 */
function kDeviceCount(id){ return Math.max(1, autoCountOf(id)); }
function kDevAutoHTML(id, label){
  const dev = AUTO_DEVICES[id];
  const owned = autoCountOf(id) > 0;
  const on = owned && autoActive(id) && !autoPaused(id);
  return kAutoBtnHTML(' data-act="auto-dev" data-dev="' + id + '"', on, label,
    on ? '停：' + dev.name + '不产出也不吃料，租期冻结（回来接着用）'
       : owned ? '开始自动：' + dev.name + '按一下开，开着时再按停'
               : '未解锁：到商店购买「自动' + dev.name + '」，买后解锁自动加工');
}
/* 烤箱 / 锅的「自动烹饪」是同一颗按钮（开到窗口就取，原料不足自动停） */
function kCookAutoHTML(station, auto){
  return kAutoBtnHTML(' data-act="auto-cook" data-cook="' + station + '"', !!auto, '自动烹饪',
    '窗口一过就取 · 同配方一直做，原料不足自动停');
}
/* 四个工位直接常驻显示：备料台（石磨 / 切菜板）+ 烹饪台（烤箱 / 锅） */
function kStationsHTML(line){
  const prep = line === 'prep';
  return '<div class="k-stations" data-line="' + line + '" data-patch-group="' + line + '">' +
    (prep ? kStationMillHTML() + kStationBoardHTML()
          : kStationOvenHTML() + kStationPotHTML()) +
    '</div>';
}

function kShelfCardHTML(it){
  const fav = state.fav && state.fav[it.key];
  const sel = kSel === it.key;
  return `
    <div class="k-card${fav ? ' fav' : ''}${sel ? ' k-sel' : ''}" data-key="${kEsc(it.key)}" aria-pressed="${sel ? 'true' : 'false'}">
      <button class="k-star${fav ? ' on' : ''}" data-fav="${kEsc(it.key)}" title="收藏">${iconHTML(fav ? 'star-filled' : 'star')}</button>
      <div class="k-card-ico">${kIconHTML(it.key, K_ICON_SIZES.card)}</div>
      <div class="k-card-name">${kEsc(it.name)}</div>
      <div class="k-card-n">×${it.n}</div>
    </div>`;
}
/* 槽位右下角的小提示：点一下可以换 / 选放入的材料 */
function kSlotSwapHTML(){
  return '<span class="k-slot-swap" title="点一下选材料" aria-hidden="true">' + iconHTML('cycle') + '</span>';
}
function kStationMillHTML(){
  const wheat = millStock();
  const slot = wheat > 0
    ? kIconHTML('crop:wheat', K_ICON_SIZES.station)
    : '<span class="k-slot k-slot-dim" title="点这里选小麦">＋</span>';
  return `
    <div class="k-station" data-station="mill" data-patch-group="mill">
      <div class="k-st-head"><span class="k-st-ico">${kStationIcoHTML('mill')}</span><span class="k-st-name">石磨</span><span class="k-st-count" title="基础 1 台；购买自动石磨后解锁自动加工">共${kDeviceCount('donkey')}台</span><span class="k-st-state" data-state="mill-x"></span></div>
      <div class="k-st-body">
        <div class="k-slot" data-slot-pick="mill">${slot}${kSlotSwapHTML()}</div>
        <span class="k-flow-n" data-mill-stock${wheat > 0 ? '' : ' hidden'}>库存 ×${wheat}</span>
      </div>
      <div class="k-progress" data-bar="mill"><i></i></div>
      <div class="k-st-actions">
        <button class="mini primary" data-act="grind" data-grind>磨粉</button>
        ${kDevAutoHTML('donkey', '自动磨面')}
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
/* 烤箱：单格槽只显示队首要烤的东西；队列总数放在槽外标签上 */
function kOvenSlotHTML(){
  const head = (KITCHEN.oven.items || [])[0];
  if(!head) return '<span class="k-slot k-slot-dim" title="拖入面粉 / 菜块：输入槽不限量，先来先烤">＋</span>';
  const key = head.type === 'piece' ? ('dish:roast|normal|' + head.id) : 'dish:bread|normal|flour';
  return kIconHTML(key, K_ICON_SIZES.station);
}
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
function kStationOvenHTML(){
  const K = KITCHEN;
  const ovenN = (K.oven.items || []).length;
  return `
    <div class="k-station" data-station="oven" data-patch-group="oven">
      <div class="k-st-head"><span class="k-st-ico">${kStationIcoHTML('oven')}</span><span class="k-st-name">烤箱</span><span class="k-st-count">共${ovenCap()}台</span><span class="k-st-state" data-state="oven-x"></span></div>
      <div class="k-st-body">
        <div class="k-slot k-oven-slot" data-slot-pick="oven">${kOvenSlotHTML()}${kSlotSwapHTML()}</div>
        <span class="k-flow-n" data-oven-stock${ovenN ? '' : ' hidden'}>队列 ×${ovenN}</span>
      </div>
      <div class="k-progress k-seg3" data-bar="oven">${kSegTicks(OVEN_MS, OVEN_PERFECT_MS, OVEN_BURN_MS)}<i></i></div>
      <div class="k-st-actions">
        <button class="mini primary" data-act="take" data-station="oven">出炉</button>
        ${kCookAutoHTML('oven', K.oven.auto)}
      </div>
    </div>`;
}
function kStationBoardHTML(){
  const K = KITCHEN;
  const src = K.board && K.board.src;
  const n = src ? (state.bag[src] || 0) : 0;
  const slot = src ? kIconHTML('crop:' + src, K_ICON_SIZES.station) : '<span class="k-slot k-slot-dim" title="点作物卡后再点这里">＋</span>';
  return `
    <div class="k-station" data-station="board" data-patch-group="board">
      <div class="k-st-head"><span class="k-st-ico">${kStationIcoHTML('board')}</span><span class="k-st-name">切菜板</span><span class="k-st-count" title="基础 1 台；购买自动切菜板后解锁自动加工">共${kDeviceCount('chopper')}台</span><span class="k-st-state" data-state="board-x"></span></div>
      <div class="k-st-body">
        <div class="k-slot k-board-slot" data-slot-pick="board">${slot}${kSlotSwapHTML()}</div>
        <span class="k-flow-n" data-board-stock${src ? '' : ' hidden'}>库存 ×${n}</span>
      </div>
      <div class="k-st-actions">
        <button class="mini primary" data-act="chop" data-chop${src && n > 0 ? '' : ' disabled'}>切块</button>
        ${kDevAutoHTML('chopper', '自动切块')}
      </div>
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
    <div class="k-station" data-station="pot" data-patch-group="pot">
      <div class="k-st-head"><span class="k-st-ico">${kStationIcoHTML('pot')}</span><span class="k-st-name">锅</span><span class="k-st-state" data-state="pot-x"></span></div>
      <div class="k-st-body">
        <div class="k-pot-slot k-pot-slot-x" data-slot-pick="pot">${chips}${kSlotSwapHTML()}</div>
      </div>
      <div class="k-progress k-seg3" data-bar="pot">${kSegTicks(POT_MS, POT_PERFECT_MS, POT_BURN_MS)}<i></i></div>
      <div class="k-st-actions">
        <button class="mini primary" data-act="take" data-station="pot">出锅</button>
        ${kCookAutoHTML('pot', K.pot.auto)}
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
    return '<div class="empty">还没有做好的菜 ' + iconHTML('pot') + '<br><span class="r-meta">烤箱能烤面包，锅里能自由配菜</span></div>';
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
          <div class="r-name">${kEsc(d.name)} ${qualityIconHTML(d.quality)}<span class="tag">${kEsc(q.name)}</span></div>
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
    : '<div class="empty">货架空空 ' + iconHTML('basket') + '<br><span class="r-meta">收获的作物、切好的菜块、磨好的面粉都会出现在这里</span></div>';
  /* 「已选 / 取消选中」挪到标题行右侧（原来单独占一行，太浪费高度） */
  return '<div class="k-sec-title">' + iconHTML('basket') + ' 食材' +
      '<span class="k-hint" data-selbar title="拖到工位 · 或点一下选中后连点工位 · 点 ★ 收藏">' +
        '<span data-seltext>拖 / 点选</span>' +
        '<button class="k-selclear" type="button" data-act="unsel">' + iconHTML('x') + ' 取消选中</button>' +
      '</span></div>' +
    '<div class="k-scroll k-cards">' + cards + '</div>';
}
function kDishPaneHTML(){
  return '<div class="k-sec-title">' + iconHTML('plate') + ' 菜品<span class="k-hint">总价 ' + kDishValueTotal() + ' 金 · ' + dishTotal() + ' 份</span></div>' +
    '<div class="k-scroll k-dish-list">' + kDishListHTML() + '</div>' +
    '<div class="k-actions"><button class="mini sell" data-act="sellall">' + iconHTML('coins') + ' 一键全卖</button></div>';
}
function kKitchenHTML(){
  const banner = state.miniGameEnabled === false
    ? '<div class="k-banner">' + iconHTML('controls') + ' 小游戏已关闭：取出动作一律按自动处理（永远「一般」，没有精品 / 焦糊判定）</div>'
    : '';
  return `
    <div class="k-wrap">
      ${banner}
      <section class="k-top" data-patch-group="top">
        <div class="k-pane k-pane-ing">${kIngPaneHTML()}</div>
        <div class="k-pane k-pane-dish">${kDishPaneHTML()}</div>
      </section>
      ${kStationsHTML('prep')}
      ${kStationsHTML('cook')}
    </div>`;
}
/* 逐块替换：HTML 完全没变的 section 直接保留旧节点。
 * 这样「放入 / 出锅」只会更新变化的那一块，图标（canvas 画的）不会跟着重画，不闪、不跳、不丢滚动位置。 */
function kGroupKey(node){ return (node && node.dataset && node.dataset.patchGroup) || ''; }
/* 逐块替换：同位置、同标签、模板 HTML 一模一样的节点原样保留。
 * 注意不能拿 `old.outerHTML` 来比：状态字 / 提示 / 进度 tone 都是 kUpdateLive
 * 每帧改上去的，old.outerHTML 一定跟刚生成的模板不同 —— 结果石磨一出面粉，
 * 整个备料台（含切菜板的自动化开关）就被重建一次，看起来像两台机器互相拖累。
 * 所以把「生成时的模板 HTML」记在节点上（__patchHTML），只比模板。 */
function kPatchNodes(oldWrap, freshWrap){
  const fresh = Array.prototype.slice.call(freshWrap.children);
  const olds = Array.prototype.slice.call(oldWrap.children);
  for(let i = 0; i < fresh.length; i++){
    const node = fresh[i], old = olds[i];
    const freshHTML = node.outerHTML;
    node.__patchHTML = freshHTML;
    if(old && old.tagName === node.tagName){
      const gk = kGroupKey(node);
      /* 分组容器：深入到子节点再比一次，这样石磨 / 切菜板各自更新 */
      if(gk && gk === kGroupKey(old)){ kPatchNodes(old, node); continue; }
      const oldHTML = old.__patchHTML || old.outerHTML;
      if(!gk && oldHTML === freshHTML) continue;
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
  /* 每帧要改的节点在这里一次取好（kUpdateLive 不再每帧 querySelector） */
  kUI = {
    el, sig,
    n: {
      millBar: q('[data-bar="mill"]'),
      ovenBar: q('[data-bar="oven"]'),
      ovenBtn: q('[data-act="take"][data-station="oven"]'),
      potBar: q('[data-bar="pot"]'),
      potBtn: q('[data-act="take"][data-station="pot"]'),
    },
    s: {
      boardState: q('[data-state="board-x"]'), boardStock: q('[data-board-stock]'), chopBtn: q('[data-chop]'),
      millState: q('[data-state="mill-x"]'), grindBtn: q('[data-grind]'), millStock: q('[data-mill-stock]'),
      donkeyBtn: q('[data-dev="donkey"]'), chopperBtn: q('[data-dev="chopper"]'),
      potState: q('[data-state="pot-x"]'), potAuto: q('[data-cook="pot"]'),
      ovenState: q('[data-state="oven-x"]'), ovenStock: q('[data-oven-stock]'), ovenAuto: q('[data-cook="oven"]'),
    },
    st: {
      mill: q('.k-st-cv[data-st-ico="mill"]'), board: q('.k-st-cv[data-st-ico="board"]'),
      oven: q('.k-st-cv[data-st-ico="oven"]'), pot: q('.k-st-cv[data-st-ico="pot"]'),
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
  kUpdateStationAnim(0);        /* 刚建好的 <canvas> 立刻补上当前帧，不会先闪一下空白 */
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
  const w = (Math.max(0, Math.min(1, r)) * 100).toFixed(1) + '%';
  if(i.style.width !== w) i.style.width = w;          /* 静止时别每帧写样式 */
  if(bar.dataset.tone !== tone) bar.dataset.tone = tone || '';
}
function kSetState(node, tone, text){
  if(!node) return;
  if(node.__ktext !== text){ node.__ktext = text; node.innerHTML = text; }   /* 状态里可能带 SVG 图标 */
  if(node.dataset.tone !== tone){
    node.dataset.tone = tone;
    if(node.classList){ node.classList.remove('busy', 'ok', 'off', 'ready', 'perfect', 'burnt'); node.classList.add(tone); }
  }
}
/* 自动化按钮：开着 → 红底「停止」，关着 → 原来的名字 */
function kSetAutoBtn(btn, on, label){
  if(!btn) return;
  const text = on ? '停止' : label;
  if(btn.textContent !== text) btn.textContent = text;
  if(btn.classList) btn.classList.toggle('stop', !!on);
}
function kClock(ms){
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
/* 工位标题的状态字：自动化优先（已停 / 缺原料 / 正在加工），没买或到期才回落到手动提示。
 * 以前石磨只判断 autoActive（暂停了仍显示「自动磨面」），切菜板完全没看自动切块机，
 * 料斗一空还会误报「缺作物」——标题状态和下面的自动化行对不上。 */
function kAutoHeadState(id){
  if(!autoActive(id)) return null;
  if(autoPaused(id)) return { tone:'off', text:'已停 · 租期冻结 ' + kClock(autoLeftMs(id)) };
  const slot = autoSlotOf(id);
  if(!slot.length && !autoSlotCan(id)) return { tone:'off', text:'缺原料 · 剩余 ' + kClock(autoLeftMs(id)) };
  const dev = AUTO_DEVICES[id];
  const acc = (state.autoAcc && state.autoAcc[id]) || 0;
  const left = Math.max(0, (dev && dev.per ? dev.per : 0) - acc);
  return { tone:'busy', text:(id === 'donkey' ? '自动磨面' : '自动切块') +
    ' ×' + autoCountOf(id) + ' · ' + kSecText(left) };
}
/* 每帧的轻量刷新：状态字 / 进度条 / 按钮可用性（不重建 DOM，也不每帧查 DOM） */
function kUpdateLive(){
  if(!kUI || !kUI.n) return;
  const K = KITCHEN, n = kUI.n, s = kUI.s;

  /* ---- 切菜板（瞬发，没有进度条）---- */
  const crop = kHasCrop(), boardBusy = kBoardBusy();
  { const ah = kAutoHeadState('chopper');
    if(ah) kSetState(s.boardState, ah.tone, ah.text);
    else kSetState(s.boardState, boardBusy ? 'busy' : (crop ? 'ok' : 'off'),
      boardBusy ? '切菜中…' : (crop ? '就绪' : '缺作物'));
  }
  { const src = K.board && K.board.src;
    if(s.boardStock){ s.boardStock.textContent = '库存 ×' + (src ? (state.bag[src] || 0) : 0); s.boardStock.hidden = !src; }
    if(s.chopBtn) s.chopBtn.disabled = !src || (state.bag[src] || 0) <= 0;
  }

  /* ---- 石磨（手动瞬时；进度条只画「自动磨面」）---- */
  const wheat = millStock(), batch = millBatch();
  if(s.grindBtn) s.grindBtn.disabled = batch <= 0;
  if(s.millStock){ s.millStock.textContent = '库存 ×' + wheat; s.millStock.hidden = wheat <= 0; }
  kSetBar(n.millBar, kRatio(K.mill.t, K.mill.dur), autoPaused('donkey') ? 'idle' : (K.mill.busy ? 'run' : 'idle'));
  { const ah = kAutoHeadState('donkey');
    if(ah) kSetState(s.millState, ah.tone, ah.text);
    else kSetState(s.millState, wheat > 0 ? 'ok' : 'off', wheat > 0 ? '就绪（点一下磨 1 份）' : '缺小麦');
  }

  /* ---- 自动化设备（石磨 / 切菜板，都是工位里的一行）---- */
  kSetAutoBtn(s.donkeyBtn, autoActive('donkey') && !autoPaused('donkey'), '自动磨面');
  kSetAutoBtn(s.chopperBtn, autoActive('chopper') && !autoPaused('chopper'), '自动切块');

  /* ---- 锅 ---- */
  const potHas = K.pot.pieces.length > 0;
  if(!potHas){
    kSetBar(n.potBar, 0, 'idle');
    kSetState(s.potState, 'off', '空锅');
  } else {
    const q = K.pot.done ? gradeOf(K.pot.t, K.pot.dur, POT_PERFECT_MS, POT_BURN_MS) : null;
    kSetBar(n.potBar, kRatio(K.pot.t, K.pot.dur + POT_BURN_MS), q || 'run');
    if(!K.pot.done){
      kSetState(s.potState, 'busy', '炖煮中 · 还剩 ' + kSecText(K.pot.dur - K.pot.t) + ' 到精品窗口');
    } else if(q === 'perfect'){
      kSetState(s.potState, 'perfect', K_ICO_PERFECT + ' 精品窗口 ' + kSecText(K.pot.dur + POT_PERFECT_MS - K.pot.t));
    } else if(q === 'normal'){
      kSetState(s.potState, 'ready', '可出锅 · ' + kSecText(K.pot.dur + POT_BURN_MS - K.pot.t) + '后焦糊');
    } else {
      kSetState(s.potState, 'burnt', K_ICO_BURNT + ' 已焦糊');
    }
  }
  if(n.potBtn) n.potBtn.disabled = !(potHas && K.pot.done);
  kSetAutoBtn(s.potAuto, K.pot.auto, '自动烹饪');

  /* ---- 烤箱 ---- */
  const ovenN = (K.oven.items || []).length;
  if(s.ovenStock){ s.ovenStock.textContent = '队列 ×' + ovenN; s.ovenStock.hidden = ovenN <= 0; }
  const oTotal = K.oven.dur + OVEN_BURN_MS;
  if(K.oven.busy){
    if(!K.oven.ready){
      kSetBar(n.ovenBar, kRatio(K.oven.t, oTotal), 'run');
      kSetState(s.ovenState, 'busy', '烤制中 ' + kSecText(K.oven.dur - K.oven.t) +
        '（本轮 ' + ovenRoundSize() + '/' + ovenCap() + ' 份 · 队列 ' + ovenN + '）');
    } else {
      const q = gradeOf(K.oven.t, K.oven.dur, OVEN_PERFECT_MS, OVEN_BURN_MS);
      kSetBar(n.ovenBar, kRatio(K.oven.t, oTotal), q);
      if(q === 'perfect'){
        kSetState(s.ovenState, 'perfect', K_ICO_PERFECT + ' 精品窗口 ' + kSecText(K.oven.dur + OVEN_PERFECT_MS - K.oven.t));
      } else if(q === 'normal'){
        kSetState(s.ovenState, 'ready', '可出炉 · ' + kSecText(K.oven.dur + OVEN_BURN_MS - K.oven.t) + '后焦糊');
      } else {
        kSetState(s.ovenState, 'burnt', K_ICO_BURNT + ' 已焦糊');
      }
    }
  } else {
    kSetBar(n.ovenBar, 0, 'idle');
    const can = (state.prep.flour || 0) > 0;
    kSetState(s.ovenState, can ? 'ok' : 'off', can ? '可进炉' : '空');
  }
  if(n.ovenBtn) n.ovenBtn.disabled = !(K.oven.busy && K.oven.ready);
  kSetAutoBtn(s.ovenAuto, K.oven.auto, '自动烹饪');
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
  kStationBurst('board');
  kRestartAnim(st, 'k-chop');
  /* 切菜板工位里就是 .k-board-slot；找不到就弹工位本身 */
  const slot = st.querySelector ? (st.querySelector('.k-board-slot') || st) : null;
  if(slot){
    /* 换图标时把右下角的「换材料」提示一起补回来，别被 innerHTML 冲掉 */
    slot.innerHTML = kIconHTML(CROPS[srcId] ? ('crop:' + srcId) : srcId, K_ICON_SIZES.station) +
      (slot.classList && slot.classList.contains('k-board-slot') ? kSlotSwapHTML() : '');
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
  /* 工位图标的动画放在最后：本帧刚重建过 DOM 时，新的 <canvas> 当帧就补上图，不闪空白 */
  kUpdateStationAnim(dt);
}
/* 逻辑层静默完成的事情（石磨/菜板完工、自动出锅）在这里补上反馈 */
function kFrameEvents(visible){
  const K = KITCHEN;
  /* 石磨：按面粉数量变化飞，而不是按 busy 的上升/下降沿 ——
     暂停 / 到期时进度条会停住，但不该让面粉图标凭空飞出去。 */
  const flour = state.prep.flour || 0;
  if(visible && kPrev.flour != null && flour > kPrev.flour) kFlyFromStation('mill', 'prep:flour');
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
  kPrev.flour = state.prep.flour || 0;
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
  el.addEventListener('contextmenu', kOnKitchenContext);
  el.addEventListener('pointerdown', kOnPointerDown);
  window.addEventListener('pointermove', kOnPointerMove);
  window.addEventListener('pointerup', kOnPointerUp);
  window.addEventListener('pointercancel', kOnPointerCancel);
  /* 指针按下期间暂停整块重建：否则 click 可能落在被替换掉的按钮上 */
  document.addEventListener('pointerdown', () => { kHeldUntil = Date.now() + 2000; kAcc = 0; }, true);
  document.addEventListener('pointerup', () => { kHeldUntil = 0; kAcc = 999; }, true);
  /* 点菜单外面 / 滚动 / 改窗口大小 → 收起材料菜单（点槽位本身不算外面，交给槽位自己切换） */
  document.addEventListener('pointerdown', (e) => {
    if(!kPicker) return;
    const t = e.target;
    if(t && t.closest && (t.closest('.k-picker') || t.closest('[data-slot-pick]'))) return;
    kClosePicker();
  }, true);
  window.addEventListener('scroll', () => { if(kPicker) kClosePicker(); }, true);
  window.addEventListener('resize', () => { if(kPicker) kClosePicker(); });
}
/* 长按不呼出浏览器菜单（触屏） */
function kOnKitchenContext(e){ if(e && e.preventDefault) e.preventDefault(); }
/* 一次「点击」的统一分流（卡片 → 选中/取消；工位 → 投料/取出） */
function kHandleTap(t){
  if(!t || !t.closest) return;
  if(t.closest('.k-star') || t.closest('[data-act]')) return;
  /* 槽位优先：点一下就能选材料 */
  const slot = t.closest('[data-slot-pick]');
  if(slot){ kPickSlotMaterial(slot.dataset.slotPick, slot); return; }
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
  /* 切块：切槽位里那份作物（和「磨粉」对称；放上来的材料由点卡片 / 点槽位决定） */
  if(act === 'chop'){
    const src = (KITCHEN.board && KITCHEN.board.src) || '';
    if(!src){ toast('先点作物卡把材料放上来'); SFX.play('error'); return; }
    kDropItem('crop:' + src, 'board');
    return;
  }
  /* 自动化按钮：开着按一下 = 停，关着按一下 = 开 */
  if(act === 'auto-dev'){
    const id = btn.dataset.dev || '';
    /* 没买过自动设备：先提示去商店解锁，别只丢一句「还没买 / 已经到期」 */
    if(autoCountOf(id) <= 0){
      const dev = AUTO_DEVICES[id];
      toast('未解锁：先到商店「机器」买「自动' + dev.name + '」（' + dev.price + ' 金起，含 5 分钟租期）', 'gear');
      SFX.play('error');
      return;
    }
    const on = !(autoActive(id) && !autoPaused(id));
    const r = autoSetOn(id, on);
    if(r && r.ok) SFX.play('click'); else SFX.play('error');
    if(r && r.msg) toast(r.msg);
    if(kUI) kUI.sig = '';
    renderKitchen(); renderHUD();
    return;
  }
  if(act === 'auto-cook'){
    const s2 = btn.dataset.cook || '';
    if(s2 !== 'oven' && s2 !== 'pot') return;
    const on = !KITCHEN[s2].auto;
    KITCHEN[s2].auto = on;
    save();
    SFX.play('click');
    if(s2 === 'oven') toast(on ? '烤箱：烤好自动出炉（只会是正常）' : '烤箱：改回手动出炉');
    else toast(on ? '锅：好了自动出锅（只会是正常）' : '锅：改回手动出锅');
    if(kUI) kUI.sig = '';
    renderKitchen();
    return;
  }
  if(act === 'grind'){
    const r = mill(MILL_BATCH_MAX);
    if(r.ok){ SFX.play('mill'); toast(r.msg); kFlyFromStation('mill', 'prep:flour'); kStationBurst('mill'); }
    else { SFX.play('error'); toast(r.msg); }
    if(kUI) kUI.sig = '';
    renderKitchen(); renderHUD();
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
function kOnPointerDown(e){
  if(e.button != null && e.button !== 0) return;
  kSuppressClick = false;
  const t = e.target;
  if(!t || !t.closest) return;
  /* 按钮 / 收藏 / 勾选框不参与拖拽与工位点击，交给 click 处理 */
  if(t.closest('.k-star') || t.closest('[data-act]')) return;
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
  /* 等价于「点槽位」：单材料直接投，多材料弹菜单；返回 { ok, opened|closed } 或投料结果 */
  pickSlot(station){
    const el = kUI && kUI.el && kUI.el.querySelector ? kUI.el.querySelector('[data-slot-pick="' + station + '"]') : null;
    return kPickSlotMaterial(station, el);
  },
  /* 当前弹出的材料菜单（null = 没开） */
  picker(){ return kPicker ? { station:kPicker.station, el:kPicker.el } : null; },
  /* 幂等渲染一次（无头测试用；连调不会让 DOM 增长） */
  render(){ renderKitchen(); },
  /* 长按持续添加：手工触发一次（等价于按住不放走到的那一步） */
  repeatOnce(station){ kRepStation = station; return kRepeatOnce(); },
  repeatArmed(){ return !!kRepTimer || !!kRepIv; },
};
