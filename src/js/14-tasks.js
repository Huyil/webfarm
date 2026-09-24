/* ===== 每日任务池 =====
 * 每天刷新 3 个：**2 个简单 + 1 个困难**（hard:true）。
 * 奖励是普通肥料 / 高级肥料（高级肥料可立即催熟）。
 * need：解锁条件，避免开局就塞给玩家做不了的任务
 *   'mill'   磨过至少 1 次面
 *   'cook'   做过至少 1 道菜（烤/煮/精品类任务都要）
 *   'expand' 扩建过至少 1 次（清理/扩建类任务）
 *   'premium'用过/有过高级肥料（高级肥料相关的任务）
 *   'crop:x' 种过作物 x（作物专属任务，如 'crop:corn'）
 */
const TASK_POOL = [
  /* ---------- 简单 ---------- */
  { id:'harvest_5',   target:5,    type:'harvest', reward:{ fert:2 }, desc:'收获 5 株作物' },
  { id:'plant_5',     target:5,    type:'plant',   reward:{ fert:2 }, desc:'播种 5 次' },
  { id:'water_3',     target:3,    type:'water',   reward:{ fert:1 }, desc:'浇水 3 次' },
  { id:'till_5',      target:5,    type:'till',    reward:{ fert:2 }, desc:'开垦 5 块地' },
  { id:'sell_60',     target:60,   type:'coins',   reward:{ fert:3 }, desc:'卖出获得 60 金币' },
  { id:'harvest_15',  target:15,   type:'harvest', reward:{ fert:4 }, desc:'收获 15 株作物' },
  { id:'plant_12',    target:12,   type:'plant',   reward:{ fert:4 }, desc:'播种 12 次' },
  { id:'water_10',    target:10,   type:'water',   reward:{ fert:3 }, desc:'浇水 10 次' },
  { id:'till_15',     target:15,   type:'till',    reward:{ fert:5 }, desc:'开垦 15 块地' },
  { id:'chop_6',      target:6,    type:'chop',    reward:{ fert:3 }, desc:'切 6 份菜块' },
  { id:'fert_2',      target:2,    type:'fert',    reward:{ fert:3 }, desc:'施肥 2 次' },
  { id:'mill_3',      target:3,    type:'mill',    reward:{ fert:3 }, desc:'磨 3 次面粉',      need:'mill' },
  { id:'cook_3',      target:3,    type:'cook',    reward:{ fert:4 }, desc:'下锅/入炉 3 次',   need:'cook' },
  { id:'roast_3',     target:3,    type:'roast',   reward:{ fert:4 }, desc:'烤 3 次菜块',      need:'cook' },
  { id:'perfect_1',   target:1,    type:'perfect', reward:{ premium:2 }, desc:'做出 1 道精品料理', need:'cook' },
  { id:'premium_2',   target:2,    type:'premium', reward:{ premium:1, fert:2 }, desc:'使用 2 次高级肥料', need:'premium' },
  { id:'expand_2',    target:2,    type:'expand',  reward:{ fert:4 }, desc:'扩建 2 次',        need:'expand' },
  { id:'decor_5',     target:5,    type:'decor',   reward:{ fert:3 }, desc:'清理 5 件装饰物',  need:'expand' },
  { id:'h_carrot_6',  target:6,    type:'harvest_carrot',  reward:{ fert:3 }, desc:'收获 6 株胡萝卜' },
  { id:'p_cabbage_6', target:6,    type:'plant_cabbage',   reward:{ fert:3 }, desc:'种下 6 株白菜' },
  { id:'p_corn_3',    target:3,    type:'plant_corn',      reward:{ fert:4 }, desc:'种下 3 株玉米',   need:'crop:corn' },
  /* 地砖靠任务送：铺几块就回赠几块，起步不用花钱 */
  { id:'pave_8',      target:8,    type:'pave',            reward:{ decor:{ path:8 } },                desc:'铺 8 块地砖' },
  { id:'plant_15_pave', target:15, type:'plant',           reward:{ decor:{ brick:6 } },               desc:'播种 15 次' },

  /* ---------- 困难 ---------- */
  { id:'harvest_30',  target:30,   type:'harvest', reward:{ fert:6, premium:1 }, desc:'收获 30 株作物', hard:true },
  { id:'plant_25',    target:25,   type:'plant',   reward:{ fert:6, premium:1 }, desc:'播种 25 次',     hard:true },
  { id:'water_20',    target:20,   type:'water',   reward:{ fert:6, premium:1 }, desc:'浇水 20 次',     hard:true },
  { id:'till_25',     target:25,   type:'till',    reward:{ fert:6, premium:1 }, desc:'开垦 25 块地',   hard:true },
  { id:'sell_400',    target:400,  type:'coins',   reward:{ fert:8, premium:2 }, desc:'卖出获得 400 金币', hard:true },
  { id:'chop_20',     target:20,   type:'chop',    reward:{ fert:6, premium:1 }, desc:'切 20 份菜块',   hard:true },
  { id:'fert_6',      target:6,    type:'fert',    reward:{ premium:2 },         desc:'施肥 6 次',      hard:true },
  { id:'mill_10',     target:10,   type:'mill',    reward:{ fert:6, premium:1 }, desc:'磨 10 次面粉',   hard:true, need:'mill' },
  { id:'cook_8',      target:8,    type:'cook',    reward:{ fert:6, premium:1 }, desc:'下锅/入炉 8 次', hard:true, need:'cook' },
  { id:'roast_8',     target:8,    type:'roast',   reward:{ fert:6, premium:2 }, desc:'烤 8 次菜块',    hard:true, need:'cook' },
  { id:'perfect_3',   target:3,    type:'perfect', reward:{ premium:3 },         desc:'做出 3 道精品料理', hard:true, need:'cook' },
  { id:'expand_4',    target:4,    type:'expand',  reward:{ premium:3 },         desc:'扩建 4 次',      hard:true, need:'expand' },
  { id:'decor_15',    target:15,   type:'decor',   reward:{ premium:3 },         desc:'清理 15 件装饰物', hard:true, need:'expand' },
  { id:'h_pumpkin_4', target:4,    type:'harvest_pumpkin',    reward:{ fert:6, premium:1 }, desc:'收获 4 个南瓜',   hard:true, need:'crop:pumpkin' },
  { id:'h_straw_10',  target:10,   type:'harvest_strawberry', reward:{ premium:2 },         desc:'收获 10 颗草莓', hard:true, need:'crop:strawberry' },
  { id:'h_eggplant_8',target:8,    type:'harvest_eggplant',   reward:{ fert:6, premium:1 }, desc:'收获 8 个茄子',   hard:true, need:'crop:eggplant' },
  { id:'pave_24',     target:24,   type:'pave',            reward:{ decor:{ tileRed:8, tileBlue:8 } }, desc:'铺 24 块地砖',   hard:true },
  { id:'harvest_40_pave', target:40, type:'harvest',       reward:{ decor:{ marble:6 } },              desc:'收获 40 株作物', hard:true },
];

function todayStr(){
  const d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function rewardText(reward){
  const parts = [];
  if(reward.fert)    parts.push(`🧪×${reward.fert}`);
  if(reward.premium) parts.push(`✨×${reward.premium}`);
  if(reward.decor)   for(const k in reward.decor) parts.push(`${DECOR_META[k] ? DECOR_META[k].icon : '🏡'}×${reward.decor[k]}`);
  return parts.join(' ') || '—';
}
/* 任务是否已解锁（避免开局就发做菜/扩建类任务） */
function taskUnlocked(def){
  if(!def || !def.need) return true;
  const T = state.stats.total;
  if(def.need === 'mill')    return (T.mill || 0) >= 1;
  if(def.need === 'cook')    return (T.cook || 0) >= 1;
  if(def.need === 'expand')  return (T.expand || 0) >= 1;
  if(def.need === 'premium') return (T.premium || 0) >= 1 || state.premium > 0;
  /* 'crop:corn' —— 种过这种作物之后，它的专属任务才会出现 */
  if(def.need.indexOf('crop:') === 0) return !!(T.cropTypes && T.cropTypes[def.need.slice(5)]);
  return true;
}
