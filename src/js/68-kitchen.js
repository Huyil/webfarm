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
let kPrev = { millBusy:false, boardBusy:false, boardSrc:null, ovenBusy:false,
              potLen:0, potPieces:[], dishes:0 };
const K_ICON_CACHE = Object.create(null);
const K_ICON_SIZES = { card:42, station:38, dish:30, ghost:46, pot:22 };
const K_TAP_SLOP = 8;           // 位移 <8px 视为点击（容忍手指抖动）
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

/* 拖拽/测试共用的投料入口：完全等价于「把货架上的 itemKey 拖到 station」 */
function kDropItem(itemKey, station){
  const check = kDropCheck(itemKey, station);
  if(!check.ok){ toast(check.msg); SFX.play('error'); return { ok:false, msg:check.msg }; }
  const raw = String(itemKey);
  const id = raw.slice(raw.indexOf(':') + 1);
  const kind = raw.slice(0, raw.indexOf(':'));
  let res;
  if(station === 'mill'){
    res = mill();
    if(res.ok) SFX.play('mill');
  } else if(station === 'oven'){
    res = ovenPut(kind === 'piece' ? { piece:id } : undefined);
    if(res.ok) SFX.play('cook');
  } else if(station === 'board'){
    res = boardPut(id);
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
    save(); renderHUD();
  }
  renderKitchen();
  kDropFx(itemKey, station, res);      // 重建之后再放动画，节点才是新的
  return res;
}

