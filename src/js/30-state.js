/* ============ 状态 ============ */
function newTile(gx, gy, terrain, stone){
  return { gx, gy, terrain,
    state: terrain === 'tilled' ? 'tilled' : 'wild',
    crop: null, growth: 0, watered: false, fertile: false, harvestsLeft: 0,
    fertLeft: 0,                               /* 还能收几次而不返草地（施肥给） */
    stone: !!stone };
}
function newStats(){
  return {
    total: { harvest:0, coins:0, plant:0, water:0, fert:0, till:0, idle:0,
             mill:0, chop:0, cook:0, perfect:0, premium:0, burnt:0, expand:0,
             decorGot:0, sold:0, roast:0, pave:0,
             cropTypes:{}, dishTypes:{} },
    today: { date: todayStr(), harvest:0, coins:0, plant:0, water:0, fert:0, till:0,
             mill:0, chop:0, cook:0, premium:0, perfect:0, expand:0, pave:0 },
  };
}
/* 矩形工具：地图与耕地都是矩形，扩建就是把它往外推一排 */
function inRect(r, x, y){ return x >= r.x0 && y >= r.y0 && x < r.x0 + r.w && y < r.y0 + r.h; }
function newState(){
  /* 开局：整块岛就是 3×3 耕地（地图即耕地），扩建时岛和耕地一起长 */
  const farm = { x0:FARM0.x0, y0:FARM0.y0, w:FARM0.w, h:FARM0.h };
  const map = { x0:farm.x0, y0:farm.y0, w:farm.w, h:farm.h };
  const tiles = [];
  for(let gy=map.y0; gy<map.y0+map.h; gy++) for(let gx=map.x0; gx<map.x0+map.w; gx++){
    tiles.push(newTile(gx, gy, 'grass'));      /* 新档是未开垦的草地：锄头有事干，一眼看出是新的 */
  }
  return {
    v: 92,
    coins: START_COINS, fertilizer: 0, premium: 0,
    bag: { carrot:0, potato:0, rice:0, wheat:0, chili:0, eggplant:0, tomato:0 },
    pieces: {},                                 // 切好的菜块：{ cropId: n }
    prep: { flour: 0 },                         // 面粉等加工品
    dishes: {},                                 // 菜品：key → { n, name, emoji, value, quality, pieces }
    decorBag: { tree:0, rock:0, bush:0, flower:0, pond:0, path:0 },
    map, farm, expandCount: { xn:0, yn:0, xp:0, yp:0 }, upExpand: { xn:0, yn:0 }, expandMode: false,
    zoomMode: 'auto', cameraAuto: true,
    tiles, tool: 'hoe', selectedSeed: 'carrot', selectedDecor: 'tree',
    camera: { x: 0, y: 0 }, showGrid: false, sidePanelY: null, sidePanelVer: 0,
    warehouseEnabled: true,
    soundEnabled: true, particlesEnabled: true, effectsEnabled: true,
    miniGameEnabled: true,
    fav: {},
    stats: newStats(),
    achievements: {}, achClaimed: {},
    tasks: { date: null, list: [] },
    /* 排行榜：名字/标识/排序项目都存档；榜单缓存只放内存（不写档，免得存档变大） */
    playerName: '', playerId: '', lbSort: 'coins', lbLastSubmit: 0,
    lbCache: [], lbOnline: null, lbRank: null, lbCount: 0, lbUpdatedAt: 0, lbError: '',
    noticeRead: {}, achRead: false, taskRead: true,
    /* 初始耕地范围内的装饰物会被收进装饰仓库，避免一开局就压在田里 */
    decorations: [],
    /* 小人开局站在农场正中（岛是 3×3，中心就是 (1,1)） */
    player: { gx: farm.x0 + (farm.w >> 1), gy: farm.y0 + (farm.h >> 1),
              x: farm.x0 + (farm.w >> 1), y: farm.y0 + (farm.h >> 1),
              tx: farm.x0 + (farm.w >> 1), ty: farm.y0 + (farm.h >> 1),
              facing: 'down',
              moving: false, bob: 0, actionType: null, actionStart: 0, actionUntil: 0,
              pendingOp: null, queue: [] },
    idle: { lastAt: Date.now(), frac: 0, total: 0 },
    clockMs: DAY_MS * 0.16,
    kitchenAuto: { oven: false, pot: false },
    ovenSlots: 1,                              /* 烤箱槽位（可花钱升级，一次烤多份） */
    autoUntil: { donkey: 0, chopper: 0 },      /* 限时自动化设备的到期时间戳 */
    autoCount: { donkey: 0, chopper: 0 },      /* 各养了几台（每轮产几份） */
    autoAcc: { donkey: 0, chopper: 0 },
    autoSlot: { donkey: [], chopper: [] },   /* 各机器**独立**的进料槽（内容物已从仓库扣掉） */
    autoPause: { donkey: 0, chopper: 0 },      /* 0 = 在跑；非 0 = 暂停时刻（暂停时租期冻结） */
    kExpand: { prep: false, cook: false },   /* 厨房两行工位的展开状态（缩略行 ↔ 大界面） */
    longPressBox: true,                        /* 长按 = 框选（关掉则长按只当普通点击，不会跟移动打架） */
    showCropBars: true,                        /* 作物头顶的生长进度条（大地图关掉能省不少绘制） */
    recentSeeds: [],                           /* 最近用过的种子（工具栏「种子」的小凸起） */
    hover: null, box: null, jobBox: null, expandPreview: null,
    lastSave: Date.now(),
  };
}
/* 开局没有装饰物：整块岛都是耕地，装饰要等开出石头地面才有地方摆。
   先送几件在装饰仓库里，买/扩出石头地面后就能用。 */
