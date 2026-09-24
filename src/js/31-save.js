/* ============ 存档：3 槽位 ============ */
function slotKey(n){ return SAVE_PREFIX + n; }

/* 只打包需要持久化的字段 */
function serialize(st){
  return {
    v: SAVE_VER, savedAt: Date.now(),
    coins: st.coins, fertilizer: st.fertilizer, premium: st.premium,
    bag: st.bag, pieces: st.pieces, prep: st.prep, dishes: st.dishes,
    decorBag: st.decorBag,
    map: st.map, farm: st.farm, expandCount: st.expandCount, upExpand: st.upExpand,
    zoomMode: st.zoomMode, cameraAuto: st.cameraAuto,
    tool: st.tool, selectedSeed: st.selectedSeed, selectedDecor: st.selectedDecor,
    camera: st.camera, showGrid: st.showGrid, sidePanelY: st.sidePanelY, sidePanelVer: st.sidePanelVer,
    warehouseEnabled: st.warehouseEnabled,
    soundEnabled: st.soundEnabled, particlesEnabled: st.particlesEnabled,
    effectsEnabled: st.effectsEnabled, miniGameEnabled: st.miniGameEnabled,
    fav: st.fav,
    stats: st.stats, achievements: st.achievements, achClaimed: st.achClaimed, tasks: st.tasks,
    noticeRead: st.noticeRead, achRead: st.achRead, taskRead: st.taskRead,
    playerName: st.playerName, playerId: st.playerId, lbSort: st.lbSort, lbLastSubmit: st.lbLastSubmit,
    player: st.player, decorations: st.decorations,
    idle: st.idle, clockMs: st.clockMs,
    /* 厨房勾选状态住在模块常量 KITCHEN 里，存档时镜像进来 */
    kitchenAuto: { oven: !!(typeof KITCHEN !== 'undefined' && KITCHEN.oven.auto),
                   pot: !!(typeof KITCHEN !== 'undefined' && KITCHEN.pot.auto),
                   ovenLoop: !!(typeof KITCHEN !== 'undefined' && KITCHEN.oven.autoLoop),
                   potLoop: !!(typeof KITCHEN !== 'undefined' && KITCHEN.pot.autoLoop) },
    autoUntil: st.autoUntil, autoAcc: st.autoAcc,
    tiles: st.tiles.map(t=>({
      gx: t.gx, gy: t.gy, terrain: t.terrain, state: t.state, crop: t.crop,
      growth: Math.round(t.growth), watered: !!t.watered, fertile: !!t.fertile,
      harvestsLeft: t.harvestsLeft || 0, stone: !!t.stone,
    })),
  };
}

