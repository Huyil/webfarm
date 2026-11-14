/* ===== 作物表 =====
 * 单次收获：stageMs 为每阶段时长，成熟 = stageMs*3
 * 多次收获：harvests 次总收获，首次成熟后每次 regrowMs 复熟，期间不用重新开垦
 */
const CROPS = {
  carrot:  { id:'carrot',   name:'胡萝卜', emoji:'🥕', produce:'胡萝卜', seedCost:4,  sellPrice:10, stageMs:12000, tag:'生长快',   color:'#e87828' },
  potato:  { id:'potato',   name:'土豆',   emoji:'🥔', produce:'土豆',   seedCost:6,  sellPrice:16, stageMs:18000, tag:'收益稳',   color:'#c8963c' },
  rice:    { id:'rice',     name:'水稻',   emoji:'🍚', produce:'大米',   seedCost:10, sellPrice:30, stageMs:30000, tag:'收益高',   color:'#e8d68a' },
  wheat:   { id:'wheat',    name:'小麦',   emoji:'🌾', produce:'小麦',   seedCost:8,  sellPrice:18, stageMs:22000, tag:'只可磨面', color:'#e0c060', noChop:true },
  chili:   { id:'chili',    name:'辣椒',   emoji:'🌶️', produce:'辣椒',   seedCost:16, sellPrice:7,  stageMs:16000, regrowMs:8000, harvests:6,  tag:'多次收获', color:'#d63a2a' },
  eggplant:{ id:'eggplant', name:'茄子',   emoji:'🍆', produce:'茄子',   seedCost:26, sellPrice:11, stageMs:20000, regrowMs:9000, harvests:5,  tag:'多次收获', color:'#8a5bc0' },
  tomato:  { id:'tomato',   name:'西红柿', emoji:'🍅', produce:'西红柿', seedCost:20, sellPrice:8,  stageMs:18000, regrowMs:7000, harvests:6,  tag:'多次收获', color:'#e04a2a' },
  strawberry:{ id:'strawberry', name:'草莓', emoji:'🍓', produce:'草莓', seedCost:26, sellPrice:5, stageMs:18000, regrowMs:5000, harvests:10, tag:'多轮收获', color:'#e8405a' },
  cabbage: { id:'cabbage',  name:'白菜',   emoji:'🥬', produce:'白菜',   seedCost:5,  sellPrice:13, stageMs:14000, tag:'速生',     color:'#a8d86a' },
  corn:    { id:'corn',     name:'玉米',   emoji:'🌽', produce:'玉米',   seedCost:12, sellPrice:34, stageMs:26000, tag:'稳收益',   color:'#f0d060' },
  pumpkin: { id:'pumpkin',  name:'南瓜',   emoji:'🎃', produce:'南瓜',   seedCost:26, sellPrice:52, stageMs:30000, tag:'高价值',   color:'#e08030' },
};
const CROP_IDS = Object.keys(CROPS);
/* 种子列表顺序：越靠后越贵 */
const SEED_ORDER = ['carrot','cabbage','potato','wheat','rice','corn','chili','tomato','eggplant','strawberry','pumpkin'];

/* ---------- 作物派生数值 ---------- */
function cropReadyMs(def){ return def.stageMs * 3; }
function cropTotalMs(def){ return cropReadyMs(def) + (def.harvests ? (def.harvests - 1) * def.regrowMs : 0); }
function cropYield(def){ return def.sellPrice * (def.harvests || 1); }
function cropProfit(def){ return cropYield(def) - def.seedCost; }
function cropROI(def){ return Math.round(cropYield(def) / def.seedCost * 100); }
function cropRate(def){ return cropProfit(def) / (cropTotalMs(def) / 1000); }
function cropIsMulti(def){ return !!def.harvests; }

/* ---------- 通用物品名 ---------- */
const EXTRA_ITEMS = {
  flour: { id:'flour', name:'面粉', emoji:'🥣', sellPrice:30 },   /* 小麦深加工提价：面粉与水稻同价 */
};
function itemName(id){
  if(CROPS[id]) return CROPS[id].produce || CROPS[id].name;
  if(EXTRA_ITEMS[id]) return EXTRA_ITEMS[id].name;
  return id;
}
function itemEmoji(id){
  if(CROPS[id]) return CROPS[id].emoji;
  if(EXTRA_ITEMS[id]) return EXTRA_ITEMS[id].emoji;
  return '❔';
}
/* 一块作物的价值 = 售价 × 0.40（一块作物切 3 份，所以整颗切完 ≈ 1.2 倍原价，再经锅放大） */
function pieceValue(cropId){
  const def = CROPS[cropId];
  return def ? def.sellPrice * 0.40 : 1;
}
