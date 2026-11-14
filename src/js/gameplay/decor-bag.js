/* ============ 装饰物：回收进仓库 & 再放置 ============ */
/* ============ 装饰分两层 ============
 * ground 层：铺装（地砖/小路）与水塘这类「地面」；prop 层：树/石头/椅子/栅栏这类立体的。
 * 两层可以**同格共存**（地砖上摆椅子），但每层各自只能有一个：
 *   · 地砖可以盖在「玩家自己摆的」立体装饰下面，也能后摆立体装饰到地砖上
 *   · 地砖**不能**跟作物、以及野生的杂草/石头/树（scatterWeeds 撒出来的）同格
 * 判定就看装饰的 wild 标记 + 元数据里的 ground。 */
function decorLayer(type){
  const meta = DECOR_META[type];
  return (meta && meta.ground) ? 'ground' : 'prop';
}
function decorAt(gx, gy, layer){
  const list = state.decorations;
  if(layer === 'ground') return list.find(d => d.gx === gx && d.gy === gy && decorLayer(d.type) === 'ground') || null;
  if(layer === 'prop')   return list.find(d => d.gx === gx && d.gy === gy && decorLayer(d.type) === 'prop') || null;
  /* 不指定层：优先给「立体」那层（锄头先敲掉树，露出下面的地砖） */
  return list.find(d => d.gx === gx && d.gy === gy && decorLayer(d.type) === 'prop')
      || list.find(d => d.gx === gx && d.gy === gy) || null;
}
function decorGroundAt(gx, gy){ return decorAt(gx, gy, 'ground'); }
function decorPropAt(gx, gy){ return decorAt(gx, gy, 'prop'); }
/* 这一格能不能放下某种装饰（分层 + 野生阻挡规则） */
function canPlaceDecorAt(gx, gy, type){
  const meta = DECOR_META[type];
  if(!meta) return { ok:false, msg:'没有这种装饰' };
  const t = getTile(gx, gy);
  if(!t) return { ok:false, msg:'超出农场范围' };
  if(inFarm(gx, gy)) return { ok:false, msg:'耕地上不能摆装饰（用锄头可以先把地里的装饰收回）' };
  if(t.crop) return { ok:false, msg:'地里有作物' };
  const layer = decorLayer(type);
  const same = decorAt(gx, gy, layer);
  if(same) return { ok:false, msg: layer === 'ground' ? '这里已经铺了地砖/水塘' : '这里已经有装饰了' };
  if(layer === 'ground'){
    /* 地砖只能盖在「玩家自己摆的」立体装饰之下；野生的杂草/石头/树要先用锄头清掉 */
    const prop = decorAt(gx, gy, 'prop');
    if(prop && decorIsWild(prop)) return { ok:false, msg:`这里长着${DECOR_META[prop.type].name}，先用锄头清掉再铺` };
  }
  return { ok:true };
}
/* 直接收走（放置/迁移用，不消耗敲击次数） */
function collectDecorationAt(gx, gy, layer){
  const d = decorAt(gx, gy, layer);
  if(!d) return null;
  state.decorations = state.decorations.filter(x => x !== d);
  if(!decorIsFree(d.type)){                  /* 免费铺装不进仓库：否则「免费放 → 锄起来卖」能刷钱 */
    state.decorBag[d.type] = (state.decorBag[d.type] || 0) + 1;
  }
  trackAction('decor');                      /* decorGot 统计（有成就看这个） */
  return d;
}
/* 锄头敲一下装饰：按耐久扣血，敲光才收进仓库；返回 {left, removed, type} */
function hitDecorationAt(gx, gy, layer){
  const d = decorAt(gx, gy, layer);
  if(!d) return null;
  const max = decorMaxHp(d.type);
  if(typeof d.hp !== 'number') d.hp = max;
  d.hp -= 1;
  d.shakeUntil = Date.now() + 180;           /* 给绘制层一个"被敲"的抖动 */
  if(d.hp > 0) return { left: d.hp, removed: false, type: d.type };
  collectDecorationAt(gx, gy);
  return { left: 0, removed: true, type: d.type };
}
/* 摆放到空地：不能压着作物，也不能和已有装饰重叠；地块会被装饰占住（回到荒地） */
function placeDecor(gx, gy, type){
  const meta = DECOR_META[type];
  const okPlace = canPlaceDecorAt(gx, gy, type);
  if(!okPlace.ok) return okPlace;
  const t = getTile(gx, gy);
  const free = decorIsFree(type);
  if(!free){
    if((state.decorBag[type] || 0) <= 0) return { ok:false, msg:'仓库里没有' + meta.name };
    state.decorBag[type]--;
  }
  /* 玩家亲手摆的：wild=false → 对齐格子（椅子桌子水井都摆得整整齐齐） */
  const off = decorOffsetFor(type, 0, 0, false);
  state.decorations.push({ type, gx, gy, seed: (Math.random() * 999) | 0, hp: decorMaxHp(type),
                           ox: off.ox, oy: off.oy, wild: false });
  t.state = 'wild'; t.terrain = t.stone ? 'stone' : 'grass'; t.growth = 0;
  t.watered = false; t.fertile = false; t.crop = null; t.harvestsLeft = 0;
  if(meta.pave) trackAction('pave');           /* 每日任务有「铺 N 块」 */
  return { ok:true, msg:`摆好${meta.name}` };
}
/* ---------- 小路的连接面 ----------
 * 四位：1=上 2=右 4=下 8=左。默认自动（看四邻里有没有小路，并要求邻居也愿意接过来），
 * 玩家点一下已有小路就换成手动档位（十字 / 横向 / 纵向 / 单点），再点回自动。 */