/* 读旧版存档（v81/v90）也能吃：缺的字段一律回落到新默认值 */
function unpackState(d){
  if(!d || !Array.isArray(d.tiles)) return null;
  /* 地图尺寸：新档带 map，旧档按 14×14 推断 */
  const map = (d.map && d.map.w > 0 && d.map.h > 0)
    ? { x0:d.map.x0|0, y0:d.map.y0|0, w:d.map.w|0, h:d.map.h|0 }
    : { x0:0, y0:0, w:MAP_W, h:MAP_H };
  if(d.tiles.length !== map.w * map.h) return null;
  const st = newState();
  st.map = map;
  st.expandCount = (d.expandCount && typeof d.expandCount === 'object')
    ? Object.assign({ xn:0, yn:0, xp:0, yp:0 }, d.expandCount)
    : { xn:0, yn:0, xp:0, yp:0 };
  st.upExpand = Object.assign({ xn:0, yn:0 }, d.upExpand || {});
  st.zoomMode = (d.zoomMode === 1 || d.zoomMode === 2 || d.zoomMode === 'auto') ? d.zoomMode : 'auto';
  st.cameraAuto = d.cameraAuto !== false;
  /* 耕地范围：新档带 farm；旧档用「已开垦地块的外接矩形」兜底，尽量不让老玩家的田荒掉 */
  if(d.farm && d.farm.w > 0 && d.farm.h > 0){
    st.farm = { x0:d.farm.x0|0, y0:d.farm.y0|0, w:d.farm.w|0, h:d.farm.h|0 };
  } else {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for(const t of d.tiles){
      if(t.terrain === 'tilled' || t.state === 'tilled' || t.crop){
        x0 = Math.min(x0, t.gx); y0 = Math.min(y0, t.gy);
        x1 = Math.max(x1, t.gx); y1 = Math.max(y1, t.gy);
      }
    }
    st.farm = (x0 === Infinity) ? { x0:FARM0.x0, y0:FARM0.y0, w:FARM0.w, h:FARM0.h }
                                : { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  st.coins = typeof d.coins==='number' ? d.coins : START_COINS;
  st.fertilizer = typeof d.fertilizer==='number' ? d.fertilizer : 0;
  st.premium = typeof d.premium==='number' ? d.premium : 0;
  st.bag = Object.assign({carrot:0,potato:0,rice:0,wheat:0,chili:0,eggplant:0,tomato:0}, d.bag||{});
  st.pieces = Object.assign({}, d.pieces||{});
  st.prep = Object.assign({flour:0}, d.prep||{});
  st.dishes = d.dishes || {};
  st.decorBag = Object.assign({tree:0,rock:0,bush:0,flower:0,pond:0,path:0}, d.decorBag||{});
  st.tool = TOOLS.includes(d.tool) ? d.tool : 'hoe';
  st.selectedSeed = (d.selectedSeed && CROPS[d.selectedSeed]) ? d.selectedSeed : 'carrot';
  st.selectedDecor = DECOR_META[d.selectedDecor] ? d.selectedDecor : 'tree';
  if(d.camera) st.camera = { x: d.camera.x||0, y: d.camera.y||0 };
  st.showGrid = !!d.showGrid;
  st.sidePanelY = (typeof d.sidePanelY === 'number') ? d.sidePanelY : null;
  st.sidePanelVer = d.sidePanelVer | 0;
  st.warehouseEnabled = d.warehouseEnabled !== false;
  st.soundEnabled = d.soundEnabled !== false;
  st.particlesEnabled = d.particlesEnabled !== false;
  st.effectsEnabled = d.effectsEnabled !== false;
  st.miniGameEnabled = d.miniGameEnabled !== false;
  st.fav = d.fav || {};
  st.stats = d.stats || newStats();
  if(!st.stats.total) st.stats = newStats();
  const T = st.stats.total, D = st.stats.today || {};
  for(const k of ['idle','mill','chop','cook','perfect','premium','burnt','expand','decorGot','sold','roast','tasksDone']) if(typeof T[k] !== 'number') T[k] = 0;
  if(!T.cropTypes) T.cropTypes = {};
  if(!T.dishTypes) T.dishTypes = {};
  for(const k of ['mill','chop','cook','premium','perfect','expand','roast','decor']) if(typeof D[k] !== 'number') D[k] = 0;
  st.stats.today = D;
  st.achievements = d.achievements || {};
  st.achClaimed = d.achClaimed || {};
  st.tasks = d.tasks || { date: null, list: [] };
  st.noticeRead = d.noticeRead || {};
  st.achRead = !!d.achRead;
  st.playerName = typeof d.playerName === 'string' ? d.playerName : '';
  st.playerId = typeof d.playerId === 'string' ? d.playerId : '';
  st.lbSort = LB_METRICS.some(m => m.id === d.lbSort) ? d.lbSort : 'coins';
  st.lbLastSubmit = d.lbLastSubmit | 0;
  st.taskRead = d.taskRead !== false;
  if(d.player) st.player = Object.assign(st.player, d.player, { moving:false, actionType:null });
  st.player.x = st.player.gx; st.player.y = st.player.gy;
  st.decorations = (Array.isArray(d.decorations) ? d.decorations : DEFAULT_DECORATIONS.map(x=>({...x})))
    .map(x => {
      const meta = DECOR_META[x.type];
      /* 老存档没有 wild 标记：按类型推断（草/石/花/树/蘑菇/竹子/松树/向日葵 = 自然长出来的） */
      const wild = (typeof x.wild === 'boolean') ? x.wild
                 : (!!meta && !meta.ground && decorIsNatural(x.type));
      const off = decorOffsetFor(x.type, hash2((x.gx||0) * 13 + 5, (x.gy||0) * 19 + 7),
                                 hash2((x.gx||0) * 29 + 3, (x.gy||0) * 31 + 11), wild);
      return { ...x, wild, hp: (typeof x.hp === 'number') ? x.hp : decorMaxHp(x.type),
               ox: wild ? ((typeof x.ox === 'number') ? x.ox : off.ox) : 0,
               oy: wild ? ((typeof x.oy === 'number') ? x.oy : off.oy) : 0 };
    });
  st.idle = Object.assign({ lastAt: Date.now(), frac: 0, total: 0 }, d.idle||{});
  st.clockMs = typeof d.clockMs === 'number' ? d.clockMs : DAY_MS * 0.16;
  st.kitchenAuto = Object.assign({ oven:false, pot:false, ovenLoop:false, potLoop:false }, d.kitchenAuto || {});
  st.autoUntil = Object.assign({ donkey:0, chopper:0 }, d.autoUntil || {});
  st.autoAcc = Object.assign({ donkey:0, chopper:0 }, d.autoAcc || {});
  st.tiles = d.tiles.map(t=>{
    const tt = newTile(t.gx, t.gy, t.terrain, t.stone);
    tt.state = t.state || 'wild';
    tt.crop = t.crop || null;
    tt.growth = t.growth || 0;
    tt.watered = !!t.watered;
    tt.fertile = !!t.fertile;
    tt.harvestsLeft = t.harvestsLeft || 0;
    if(tt.crop && CROPS[tt.crop] && CROPS[tt.crop].harvests && !tt.harvestsLeft) tt.harvestsLeft = CROPS[tt.crop].harvests;
    return tt;
  });
  /* 老存档一次性归一（详见 55-expand.js）：操作的都是刚读出来的新档对象，不是全局 state */
  if((d.v | 0) < SAVE_VER){
    const lower = normalizeOldLowerStone(st);   /* v9.5：下方「旧上限」多出来的石头还原成带杂物的草地 */
    if(lower > 0) console.info(`[迁移] 下方石头地还原为带杂物的草地：${lower} 格`);
    const top = normalizeTopStone(st);          /* v9.10：补齐上方石头带里漏成草地的格子 */
    if(top > 0) console.info(`[迁移] 上方石头带补洞：${top} 格`);
  }
  return st;
}

/* ---------- 槽位读写 ---------- */
function readSlot(n){
  try {
    const raw = lsGet(slotKey(n));
    return raw ? JSON.parse(raw) : null;
  } catch(e){ return null; }
}
function slotMeta(n){
  const d = readSlot(n);
  if(!d) return { n, exists:false, empty:true };
  const st = unpackState(d);
  return {
    n, exists: !!st, savedAt: d.savedAt || 0,
    coins: st ? st.coins : 0,
    ach: st ? Object.keys(st.achievements||{}).length : 0,
    dishes: st ? Object.values(st.dishes||{}).reduce((a,b)=>a+(b.n||0),0) : 0,
    crop: st ? Object.values(st.bag||{}).reduce((a,b)=>a+b,0) : 0,
    day: st ? Math.floor((st.stats.total.till||0)) : 0,
  };
}
function saveToSlot(n, st){
  return lsSet(slotKey(n), JSON.stringify(serialize(st || state)));
}
function deleteSlot(n){
  lsDel(slotKey(n));
  if(currentSlot() === n) setCurrentSlot(0);
}
/* localStorage 在个别环境下会直接抛异常（file:// 打开、隐私模式、禁 cookie），
   所以读写一律包一层，游戏本体不因为存档不可用而崩。 */
function lsGet(k){ try { return localStorage.getItem(k); } catch(e){ return null; } }
function lsSet(k, v){ try { localStorage.setItem(k, v); return true; } catch(e){ return false; } }
function lsDel(k){ try { localStorage.removeItem(k); } catch(e){} }
function currentSlot(){
  const v = parseInt(lsGet(CUR_SLOT_KEY) || '0', 10);
  return (v >= 1 && v <= SLOT_COUNT) ? v : 0;
}
function setCurrentSlot(n){
  lsSet(CUR_SLOT_KEY, String(n || 0));
}
function loadFromSlot(n){
  const d = readSlot(n);
  if(!d) return null;
  const st = unpackState(d);
  if(!st) return null;
  const offlineMs = Math.max(0, Date.now() - (d.savedAt || Date.now()));
  return { state: st, offlineMs, savedAt: d.savedAt || 0 };
}
function save(){ saveToSlot(currentSlot() || 1, state); }

/* 旧版单槽存档（iso_farm_v8_0）自动搬进槽位 1 */
function migrateLegacy(){
  if(currentSlot()) return 0;
  let raw = null;
  try { raw = localStorage.getItem(LEGACY_KEY); } catch(e){}
  if(!raw) return 0;
  try {
    const d = JSON.parse(raw);
    const st = unpackState(d);
    if(!st) return 0;
    /* 关键：保留旧档的 savedAt，否则迁移会把离线收益抹成 0 */
    const payload = serialize(st);
    payload.savedAt = d.savedAt || Date.now();
    try { localStorage.setItem(slotKey(1), JSON.stringify(payload)); } catch(e){ return 0; }
    setCurrentSlot(1);
    return 1;
  } catch(e){ return 0; }
}