function initDecorations(st){
  st.decorations = [];
  st.decorBag = { tree:1, rock:0, bush:1, flower:2, pond:0, path:0 };
  return st;
}
let state = initDecorations(newState());
let drawOrder = [];

/* ---------- 地块寻址（地图可扩建，索引随 map 走） ---------- */
function tileIndex(x, y){
  const m = state.map;
  return (y - m.y0) * m.w + (x - m.x0);
}
function getTile(gx, gy){
  const m = state.map;
  if(gx < m.x0 || gy < m.y0 || gx >= m.x0 + m.w || gy >= m.y0 + m.h) return null;
  return state.tiles[tileIndex(gx, gy)];
}
function inFarm(x, y){ return inRect(state.farm, x, y); }
function inMap(x, y){ return inRect(state.map, x, y); }
function buildDrawOrder(){
  drawOrder = Array.from({length: state.tiles.length}, (_, i)=>i);
  drawOrder.sort((a, b) => {
    const A = state.tiles[a], B = state.tiles[b];
    return (A.gx + A.gy) - (B.gx + B.gy);
  });
}
/* 地图扩容：按新矩形重建数组，已有地块按坐标搬运，新格按 stone 填充 */
function rebuildMapTiles(newMap, stoneStrip){
  const old = new Map();
  for(const t of state.tiles) old.set(t.gx + ',' + t.gy, t);
  const prevMap = state.map;
  /* 地图在某方向外扩时，新格子里可能有一条正对着已有石头带的：
     比如先买了上面的石头带，再往下扩一排 —— 新那一排里、石头带正下方的那几格
     如果建成草地，石头区就会嵌进一条草。这里按「朝旧地图方向的邻居」继承石头属性。 */
  function inheritStone(gx, gy){
    const probes = [];
    if(gx >= prevMap.x0 + prevMap.w) probes.push([gx - 1, gy]);
    if(gx <  prevMap.x0)             probes.push([gx + 1, gy]);
    if(gy >= prevMap.y0 + prevMap.h) probes.push([gx, gy - 1]);
    if(gy <  prevMap.y0)             probes.push([gx, gy + 1]);
    for(const p of probes){
      const t = old.get(p[0] + ',' + p[1]);
      if(t && t.stone) return true;
    }
    return false;
  }
  const tiles = [];
  for(let gy=newMap.y0; gy<newMap.y0+newMap.h; gy++){
    for(let gx=newMap.x0; gx<newMap.x0+newMap.w; gx++){
      const prev = old.get(gx + ',' + gy);
      if(prev){ tiles.push(prev); continue; }
      const isStone = stoneStrip ? inRect(stoneStrip, gx, gy) : inheritStone(gx, gy);
      tiles.push(newTile(gx, gy, 'grass', isStone));
    }
  }
  state.map = newMap;
  state.tiles = tiles;
  buildDrawOrder();
}
function unlockedAchCount(){ return Object.keys(state.achievements || {}).length; }
