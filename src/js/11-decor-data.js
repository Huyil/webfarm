/* ===== 装饰物 ===== */
const DEFAULT_DECORATIONS = [
  { type:'tree',   gx:0,  gy:0,  seed:0 },
  { type:'tree',   gx:13, gy:0,  seed:1 },
  { type:'tree',   gx:0,  gy:13, seed:2 },
  { type:'tree',   gx:13, gy:13, seed:3 },
  { type:'tree',   gx:2,  gy:11, seed:4 },
  { type:'tree',   gx:11, gy:2,  seed:5 },
  { type:'rock',   gx:1,  gy:3,  seed:10 },
  { type:'rock',   gx:4,  gy:0,  seed:11 },
  { type:'rock',   gx:10, gy:13, seed:12 },
  { type:'rock',   gx:12, gy:4,  seed:13 },
  { type:'bush',   gx:3,  gy:1,  seed:20 },
  { type:'bush',   gx:8,  gy:0,  seed:21 },
  { type:'bush',   gx:0,  gy:7,  seed:22 },
  { type:'bush',   gx:13, gy:8,  seed:23 },
  { type:'bush',   gx:5,  gy:13, seed:24 },
  { type:'flower', gx:2,  gy:4,  seed:30 },
  { type:'flower', gx:4,  gy:2,  seed:31 },
  { type:'flower', gx:6,  gy:1,  seed:32 },
  { type:'flower', gx:9,  gy:1,  seed:33 },
  { type:'flower', gx:12, gy:1,  seed:34 },
  { type:'flower', gx:2,  gy:9,  seed:35 },
  { type:'flower', gx:11, gy:10, seed:36 },
  { type:'flower', gx:4,  gy:12, seed:37 },
  { type:'pond',   gx:9,  gy:9,  seed:40 },
  { type:'path',   gx:7,  gy:4,  seed:41 },
  { type:'path',   gx:7,  gy:3,  seed:42 },
  { type:'path',   gx:8,  gy:3,  seed:43 },
];

/* 装饰物元数据：仓库/摆放用 */
const DECOR_META = {
  tree:   { id:'tree',   name:'树',   icon:'🌳', ground:false },
  rock:   { id:'rock',   name:'石头', icon:'🪨', ground:false },
  bush:   { id:'bush',   name:'灌木', icon:'🌿', ground:false },
  flower: { id:'flower', name:'花',   icon:'🌸', ground:false },
  pond:   { id:'pond',   name:'水塘', icon:'💧', ground:true  },
  /* ---- 铺装（地面）：全部免费铺装、对齐格子；pave=走铺装画法，full=铺满整格（不走连接） ---- */
  path:     { id:'path',     name:'碎石小路', icon:'🟫', ground:true, pave:true, connect:4 },
  brick:    { id:'brick',    name:'红砖路',   icon:'🧱', ground:true, pave:true, connect:4 },
  tileRed:  { id:'tileRed',  name:'红瓷砖',   icon:'🟥', ground:true, pave:true, full:true, tile:'#c0503f' },
  tileBlue: { id:'tileBlue', name:'青瓷砖',   icon:'🟦', ground:true, pave:true, full:true, tile:'#3f7fa8' },
  tileJade: { id:'tileJade', name:'玉瓷砖',   icon:'🟩', ground:true, pave:true, full:true, tile:'#4f9e6a' },
  marble:   { id:'marble',   name:'大理石',   icon:'⬜', ground:true, pave:true, full:true, tile:'#e6e3da' },
  /* v9.8 新增：从小摆设到大件（这些是「人工摆放」，默认对齐格子） */
  chair:     { id:'chair',     name:'木椅',   icon:'🪑', ground:false },
  table:     { id:'table',     name:'木桌',   icon:'🍽️', ground:false },
  bench:     { id:'bench',     name:'长椅',   icon:'🛋️', ground:false },
  plant:     { id:'plant',     name:'盆栽',   icon:'🪴', ground:false },
  mushroom:  { id:'mushroom',  name:'蘑菇',   icon:'🍄', ground:false },
  sunflower: { id:'sunflower', name:'向日葵', icon:'🌻', ground:false },
  fence:     { id:'fence',     name:'木栅栏', icon:'🪵', ground:false, connect:8 },
  bamboo:    { id:'bamboo',    name:'竹子',   icon:'🎋', ground:false },
  pine:      { id:'pine',      name:'松树',   icon:'🌲', ground:false },
  lantern:   { id:'lantern',   name:'石灯笼', icon:'🏮', ground:false },
  well:      { id:'well',      name:'水井',   icon:'⛲', ground:false },
  statue:    { id:'statue',    name:'石像',   icon:'🗿', ground:false },
};
const DECOR_IDS = Object.keys(DECOR_META);
/* 锄掉装饰需要敲几下：杂草类 1 下、石头 2 下、地砖/树等其他装饰 3 下 */
const DECOR_HP = { bush:1, flower:1, rock:2, tree:3, path:3, pond:3, brick:3, tileRed:3, tileBlue:3, tileJade:3, marble:3,
                   mushroom:1, sunflower:1, fence:2, bamboo:2, pine:3, lantern:2, well:3, statue:3,
                   chair:2, table:2, bench:2, plant:2 };
function decorMaxHp(type){ return DECOR_HP[type] || 1; }

/* 会「野生」长出来的装饰：只有这些才用随机偏移（错落才像自然长的）；
   玩家自己摆的（小路/椅子/桌子/水井/石像…）一律对齐格子，摆起来才是齐的。
   判定用装饰对象上的 wild 标记（老存档按类型推断）。 */
const DECOR_NATURAL = { bush:1, rock:1, flower:1, tree:1, mushroom:1, pine:1, bamboo:1, sunflower:1 };
function decorIsNatural(type){ return !!DECOR_NATURAL[type]; }
/* 这个装饰对象该不该错落摆放 */
function decorIsWild(d){
  if(!d) return false;
  if(typeof d.wild === 'boolean') return d.wild;
  const meta = DECOR_META[d.type];
  if(meta && meta.ground) return false;
  return decorIsNatural(d.type);
}

/* 免费铺装：这类装饰「重复放置不消耗」，随便刷（小路就是拿来铺的）。
   为了不出现「免费放 → 锄起来卖钱」的循环，它们的回收价是 0，也不进商店。 */
const DECOR_FREE = {};   /* 目前没有免费铺装了：地砖改成「商店买 / 每日任务赠送」 */
function decorIsFree(type){ return !!DECOR_FREE[type]; }

/* 商店买卖价（金币）：买回来是卖出去的 2 倍 */
const DECOR_PRICE = { flower:12, bush:18, rock:24, tree:32, pond:70,
                      path:6, brick:10, tileRed:14, tileBlue:14, tileJade:18, marble:26,
                      mushroom:10, sunflower:16, fence:12, bamboo:26, pine:40, lantern:60, well:90, statue:150,
                      chair:20, table:34, bench:30, plant:24 };
const DECOR_SELL  = { flower:6,  bush:9,  rock:12, tree:16, pond:35,
                      path:3, brick:5, tileRed:7, tileBlue:7, tileJade:9, marble:13,
                      mushroom:5,  sunflower:8,  fence:6,  bamboo:13, pine:20, lantern:30, well:45, statue:75,
                      chair:10, table:17, bench:15, plant:12 };