const PATH_SIDES = [
  { dx: 0, dy: -1, bit: 1, back: 4 },
  { dx: 1, dy:  0, bit: 2, back: 8 },
  { dx: 0, dy:  1, bit: 4, back: 1 },
  { dx: -1, dy: 0, bit: 8, back: 2 },
];
/* 8 向：再加四个斜角（栅栏用得上，能拐弯、能围成菱形） */
const DIAG_SIDES = [
  { dx: 1, dy: -1, bit: 16,  back: 64 },
  { dx: 1, dy:  1, bit: 32,  back: 128 },
  { dx: -1, dy: 1, bit: 64,  back: 16 },
  { dx: -1, dy: -1, bit: 128, back: 32 },
];
function connDirs(type){
  const m = DECOR_META[type];
  return (m && m.connect === 8) ? PATH_SIDES.concat(DIAG_SIDES) : PATH_SIDES;
}
function connMaskOf(d){
  const full = (1 << connDirs(d.type).length) - 1;
  if(DECOR_META[d.type] && DECOR_META[d.type].full) return full;   /* 瓷砖/大理石铺满整格 */
  if(typeof d.conn === 'number' && d.conn >= 0) return d.conn & full;
  let m = 0;
  for(const sd of connDirs(d.type)){
    const n = decorAt(d.gx + sd.dx, d.gy + sd.dy);
    if(!n || n.type !== d.type) continue;
    const nm = (typeof n.conn === 'number' && n.conn >= 0)
      ? (n.conn & full)
      : rawMaskOf(n.gx, n.gy, d.type, true);
    if(nm & sd.back) m |= sd.bit;
  }
  return m;
}
function rawMaskOf(gx, gy, type, shallow){
  let m = 0;
  for(const sd of connDirs(type)){
    const n = decorAt(gx + sd.dx, gy + sd.dy);
    if(n && n.type === type) m |= sd.bit;
  }
  return m;
}
function paveIs(type){ const m = DECOR_META[type]; return !!(m && m.ground && m.pave); }
function pathRawMask(gx, gy, type){ return rawMaskOf(gx, gy, type || 'path'); }
function pathConnMask(d){ return d ? connMaskOf(d) : 0; }
function fenceConnMask(d){ return d ? connMaskOf(d) : 0; }
const PATH_CONN_MODES = [
  { v: -1, name: '自动连接' },
  { v: 15, name: '十字' },
  { v: 10, name: '横向' },
  { v: 5,  name: '纵向' },
  { v: 0,  name: '单点' },
];
const CONN8_MODES = [
  { v: -1,  name: '自动连接' },
  { v: 255, name: '八向全连' },
  { v: 15,  name: '四向十字' },
  { v: 170, name: '四个斜角' },
  { v: 10,  name: '横向' },
  { v: 5,   name: '纵向' },
  { v: 0,   name: '单点' },
];
function connModesOf(type){ return connDirs(type).length === 8 ? CONN8_MODES : PATH_CONN_MODES; }
/* 点一下已有小路/砖路/栅栏 → 换下一个连接档位（能连的都能改） */
function cyclePathConn(gx, gy){
  const d = decorAt(gx, gy);
  if(!d) return null;
  const meta = DECOR_META[d.type];
  if(!meta || !meta.connect) return null;           /* 铺满整格的/不能连的：不参与 */
  const modes = connModesOf(d.type);
  const cur = (typeof d.conn === 'number') ? d.conn : -1;
  let i = modes.findIndex(m => m.v === cur);
  if(i < 0) i = 0;
  const next = modes[(i + 1) % modes.length];
  if(next.v < 0) delete d.conn; else d.conn = next.v;
  return next;
}