/* 取出（手动；小游戏关闭时按自动处理，永远只出「正常」） */
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
    mill: { busy:K.mill.busy, t:K.mill.t, dur:K.mill.dur, progress:kRatio(K.mill.t, K.mill.dur), can:canMill() },
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
  if(it) txt = '✅ 已选 ' + it.name + ' ×' + it.n + ' · 连点工位连续投入，再点卡片取消';
  else if(kSel) txt = '✅ 已选 ' + kItemLabel(kSel) + '（货架已用完）· 可换选别的食材';
  else txt = '👆 点一下卡片选中，之后连点工位即可快速投料 / 切菜';
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
function kKitchenSig(){
  const K = KITCHEN;
  const shelf = kitchenShelf().map(it => it.key + ':' + it.n + (state.fav && state.fav[it.key] ? '*' : '')).join(',');
  const dishes = Object.keys(state.dishes).map(k => k + ':' + state.dishes[k].n).join(',');
  return [
    shelf, dishes, kPiecesSummary(),
    K.mill.busy ? 1 : 0,
    K.oven.busy ? 1 : 0, K.oven.ready ? 1 : 0, K.oven.auto ? 1 : 0,
    kBoardBusy() ? 1 : 0, (K.board && K.board.src) || '',
    K.pot.pieces.join('.'), K.pot.done ? 1 : 0, K.pot.auto ? 1 : 0,
    state.prep.flour || 0, state.bag.wheat || 0,
    state.miniGameEnabled === false ? 0 : 1,
  ].join('|');
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
      <div class="k-st-head"><span class="k-st-ico">🪨</span><span class="k-st-name">石磨</span><span class="k-st-state" data-state="mill"></span></div>
      <div class="k-st-body">
        <div class="k-mill"><div class="k-mill-wheel" data-wheel="mill"></div></div>
        <div class="k-st-flow">${kIconHTML('crop:wheat', 26)}<span class="k-arrow">→</span>${kIconHTML('prep:flour', 26)}</div>
      </div>
      <div class="k-progress" data-bar="mill"><i></i></div>
      <div class="k-st-hint">拖入小麦自动开磨（${kSecText(K.mill.dur)}）</div>
    </div>`;
}
/* 烤箱里正在烤的东西 → 图标 key */
function kOvenSlotKey(){
  const it = KITCHEN.oven.item;
  if(it && it.type === 'piece') return 'dish:roast|normal|' + it.id;
  return 'dish:bread|normal|flour';
}
function kPieceStock(){ let n = 0; for(const id of CROP_IDS) n += (state.pieces[id] || 0); return n; }
/* 三段进度条刻度：可收 / 精品窗口结束 / 焦糊 三个分界
 * 注意：焦糊刻度要贴在**最右端**（dur+burn = 走满）。以前把它错标在
 * (dur+perfect) 即 50% 的位置，看起来就像"走到一半就该焦糊"。 */
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
  return `
    <div class="k-station" data-station="oven">
      <div class="k-st-head"><span class="k-st-ico">🔥</span><span class="k-st-name">烤箱</span><span class="k-st-state" data-state="oven"></span></div>
      <div class="k-st-body">
        <div class="k-slot k-oven-slot">${K.oven.busy ? kIconHTML(kOvenSlotKey(), K_ICON_SIZES.station) : '<span class="k-slot-empty">空</span>'}</div>
        <div class="k-st-info">
          <div class="k-st-line">🥣 面粉 ×${state.prep.flour || 0} · 🔪 菜块 ×${kPieceStock()}</div>
          <label class="k-check"><input type="checkbox" data-auto="oven" ${K.oven.auto ? 'checked' : ''}><span>自动出炉（只会是正常）</span></label>
        </div>
      </div>
      <div class="k-progress k-seg3" data-bar="oven">${kSegTicks(OVEN_MS, OVEN_PERFECT_MS, OVEN_BURN_MS)}<i></i></div>
      <div class="k-st-actions">
        <button class="mini primary" data-act="take" data-station="oven">出炉</button>
        <span class="k-st-hint">手动出炉才可能出精品</span>
      </div>
    </div>`;
}
function kStationBoardHTML(){
  const K = KITCHEN;
  const src = K.board && K.board.src;
  const slot = src ? kIconHTML('crop:' + src, K_ICON_SIZES.station) : '<span class="k-slot-empty">点作物卡后再点这里</span>';
  return `
    <div class="k-station" data-station="board">
      <div class="k-st-head"><span class="k-st-ico">🔪</span><span class="k-st-name">切菜板</span><span class="k-st-state" data-state="board"></span></div>
      <div class="k-st-body">
        <div class="k-slot k-board-slot">${slot}</div>
        <div class="k-st-info"><div class="k-st-line">🍴 菜块：${kEsc(kPiecesSummary())}</div></div>
      </div>
      <div class="k-st-hint">瞬发：点一下作物卡 → 连点这里，每点「咔」出 ${CHOP_PIECES} 块菜块</div>
    </div>`;
}
function kStationPotHTML(){
  const K = KITCHEN;
  const has = K.pot.pieces.length > 0;
  const chips = has
    ? K.pot.pieces.map(id => '<span class="k-chip">' + kIconHTML('piece:' + id, K_ICON_SIZES.pot) + '</span>').join('')
    : '<span class="k-slot-empty">拖入菜块 / 大米</span>';
  const pv = has ? potRecipe(K.pot.pieces) : null;
  return `
    <div class="k-station" data-station="pot">
      <div class="k-st-head"><span class="k-st-ico">🍲</span><span class="k-st-name">锅</span><span class="k-st-state" data-state="pot"></span></div>
      <div class="k-st-body">
        <div class="k-pot-slot">${chips}</div>
        <div class="k-st-info">
          <div class="k-st-line">${pv ? '＝ ' + kEsc(pv.name) + '（基础 ' + pv.base + ' 金）' : '每加一样食材，进度条会重置'}</div>
          <label class="k-check"><input type="checkbox" data-auto="pot" ${K.pot.auto ? 'checked' : ''}><span>自动出锅（只会是正常）</span></label>
        </div>
      </div>
      <div class="k-progress k-seg3" data-bar="pot">${kSegTicks(POT_MS, POT_PERFECT_MS, POT_BURN_MS)}<i></i></div>
      <div class="k-st-actions">
        <button class="mini primary" data-act="take" data-station="pot">出锅</button>
        <span class="k-st-hint">${state.miniGameEnabled === false ? '小游戏已关：直接出正常' : kSecText(K.pot.dur) + ' 走完即可出锅'}</span>
      </div>
    </div>`;
}
function kDishListHTML(){
  const keys = Object.keys(state.dishes);
  if(!keys.length){
    return '<div class="empty">还没有做好的菜 🍳<br><span class="r-meta">烤箱烤面包、锅里自由配菜都能做出菜</span></div>';
  }
  let rows = '';
  for(const key of keys){
    const d = state.dishes[key];
    const q = QUALITY[d.quality] || QUALITY.normal;
    const pieces = (d.pieces || []).map(itemName).join(' + ') || '—';
    rows += `
      <div class="row k-dish-row">
        <div class="r-ico k-dish-ico">${kIconHTML('dish:' + key, K_ICON_SIZES.dish)}</div>
        <div class="k-dish-main">
          <div class="r-name">${kEsc(d.name)}${d.qtag ? ' ' + d.qtag : ''}<span class="tag">${kEsc(q.name)}</span></div>
          <div class="r-meta">${kEsc(pieces)} · 单价 ${d.value} 金</div>
        </div>
        <div class="r-count">×${d.n}</div>
        <button class="mini sell" data-act="sell" data-key="${kEsc(key)}" data-n="1">卖1</button>
        <button class="mini sell" data-act="sell" data-key="${kEsc(key)}" data-n="${d.n}">全卖</button>
      </div>`;
  }
  rows += `<div class="k-actions"><button class="mini sell" data-act="sellall">💸 一键全卖（+${kDishValueTotal()} 金）</button></div>`;
  return rows;
}
function kKitchenHTML(){
  const shelf = kitchenShelf();
  const cards = shelf.length
    ? shelf.map(kShelfCardHTML).join('')
    : '<div class="empty">货架空空 🧺<br><span class="r-meta">收获的作物、切好的菜块、磨好的面粉都会出现在这里</span></div>';
  const banner = state.miniGameEnabled === false
    ? '<div class="k-banner">🎛️ 小游戏已关闭：取出动作一律按自动处理（永远「正常」，没有精品 / 焦糊判定）</div>'
    : '';
  return `
    <div class="k-wrap">
      ${banner}
      <section class="k-shelf">
        <div class="k-sec-title">🧺 食材货架<span class="k-hint">拖到工位 · 或点一下选中后连点工位 · 点 ★ 收藏</span></div>
        <div class="k-cards">${cards}</div>
        <div class="k-selected" data-selbar>
          <span data-seltext></span>
          <button class="k-selclear" type="button" data-act="unsel">✕ 取消选中</button>
        </div>
      </section>
      <section class="k-stations">
        ${kStationMillHTML()}
        ${kStationOvenHTML()}
        ${kStationBoardHTML()}
        ${kStationPotHTML()}
      </section>
      <section class="k-dishes">
        <div class="k-sec-title">🍽️ 菜品仓库<span class="k-hint">总价值 ${kDishValueTotal()} 金 · 共 ${dishTotal()} 份</span></div>
        ${kDishListHTML()}
      </section>
    </div>`;
}
/* 逐块替换：HTML 完全没变的 section 直接保留旧节点。
 * 这样「放入 / 出锅」只会更新食材货架与工位两块，
 * 菜品仓库那一片（图标是 canvas 画出来的）不会跟着重画，不闪、不跳、不丢滚动位置。 */
function kPatchHTML(el, html){
  const tpl = document.createElement('div');
  tpl.innerHTML = html;
  const freshWrap = tpl.firstElementChild;
  if(!freshWrap){ el.innerHTML = html; return; }
  const oldWrap = el.firstElementChild;
  if(!oldWrap || oldWrap.tagName !== freshWrap.tagName){ el.innerHTML = html; return; }
  /* 在 .k-wrap 这一层做逐块对比 */
  const fresh = Array.prototype.slice.call(freshWrap.children);
  const olds = Array.prototype.slice.call(oldWrap.children);
  for(let i = 0; i < fresh.length; i++){
    const node = fresh[i], old = olds[i];
    if(old && old.tagName === node.tagName && old.outerHTML === node.outerHTML) continue;  /* 一模一样：保留旧节点 */
    if(old) oldWrap.replaceChild(node, old);
    else oldWrap.appendChild(node);
  }
  for(let i = fresh.length; i < olds.length; i++) oldWrap.removeChild(olds[i]);
}
function kBuildKitchen(el, sig){
  const box = el.closest ? el.closest('.modal-box') : null;
  const scrollTop = box ? box.scrollTop : 0;
  kPatchHTML(el, kKitchenHTML());
  const q = s => el.querySelector(s);
  kUI = {
    el, sig,
    n: {
      millBar: q('[data-bar="mill"]'), millWheel: q('[data-wheel="mill"]'), millState: q('[data-state="mill"]'),
      ovenBar: q('[data-bar="oven"]'), ovenState: q('[data-state="oven"]'),
      ovenBtn: q('[data-act="take"][data-station="oven"]'),
      boardState: q('[data-state="board"]'),
      potBar: q('[data-bar="pot"]'), potState: q('[data-state="pot"]'),
      potBtn: q('[data-act="take"][data-station="pot"]'),
    },
  };
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
function kSetState(node, tone, text){
  if(!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
  if(node.classList){ node.classList.remove('busy', 'ok', 'off', 'ready', 'perfect', 'burnt'); node.classList.add(tone); }
}
/* 每帧的轻量刷新：进度条 / 转盘 / 状态字 / 按钮可用性（不重建 DOM） */
function kUpdateLive(){
  if(!kUI || !kUI.n) return;
  const K = KITCHEN, n = kUI.n;
  /* 石磨 */
  const millR = kRatio(K.mill.t, K.mill.dur);
  kSetBar(n.millBar, millR, K.mill.busy ? 'run' : 'idle');
  if(n.millWheel){
    n.millWheel.style.transform = 'rotate(' + Math.round(K.mill.busy ? millR * 720 : 0) + 'deg)';
    if(n.millWheel.classList) n.millWheel.classList.toggle('spin', K.mill.busy);
  }
  if(K.mill.busy) kSetState(n.millState, 'busy', '磨面中 ' + kSecText(K.mill.dur - K.mill.t));
  else kSetState(n.millState, (state.bag.wheat || 0) > 0 ? 'ok' : 'off', (state.bag.wheat || 0) > 0 ? '就绪' : '缺小麦');
  /* 烤箱 */
  if(K.oven.busy){
    const oTotal = K.oven.dur + OVEN_BURN_MS;
    if(!K.oven.ready){
      kSetBar(n.ovenBar, kRatio(K.oven.t, oTotal), 'run');
      kSetState(n.ovenState, 'busy', '烤制中 ' + kSecText(K.oven.dur - K.oven.t));
    } else {
      const q = gradeOf(K.oven.t, K.oven.dur, OVEN_PERFECT_MS, OVEN_BURN_MS);
      kSetBar(n.ovenBar, kRatio(K.oven.t, oTotal), q);
      if(q === 'perfect')      kSetState(n.ovenState, 'perfect', '✨ 精品窗口 ' + kSecText(K.oven.dur + OVEN_PERFECT_MS - K.oven.t));
      else if(q === 'normal')  kSetState(n.ovenState, 'ready', '可出炉 · ' + kSecText(K.oven.dur + OVEN_BURN_MS - K.oven.t) + '后焦糊');
      else                     kSetState(n.ovenState, 'burnt', '🔥 已焦糊');
    }
  } else {
    kSetBar(n.ovenBar, 0, 'idle');
    kSetState(n.ovenState, (state.prep.flour || 0) > 0 ? 'ok' : 'off', (state.prep.flour || 0) > 0 ? '可进炉' : '空');
  }
  if(n.ovenBtn) n.ovenBtn.disabled = !(K.oven.busy && K.oven.ready);
  /* 切菜板：瞬时产出，没有进度条——反馈靠投入时的「咔」动画 */
  const crop = kHasCrop();
  if(kBoardBusy()) kSetState(n.boardState, 'busy', '切菜中…');
  else kSetState(n.boardState, crop ? 'ok' : 'off', crop ? '就绪' : '缺作物');
  /* 锅 */
  if(K.pot.pieces.length){
    const pTotal = K.pot.dur + POT_BURN_MS;
    if(!K.pot.done){
      kSetBar(n.potBar, kRatio(K.pot.t, pTotal), 'run');
      kSetState(n.potState, 'busy', '炖煮中 · 还剩 ' + kSecText(K.pot.dur - K.pot.t) + ' 到精品窗口');
    } else {
      const q = gradeOf(K.pot.t, K.pot.dur, POT_PERFECT_MS, POT_BURN_MS);
      kSetBar(n.potBar, kRatio(K.pot.t, pTotal), q);
      if(q === 'perfect')     kSetState(n.potState, 'perfect', '✨ 精品窗口 ' + kSecText(K.pot.dur + POT_PERFECT_MS - K.pot.t));
      else if(q === 'normal') kSetState(n.potState, 'ready', '可出锅 · ' + kSecText(K.pot.dur + POT_BURN_MS - K.pot.t) + '后焦糊');
      else                    kSetState(n.potState, 'burnt', '🔥 已焦糊');
    }
  } else {
    kSetBar(n.potBar, 0, 'idle');
    kSetState(n.potState, 'off', '空锅');
  }
  if(n.potBtn) n.potBtn.disabled = !(K.pot.pieces.length > 0 && K.pot.done);
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
  const slot = st.querySelector ? st.querySelector('.k-board-slot') : null;
  if(slot){
    slot.innerHTML = kIconHTML('crop:' + srcId, K_ICON_SIZES.station);
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
    kFlyFromStation('board', 'piece:' + srcId, () => { kFlyN--; });
  }
}
function kFlyFromStation(station, key, onDone){
  const done = () => { if(onDone){ const f = onDone; onDone = null; f(); } };
  if(!kUI || !kUI.el || !kUI.el.querySelector){ done(); return; }
  const from = kUI.el.querySelector('.k-station[data-station="' + station + '"]');
  const to = kUI.el.querySelector('.k-shelf') || kUI.el.querySelector('.k-dishes');
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
  kPrev.potPieces = K.pot.pieces.slice();
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
  if(t.closest('.k-star') || t.closest('[data-act]') || t.closest('.k-check')) return;
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
  const st = box && box.dataset ? box.dataset.auto : '';
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
  if(t.closest('.k-star') || t.closest('[data-act]') || t.closest('.k-check')) return;
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
  kAcc = 0;
}
function kOnPointerMove(e){
  if(!kDrag || e.pointerId !== kDrag.id) return;
  if(!kDrag.active){
    if(Math.hypot(e.clientX - kDrag.sx, e.clientY - kDrag.sy) < K_TAP_SLOP) return;
    if(!kDrag.draggable){ kDrag = null; return; }   // 工位上的滑动 = 滚动页面，不算点击
    kDrag.active = true;
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
  kDropHighlight(null, d.key);
  kClearPressing(d.key);
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
};
