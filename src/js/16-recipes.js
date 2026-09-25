/* ===== 加工品与菜品 ===== */

/* 固定加工：石磨 1 小麦 → 1 面粉；面粉可在烤箱里烤成面包 */
const MILL_IN  = 'wheat';
const MILL_OUT = 'flour';

const DISHES = {
  bread: { id:'bread', name:'面包', emoji:'🍞', station:'oven', input:'flour', price:60, factor:1 },
  /* 面包片（菜板上切出来，见 boardSliceBread）：名字/图标要能被 kDishInfo 认出来 */
  slice: { id:'slice', name:'面包片', emoji:'🍞', station:'board', input:'bread', price:0, factor:1 },
};

/* 锅里认得出的家常菜：need = 菜块数量的精确多重集
 * 系数刻意压得比较低：切菜是瞬时的、几乎零成本，不能让「便宜作物切一下煮一下」就翻好几倍 */
const POT_COMBOS = [
  { id:'disanxian',  name:'地三鲜',   emoji:'🥘', need:{ potato:1, eggplant:1, chili:1 },   factor:1.55 },
  { id:'mapo',       name:'麻辣茄条', emoji:'🌶️', need:{ eggplant:1, chili:2 },              factor:1.55 },
  { id:'curry',      name:'咖喱饭',   emoji:'🍛', need:{ rice:2, potato:1, carrot:1 },      factor:1.60 },
  { id:'fried_rice', name:'什锦炒饭', emoji:'🍚', need:{ rice:2, carrot:1, chili:1 },       factor:1.55 },
  { id:'stew',       name:'红烩土豆', emoji:'🍲', need:{ potato:2, tomato:1 },               factor:1.50 },
  { id:'soup',       name:'田园浓汤', emoji:'🥣', need:{ carrot:1, tomato:1, potato:1 },     factor:1.50 },
  { id:'ratatouille',name:'普罗旺斯炖菜', emoji:'🍆', need:{ eggplant:1, tomato:2, chili:1 }, factor:1.60 },
  { id:'pumpkin_soup', name:'南瓜浓汤',   emoji:'🍲', need:{ pumpkin:2, carrot:1 },           factor:1.55 },
  { id:'corn_bake',    name:'玉米烙',     emoji:'🌽', need:{ corn:2, flour:0 },               factor:1.50 },
  { id:'jam',          name:'草莓酱',     emoji:'🍓', need:{ strawberry:3 },                  factor:1.60 },
  { id:'salad',        name:'田园沙拉',   emoji:'🥗', need:{ cabbage:2, tomato:1, carrot:1 }, factor:1.55 },
];
const POT_FALLBACK = { id:'mix', name:'杂烩', emoji:'🍲', factor:1.10 };

/* 锅里能直接下的生食材（大米不用切） */
const POT_RAW_OK = ['rice'];

/* 多重集匹配 */
function sameNeed(a, b){
  const ka = Object.keys(a).filter(k => a[k] > 0);
  const kb = Object.keys(b).filter(k => b[k] > 0);
  if(ka.length !== kb.length) return false;
  return ka.every(k => a[k] === b[k]);
}
function countPieces(pieces){
  const c = {};
  for(const p of pieces) c[p] = (c[p] || 0) + 1;
  return c;
}
/* 目标菜（未定品质）：返回 {id,name,emoji,factor,base,pieces,counts,n}
 *
 * v9.27：`pieces` 改成**去重后的种类表**，数量放在 `counts` 里。
 * 以前是原样复制整个多重集 —— 塞 1000 块南瓜时，菜品主键会变成 6KB 的长串、
 * 菜品记录里存 1000 个元素的数组、存档也跟着膨胀。聚合后：键 / 存档 / 界面都是
 * "有几种"，跟塞了多少块无关（`n` 保留总数，`base` 仍然按块数算，价钱不变）。 */
function potRecipe(pieces){
  const need = countPieces(pieces);
  const combo = POT_COMBOS.find(c => sameNeed(c.need, need));
  const def = combo || POT_FALLBACK;
  let base = 0;
  const kinds = Object.keys(need);
  for(const id of kinds) base += pieceValue(id) * need[id];
  base *= def.factor;
  kindCacheKey = kinds.join(',') + '|' + pieces.length;      /* 给 UI 做缓存键（种类 + 总数） */
  return { id:def.id, name:def.name, emoji:def.emoji, factor:def.factor,
           base:Math.round(base), pieces:kinds, counts:need, n:pieces.length };
}
/* 锅里的内容摘要（种类 + 数量），UI 缓存用；对同一锅内容稳定不变 */
let kindCacheKey = '';
/* 品质定价 */
function applyQuality(baseValue, qualityId){
  const q = QUALITY[qualityId] || QUALITY.normal;
  return Math.max(1, Math.round(baseValue * q.mult));
}
/* 面包（烤箱固定产线） */
function ovenRecipe(){
  return { id:'bread', name:'面包', emoji:'🍞', base:DISHES.bread.price, pieces:['flour'] };
}