/* 新买的地会长出杂草/石头等装饰物：按坐标 hash 决定，确定性可复现。
   farm 行概率高一点，石头地面低一点。锄头一锄既能清掉它、也能顺便开垦。 */
const WEED_TABLE = [
  { type:'bush',      w:32 },
  { type:'rock',      w:28 },
  { type:'flower',    w:16 },
  { type:'mushroom',  w:9  },
  { type:'pine',      w:6  },
  { type:'bamboo',    w:5  },
  { type:'sunflower', w:4  },
];
function pickWeed(h){
  let acc = 0;
  for(const it of WEED_TABLE){ acc += it.w; if(h * 100 < acc) return it.type; }
  return 'bush';
}
function scatterWeeds(tiles, chance, st){
  /* st 可选：读档迁移时要在「还没挂上去的新档对象」上撒杂物，所以不能写死全局 state */
  const S = st || state;
  let n = 0;
  for(const t of tiles){
    if(S.decorations.some(d => d.gx === t.gx && d.gy === t.gy)) continue;
    const h = hash2(t.gx * 7 + 13, t.gy * 11 + 29);
    if(h > (chance == null ? 0.45 : chance)) continue;
    const type = pickWeed(hash2(t.gx * 31 + 7, t.gy * 17 + 3));
    const off = decorOffsetFor(type, hash2(t.gx * 13 + 5, t.gy * 19 + 7), hash2(t.gx * 29 + 3, t.gy * 31 + 11), true);
    S.decorations.push({ type, gx:t.gx, gy:t.gy, seed:(hash2(t.gx, t.gy) * 999) | 0, hp: decorMaxHp(type),
                         ox: off.ox, oy: off.oy, wild: true });
    n++;
  }
  return n;
}
/* 卖装饰物（从装饰仓库换金币） */
function sellDecor(type, qty){
  const have = state.decorBag[type] || 0;
  const n = Math.max(0, Math.min(qty, have));
  if(n <= 0) return 0;
  const gain = n * (DECOR_SELL[type] || 0);
  state.decorBag[type] -= n;
  state.coins += gain;
  trackAction('coins', gain);
  return gain;
}
/* 装饰在格子里的偏移：散布到四角附近，避免全部压在正中 */
/* 地面装饰（小路/水塘）必须**对齐格子**才铺得整齐，不给随机偏移；
   立体的树/石头等才用偏移，免得整齐得像贴纸。 */
function decorOffsetFor(type, h1, h2, wild){
  const meta = DECOR_META[type];
  if(meta && meta.ground) return { ox: 0, oy: 0 };      /* 地面铺装必须对齐 */
  if(!wild) return { ox: 0, oy: 0 };                    /* 玩家自己摆的也一律对齐 */
  return decorOffset(h1, h2);
}
function decorOffset(h1, h2){
  let ox = (h1 * 2 - 1) * 17;        /* ±17px：左顶点 ~ 右顶点之间 */
  let oy = (h2 * 2 - 1) * 7;         /* ±7px：上/下方向少量 */
  /* 正中会正好压住作物，留出空档：偏移过小就推到一侧 */
  if (Math.abs(ox) < 5) ox = (h1 >= 0.5 ? 1 : -1) * (5 + Math.abs(ox) * 0.6);
  if (Math.abs(oy) < 2.5) oy = (h2 >= 0.5 ? 1 : -1) * (2.5 + Math.abs(oy) * 0.5);
  return { ox: Math.round(ox), oy: Math.round(oy) };
}
function decorBagTotal(){
  return DECOR_IDS.reduce((a, id) => a + (state.decorBag[id] || 0), 0);
}
