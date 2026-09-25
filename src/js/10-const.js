/* ============ 常量 ============ */
const GAME_VERSION = '@VERSION@';
const SAVE_VER = 96;                            /* 存档格式版本：95 = 下方石头地还原，96 = 补齐上方石头带的洞 */
const MAP_W=14, MAP_H=14;                       // 仅作为「老存档没带 map 字段」时的兜底地图尺寸（岛本身随扩建一直长）
const FARM0 = { x0:0, y0:0, w:3, h:3 };         // 开局整块岛就是 3×3 耕地
const EXPAND_BASE=10, EXPAND_RATE=1.5, EXPAND_CAP=1000;   // 扩建单价：每个方向独立计算，10 起，指数递增，封顶 1000
const STONE_ROWS=3;                             // 超出可耕上限后，每次扩建新增的石头地面行数
const UP_PLANT_LIMIT=3;                         // 左上/右上各自最多还能扩出几排「可耕地」
const TILE_W=256, TILE_H=128, HALF_W=128, HALF_H=64, SCALE=0.3, THICKNESS=52;
const START_COINS=50, WATER_MULT=2, FERT_MULT=1.5, FERT_COST=3, PREMIUM_COST=26;
/* 施肥后的「兜底收获次数」：收获这么多次都不返草地（可以直接补种）。
 * 普通肥料 2 次、高级肥料 5 次；用完才像以前一样变回草地。 */
const FERT_KEEP = 2, PREMIUM_KEEP = 5;

/* 离线：作物按 40% 速度补，最长 8 小时 */
const OFFLINE_RATE=0.4, OFFLINE_CAP=8*3600*1000;
/* 挂机收益：0.3 金/分起步，每解锁 1 个成就 +0.06（30 个成就 ≈ 2.1 金/分封顶）
   离线只结算 2 小时。定位是「保底零花」，不允许压过种田与做菜。 */
const IDLE_BASE_PER_MIN=0.3, IDLE_PER_ACH=0.06, IDLE_OFFLINE_CAP=2*3600*1000;
/* 昼夜：一整天 = 22 分钟真实时间（清晨 2 + 白天 10 + 傍晚 2 + 夜晚 8） */
const DAY_MS=22*60*1000;

/* 视角缩放：auto=自动适配农场；1/2 为固定倍率；滚轮可微调 */
/* 0.35 太小了：40×40 以上农场怎么都铺不满一屏（自动倍率被下限卡住），
 * 既要左右拖、又多画一堆屏外地块。0.22 让大地图能整块看全，也更省。 */
const ZOOM_MIN=0.22, ZOOM_MAX=12, ZOOM_AUTO_PAD=0.78;
const ZOOM_AUTO_MAX=1.6;   // 宽屏自动倍率上限：不要把小农场吹得太大
const ZOOM_FILL_MAX=2.6;   // 窄屏「铺满宽度」时的上限（超了就卷轴式拖动查看）
const ZOOM_STEPS=[1, 2, 5, 10];   // 按钮循环的固定倍率

/* 存档槽位 */
const SAVE_PREFIX='iso_farm_v9_slot_', SLOT_COUNT=3;
const LEGACY_KEY='iso_farm_v8_0', CUR_SLOT_KEY='iso_farm_v9_current';

/* 厨房时序 */
const OVEN_MS=4000, OVEN_PERFECT_MS=2000, OVEN_BURN_MS=8000;
const OVEN_SLOT_PRICE0=2000, OVEN_SLOT_RATE=1.5, OVEN_SLOT_MAX=6;   /* 烤箱槽位：2000 起指数上涨，最多 6 槽 */   /* 4s 可收 → 4~6s 精品 → 6~12s 一般 → 12s 后焦糊 */
const POT_MS=4000,  POT_PERFECT_MS=2000,  POT_BURN_MS=8000;   /* 4s 可收 → 4~6s 精品 → 6~12s 一般 → 12s 后焦糊 */
const MILL_MS=900, CHOP_MS=600, CHOP_PIECES=3;

/* 品质 */
const QUALITY = {
  perfect:{ id:'perfect', name:'精品', mult:1.5,  tag:'✨' },
  normal: { id:'normal',  name:'一般', mult:1.0,  tag:''   },
  burnt:  { id:'burnt',   name:'焦糊', mult:0.5,  tag:'🔥' },
};

/* 工具集 */
const TOOLS = ['hoe','seed','water','fert','premium','sickle','decor'];
const TOOL_META = {
  hoe:    { icon:'⛏️', name:'锄头',     desc:'开垦荒地；顺手把装饰物收回仓库' },
  seed:   { icon:'🌱', name:'种子',     desc:'在开垦过的地块播种' },
  water:  { icon:'💧', name:'水壶',     desc:'浇水：生长 ×2（每周期一次，免费）' },
  fert:   { icon:'🧪', name:'肥料',     desc:'生长 ×1.5；收完还留 ' + FERT_KEEP + ' 次耕地（不返草地）' },
  premium:{ icon:'✨', name:'高级肥料', desc:'立即催熟，并留 ' + PREMIUM_KEEP + ' 次耕地（不返草地）' },
  sickle: { icon:'✂️', name:'收获',     desc:'收获成熟作物；多次收获作物会继续生长' },
  decor:  { icon:'🏡', name:'装饰',     desc:'把仓库里的装饰物摆回地块' },
};
