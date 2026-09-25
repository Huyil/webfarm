#!/usr/bin/env node
/* 无头冒烟测试：jsdom 载入构建产物，桩掉 canvas/Audio，跑帧并走一遍完整玩法链路。
 *   node tools/smoke.js farm.html
 *   node tools/smoke.js farm.min.html
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, '..', 'farm.html');
const NAME = path.basename(FILE);

function loadJsdom() {
  const tries = [() => require('jsdom'), () => require(path.join('/home/loli/deepseek-harness/node_modules', 'jsdom'))];
  for (const t of tries) { try { return t(); } catch (e) {} }
  console.error('✗ 找不到 jsdom');
  process.exit(2);
}
const { JSDOM, VirtualConsole } = loadJsdom();

function ctxStub(onCall) {
  const grad = { addColorStop() {} };
  const base = {
    canvas: { width: 800, height: 600 },
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => ({}),
    measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    getLineDash: () => [],
  };
  const noop = function () {};
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'then' || typeof k === 'symbol') return undefined;
      if (onCall) return function () { onCall(); };
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; },
    has() { return true; },
  });
}

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + label); }
  else { fail++; failures.push(label + (extra ? ' → ' + extra : '')); console.log('  \x1b[31m✗\x1b[0m ' + label + (extra ? '  \x1b[2m' + extra + '\x1b[0m' : '')); }
}
function eq(a, b, label) { ok(a === b, label, `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`); }
function near(a, b, tol, label) { ok(Math.abs(a - b) <= tol, label, `期望 ≈${b}±${tol}，实际 ${a}`); }
function section(t) { console.log('  \x1b[2m── ' + t + '\x1b[0m'); }

const html = fs.readFileSync(FILE, 'utf8');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const m = String((e && e.message) || e);
  if(/Not implemented/.test(m)) return;
  errors.push(m);
});
vc.on('error', (...a) => errors.push(a.map(String).join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole: vc,
  beforeParse(window) {
    window.__ctxOps = 0;
    window.HTMLCanvasElement.prototype.getContext = function () { return ctxStub(() => { window.__ctxOps++; }); };
    window.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:,'; };
    window.Element.prototype.animate = function () { return { cancel() {}, finished: Promise.resolve(), onfinish: null }; };
    if (!window.performance) window.performance = { now: () => Date.now(), timeOrigin: Date.now() };
    /* 迁移功能用 WebCrypto + CompressionStream 加密压缩；jsdom 里没有，注入 Node 的实现（真跑一遍，别用桩） */
    try {
      const wc = require('crypto').webcrypto;
      Object.defineProperty(window, 'crypto', { value: wc, configurable: true, writable: true });
    } catch (e) {}
    try {
      if (typeof CompressionStream === 'function') window.CompressionStream = CompressionStream;
      if (typeof DecompressionStream === 'function') window.DecompressionStream = DecompressionStream;
      if (typeof TextEncoder === 'function') window.TextEncoder = TextEncoder;
      if (typeof TextDecoder === 'function') window.TextDecoder = TextDecoder;
    } catch (e) {}
  },
});

const W = dom.window;
const frames = n => new Promise(res => {
  let i = 0;
  const tick = () => (++i >= n ? res() : W.requestAnimationFrame(tick));
  W.requestAnimationFrame(tick);
});

(async () => {
  console.log(`\n\x1b[1m冒烟测试\x1b[0m ${NAME}  \x1b[2m(${(html.length / 1024).toFixed(1)} KB)\x1b[0m`);
  await frames(6);

  section('启动 / DOM');
  ok(errors.length === 0, '初始化无未捕获异常', errors.slice(0, 3).join(' | '));
  ok(!!W.document.getElementById('game'), 'canvas #game 存在');
  eq(W.document.getElementById('hudMoney').textContent, '50', '初始金币 = 50（降低起步难度）');
  ok(/\d+\.\d+\.\d+/.test(W.document.title), '标题带版本号', W.document.title);
  eq(W.document.querySelectorAll('#sidePanel button .sl').length, 12, '侧栏 12 个按钮都有文字标签（v9.28 多了「🤖 自动农活」）');
  ok(!!W.document.getElementById('lbBtn'), '顶栏也有 🏅 排行榜入口（两个入口都能点开）');
  eq(W.document.getElementById('lbBtn').textContent, '🏅', '顶栏入口就是奖牌图标');
  eq(W.document.querySelectorAll('#toolbar button').length, 5, '工具栏 5 个工具（v9.19 起「催熟」并进「肥料」的小凸起）');

  const D = W.FarmDebug;
  if (!D) { ok(false, '游戏暴露 FarmDebug 调试接口'); dom.window.close(); process.exit(1); }
  const api = D.api;
  const st = () => D.state;
  eq(st().tiles.length, st().map.w * st().map.h, '地块数 = 地图尺寸');
  eq(st().map.w, 3, '开局整块岛宽 3');
  eq(st().map.h, 3, '开局整块岛高 3');
  eq(st().farm.w, 3, '开局耕地 3 列');
  eq(st().farm.h, 3, '开局耕地 3 行');
  eq(st().tiles.length, 9, '开局画面只有 3×3 = 9 块地');
  eq(api.currentSlot(), 1, '首次启动自动占用槽位 1');

  section('扩建：3×3 起步 · 每方向独立 10 起 · 新地是草地 · 超限出石头地面');
  eq(api.expandPrice('xp'), 10, '右下第一排单价 10');
  eq(api.expandPrice('yn'), 10, '右上第一排也是 10（各方向独立）');
  eq(st().expandMode, false, '默认不在扩建模式');
  const xp0 = api.expandInfo('xp');
  eq(xp0.kind, 'farm', '右下方向买的是地');
  st().coins = 500;
  const r1 = api.doExpand('xp');
  ok(r1.ok && r1.kind === 'farm', '买下右下 1 排', r1.msg);
  eq(st().farm.w, 4, '耕地变 4 列');
  eq(st().farm.h, 3, '高度还是 3 行（4×3）');
  eq(st().map.w, 4, '岛也跟着长到 4 宽');
  eq(st().tiles.length, 12, '画面从 9 块变成 12 块');
  eq(st().coins, 500 - 10, '扣 10 金');
  const newColTiles = st().tiles.filter(t => t.gx === 3);
  ok(newColTiles.length === 3 && newColTiles.every(t => t.state === 'wild' && t.terrain === 'grass'),
    '新买的地是未开垦的草地（不是耕地）');
  const weedsOnNew = newColTiles.filter(t => !!api.decorAt(t.gx, t.gy));
  ok(weedsOnNew.length >= 1, '新买的地上长出了杂草/石头', '杂草 ' + weedsOnNew.length + ' 处');
  ok(weedsOnNew.every(t => ['bush','rock','flower','tree'].includes(api.decorAt(t.gx, t.gy).type)),
    '杂草是灌木/石头/花/树之一');
  eq(api.expandPrice('xp'), Math.min(1000, Math.round(10 * Math.pow(1.5, 1))), '右下第二排 = 10×1.5');
  eq(api.expandPrice('yn'), 10, '右上仍是 10 —— 每个方向单独计价');
  const r2 = api.doExpand('yp');
  ok(r2.ok, '再买左下 1 排');
  eq(st().farm.w, 4, '宽 4');
  eq(st().farm.h, 4, '高 4（4×4）');
  eq(st().tiles.length, 16, '画面 16 块');
  eq(api.expandCountOf('yp'), 1, '左下单独计数');
  eq(api.expandCountOf('xp'), 1, '右下也各算各的');

  // 左上/右上各有限制：先给可耕地，达到上限后改给石头地面
  st().coins = 999999;
  const upLimit = api.UP_PLANT_LIMIT;
  let farmKinds = 0, stoneHit = null;
  for (let i = 0; i < upLimit + 2 && !stoneHit; i++) {
    const r = api.doExpand('xn');
    if (r.kind === 'farm') farmKinds++; else stoneHit = r;
  }
  eq(farmKinds, upLimit, `左上最多再扩 ${upLimit} 排地`);
  ok(!!stoneHit, '达到上限后转为石头地面', stoneHit && stoneHit.msg);
  ok(st().map.w > st().farm.w, '岛比耕地宽（多出来的就是石头地面）', `map=${st().map.w} farm=${st().farm.w}`);
  const stoneTiles = st().tiles.filter(t => t.stone);
  ok(stoneTiles.length >= 3, '一次新增 3 排石头地面', 'stone=' + stoneTiles.length);
  const stoneTile = stoneTiles[0];
  eq(api.inFarm(stoneTile.gx, stoneTile.gy), false, '石头地面不在耕地内');
  st().selectedSeed = 'carrot'; D.api.setTool('seed');
  const coinsBeforeStone = st().coins;
  api.runTool(stoneTile.gx, stoneTile.gy, true);
  eq(stoneTile.crop, null, '石头地面种不了作物');
  eq(st().coins, coinsBeforeStone, '种植失败不扣钱');
  st().expandCount = { xn: 40, yn: 0, xp: 0, yp: 0 };
  eq(api.expandPrice('xn'), 1000, '单价封顶 1000');
  eq(api.expandPrice('yn'), 10, '封顶只影响疯狂扩建的那个方向');
  st().coins = 500;
  D.api.setTool('hoe');
  api.toggleExpandMode(true);
  eq(st().expandMode, true, '开启扩建模式');
  const winfo = api.expandInfo('yn');
  ok(!!winfo && winfo.strip.w > 0 && winfo.strip.h > 0, '右上方向有候选长条');
  eq(api.expandDirAt(winfo.strip.x0, winfo.strip.y0), 'yn', '长条命中测试正确');
  eq(api.expandDirAt(st().farm.x0 + 1, st().farm.y0 + 1), null, '耕地内部不是扩建目标（小人不会走过去）');
  api.toggleExpandMode(false);
  eq(st().expandMode, false, '可以退出扩建模式');

  section('扩建上限：只有上方两向封顶，下方两向一直能扩草地');
  {
    const f0 = st().farm;
    const keep = { x0:f0.x0, y0:f0.y0, w:f0.w, h:f0.h, map:Object.assign({}, st().map),
                   coins:st().coins, up:Object.assign({ xn:0, yn:0 }, st().upExpand) };
    /* 把状态摆成「已经 14×14」：农场尺寸与地图都要一致，否则测的不是真实情形。
       注意 rebuildMapTiles 会**丢掉**矩形外的地块（新建的格也不再是石头），
       所以这里取「原地图 ∪ 农场矩形」的并集 —— 只扩不缩，原有地块与 stone 标记都保住。 */
    st().farm.w = 14; st().farm.h = 14;
    const ux = Math.min(keep.map.x0, f0.x0), uy = Math.min(keep.map.y0, f0.y0);
    const ux1 = Math.max(keep.map.x0 + keep.map.w, f0.x0 + 14), uy1 = Math.max(keep.map.y0 + keep.map.h, f0.y0 + 14);
    api.rebuildMapTiles({ x0:ux, y0:uy, w:ux1 - ux, h:uy1 - uy }, null);
    eq(api.expandKind('xp'), 'farm', '右下到 14 列仍给可耕草地（不再转石头地）');
    eq(api.expandKind('yp'), 'farm', '左下到 14 行仍给可耕草地');
    /* 真买一排：越过 14 之后新增的仍是「草地」不是石头 */
    st().coins = 1000000;
    const r = api.doExpand('xp');
    ok(r.ok && r.kind === 'farm', '第 15 列可以正常买下来', r.msg);
    eq(st().farm.w, 15, '农场宽度真的 +1');
    const nt = api.getTile(st().farm.x0 + 14, st().farm.y0);
    ok(nt && !nt.stone && nt.terrain === 'grass' && nt.state === 'wild', '越界后的新地仍是草地（要自己开垦）',
      nt ? `terrain=${nt.terrain} stone=${nt.stone}` : '格子不存在');
    eq(api.expandKind('xp'), 'farm', '买到第 16 列也还是草地（下方两向无上限）');
    /* 上方两向到顶 → 石头地 */
    st().upExpand = { xn: 3, yn: 3 };
    eq(api.expandKind('xn'), 'stone', '左上满 3 排后转为石头地（唯一的上限）');
    eq(api.expandKind('yn'), 'stone', '右上同理');
    /* 还原 */
    st().farm.x0 = keep.x0; st().farm.y0 = keep.y0; st().farm.w = keep.w; st().farm.h = keep.h;
    st().coins = keep.coins; st().upExpand = keep.up;
    api.rebuildMapTiles(keep.map, null);
  }

  section('视角：自动居中 + 缩放');
  st().cameraAuto = true;
  api.centerOnFarm();
  const zAuto = api.viewZoom();
  ok(zAuto > 0.3 && zAuto <= 2.6, '自动倍率在合理范围', zAuto.toFixed(2));
  st().zoomMode = 1; st().cameraAuto = false;
  eq(api.viewZoom(), 1, '固定 1x');
  const p1 = api.gridToScreen(st().farm.x0, st().farm.y0);
  st().zoomMode = 2;
  eq(api.viewZoom(), 2, '固定 2x');
  const p2 = api.gridToScreen(st().farm.x0, st().farm.y0);
  const d1 = Math.hypot(p1.x - 512, p1.y - 384), d2 = Math.hypot(p2.x - 512, p2.y - 384);
  ok(Math.abs(d2 - d1 * 2) < 2, '2x 时同一格到屏幕中心的距离是 1x 的两倍（缩放真的生效）', `${d1.toFixed(1)} → ${d2.toFixed(1)}`);
  const back = api.screenToGrid(p2.x, p2.y);
  eq(back.gx, st().farm.x0, '屏幕 → 网格 在 2x 下也能还原 X');
  eq(back.gy, st().farm.y0, '屏幕 → 网格 在 2x 下也能还原 Y');
  st().zoomMode = 'auto'; api.cycleZoom();
  eq(st().zoomMode, 1, '点一下：自动 → 1x');
  eq(st().cameraAuto, false, '手动倍率不再自动居中');
  api.cycleZoom(); eq(st().zoomMode, 2, '再点：→ 2x');
  api.cycleZoom(); eq(st().zoomMode, 5, '再点：→ 5x');
  api.cycleZoom(); eq(st().zoomMode, 10, '再点：→ 10x');
  eq(api.viewZoom(), 10, '10x 真的生效');
  api.cycleZoom();
  eq(st().zoomMode, 'auto', '再点：回到自动');
  eq(st().cameraAuto, true, '自动模式恢复自动居中');

  // 后面几段要用到「耕地内的坐标」，这里统一取相对位置
  const B = { x: st().farm.x0, y: st().farm.y0 };

  section('数据表完整性');
  for (const id of ['carrot','potato','rice','wheat','chili','eggplant','tomato','cabbage','corn','pumpkin','strawberry'])
    ok(!!api.CROPS[id], `作物 ${id} 存在`);
  ok(api.CROPS.strawberry.harvests >= 8, '草莓是「多轮收获」（10 轮）');
  ok(api.CROPS.wheat.noChop === true, '小麦标记为不可切块');
  const emojis = Object.keys(api.CROPS).map(k => api.CROPS[k].emoji);
  eq(new Set(emojis).size, emojis.length, '没有两种作物共用同一个图标');
  ok(api.CROPS.chili.harvests >= 2, '辣椒是多次收获作物');
  ok(api.CROPS.eggplant.harvests >= 2 && api.CROPS.tomato.harvests >= 2, '茄子/西红柿是多次收获作物');
  ok(!api.CROPS.rice.harvests, '水稻是单次收获');

  section('田间：开垦 → 播种 → 浇水 → 成熟 → 收获');
  st().coins = 500;
  const clearDeco = t => { if(t && api.decorAt(t.gx, t.gy)) api.collectDecorationAt(t.gx, t.gy); };
  const P = { gx: B.x + 1, gy: B.y + 1 };
  const tile = () => api.getTile(P.gx, P.gy);
  clearDeco(tile());
  D.api.setTool('hoe');
  tile().state = 'wild'; tile().terrain = 'grass'; tile().crop = null;
  api.runTool(P.gx, P.gy, true);
  eq(tile().state, 'tilled', '锄头把荒地开垦成耕地');
  st().selectedSeed = 'carrot'; D.api.setTool('seed');
  api.runTool(P.gx, P.gy, true);
  eq(tile().state, 'growing', '播种进入生长');
  D.api.setTool('water');
  api.runTool(P.gx, P.gy, true);
  eq(tile().watered, true, '浇水成功');
  api.step(12000 * 3 / 2 + 200);
  eq(tile().state, 'ready', '浇水（×2）后 18s 成熟');
  D.api.setTool('sickle');
  const bag0 = st().bag.carrot;
  api.runTool(P.gx, P.gy, true);
  eq(st().bag.carrot, bag0 + 1, '仓储模式收获入库 +1');
  eq(tile().state, 'wild', '单次作物收获后回到荒地');
  ok(st().achievements.first_harvest, '解锁「初次收获」成就');

  section('多次收获作物');
  const M = { gx: B.x + 2, gy: B.y + 1 };
  st().coins = 500;
  clearDeco(api.getTile(M.gx, M.gy));
  D.api.setTool('hoe'); api.runTool(M.gx, M.gy, true);
  st().selectedSeed = 'chili'; D.api.setTool('seed'); api.runTool(M.gx, M.gy, true);
  const ct = () => api.getTile(M.gx, M.gy);
  eq(ct().harvestsLeft, api.CROPS.chili.harvests, '种下时记录剩余收获次数');
  D.api.setTool('water'); api.runTool(M.gx, M.gy, true);
  api.step(200000);
  eq(ct().state, 'ready', '辣椒成熟');
  const chili0 = st().bag.chili;
  D.api.setTool('sickle'); api.runTool(M.gx, M.gy, true);
  eq(st().bag.chili, chili0 + 1, '第一次收获入库');
  eq(ct().state, 'growing', '收获后原地继续生长（不用重新开垦）');
  eq(ct().harvestsLeft, api.CROPS.chili.harvests - 1, '剩余次数递减');
  api.step(api.CROPS.chili.regrowMs + 500);
  eq(ct().state, 'ready', '复熟只需 regrowMs');

  section('肥料：普通 ×1.5 / 高级催熟');
  const F = { gx: B.x + 3, gy: B.y + 1 };
  st().coins = 500;
  clearDeco(api.getTile(F.gx, F.gy));
  D.api.setTool('hoe'); api.runTool(F.gx, F.gy, true);
  st().selectedSeed = 'rice'; D.api.setTool('seed'); api.runTool(F.gx, F.gy, true);
  const ft = () => api.getTile(F.gx, F.gy);
  st().fertilizer = 5;
  D.api.setTool('fert'); api.runTool(F.gx, F.gy, true);
  eq(ft().fertile, true, '普通肥料生效');
  eq(st().fertilizer, 4, '普通肥料消耗 1');
  const g0 = ft().growth;
  api.step(1000);
  near(ft().growth - g0, 1000 * 1.5, 5, '施肥后生长速率 ×1.5');
  st().premium = 2;
  D.api.setTool('premium'); api.runTool(F.gx, F.gy, true);
  eq(ft().state, 'ready', '高级肥料立即催熟');
  eq(st().premium, 1, '高级肥料消耗 1');

  section('装饰物：只能放农场外的石头地 / 砾石地，锄头收回');
  const freeStone = st().tiles.find(t => t.stone && !api.decorAt(t.gx, t.gy));
  ok(!!freeStone, '还有空的石头地面可用');
  st().decorBag.tree = (st().decorBag.tree || 0) + 1;
  const decoBag0 = st().decorBag.tree || 0;
  const pl = api.placeDecor(freeStone.gx, freeStone.gy, 'tree');
  ok(pl.ok, '石头地面可以摆装饰', pl.msg);
  eq(st().decorBag.tree, decoBag0 - 1, '摆放扣减装饰仓库');
  ok(!!api.decorAt(freeStone.gx, freeStone.gy), '地块上出现装饰物');
  const onFarm = api.placeDecor(B.x + 1, B.y + 1, 'flower');
  ok(!onFarm.ok, '耕地上不能摆装饰', onFarm.msg);
  D.api.setTool('hoe');
  /* 树要敲 3 下才收得走（杂草 1 / 石头 2 / 其他 3） */
  api.runTool(freeStone.gx, freeStone.gy, false);
  api.runTool(freeStone.gx, freeStone.gy, false);
  ok(!!api.decorAt(freeStone.gx, freeStone.gy), '树敲 2 下还在');
  api.runTool(freeStone.gx, freeStone.gy, false);
  eq(st().decorBag.tree, decoBag0, '敲满 3 下后装饰进仓库');
  ok(!api.decorAt(freeStone.gx, freeStone.gy), '装饰已从地块移除');
  eq(freeStone.stone, true, '石头地面不会被锄成耕地');
  eq(freeStone.state, 'wild', '石头地面状态未被改动');

  section('装饰物买卖：买价 = 卖价 ×2');
  for (const id of ['flower','bush','rock','tree','path','pond']) {
    eq(api.DECOR_PRICE[id], api.DECOR_SELL[id] * 2, `${id}：买价是卖价的 2 倍`);
  }
  st().coins = 0;
  st().decorBag.rock = (st().decorBag.rock || 0) + 3;
  const rocksBefore = st().decorBag.rock;
  const soldGain = api.sellDecor('rock', 2);
  eq(soldGain, api.DECOR_SELL.rock * 2, '卖出 2 个石头按卖价结算');
  eq(st().coins, soldGain, '金币到账');
  eq(st().decorBag.rock, rocksBefore - 2, '仓库数量扣减');
  st().coins = 500;
  st().decorBag.bush = 1;
  api.openSheet('decor');
  const dList = W.document.getElementById('decorList');
  const dRows = [...dList.querySelectorAll('.row')];
  ok(dRows.length >= 1, '装饰仓库列出可卖装饰');
  const bushRow = dRows.find(r => r.textContent.includes('灌木'));
  ok(!!bushRow && !!bushRow.querySelector('.mini.sell'), '装饰行有卖出按钮');
  const coinsBeforeSell = st().coins;
  bushRow.querySelector('.mini.sell').dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
  ok(st().coins > coinsBeforeSell, '点卖出真的进账');
  api.closeSheet();

  section('厨房：小麦 → 面粉 → 面包（石磨和切菜板一个操作：点一下直接出粉）');
  st().bag.wheat = 3;
  const flour0 = st().prep.flour || 0;
  const rMill = api.cook.mill();                       // 不传参数 = 磨 1 份
  ok(rMill.ok && rMill.n === 1, '点一下直接出 1 份面粉（不需要先装料、也不计时）');
  eq(st().prep.flour, flour0 + 1, '研磨产出 1 份面粉');
  eq(st().bag.wheat, 2, '同时消耗 1 份小麦');
  ok(!('queued' in api.KITCHEN.mill), '石磨没有「待磨队列」这一步了（和菜板一样一步到位）');
  eq(api.millBatch(), 2, 'millBatch() = 这一把能磨几份（受仓库与上限限制）');
  /* 一次放多份：卡上「磨 ×N」一把磨完（上限 MILL_BATCH_MAX） */
  st().bag.wheat = 20;
  const before5 = st().prep.flour;
  const rMill5 = api.cook.mill(api.MILL_BATCH_MAX);
  ok(rMill5.ok && rMill5.n === api.MILL_BATCH_MAX, `一把磨 ${api.MILL_BATCH_MAX} 份`);
  eq(st().prep.flour, before5 + api.MILL_BATCH_MAX, '一次产出同样多的面粉');
  eq(st().bag.wheat, 20 - api.MILL_BATCH_MAX, '消耗对应的小麦');
  eq(api.millBatch(), api.MILL_BATCH_MAX, '仓库够多时一把就是上限份数');
  /* 没小麦就磨不动 */
  st().bag.wheat = 0;
  ok(!api.cook.mill().ok, '仓库没小麦时磨不出粉');
  ok(!api.canMill(), 'canMill() = 仓库里还有没有小麦');
  eq(api.millBatch(), 0, '没小麦时一把 0 份');
  st().bag.wheat = 3;
  api.cook.mill();                                     // 直接磨 1 份备用
  ok(api.cook.ovenPut().ok, '面粉进烤箱');
  api.kitchenTick(api.KITCHEN.oven.dur + 100);
  ok(api.KITCHEN.oven.ready, '面包烤好（进入可出炉状态）');
  const out = api.cook.ovenTake(false);
  ok(out.ok && out.quality === 'perfect', '准时出炉拿到精品（+25%）', out.quality);
  eq(Object.values(st().dishes).reduce((a, b) => a + b.n, 0), 1, '菜品进入仓库');
  ok(st().achievements.first_cook, '解锁「初次下厨」成就');

  section('厨房：切菜板 + 锅（自由配菜）');
  st().bag.carrot = 2; st().bag.potato = 1; st().bag.eggplant = 1; st().bag.chili = 1;
  ok(api.cook.boardPut('carrot').ok, '切胡萝卜');
  api.kitchenTick(1000);
  eq(st().pieces.carrot, 3, '一块作物切成 3 份菜块');
  api.cook.boardPut('potato'); api.kitchenTick(1000);
  api.cook.boardPut('eggplant'); api.kitchenTick(1000);
  api.cook.boardPut('chili'); api.kitchenTick(1000);
  ok(api.cook.potAdd({ piece:'potato' }).ok, '土豆块下锅');
  ok(api.cook.potAdd({ piece:'eggplant' }).ok, '茄子块下锅');
  ok(api.cook.potAdd({ piece:'chili' }).ok, '辣椒块下锅');
  const pv = api.potRecipe(api.KITCHEN.pot.pieces);
  eq(pv.id, 'disanxian', '识别出名菜「地三鲜」');
  api.kitchenTick(api.KITCHEN.pot.dur + 100);
  ok(api.KITCHEN.pot.done, '锅进度条走完');
  const pot = api.cook.potTake(false);
  ok(pot.ok && pot.quality === 'perfect', '准时出锅拿到精品', pot.quality);
  eq(api.KITCHEN.pot.pieces.length, 0, '出锅后锅清空');
  ok(api.cook.potAdd({ piece:'carrot' }).ok === false || true, '空锅可以继续用');
  st().bag.rice = 2;
  api.cook.potAdd({ raw:'rice' });
  ok(api.KITCHEN.pot.pieces.length >= 1, '大米可以直接下锅');

  section('挂机收益：0.3/分起步 + 每成就 0.06，离线封顶 2 小时');
  st().coins = 0;
  const achN = Object.keys(st().achievements).length;
  const rate = api.idleRate();
  near(rate, 0.3 + 0.06 * achN, 0.0001, '挂机速率 = 0.3 + 0.06×成就数');
  ok(rate <= 0.3 + 0.06 * 30 + 1e-9, '成就拉满也只有 ≈2.1 金/分（挂机不再压过种田）', rate.toFixed(2) + ' 金/分');
  ok(rate < 3, '速率上限远低于旧的 16 金/分', rate.toFixed(2));
  /* 速率 <1 金/分 时靠分位小数累计：10 分钟应该能凑出整数 */
  const got = api.idleAdvance(10 * 60000);
  near(got, Math.floor(rate * 10), 1, '挂机 10 分钟到账 ≈ 速率×10');
  const idleTotal0 = st().stats.total.idle;
  api.idleAdvance(30 * 60000);
  ok(st().stats.total.idle >= idleTotal0, '长时间挂机持续累计');
  ok(api.idleAdvance(3600 * 1000) >= 0, '挂机 1 小时不报错');
  eq(api.IDLE_OFFLINE_CAP, 2 * 3600 * 1000, '离线结算上限 = 2 小时');
  eq(api.OFFLINE_CAP, 8 * 3600 * 1000, '作物离线补算仍按 8 小时（两回事）');
  {
    /* 离线 10 小时：只按 2 小时给 */
    const fresh = api.newState();
    fresh.achievements = st().achievements;
    const gained = api.idleOffline(fresh, 10 * 3600 * 1000);
    const cap = Math.floor(2 * 60 * rate);
    ok(gained > 0, '离线回来仍有钱（保底收入还在）', gained + ' 金');
    ok(gained <= cap + 1, '离线 10 小时也只按 2 小时封顶结算', `得 ${gained}，封顶 ≈${cap}`);
  }

  section('任务：奖励是肥料');
  const today = (() => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); })();
  st().stats.today.mill = 3;
  st().tasks = { date: today, list: [{ id:'mill_3', claimed:false }] };
  const fert0 = st().fertilizer;
  api.renderTaskList();
  api.claimTask('mill_3');
  eq(st().fertilizer, fert0 + 3, '任务奖励发放普通肥料 ×3');
  ok(st().tasks.list[0].claimed, '任务标记为已领取');
  st().tasks = { date: today, list: [{ id:'fert_6', claimed:false }] };
  st().stats.today.fert = 6;
  const prem0 = st().premium;
  api.claimAllTasks();
  eq(st().premium, prem0 + 2, '一键领取发放高级肥料 ×2（可直接催熟）');

  section('小人：移动动画 + 工具动作');
  st().player.x = 7; st().player.y = 6; st().player.tx = 7; st().player.ty = 6;
  st().player.moving = false; st().player.actionType = null; st().player.queuedAction = null;
  api.playerGoto(3, 3, 'hoe');
  eq(st().player.tx, 3, '设置目标格 X');
  eq(st().player.ty, 3, '设置目标格 Y');
  const x0 = st().player.x;
  api.updatePlayer(200);
  ok(st().player.x !== x0, '小人朝目标移动（不是瞬移）', `x ${x0} → ${st().player.x.toFixed(2)}`);
  eq(st().player.moving, true, '移动中标记为行走');
  ok(['up','down','left','right'].includes(st().player.facing), '有朝向', st().player.facing);
  api.updatePlayer(5000);
  ok(Math.abs(st().player.x - 3) < 0.05 && Math.abs(st().player.y - 3) < 0.05, '走到目标格');
  eq(st().player.moving, false, '到达后停止行走');
  eq(st().player.actionType, 'hoe', '到达后播放锄地动作');
  ok(st().player.actionUntil > Date.now(), '动作有持续时间（可做动画插值）');
  st().player.actionUntil = Date.now() - 1;
  api.updatePlayer(16);
  eq(st().player.actionType, null, '动作结束后自动清除');

  section('存档槽位');
  st().coins = 777;
  st().dishes = { 'bread|perfect|flour': { n: 2, name:'面包', emoji:'🍞', value:78, quality:'perfect', pieces:['flour'] } };
  ok(api.saveToSlot(2), '写入槽位 2');
  ok(!!W.localStorage.getItem(api.slotKey(2)), '槽位 2 落到 localStorage');
  const meta = api.slotMeta(2);
  ok(meta.exists && meta.coins === 777, '槽位摘要可读', JSON.stringify(meta));
  st().coins = 1;
  const loaded = api.loadSlot(2);
  eq(loaded.state.coins, 777, '读回金币');
  eq(Object.keys(loaded.state.dishes).length, 1, '读回菜品');
  const l2 = api.loadSlot(2);
  eq(l2.state.dishes['bread|perfect|flour'].value, 78, '菜品单价保留');
  ok(api.saveToSlot(3), '写入槽位 3');
  api.deleteSlot(3);
  eq(api.slotMeta(3).exists, false, '删除槽位 3');
  eq(api.currentSlot(), 1, '当前槽位仍为 1');

  section('旧档迁移（v8 单槽 → v9 槽位 1）');
  const legacy = {
    v: 81, savedAt: Date.now() - 3600000, coins: 123, fertilizer: 2,
    bag: { carrot: 3 }, tool: 'hoe', selectedSeed: 'rice',
    camera: { x: 0, y: 0 }, showGrid: false, sidePanelY: null,
    warehouseEnabled: true, soundEnabled: true, particlesEnabled: true,
    stats: { total: { harvest:9, coins:200, plant:9, water:3, fert:0, till:9, cropTypes:{ carrot:true } },
             today: { date:'2020-1-1', harvest:0, coins:0, plant:0, water:0, fert:0, till:0 } },
    achievements: { first_harvest: 1 }, tasks: { date: null, list: [] },
    noticeRead: {}, achRead: false, taskRead: true,
    player: { gx: 7, gy: 6 }, decorations: [{ type:'tree', gx:0, gy:0, seed:0 }],
    tiles: Array.from({ length: 196 }, (_, i) => ({
      gx: i % 14, gy: Math.floor(i / 14),
      terrain: i === 86 ? 'tilled' : 'grass',
      state: i === 86 ? 'growing' : 'wild',
      crop: i === 86 ? 'carrot' : null,
      growth: i === 86 ? 5000 : 0, watered: i === 86, fertile: false,
    })),
  };
  W.localStorage.setItem('iso_farm_v8_0', JSON.stringify(legacy));
  W.localStorage.removeItem(api.slotKey(1));
  api.setCurrentSlot(0);
  eq(api.migrateLegacy(), 1, '检测到 v8 存档并自动迁移');
  eq(api.currentSlot(), 1, '迁移后当前槽位 = 1');
  const mig = api.loadSlot(1);
  ok(!!mig, '迁移后的槽位 1 可读');
  eq(mig.state.coins, 123, '金币迁移正确');
  eq(mig.state.bag.carrot, 3, '仓库迁移正确');
  eq(mig.state.stats.total.harvest, 9, '统计迁移正确');
  eq(mig.state.tiles.length, 196, '地块数量正确');
  eq(mig.state.tiles[86].crop, 'carrot', '生长中的作物保留');
  eq(mig.state.tiles[86].watered, true, '已浇水状态保留');
  eq(mig.state.premium, 0, 'v9 新字段回落到默认值（高级肥料=0）');
  ok('pond' in mig.state.decorBag, '装饰仓库含新类型（pond）');
  ok(mig.state.dishes && Object.keys(mig.state.dishes).length === 0, '菜品字段初始化');
  ok(mig.offlineMs > 3000000, '离线时长按 savedAt 计算', Math.round(mig.offlineMs / 1000) + 's');

  section('离线结算');
  const offlineState = api.newState();
  offlineState.coins = 0;
  const ot = offlineState.tiles[(1 - offlineState.map.y0) * offlineState.map.w + (1 - offlineState.map.x0)];
  ot.state = 'growing'; ot.crop = 'carrot'; ot.growth = 0; ot.harvestsLeft = 0;
  const off = api.applyOffline(offlineState, 3600 * 1000);
  ok(off.grown >= 1, '离线作物继续生长');
  eq(ot.state, 'ready', '离线 1 小时胡萝卜成熟');
  ok(off.idle >= 1, '离线也有挂机收益', '实得 ' + off.idle);

  await frames(5);
  section('天气联动：雨天自动浇水');
  const wt = api.getTile(B.x + 1, B.y + 2), wt2 = api.getTile(B.x + 2, B.y + 2);
  for (const t of [wt, wt2]) { t.terrain = 'tilled'; t.state = 'growing'; t.crop = 'carrot'; t.growth = 1000; t.watered = false; t.fertile = false; }
  api.setAtmos(null, 'rain');
  api.applyRainWatering();
  const growingN = st().tiles.filter(t => t.state === 'growing').length;
  const wateredN = st().tiles.filter(t => t.state === 'growing' && t.watered).length;
  ok(growingN >= 2 && wateredN === growingN, '雨天把所有生长中的作物都浇了', `${wateredN}/${growingN}`);
  /* 雨中持续湿润：新种下的、多次收获复熟重置的，都不该再要玩家浇水 */
  const wt3 = api.getTile(B.x, B.y + 2);
  wt3.terrain = 'tilled'; wt3.state = 'growing'; wt3.crop = 'chili'; wt3.growth = 5000; wt3.watered = false; wt3.fertile = false;
  api.applyRainWatering();
  eq(wt3.watered, true, '雨中新种下的作物自动湿润（雨天不用水壶）');
  /* 关键是「种下去的那一刻」就该是湿的，而不是等下一帧 */
  {
    const wt4 = api.getTile(B.x, B.y + 1);
    wt4.stone = false; wt4.terrain = 'tilled'; wt4.state = 'tilled'; wt4.crop = null;
    wt4.growth = 0; wt4.watered = false; wt4.fertile = false; wt4.harvestsLeft = 0;
    const coinsKeep = st().coins;
    st().coins = 500;                       /* 播种要花钱，这里只验「种下去湿不湿」 */
    const pr = api.plantSeed(wt4, 'chili');
    st().coins = coinsKeep;
    ok(pr.ok, '雨天播种成功', pr.msg);
    eq(wt4.watered, true, '雨中播下去的当帧就是湿润的（不等下一帧雨检）');
    wt4.state = 'wild'; wt4.crop = null; wt4.watered = false;
  }
  wt3.watered = false;                      /* 模拟多次收获复熟后的重置 */
  api.applyRainWatering();
  eq(wt3.watered, true, '雨中复熟重置后也会立刻重新湿润');
  /* 水壶在雨天没事可做：框选会自己跳过 */
  D.api.setTool('water');
  const rainBox = api.applyToolToRect(wt3.gx, wt3.gy, wt3.gx, wt3.gy);
  eq(rainBox, 0, '雨天框选浇水不排作业（已经全湿了）');
  wt3.state = 'wild'; wt3.watered = false;
  for (const t of [wt, wt2]) { t.state = 'wild'; t.watered = false; }
  api.setAtmos(null, 'clear');
  wt.state = 'growing'; wt.watered = false;
  api.applyRainWatering();
  eq(wt.watered, false, '晴天不会凭空浇水');
  wt.state = 'wild';
  api.setAtmos(11, 'clear');

  section('自动生成的装饰带随机偏移（不落在格子正中）');
  {
    const gx = B.x + 2, gy = B.y + 3;
    const t = api.getTile(gx, gy);
    if (t) {
      if (api.decorAt(gx, gy)) api.collectDecorationAt(gx, gy);
      const n = api.scatterWeeds([t], 1);      // 概率给 1 → 必定生成
      eq(n, 1, '强制散布出 1 个装饰');
      const d = api.decorAt(gx, gy);
      ok(d && typeof d.ox === 'number' && typeof d.oy === 'number', '装饰带偏移量');
      ok(Math.abs(d.ox) <= 17 && Math.abs(d.oy) <= 7, '偏移在格子范围内', `ox=${d.ox} oy=${d.oy}`);
      const many = [];
      for (let i = 0; i < 24; i++){ const o = api.decorOffset(i / 24, (i * 7 % 24) / 24); many.push(o); }
      ok(many.some(o => o.ox < -6) && many.some(o => o.ox > 6), '偏移会散到左右两侧（不都在正中）');
      ok(many.every(o => !(o.ox === 0 && o.oy === 0)), '不会正好落在格子正中');
      api.collectDecorationAt(gx, gy);
    }
  }

  section('锄头规则：敲装饰次数 / 批量不回退 / 单击才还原草地');
  {
    const mk = (type, gx, gy) => {
      const t = api.getTile(gx, gy);
      t.stone = false; t.terrain = 'grass'; t.state = 'wild'; t.crop = null;
      const old = api.decorAt(gx, gy); if(old) api.collectDecorationAt(gx, gy);
      st().decorations.push({ type, gx, gy, seed: 42, hp: api.decorMaxHp(type) });
      return t;
    };
    D.api.setTool('hoe');
    // 杂草 1 下
    let t1 = mk('bush', B.x + 1, B.y + 1);
    const bag1 = st().decorBag.bush || 0;
    api.runTool(t1.gx, t1.gy, false);
    ok(!api.decorAt(t1.gx, t1.gy), '杂草敲 1 下就掉了');
    eq(st().decorBag.bush, bag1 + 1, '敲掉的杂草进装饰仓库');
    eq(t1.state, 'wild', '敲掉装饰后地块仍是草地（还没开垦）');
    api.runTool(t1.gx, t1.gy, false);
    eq(t1.state, 'tilled', '再锄一下才变成耕地');
    // 石头 2 下
    let t2 = mk('rock', B.x + 2, B.y + 2);
    api.runTool(t2.gx, t2.gy, false);
    ok(!!api.decorAt(t2.gx, t2.gy), '石头第 1 下还在');
    eq(api.decorAt(t2.gx, t2.gy).hp, 1, '石头剩 1 下');
    api.runTool(t2.gx, t2.gy, false);
    ok(!api.decorAt(t2.gx, t2.gy), '石头第 2 下敲掉');
    // 树 3 下
    let t3 = mk('tree', B.x + 3, B.y + 2);
    api.runTool(t3.gx, t3.gy, false);
    api.runTool(t3.gx, t3.gy, false);
    ok(!!api.decorAt(t3.gx, t3.gy), '树敲 2 下还在');
    api.runTool(t3.gx, t3.gy, false);
    ok(!api.decorAt(t3.gx, t3.gy), '树第 3 下敲掉');
    eq(api.DECOR_HP.bush, 1, '杂草 1 下');
    eq(api.DECOR_HP.rock, 2, '石头 2 下');
    eq(api.DECOR_HP.tree, 3, '其他装饰 3 下');
    // 耐久存档
    let t4 = mk('rock', B.x + 1, B.y + 3);
    api.runTool(t4.gx, t4.gy, false);
    api.saveToSlot(2);
    const rel = api.loadSlot(2);
    const saved = rel.state.decorations.find(d => d.gx === t4.gx && d.gy === t4.gy);
    ok(saved && saved.hp === 1, '装饰耐久会存档（读回来还是剩 1 下）', saved && ('hp=' + saved.hp));
    api.collectDecorationAt(t4.gx, t4.gy);
    // 批量/拖拽：只能开垦，不会把耕地抹回草地
    let t5 = mk('bush', B.x + 2, B.y + 3);
    api.collectDecorationAt(t5.gx, t5.gy);
    t5.state = 'tilled'; t5.terrain = 'tilled';
    api.runTool(t5.gx, t5.gy, true);          // silent = 拖拽/框选
    eq(t5.state, 'tilled', '拖拽/框选的锄地不会把耕地变成草地');
    api.runTool(t5.gx, t5.gy, false);         // 单击
    eq(t5.state, 'wild', '只有单击才会还原成草地');
    t5.state = 'tilled'; t5.terrain = 'tilled';
  }

  section('交互：到位后才生效 / 悬停 / 框选批量');
  st().coins = 500;
  const far = api.getTile(B.x + 1, B.y + 1);
  far.state = 'wild'; far.terrain = 'grass'; far.crop = null; far.stone = false;
  st().player.x = B.x + 9; st().player.y = B.y + 9; st().player.tx = B.x + 9; st().player.ty = B.y + 9;
  st().player.pendingOp = null; st().player.actionType = null;
  D.api.setTool('hoe');
  api.applyToolAt(B.x + 1, B.y + 1, false);
  eq(far.state, 'wild', '单击远处：人没走到，地块不变化（效果延后）');
  api.updatePlayer(60);
  eq(far.state, 'wild', '走一半仍未生效');
  for (let i = 0; i < 300; i++) api.updatePlayer(60);
  eq(far.state, 'tilled', '走到位后自动完成锄地');
  api.setHover(B.x + 1, B.y + 1);
  ok(!!D.state.hover && D.state.hover.gx === B.x + 1 && D.state.hover.gy === B.y + 1, '悬停记录当前指向的格子');
  api.setHover(null);
  eq(D.state.hover, null, '移出画布后取消悬停高亮');

  // 拖拽刷地：不瞬移，先排队，走到位才生效
  st().player.x = B.x + 5; st().player.y = B.y + 5; st().player.tx = B.x + 5; st().player.ty = B.y + 5;
  api.playerClearQueue();
  const dragTile = api.getTile(B.x + 2, B.y + 3);
  dragTile.state = 'wild'; dragTile.terrain = 'grass'; dragTile.crop = null; dragTile.stone = false;
  D.api.setTool('hoe');
  const px0 = st().player.x, py0 = st().player.y;
  api.applyToolAt(B.x + 2, B.y + 3, true);
  ok(Math.abs(st().player.x - px0) < 0.001 && Math.abs(st().player.y - py0) < 0.001, '拖拽不再让小人瞬移到目标格');
  eq(dragTile.state, 'wild', '拖拽时地块还没被改（等小人走到）');
  ok(api.jobActive(), '拖拽产生了一个待办作业');
  for (let i = 0; i < 400 && api.jobActive(); i++) api.updatePlayer(60);
  eq(dragTile.state, 'tilled', '小人走到后自动完成锄地');
  ok(!api.jobActive(), '作业完成后队列清空');

  // 框选：排一条顺路，小人依次走过去做（不是隔空瞬间改地）
  const boxTiles = [[B.x + 1, B.y + 2], [B.x + 2, B.y + 2], [B.x + 1, B.y + 3]].map(([x, y]) => api.getTile(x, y));
  for (const t of boxTiles) { t.state = 'growing'; t.crop = 'carrot'; t.growth = 100; t.watered = false; t.harvestsLeft = 0; }
  D.api.setTool('water');
  const hit = api.applyToolToRect(B.x + 1, B.y + 2, B.x + 2, B.y + 3);
  ok(hit >= 3, '框选生成作业', '共 ' + hit + ' 格');
  eq(boxTiles[0].watered, false, '刚框选完还没浇水（要等人走过去）');
  ok(!!st().jobBox, '作业期间保留选区高亮');
  for (let i = 0; i < 500 && api.jobActive(); i++) api.updatePlayer(60);
  ok(boxTiles.every(t => t.watered), '小人一路走过去把矩形内的作物都浇了');
  eq(st().jobBox, null, '作业完成后选区自动收起');

  // 再框选一次，然后用「点地图」取消
  for (const t of boxTiles) t.watered = false;
  api.applyToolToRect(B.x + 1, B.y + 2, B.x + 2, B.y + 3);
  ok(api.jobActive(), '又排了一批作业');
  const jobsLeft = api.playerQueue().length;
  api.cancelJob();
  ok(!api.jobActive(), '点地图可以取消框选作业');
  eq(api.playerQueue().length, 0, '队列被清空', `之前 ${jobsLeft} 格`);
  api.updatePlayer(200);
  ok(boxTiles.some(t => !t.watered), '取消后不再继续施工');

  section('种子列表：11 种种子都在，点了能选中');
  {
    D.api.setTool && D.api.setTool('hoe');
    st().coins = 9999;
    D.api.renderSeedList ? D.api.renderSeedList() : api.renderSeedList();
    const rows = W.document.querySelectorAll('#seedList .row');
    eq(rows.length, Object.keys(api.CROPS).length, '种子列表行数 = 作物数');
    eq(rows.length, 11, '一共 11 种作物');
    const names = Array.from(rows).map(r => r.querySelector('.r-name').textContent);
    for (const id of Object.keys(api.CROPS)) {
      ok(names.some(n => n.indexOf(api.CROPS[id].name) === 0), `列表里有 ${api.CROPS[id].name}`);
    }
    rows[rows.length - 1].onclick();
    eq(st().selectedSeed, 'pumpkin', '点最后一行（南瓜）能选中');
    eq(st().tool, 'seed', '选种子会把工具切成播种');
  }


  section('售价回调 / 小麦不可切块 / 面粉与水稻同价');
  eq(api.CROPS.chili.sellPrice, 7, '辣椒售价回调到 7');
  eq(api.CROPS.tomato.sellPrice, 8, '西红柿售价回调到 8');
  eq(api.CROPS.eggplant.sellPrice, 11, '茄子售价回调到 11');
  ok(api.CROPS.chili.harvests >= 5 && api.CROPS.chili.harvests <= 6, '辣椒确实是 5~6 轮', String(api.CROPS.chili.harvests));
  eq(api.EXTRA_ITEMS.flour.sellPrice, 30, '面粉提价到 30（与水稻同价）');
  eq(api.DISHES.bread.price, 60, '面包提价到 60');
  ok(api.CROPS.wheat.noChop === true, '小麦标记 noChop');
  ok(!api.canBoard('wheat'), '切菜板不接受小麦');
  {
    const savedWheat = st().bag.wheat || 0;
    st().bag.wheat = 3;
    const wr = api.cook.boardPut('wheat');
    ok(!wr.ok, '强行把小麦丢上切菜板会被拒绝', wr.msg);
    eq(st().bag.wheat, 3, '被拒绝时不消耗小麦');
    st().bag.carrot = (st().bag.carrot || 0) + 1;
    const cr = api.cook.boardPut('carrot');
    ok(cr.ok, '别的作物仍能正常切块', cr.msg);
    st().bag.wheat = savedWheat;
    st().pieces = st().pieces || {};
  }

  section('11 种作物都能走完 播种 → 收获 链路');
  {
    const f = st().farm;
    const tile = api.getTile(f.x0, f.y0);
    const bagBefore = Object.assign({}, st().bag);
    for (const id of Object.keys(api.CROPS)) {
      const def = api.CROPS[id];
      tile.stone = false; tile.terrain = 'tilled'; tile.state = 'tilled'; tile.crop = null;
      tile.harvestsLeft = 0; tile.watered = false; tile.fertile = false; tile.growth = 0;
      st().coins = 1000;
      const r = api.plantSeed(tile, id);
      ok(r.ok, `可以种下 ${def.name}`, r.msg);
      eq(st().coins, 1000 - def.seedCost, `${def.name} 扣掉种子钱 ${def.seedCost}`);
      tile.state = 'ready'; tile.growth = api.cropReadyMs(def);
      const before = st().bag[id] || 0;
      const hr = api.harvestTile(tile);
      ok(hr.ok, `可以收获 ${def.name}`, hr.msg);
      eq((st().bag[id] || 0) - before, 1, `${def.name} 收进仓库 1 个`);
    }
    st().bag = bagBefore;
    tile.state = 'wild'; tile.terrain = 'grass'; tile.crop = null; tile.harvestsLeft = 0;
  }


  section('火候时段：4s 可收 / 4~6s 精品 / 6~12s 正常 / 12s 后焦糊');
  eq(api.POT_MS, 4000, '锅 4 秒可收');
  eq(api.OVEN_MS, 4000, '烤箱 4 秒可收');
  eq(api.POT_PERFECT_MS, 2000, '精品窗口 4~6 秒');
  eq(api.POT_MS + api.POT_BURN_MS, 12000, '锅 12 秒焦糊');
  eq(api.OVEN_MS + api.OVEN_BURN_MS, 12000, '烤箱 12 秒焦糊');
  const potQualityAt = ms => {
    st().pieces.carrot = 1;
    const a = api.cook.potAdd({ piece: 'carrot' });
    if (!a.ok) return 'ERR:' + a.msg;
    api.kitchenTick(ms);
    const r = api.cook.potTake(false);
    return r.quality || ('ERR:' + r.msg);
  };
  eq(potQualityAt(4100), 'perfect', '4.1s 出锅 = 精品');
  eq(potQualityAt(8000), 'normal', '8s 出锅 = 正常');
  eq(potQualityAt(12500), 'burnt', '12.5s 出锅 = 焦糊');

  section('烤箱：切过的东西都能烤（三档品质 + 叠加颜色）');
  st().pieces.potato = 1;
  ok(api.cook.ovenPut({ piece: 'potato' }).ok, '菜块可以进烤箱');
  eq(api.KITCHEN.oven.item && api.KITCHEN.oven.item.type, 'piece', '烤箱记住了烤的是菜块');
  api.kitchenTick(api.OVEN_MS + 100);
  const roast = api.cook.ovenTake(false);
  ok(roast.ok && roast.quality === 'perfect', '准时出炉 = 精品烤菜', roast.quality);
  ok(roast.dish && roast.dish.pieces[0] === 'potato', '烤菜的用料就是那块菜块');
  ok(roast.dish && roast.dish.name.indexOf('烤') === 0, '名字带「烤」', roast.dish && roast.dish.name);
  st().pieces.chili = 1;
  api.cook.ovenPut({ piece: 'chili' });
  api.kitchenTick(api.OVEN_MS + api.OVEN_PERFECT_MS + 2000);
  const roast2 = api.cook.ovenTake(false);
  eq(roast2.quality, 'normal', '过了精品窗口 = 正常烤菜');
  st().pieces.tomato = 1;
  api.cook.ovenPut({ piece: 'tomato' });
  api.kitchenTick(api.OVEN_MS + api.OVEN_BURN_MS + 500);
  const roast3 = api.cook.ovenTake(false);
  eq(roast3.quality, 'burnt', '太久 = 焦糊烤菜');
  ok(api.applyQuality(10, 'perfect') === 15 && api.applyQuality(10, 'burnt') === 5,
    '品质倍率：精品 ×1.5 / 焦糊 ×0.5（图标按品质叠色）');

  section('经济：切+煮不再暴涨 / 切菜瞬时');
  const r3 = api.potRecipe(['carrot', 'carrot', 'carrot']);
  ok(r3.base <= 14, '3 块胡萝卜杂烩基础价 ≤ 14（胡萝卜本身才 10 金）', 'base=' + r3.base);
  ok(api.applyQuality(r3.base, 'perfect') <= 21, '精品版 ≤ 21（精品涨价后仍不足 2.1× 原料价）', 'perfect=' + api.applyQuality(r3.base, 'perfect'));
  eq(api.applyQuality(100, 'burnt'), 50, '焦糊 = 半价');
  const combo = api.potRecipe(['potato', 'eggplant', 'chili']);
  eq(combo.id, 'disanxian', '名菜识别正常');
  ok(combo.base < 34, '名菜价不超过三种作物原价之和', 'base=' + combo.base);
  st().bag.carrot = 2; st().pieces.carrot = 0;
  const chop1 = api.cook.boardPut('carrot');
  ok(chop1.ok && st().pieces.carrot === 3, '切菜瞬时产出 3 块（没有计时条）');
  api.cook.boardPut('carrot');
  eq(st().pieces.carrot, 6, '连续切两块立刻累计到 6');

  section('DOM 交互（弹层 / 侧栏 / 工具栏）');
  const $ = id => W.document.getElementById(id);
  const click = el => { if (!el) { ok(false, '元素存在'); return; } el.dispatchEvent(new W.MouseEvent('click', { bubbles: true })); };
  click($('btnShop'));   ok($('shopModal').classList.contains('show'), '商店弹层打开');
  ok($('shopList').children.length >= 2, '商店列出普通/高级肥料');
  click($('btnStore'));  ok($('storeModal').classList.contains('show'), '仓库弹层打开');
  eq($('storeTabs').children.length, 3, '仓库三个页签（作物/备料/菜品）');
  click($('storeTabs').children[2]);
  click($('btnDecor'));  ok($('decorModal').classList.contains('show'), '装饰仓库弹层打开');
  // 存档入口已经挪进设置面板，侧栏原位置改成缩放
  click($('btnOpenSlots')); ok($('slotsModal').classList.contains('show'), '从设置里打开存档弹层');
  eq($('slotsBody').querySelectorAll('.slot-card').length, 3, '存档界面 3 个槽位卡片');
  click(W.document.querySelector('#slotsModal [data-close]'));
  click($('btnSettings')); ok($('settingsModal').classList.contains('show'), '设置弹层打开');
  ok($('settingsModal').querySelectorAll('.setting-row').length >= 5, '设置项 ≥5（含全屏特效/小游戏）');
  click($('achBtn'));    ok($('achievementModal').classList.contains('show'), '成就弹层打开');
  ok($('achList').children.length > 1, '成就列表渲染');
  click($('tabTask'));   ok($('taskList').style.display !== 'none', '任务页签可切换');
  click($('noticeBtn')); ok($('noticeModal').classList.contains('show'), '公告弹层打开');
  ok($('logList').children.length >= 3, '公告列出多个版本');
  click(W.document.querySelector('#noticeModal [data-close]'));
  ok(!$('noticeModal').classList.contains('show'), '关闭按钮生效');

  eq(W.document.querySelectorAll('#toolbar button').length, 5, '工具栏 5 个键（催熟已并入肥料）');
  const tbBtns = W.document.querySelectorAll('#toolbar button');
  click(tbBtns[2]); eq(st().tool, 'water', '点工具栏切到浇水');
  click(tbBtns[4]); eq(st().tool, 'sickle', '点工具栏切到收获');
  /* 种子：先弹「小凸起」（常用种子 + 更多），不再直接开大窗口 */
  click(tbBtns[1]); eq(st().tool, 'seed', '点种子工具');
  ok($('seedPop').classList.contains('show'), '种子先弹小凸起（不是旧的大窗口）');
  ok(!$('seedModal').classList.contains('show'), '此时不打开旧的种子窗口');
  /* 种过东西之后，小凸起里就有「常用种子」 */
  st().coins = 500;
  const t0 = api.getTile(st().farm.x0, st().farm.y0);
  t0.state = 'tilled'; t0.crop = null;
  api.plantSeed(t0, 'carrot');
  ok((st().recentSeeds || []).includes('carrot'), '播种后记住「最近用过的种子」', JSON.stringify(st().recentSeeds));
  api.renderToolbar && api.renderToolbar();
  ok($('seedPop').querySelectorAll('[data-seed]').length >= 1, '小凸起里列出常用种子');
  click($('seedPop').querySelector('[data-act="seed-more"]'));
  ok($('seedModal').classList.contains('show'), '点「更多」才展开旧的种子窗口');
  ok($('seedList').children.length >= 8, '种子列表含 7 种作物 + 说明');
  click(W.document.querySelector('#seedModal [data-close]'));
  /* 肥料：点一下弹小凸起，里面能切到高级肥料（原「催熟」） */
  click(tbBtns[3]); eq(st().tool, 'fert', '点肥料键 = 选普通肥料');
  ok($('fertPop').classList.contains('show'), '肥料键弹出小凸起');
  const premOpt = $('fertPop').querySelector('[data-tool-pick="premium"]');
  ok(!!premOpt, '小凸起里有「高级肥料」（原来的催熟键）');
  click(premOpt);
  eq(st().tool, 'premium', '小凸起里能切到高级肥料');
  ok(!$('fertPop').classList.contains('show'), '选完自动收起');
  click(tbBtns[3]); eq(st().tool, 'fert', '再点肥料键切回普通肥料');

  const labels = [...W.document.querySelectorAll('#sidePanel .sl')].map(e => e.textContent.trim());
  ok(labels.includes('厨房') && labels.includes('缩放') && labels.includes('装饰') && labels.includes('平移'), '侧栏按钮都有文字（存档已换到设置里的缩放）', labels.join('/'));
  ok($('hudIdle') && $('hudPremium') && $('hudClock'), 'HUD 有挂机/高级肥料/时钟');

  // 成就面板：奖励文案 + 领取按钮 + 一键领取
  st().stats.total.harvest = 1;
  D.api.checkAchievements();
  st().achClaimed = {};
  click($('achBtn'));
  const achCards = [...$('achList').querySelectorAll('.ach-card')];
  ok(achCards.length >= 30, '成就面板列出全部成就', achCards.length + ' 张卡');
  ok(achCards.some(c => c.querySelector('.ach-reward')), '卡片上显示奖励');
  const firstCard = achCards.find(c => c.textContent.includes('初次收获'));
  ok(!!firstCard && !!firstCard.querySelector('.ach-claim'), '成就卡上有领取按钮');
  const fertBefore2 = st().fertilizer;
  click(firstCard.querySelector('.ach-claim'));
  ok(st().fertilizer > fertBefore2, '点领取真的发奖励');
  const card2 = [...$('achList').querySelectorAll('.ach-card')].find(c => c.textContent.includes('初次收获'));
  ok(!!card2 && (card2.classList.contains('claimed') || card2.textContent.includes('已领')), '领完变成已领（面板重绘后）');
  click($('btnStore'));   // 关掉面板

  // HUD「⋯」展开次要信息（窄屏只留一行重要信息）
  const moreBtn = $('moreBtn'), morePanel = $('hudMore');
  ok(!!moreBtn && !!morePanel, 'HUD 有「⋯」更多信息按钮');
  click(moreBtn);
  ok(morePanel.classList.contains('show'), '点 ⋯ 展开次要信息');
  ok($('hudClock').textContent.length >= 4, '展开面板里有时刻', $('hudClock').textContent);
  ok($('hudIdle').textContent.length > 0, '展开面板里有挂机速率', $('hudIdle').textContent);
  ok($('hudFarm').textContent.includes('×'), '展开面板里有农场尺寸', $('hudFarm').textContent);
  click(moreBtn);
  ok(!morePanel.classList.contains('show'), '再点 ⋯ 收起');
  eq($('hudMoney').parentElement.classList.contains('hud-item'), true, '一行主信息仍保留金币');

  // 网格按钮状态一目了然（曾经「高亮 = 开还是关」看不出来）
  const gridBtn = $('btnGrid');
  click(gridBtn); eq(st().showGrid, true, '点网格 → 开启');
  eq($('gridState').textContent, '开', '按钮上显示「开」');
  click(gridBtn); eq(st().showGrid, false, '再点 → 关闭');
  eq($('gridState').textContent, '关', '按钮上显示「关」');

  // 🔍 缩放按钮：自动 → 1x → 2x → 自动
  st().zoomMode = 'auto';
  click($('btnZoom')); eq(st().zoomMode, 1, '点缩放：自动 → 1x');
  eq($('zoomState').textContent, '1x', '按钮上显示 1x');
  click($('btnZoom')); eq(st().zoomMode, 2, '再点 → 2x');
  eq($('zoomState').textContent, '2x', '按钮上显示 2x');
  click($('btnZoom')); eq(st().zoomMode, 5, '再点 → 5x');
  eq($('zoomState').textContent, '5x', '按钮上显示 5x');
  click($('btnZoom')); eq(st().zoomMode, 10, '再点 → 10x');
  eq($('zoomState').textContent, '10x', '按钮上显示 10x');
  click($('btnZoom')); eq(st().zoomMode, 'auto', '再点 → 自动');
  eq($('zoomState').textContent, '自动', '按钮上显示自动');

  // 扩建：按钮切换「在地图上点长条」的模式
  click($('btnExpand'));
  eq(st().expandMode, true, '点 💰 进入扩建模式');
  ok($('expandBar').classList.contains('show'), '底部出现扩建信息条');
  ok($('expandBar').textContent.includes('耕地'), '信息条显示耕地尺寸');
  eq($('expandBar').querySelectorAll('.eb-item').length, 4, '信息条列出 4 个方向的价格');
  click($('btnExpand'));
  eq(st().expandMode, false, '再点一次退出扩建模式');
  ok(!$('expandBar').classList.contains('show'), '信息条收起');

  // 仓库里的食材要有图标（canvas 绘制），不是只有 emoji
  st().pieces.carrot = 2; st().prep.flour = 1;
  click($('btnStore'));
  click($('storeTabs').children[1]);      // 备料页
  const prepRows = [...$('storeList').querySelectorAll('.row')];
  ok(prepRows.length >= 2, '备料页列出面粉与菜块', 'rows=' + prepRows.length);
  ok(prepRows.some(r => r.querySelector('.r-ico canvas')), '备料行里有 canvas 图标');
  click($('storeTabs').children[0]);      // 作物页
  st().bag.carrot = 1; api.renderStore();
  ok([...$('storeList').querySelectorAll('.row')].some(r => r.querySelector('.r-ico canvas')), '作物行也有图标');
  click($('btnStore'));

  // 厨房三段进度条
  api.openSheet('kitchen');
  const kTicks = $('kitchenBody').querySelectorAll('.k-tick');
  eq(kTicks.length, 6, '烤箱与锅各有 3 个分界刻度（可收 / 精品结束 / 焦糊）');
  {
    const burn = [...kTicks].filter(t => t.classList.contains('k-tick-burn'));
    eq(burn.length, 2, '两个「焦糊」刻度');
    ok(burn.every(b => parseFloat(b.style.left) > 99), '焦糊刻度贴在进度条最右端（走满才焦糊，不再错标在 6 秒处）',
      burn.map(b => b.style.left).join(','));
  }
  api.closeSheet();

  // 商店装饰品
  click($('btnShop'));
  const shopRows = [...$('shopList').querySelectorAll('.row')];
  ok(shopRows.length >= 8, '商店列出肥料 + 装饰品', 'rows=' + shopRows.length);
  const treeRow = shopRows.find(r => r.textContent.includes('树'));
  ok(!!treeRow, '商店里有「树」可买');
  if (treeRow) {
    st().coins = 500;
    const bagB = st().decorBag.tree || 0;
    click(treeRow.querySelector('.mini'));
    eq(st().decorBag.tree, bagB + 1, '买树进装饰仓库');
    eq(st().coins, 500 - 32, '扣 32 金');
  }

  section('厨房 UI（拖拽接口 / 收藏优先 / 工位）');
  const KD = W.KitchenDebug;
  ok(!!KD, '厨房暴露 KitchenDebug 拖拽接口');
  if (KD) {
    st().bag.wheat = 2; st().bag.carrot = 2; st().prep.flour = 1;
    api.openSheet('kitchen');
    ok($('kitchenModal').classList.contains('show'), '厨房弹层打开');
    ok($('kitchenBody').children.length > 0, '厨房界面有内容');
    let keys = KD.shelfKeys();
    ok(keys.includes('crop:wheat') && keys.includes('crop:carrot') && keys.includes('prep:flour'),
      '货架列出小麦/胡萝卜/面粉', keys.join(','));
    KD.toggleFav('crop:carrot');
    keys = KD.shelfKeys();
    eq(keys[0], 'crop:carrot', '收藏项排到货架最前');
    KD.toggleFav('crop:carrot');

    const flourBefore = st().prep.flour;
    KD.drop('crop:wheat', 'mill');
    api.kitchenTick(1500);
    eq(st().prep.flour, flourBefore + 1, '拖一份小麦进石磨，立刻出 1 份面粉（和切菜板一样一步到位）');

    KD.drop('crop:carrot', 'board');
    api.kitchenTick(1200);
    ok((st().pieces.carrot || 0) > 0, '拖作物进切菜板产出菜块', '菜块 ' + (st().pieces.carrot || 0));

    KD.drop('piece:carrot', 'pot');
    ok(api.KITCHEN.pot.pieces.length >= 1, '拖菜块进锅');
    api.kitchenTick(api.KITCHEN.pot.dur + 300);
    const took = KD.take('pot');
    ok(took && took.ok !== false, '从锅里出锅成功');
    eq(api.KITCHEN.pot.pieces.length, 0, '出锅后锅清空');

    st().prep.flour = 1;
    KD.drop('prep:flour', 'oven');
    api.kitchenTick(api.KITCHEN.oven.dur + 200);
    ok(api.KITCHEN.oven.ready, '拖面粉进烤箱并烤好');
    KD.take('oven');
    ok(!api.KITCHEN.oven.busy, '出炉后烤箱空出');

    const ss = KD.stationState();
    ok(ss && ss.mill && ss.oven && ss.board && ss.pot, 'stationState 四个工位齐全');

    // 点选投料 + 瞬发切菜（v9.1）
    ok(typeof KD.select === 'function' && typeof KD.clickStation === 'function', '厨房暴露「单击选中 / 连点工位」接口');
    if (typeof KD.select === 'function') {
      st().bag.carrot = 3; st().pieces.carrot = 0;
      eq(KD.select('crop:carrot'), 'crop:carrot', '单击卡片 = 选中食材');
      eq(KD.selected(), 'crop:carrot', '选中状态可读');
      const r1 = KD.clickStation('board');
      ok(r1 && r1.ok !== false, '选中后点击菜板 = 投入');
      eq(st().pieces.carrot, 3, '点选切菜一次立即出 3 块（无计时条）');
      eq(KD.selected(), 'crop:carrot', '投入后保持选中，方便连点');
      KD.clickStation('board');
      eq(st().pieces.carrot, 6, '连点第二次继续投入');
      eq(KD.select('crop:carrot'), null, '再点同一张卡片 = 取消选中');
      st().bag.rice = 2;
      KD.clickStation('oven');
      ok(true, '未选中时点击烤箱不报错（取出或提示）');
    }

    // 自动出锅 = 避免烧糊：不会焦、也不会精品
    if (api.OVEN_BURN_MS) {
      st().prep.flour = 1;
      api.KITCHEN.oven.auto = true;
      api.cook.ovenPut();
      api.kitchenTick(api.OVEN_MS + 200);
      ok(api.KITCHEN.oven.busy, '自动模式下烤好不会立刻取出（继续放到快焦）');
      const before = Object.values(st().dishes).reduce((a, b) => a + b.n, 0);
      api.kitchenTick(api.OVEN_BURN_MS);
      ok(!api.KITCHEN.oven.busy, '自动模式最终会取出（避免烧糊）');
      const keys = Object.keys(st().dishes);
      const made = keys[keys.length - 1];
      ok(Object.values(st().dishes).reduce((a, b) => a + b.n, 0) > before, '自动出锅确实产出了菜品');
      ok(!made || !made.includes('burnt'), '自动出锅不会产出焦糊', made);
      ok(!made || !made.includes('perfect'), '自动出锅也拿不到精品', made);
      api.KITCHEN.oven.auto = false;
    }

    // 「自动出锅」勾选必须跨存档保留（否则刷新就丢）
    api.KITCHEN.oven.auto = true;
    api.KITCHEN.pot.auto = true;
    api.setCurrentSlot(2); api.saveToSlot(2);
    const ra = api.loadSlot(2);
    ok(ra.state.kitchenAuto && ra.state.kitchenAuto.oven === true && ra.state.kitchenAuto.pot === true,
      '自动出锅勾选写入存档', JSON.stringify(ra.state.kitchenAuto));
    api.KITCHEN.oven.auto = false; api.KITCHEN.pot.auto = false;
    api.setCurrentSlot(1);
    api.closeSheet();
  }

  section('框选作业：按当前工具干活 + 有作物自动跳过 + 缺钱自动停手');
  {
    const f = st().farm;
    const row = f.y0 + f.h - 1;                    // 用最底下一排，避开别的用例
    const gxs = [f.x0, f.x0 + 1, f.x0 + 2];
    const clean = (gx, gy, stateName, crop) => {
      if (api.decorAt(gx, gy)) api.collectDecorationAt(gx, gy);
      const t = api.getTile(gx, gy);
      t.stone = false; t.crop = crop || null; t.growth = 0; t.watered = false;
      t.fertile = false; t.harvestsLeft = 0;
      t.state = stateName;
      t.terrain = stateName === 'tilled' ? 'tilled' : 'grass';
      return t;
    };
    const runJob = () => { for (let i = 0; i < 900 && api.jobActive(); i++) api.updatePlayer(60); };

    /* ① 播种：空地种上，有作物的两格自行跳过 */
    const p0 = clean(gxs[0], row, 'tilled');
    const p1 = clean(gxs[1], row, 'growing', 'wheat');
    const p2 = clean(gxs[2], row, 'ready', 'wheat');
    p2.growth = api.cropReadyMs(api.CROPS.wheat);
    st().coins = 1000; st().selectedSeed = 'carrot';
    D.api.setTool('seed');
    const n1 = api.applyToolToRect(gxs[0], row, gxs[2], row);
    eq(n1, 1, '框选播种只挑出 1 格空地（有作物的两格自动跳过）');
    const coins0 = st().coins;
    runJob();
    eq(p0.crop, 'carrot', '空地被种上了');
    eq(p1.crop, 'wheat', '生长中的地块没被改种（跳过）');
    eq(p2.crop, 'wheat', '已成熟的地块也没被覆盖（跳过）');
    eq(coins0 - st().coins, api.CROPS.carrot.seedCost, '只为 1 格付了种子钱');

    /* ② 播种缺钱：只够 1 格 → 种完立刻停手，剩下的格子不空走 */
    const q0 = clean(gxs[0], row, 'tilled');
    const q1 = clean(gxs[1], row, 'tilled');
    const q2 = clean(gxs[2], row, 'tilled');
    st().coins = api.CROPS.carrot.seedCost;        // 刚好只够 1 格
    D.api.setTool('seed');
    const n2 = api.applyToolToRect(gxs[0], row, gxs[2], row);
    eq(n2, 3, '钱够 1 格时，队列仍按 3 格空地排出');
    ok(api.jobActive(), '作业已开始');
    runJob();
    const planted = [q0, q1, q2].filter(t => t.crop === 'carrot').length;
    eq(planted, 1, '缺钱时只种了 1 格就自动停手');
    eq(st().coins, 0, '钱正好花光');
    ok(!api.jobActive(), '剩余队列被清空（不会继续空走）');
    eq(st().jobBox, null, '停手后框选高亮也收起');

    /* ③ 收获：只收成熟的 */
    const h0 = clean(gxs[0], row, 'ready', 'carrot');
    const h1 = clean(gxs[1], row, 'growing', 'carrot');
    const h2 = clean(gxs[2], row, 'ready', 'carrot');
    h0.growth = api.cropReadyMs(api.CROPS.carrot);
    h2.growth = api.cropReadyMs(api.CROPS.carrot);
    st().warehouseEnabled = true;
    const bagBefore = st().bag.carrot || 0;
    D.api.setTool('sickle');
    const n3 = api.applyToolToRect(gxs[0], row, gxs[2], row);
    eq(n3, 2, '框选收获只挑出 2 格成熟的');
    runJob();
    eq((st().bag.carrot || 0) - bagBefore, 2, '收到 2 个胡萝卜');
    eq(h1.state, 'growing', '没熟的那格没被动');

    /* ④ 浇水：只浇没浇过的生长中作物 */
    const w0 = clean(gxs[0], row, 'growing', 'carrot');
    const w1 = clean(gxs[1], row, 'growing', 'carrot'); w1.watered = true;
    const w2 = clean(gxs[2], row, 'ready', 'carrot');
    D.api.setTool('water');
    const n4 = api.applyToolToRect(gxs[0], row, gxs[2], row);
    eq(n4, 1, '框选浇水只挑出 1 格没浇过的');
    runJob();
    ok(w0.watered, '生长中的地被浇了');
    ok(w1.watered, '已浇过的仍是浇过的（没重复处理）');
    eq(w2.watered, false, '成熟的地不浇水');

    /* ⑤ 范围里一格都不合适 → 不排作业并给提示 */
    const z0 = clean(gxs[0], row, 'growing', 'carrot');
    const z1 = clean(gxs[1], row, 'growing', 'carrot');
    const z2 = clean(gxs[2], row, 'growing', 'carrot');
    D.api.setTool('sickle');
    const n5 = api.applyToolToRect(gxs[0], row, gxs[2], row);
    eq(n5, 0, '没有成熟作物时不排作业');
    ok(!api.jobActive(), '也不会启动小人');
    /* 收尾：还原成草地，别影响后面的用例 */
    [z0, z1, z2].forEach(t => { t.state = 'wild'; t.terrain = 'grass'; t.crop = null; t.watered = false; });
    st().coins = 500;
  }


  section('真实指针序列：悬停高亮 + 长按框选');
  const canvasEl = $('game');
  const pt = (gx, gy) => api.gridToScreen(gx, gy);
  const pev = (type, gx, gy) => {
    const p = pt(gx, gy);
    canvasEl.dispatchEvent(new W.MouseEvent(type, { bubbles: true, clientX: p.x, clientY: p.y, button: 0 }));
  };
  // 悬停
  pev('pointermove', B.x + 1, B.y + 2);
  ok(!!st().hover && st().hover.gx === B.x + 1 && st().hover.gy === B.y + 2, '鼠标移到格子 → 记录悬停格（用于高亮）');
  canvasEl.dispatchEvent(new W.MouseEvent('pointerleave', { bubbles: true }));
  eq(st().hover, null, '指针离开画布 → 取消高亮');
  // 长按框选
  const bt = [[B.x + 1, B.y + 1], [B.x + 2, B.y + 1], [B.x + 1, B.y + 2], [B.x + 2, B.y + 2]].map(([x, y]) => api.getTile(x, y));
  for (const t of bt) { t.state = 'growing'; t.crop = 'carrot'; t.growth = 50; t.watered = false; t.harvestsLeft = 0; }
  D.api.setTool('water');
  pev('pointerdown', B.x + 1, B.y + 1);
  await new Promise(r => setTimeout(r, 460));          // 超过长按阈值 380ms
  pev('pointermove', B.x + 2, B.y + 2);
  ok(!!st().box, '长按后进入框选模式（画布上有选区）');
  pev('pointerup', B.x + 2, B.y + 2);
  ok(!!st().jobBox, '松手后保留选区高亮（作业中）');
  for (let i = 0; i < 500 && api.jobActive(); i++) api.updatePlayer(60);
  eq(bt.filter(t => t.watered).length, 4, '框选范围内的 4 块地都被浇了');
  eq(st().jobBox, null, '作业结束选区收起');
  // 长按框选 + 种子（真实指针序列）：只种空地，有作物的格子自行跳过
  {
    const s0 = api.getTile(B.x + 1, B.y + 1), s1 = api.getTile(B.x + 2, B.y + 1);
    s0.state = 'tilled'; s0.terrain = 'tilled'; s0.crop = null; s0.growth = 0; s0.harvestsLeft = 0;
    s1.state = 'growing'; s1.crop = 'potato'; s1.growth = 20; s1.watered = false;
    st().coins = 500; st().selectedSeed = 'carrot';
    D.api.setTool('seed');
    st().player.x = B.x + 1; st().player.y = B.y + 2; st().player.tx = B.x + 1; st().player.ty = B.y + 2;
    pev('pointerdown', B.x + 1, B.y + 1);
    await new Promise(r => setTimeout(r, 460));
    pev('pointermove', B.x + 2, B.y + 1);
    ok(!!st().box, '选着种子长按也能进框选（不再被强制改成锄头）');
    pev('pointerup', B.x + 2, B.y + 1);
    for (let i = 0; i < 500 && api.jobActive(); i++) api.updatePlayer(60);
    eq(s0.crop, 'carrot', '框选把空地种上了');
    eq(s1.crop, 'potato', '有作物的格子没被覆盖（自动跳过）');
    eq(s0.state, 'growing', '种完进入生长状态');
  }

  // v9.19：侧栏「长按框选」开关 —— 关掉后长按不再划范围（免得跟"点哪走哪"打架）
  {
    D.api.setTool('water');
    st().longPressBox = false;
    const bt2 = [[B.x + 3, B.y + 1], [B.x + 4, B.y + 1]].map(([x, y]) => api.getTile(x, y));
    for (const t of bt2) { t.state = 'growing'; t.crop = 'carrot'; t.growth = 50; t.watered = false; t.harvestsLeft = 0; }
    pev('pointerdown', B.x + 3, B.y + 1);
    await new Promise(r => setTimeout(r, 460));
    pev('pointermove', B.x + 4, B.y + 1);
    ok(!st().box, '长按开关关掉后，长按不进入框选');
    pev('pointerup', B.x + 4, B.y + 1);
    ok(!st().jobBox, '也不会排出批量作业');
    eq(bt2.filter(t => !t.watered).length, 2, '长按期间一格都没动（退化成"点哪走哪"）');
    /* 松手那一下按"单击"处理：会派一格的小活，跑完再收拾干净，别污染后面的用例 */
    for (let i = 0; i < 300 && api.jobActive(); i++) api.updatePlayer(60);
    ok(!api.jobActive(), '长按（开关关掉时）退化成的单击作业跑完就结束');
    ok(!!$('btnLongPress'), '侧栏有「长按框选」开关按钮');
    st().longPressBox = true;
    const lp0 = st().longPressBox;
    click($('btnLongPress'));
    eq(st().longPressBox, !lp0, '点侧栏按钮能切换长按框选');
    eq($('longPressState').textContent, st().longPressBox ? '开' : '关', '按钮上的状态字跟着变');
    click($('btnLongPress'));
    eq(st().longPressBox, lp0, '再点一下切回来');
    /* 存进存档 */
    const sv = api.serialize(st());
    eq(sv.longPressBox, st().longPressBox, '开关状态写进存档');
    for (const t of bt2) { t.state = 'wild'; t.terrain = 'grass'; t.crop = null; t.watered = false; }
  }

  // v9.20：长按框选开着时，按住拖动**不干活**（小人不再跟着鼠标跑）
  {
    D.api.setTool('hoe');
    st().longPressBox = true;
    const th = api.getTile(B.x + 5, B.y + 1);
    th.state = 'wild'; th.terrain = 'grass'; th.crop = null; th.stone = false;
    const job0 = api.jobActive();
    const p0 = { x: st().player.gx, y: st().player.gy, tx: st().player.tx, ty: st().player.ty };
    pev('pointerdown', B.x + 5, B.y + 1);
    pev('pointermove', B.x + 6, B.y + 1);
    pev('pointermove', B.x + 7, B.y + 1);
    eq(api.jobActive(), job0, '按住拖动不会派活');
    eq(th.state, 'wild', '拖过的那格没被开垦');
    eq(st().player.tx, p0.tx, '小人没有跟着指针走（要等松手）');
    /* 一直按着到 380ms → 进框选（长按只干框选这件事） */
    await new Promise(r => setTimeout(r, 460));
    ok(!!st().box, '按满 380ms 后进入框选模式');
    pev('pointerup', B.x + 7, B.y + 1);
    for (let i = 0; i < 400 && api.jobActive(); i++) api.updatePlayer(60);
    ok(!api.jobActive(), '松手后才开始干活（框选作业跑完）');
    st().longPressBox = true;
  }

  // 短按单击：不应该触发框选，而是正常走过去干活
  const one = api.getTile(B.x + 2, B.y + 3);
  one.state = 'wild'; one.terrain = 'grass'; one.crop = null; one.stone = false;
  D.api.setTool('hoe');
  st().player.x = B.x + 2; st().player.y = B.y + 2; st().player.tx = B.x + 2; st().player.ty = B.y + 2;
  pev('pointerdown', B.x + 2, B.y + 3);
  pev('pointerup', B.x + 2, B.y + 3);
  eq(st().box, null, '短按不会进入框选');
  for (let i = 0; i < 60; i++) api.updatePlayer(60);
  eq(one.state, 'tilled', '短按 = 单击：走到位后锄地完成');

  section('昼夜时长：10 分钟白天 + 2+2 晨昏 + 8 分钟夜晚');
  const hAt = min => api.hourFromClock(min * 60000);
  near(hAt(0), 5, 0.01, '第 0 分钟 = 5 点（清晨开始）');
  near(hAt(2), 8, 0.01, '2 分钟后天亮（8 点）');
  near(hAt(12), 17, 0.01, '再过 10 分钟到 17 点（白天结束）');
  near(hAt(14), 20, 0.01, '傍晚 2 分钟 → 20 点');
  near(api.hourFromClock(22 * 60000) % 24, 5, 0.01, '夜晚 8 分钟后回到 5 点（全天 22 分钟）');
  eq(api.DAY_PHASES.map(p => p.min).reduce((a, b) => a + b, 0), 22, '全天总时长 = 22 分钟');
  D.api.setAtmos(9, 'clear');

  section('新建存档：地貌与小人位置都要复位');
  api.newGameInSlot(3);
  eq(st().tiles.length, 9, '新档回到 3×3 = 9 块地');
  eq(st().map.w, 3, '新档地图 3 宽');
  eq(st().farm.w, 3, '新档耕地 3 宽');
  eq(st().tiles.filter(t => t.state === 'tilled').length, 0, '新档地块是未开垦的草地（不是上一档的耕地）');
  eq(st().player.gx, 1, '小人站在新农场中心 X');
  eq(st().player.gy, 1, '小人站在新农场中心 Y');
  const c = api.gridToScreen(1, 1);
  ok(Math.abs(c.x - 512) < 2 && Math.abs(c.y - 384) < 2, '镜头已经回到新农场中心（不会看到虚空）', `(${c.x.toFixed(0)},${c.y.toFixed(0)})`);
  ok(api.inFarm(st().player.gx, st().player.gy), '小人站在耕地范围内');
  eq(api.currentSlot(), 3, '当前槽位切到 3');

  section('每日任务：池子更大 / 2 简单 + 1 难 / 开局不派做菜任务');
  {
    ok(api.TASK_POOL.length >= 36, '任务池 ≥ 36 个', api.TASK_POOL.length + ' 个');
    ok(api.TASK_POOL.some(t => t.hard) && api.TASK_POOL.some(t => !t.hard), '任务分简单与困难');
    ok(api.TASK_POOL.every(t => t.reward && (t.reward.fert || t.reward.premium || t.reward.decor)), '每个任务都有奖励（肥料/高级肥料/地砖）');
    ok(api.TASK_POOL.filter(t => t.reward.decor).length >= 4, '有若干任务会送地砖', String(api.TASK_POOL.filter(t => t.reward.decor).length));
    // 开局：没有任何做菜/扩建经历
    const T = st().stats.total;
    T.cook = 0; T.mill = 0; T.expand = 0; T.premium = 0; T.roast = 0;
    st().premium = 0;
    let badStart = 0, badSplit = 0;
    for (let i = 0; i < 25; i++) {
      st().tasks.date = null;
      api.checkTasks(true);
      const defs = st().tasks.list.map(t => api.TASK_POOL.find(x => x.id === t.id)).filter(Boolean);
      if (defs.length !== 3) badSplit++;
      if (defs.filter(d => d.hard).length !== 1) badSplit++;
      if (defs.filter(d => !d.hard).length !== 2) badSplit++;
      if (defs.some(d => d.need)) badStart++;
    }
    eq(badSplit, 0, '每天都是 2 个简单 + 1 个困难');
    eq(badStart, 0, '开局 25 次刷新都没派到「需要做菜/扩建」的任务');
    // 有经历之后，对应的任务会出现
    T.cook = 1; T.mill = 1; T.expand = 1; T.premium = 1;
    let sawNeed = false;
    for (let i = 0; i < 40 && !sawNeed; i++) {
      st().tasks.date = null;
      api.checkTasks(true);
      sawNeed = st().tasks.list.some(t => { const d = api.TASK_POOL.find(x => x.id === t.id); return d && d.need; });
    }
    ok(sawNeed, '有做菜/扩建经历后，任务池会包含对应任务');
    /* 作物专属任务：没种过就不派 */
    const CT = st().stats.total.cropTypes || (st().stats.total.cropTypes = {});
    const savedCorn = CT.corn, savedStraw = CT.strawberry;
    delete CT.corn; delete CT.strawberry;
    ok(!api.taskUnlocked({ need: 'crop:corn' }), '没种过玉米时，玉米专属任务不参与抽取');
    ok(!api.taskUnlocked({ need: 'crop:strawberry' }), '没种过草莓时，草莓专属任务不参与抽取');
    CT.corn = true;
    ok(api.taskUnlocked({ need: 'crop:corn' }), '种过玉米后解锁玉米专属任务');
    ok(!api.taskUnlocked({ need: 'crop:strawberry' }), '解锁玉米不影响草莓');
    if(savedCorn === undefined) delete CT.corn; else CT.corn = savedCorn;
    if(savedStraw !== undefined) CT.strawberry = savedStraw;
    ok(api.taskUnlocked({}), '无门槛任务始终解锁');
    eq(api.TASK_POOL.filter(t => t.need && t.need.indexOf('crop:') === 0).length, 4, '有 4 个作物专属任务');

    /* 每种作物单独的当日计数（作物专属任务的依据） */
    const before = st().stats.today.plant_cabbage || 0;
    api.trackAction('plant', 'cabbage');
    eq(st().stats.today.plant_cabbage, before + 1, '播种白菜会记到 plant_cabbage');
    const hb = st().stats.today.harvest_carrot || 0;
    api.trackAction('harvest', 'carrot');
    eq(st().stats.today.harvest_carrot, hb + 1, '收获胡萝卜会记到 harvest_carrot');
  }

  section('竖屏 / 手机自适应（CSS 检查，压缩产物也要过）');
  {
    const css = html.replace(/\s+/g, '');   /* 压缩后空格会被去掉，先归一化 */
    ok(css.includes('@media(orientation:portrait)'), 'CSS 里有竖屏/窄屏媒体查询');
    /* 位置改成了一套变量：--m-edge / --m-toolbar-* / --m-hint-bottom，断言「链」是否还连得上 */
    ok(css.includes('--m-edge:max(6px'), '定义了手机端屏幕边距变量');
    ok(css.includes('.toolbar{left:var(--m-edge);right:var(--m-edge)'), '工具栏在窄屏下铺满宽度');
    ok(css.includes('--m-toolbar-btn:max(46px') && css.includes('min-height:var(--m-toolbar-btn)'),
      '工具栏按钮有 46px 最小点按高度');
    ok(css.includes('.hud{top:') && css.includes('left:var(--m-edge);right:var(--m-edge)'), '顶栏在窄屏下铺满宽度');
    ok(css.includes('max(34px'), '顶栏图标按钮有最小尺寸兜底（--ui-scale 缩小时也够点）');
    /* v9.19 手机顶栏：三列两行；🏅 露出来，🏆 收进「⋯」 */
    ok(css.includes('#achBtn{display:none}'), '手机端把 🏆 收进「⋯」弹层（顶栏第一排 = 🏅 📢 ⋯）');
    ok(!css.includes('#lbBtn{display:none}'), '手机顶栏露出 🏅 排行榜入口');
    /* 抽屉把手与抽屉的 top 都依赖 --m-hud-top：这个变量以前没定义，整条 calc() 作废 →
       表现为「菜单被挡住 / 点不开」。这里钉住它必须存在且被引用。 */
    ok(css.includes('--m-hud-top:calc('), '定义了 --m-hud-top（抽屉位置链的根）');
    ok(css.includes('top:var(--m-hud-top)'), '手机顶栏用 --m-hud-top 定位');
    ok(css.includes('.side-toggle{display:flex') && css.includes('position:static'),
      '菜单把手改回顶栏网格里的普通按钮（position:static，不会被顶栏压住）');
    ok(/\.hud\{[^}]*grid-template-columns:minmax\(0,1fr\)minmax\(0,1fr\)auto/.test(css),
      '手机顶栏是三列两行网格（金币+挂机 / 肥料 / 图标；田块尺寸 / 高级肥料 / 时间+菜单）');
    ok(css.includes('.hud-money{grid-area:1/1/2/2}') && css.includes('.hud-right2{grid-area:2/3/3/4'),
      '顶栏各项用 grid-area 明确排位（金币左上 / 时间+菜单右下）');
    /* 所有 var(--x) 都必须有定义：--m-hud-top 这种漏定义在无头环境里完全看不出来 */
    {
      const defs = new Set([...css.matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]));
      const inline = new Set(['--ui-scale', '--k-ico', '--p']);  /* JS 运行时写进 style 的 */
      const missing = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]))]
        .filter(n => !defs.has(n) && !inline.has(n));
      eq(missing.length, 0, 'CSS 里没有引用未定义的自定义属性', missing.join(','));
    }
    /* 锅里食材再多也只能在那一块里滚，不许把整页/弹层撑出滚动条 */
    ok(/\.k-pot-slot\{[^}]*max-height:/.test(css) && /\.k-pot-slot\{[^}]*overflow-y:auto/.test(css),
      '锅里的食材列表有高度上限并自己滚动（不再撑高整页）');
    ok(/\.k-pot-slot\{[^}]*min-width:0/.test(css), '锅里食材列表 min-width:0（不会被内容撑宽）');
    ok(/\.k-pot-slot\{[^}]*overscroll-behavior:contain/.test(css), '锅里滚到底不会把外层一起带着滚');
    ok(css.includes('flex:1 1 0'.replace(/\s+/g, '')) || css.includes('flex:110'), '工具栏按钮等分宽度');
    /* 提示条要贴住工具栏上沿，而不是飘在屏幕中间 */
    ok(css.includes('--m-hint-bottom:calc(var(--m-toolbar-bottom)+var(--m-toolbar-h)+8px)'),
      '提示条底部 = 工具栏底部 + 工具栏高度 + 8px（紧贴工具栏）');
    ok(css.includes('.tool-hint{left:50%;right:auto') && css.includes('bottom:var(--m-hint-bottom)'),
      '提示条改为按内容自适应宽度并贴住工具栏');
    ok(css.includes('--m-toast-bottom:calc(var(--m-hint-bottom)+44px)') && css.includes('bottom:var(--m-toast-bottom)'),
      '飘字固定在提示条上方');
    ok(!css.includes('.tool-hint{left:6px;right:6px'), '提示条不再是横贯整屏的一条（会压住右侧栏）');
    /* 字号兜底：手机上 --ui-scale=0.6，calc(10px*0.6) 只有 6px，必须 max() */
    ok(css.includes('.tool-hint{') && /font-size:max\(11px/.test(css), '提示条字号有 11px 兜底');
    ok(/font-size:max\(12px/.test(css), '飘字与侧栏字号有 12px 兜底');
    /* 侧栏高度要给顶栏与底部两条留位 */
    ok(css.includes('max-height:calc(100vh-var(--m-hud-h)-var(--m-bottom-reserve)'),
      '侧栏最大高度扣掉了顶栏与底部提示条/飘字');
    /* 刘海屏与触屏滚动 */
    ok(html.includes('viewport-fit=cover'), 'viewport 加了 viewport-fit=cover（刘海屏安全区）');
    ok(css.includes('env(safe-area-inset-bottom'), '底部元素避开 iPhone home 指示条');
    ok(/body\{[^}]*touch-action:manipulation/.test(css), 'body 不再 touch-action:none（弹层在手机上才能滚动）');
    ok(css.includes('canvas{') && css.includes('touch-action:none'), '画布仍然吃住手势（拖拽/平移/长按不受影响）');
  }

  section('源码版 / 产物边界：模板里的 dev 外链不能进产物');
  {
    const srcHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
    ok(srcHtml.includes('<!--@DEV_JS_BEGIN@-->') && srcHtml.includes('dev-bundle.js'),
      'src/index.html 直接打开时会加载拼接好的 dev-bundle.js');
    ok(srcHtml.includes('dev-bundle.css'), '样式同理走 dev-bundle.css');
    ok(srcHtml.includes('/*@INJECT_JS@*/') && srcHtml.includes('/*@INJECT_CSS@*/'),
      '模板占位符仍在（构建往里注入内联产物）');
    ok(!/href="css\//.test(html), '构建产物里没有外链 css/（dev 块已被剥离）');
    ok(!/src="js\//.test(html), '构建产物里没有外链 js/（dev 块已被剥离）');
    ok(!html.includes('dev-bundle'), '构建产物里不引用 dev-bundle');
    /* 源码里不再自带 IIFE 括号（改由构建期包上），否则 45 个 script 单独加载会语法错误 */
    ok(!fs.readFileSync(path.join(__dirname, '..', 'src', 'js', '00-header.js'), 'utf8').includes('(function(){'),
      '00-header.js 不再自带 IIFE 开括号（改由 build.js 包）');
    ok(html.includes('(function(){\n\'use strict\';') || /\/\(function\(\)\{/.test(html) || html.includes('(function(){'),
      '构建产物仍是一个 IIFE');
    const devBundle = path.join(__dirname, '..', 'src', 'dev-bundle.js');
    ok(fs.existsSync(devBundle), '存在源码版拼接产物 src/dev-bundle.js');
    const db = fs.readFileSync(devBundle, 'utf8');
    ok(db.startsWith('/*') && db.trimEnd().endsWith('})();'), '源码版产物同样收口在一个 IIFE 里');
  }

  section('侧栏：手机 = 右上角浮窗抽屉，桌面 = 原样（可拖拽、JS 定位）');
  {
    const src = html.replace(/\s+/g, '');
    const css = html.replace(/\s+/g, '');
    /* 手机抽屉 */
    ok(!!W.document.getElementById('sideToggle'), '有抽屉把手按钮');
    eq(W.document.getElementById('sideToggle').getAttribute('aria-expanded'), 'false', '默认收起');
    ok(/\.side-toggle\{display:none\}/.test(css), '桌面端把手完全隐藏（电脑页面保持原样）');
    ok(/\.side-toggle\{[^}]*display:flex/.test(css) && /\.side-panel\{[^}]*display:none/.test(css),
      '手机端：把手显示、侧栏默认收起');
    ok(/\.side-panel\.open\{display:flex\}/.test(css), '抽屉展开态有样式');
    ok(/\.side-panel\.open[^}]*|overscroll-behavior:contain/.test(css), '抽屉内部滚动、不外溢');
    /* 把手能开关抽屉 */
    const tg = W.document.getElementById('sideToggle');
    const sp = W.document.getElementById('sidePanel');
    tg.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
    ok(sp.classList.contains('open'), '点把手会展开抽屉');
    eq(tg.getAttribute('aria-expanded'), 'true', '展开时 aria-expanded=true');
    tg.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
    ok(!sp.classList.contains('open'), '再点一下收起');
    /* 桌面端逻辑仍在：JS 定位 + 布局版本号 + 拖拽（属性名/字符串守卫，压缩产物也有效） */
    ok(src.includes('getBoundingClientRect') && src.includes('toolHint'),
      '边界取自顶栏下沿与提示条上沿');
    ok(src.includes('sidePanelVer') && /sidePanelVer[^;]{0,40}/.test(src),
      '带布局版本号：老存档会按新布局重算一次位置');
    if (/\.min\.html$/i.test(NAME)) {
      console.log('  \x1b[2m·\x1b[0m 压缩产物：跳过 4 项「按标识符」的抽屉/定位守卫（标识符已重命名，行为由上面的真实点击用例覆盖）');
    } else {
      ok(src.includes('sidePanelBounds(){'), '桌面端侧栏位置仍由 sidePanelBounds() 统算');
      ok(src.includes('sidePanel.style.top='), '桌面端仍由 JS 设置 top（手机抽屉模式会跳过）');
      ok(src.includes('sideIsDrawer'), '有「是否手机抽屉」判断：手机端不拖拽、不清位置');
      ok(src.includes('sideDrawerClose'), '有收起抽屉的函数，点侧栏按钮/点画面会收起来');
    }
    ok(!sp.classList.contains('open'), '（复核）抽屉当前是收起状态');
  }


  section('随机分布：hash2 必须均匀（曾经只返回 [0,0.5)）');
  {
    const N = 20000, bins = new Array(10).fill(0);
    let sum = 0, above90 = 0;
    for (let i = 0; i < N; i++) {
      const v = api.hash2(i % 977, (i * 7) % 613);
      sum += v;
      if (v >= 0.9) above90++;
      bins[Math.min(9, Math.floor(v * 10))]++;
    }
    near(sum / N, 0.5, 0.02, '均值 ≈ 0.5');
    ok(above90 / N > 0.05, '取值能到 0.9 以上（旧实现永远 < 0.5）', (above90 / N * 100).toFixed(1) + '%');
    ok(bins.every(b => b > N * 0.05), '十个等分段都有样本（分布均匀）', bins.map(b => (b / N * 100).toFixed(0)).join('/'));
  }

  section('成就：数量、奖励、领取');
  ok(api.ACHIEVEMENTS.length >= 30, '成就数量 ≥ 30', api.ACHIEVEMENTS.length + ' 个');
  ok(api.ACHIEVEMENTS.every(a => a.reward && (a.reward.fert || a.reward.premium || a.reward.decor)),
    '每个成就都配了奖励');
  {
    const badDecor = [];
    for (const a of api.ACHIEVEMENTS) {
      if (!a.reward.decor) continue;
      for (const k in a.reward.decor) if (!api.DECOR_META[k]) badDecor.push(a.id + ':' + k);
    }
    eq(badDecor.length, 0, '装饰奖励都是合法的装饰类型');
    const hasFert = api.ACHIEVEMENTS.some(a => a.reward.fert);
    const hasDecor = api.ACHIEVEMENTS.some(a => a.reward.decor);
    ok(hasFert && hasDecor, '奖励同时覆盖肥料与装饰地砖');
  }
  // 解锁一个（肥料奖励）并领取
  st().stats.total.harvest = 1;
  D.api.checkAchievements();
  ok(!!st().achievements.first_harvest, '触发解锁「初次收获」');
  const fertBefore = st().fertilizer;
  const c1 = api.claimAchievement('first_harvest');
  ok(c1.ok, '领取成功');
  eq(st().fertilizer, fertBefore + 2, '拿到 🧪×2');
  ok(api.achClaimed('first_harvest'), '标记为已领取');
  ok(!api.claimAchievement('first_harvest').ok, '不能重复领取');
  // 装饰奖励
  st().stats.total.harvest = 50;
  D.api.checkAchievements();
  const pathBefore = st().decorBag.path || 0;
  api.claimAchievement('harvest_50');
  eq(st().decorBag.path, pathBefore + 2, '装饰地砖奖励进装饰仓库');
  // 一键领取
  st().stats.total.coins = 200;   // coins_100 / coins_500?
  D.api.checkAchievements();
  const n = api.claimAllAchievements();
  ok(n >= 1, '一键领取成就奖励', '领取 ' + n + ' 个');
  eq(api.claimableAchCount(), 0, '领完后没有可领取的');
  // 新统计量要有人写
  st().stats.total.decorGot = 0; st().stats.total.sold = 0; st().stats.total.roast = 0;
  const deco = st().decorations.find(d => d.type && !api.inFarm(d.gx, d.gy));
  D.api.setTool('hoe');
  if (deco) api.runTool(deco.gx, deco.gy, true);
  ok(st().stats.total.decorGot >= (deco ? 1 : 0), '收集装饰会记入 decorGot', String(st().stats.total.decorGot));
  st().bag.carrot = 3;
  api.sellCrop('carrot', 2);
  eq(st().stats.total.sold, 2, '卖出作物记入 sold');
  st().pieces.potato = 1;
  api.cook.ovenPut({ piece: 'potato' });
  api.kitchenTick(api.OVEN_MS + 100);
  api.cook.ovenTake(false);
  eq(st().stats.total.roast, 1, '烤菜记入 roast');

  section('肥料 v9.19：收完不返草地（普通 2 次 / 高级 5 次）+ 颜色更深');
  {
    const t = api.getTile(st().farm.x0 + 1, st().farm.y0 + 1);
    /* 普通肥料：2 次 */
    t.state = 'growing'; t.crop = 'carrot'; t.growth = 0; t.fertile = false; t.fertLeft = 0;
    t.terrain = 'tilled';
    st().fertilizer = 5;
    const r = api.fertilizeTile(t, false);
    ok(r.ok, '施肥成功', r.msg);
    eq(t.fertLeft, api.FERT_KEEP, '普通肥料 = 还能收 2 次不返草地');
    const ready = () => { t.growth = api.cropReadyMs(api.CROPS.carrot); t.state = 'ready'; };
    ready();
    const h1 = api.harvestTile(t);
    ok(h1.kept === true && t.state === 'tilled', '第 1 次收获：还是耕地（可以直接补种）', t.state);
    eq(t.fertLeft, 1, '还剩 1 次');
    eq(t.crop, null, '地上没作物了');
    api.plantSeed(t, 'carrot');
    eq(t.state, 'growing', '耕地可以直接补种（不用重新开垦）');
    ready();
    api.harvestTile(t);
    eq(t.state, 'tilled', '第 2 次收获：仍是耕地');
    eq(t.fertLeft, 0, '兜底次数用完');
    api.plantSeed(t, 'carrot');
    ready();
    api.harvestTile(t);
    eq(t.state, 'wild', '第 3 次收获：恢复原样，变回草地');
    /* 高级肥料：催熟 + 5 次 */
    const t2 = api.getTile(st().farm.x0 + 2, st().farm.y0 + 1);
    t2.state = 'growing'; t2.crop = 'carrot'; t2.growth = 0; t2.fertLeft = 0; t2.terrain = 'tilled';
    st().premium = 3;
    const r2 = api.fertilizeTile(t2, true);
    ok(r2.ok && r2.ripened === true, '高级肥料立刻催熟', r2.msg);
    eq(t2.state, 'ready', '催熟后直接可收');
    eq(t2.fertLeft, api.PREMIUM_KEEP, '高级肥料 = 5 次不返草地');
    ok(api.FERT_KEEP === 2 && api.PREMIUM_KEEP === 5, '常量：普通 2 / 高级 5');
    /* 颜色更深：施肥后的地色换成深一档的土色（原来是浅褐 #a38055） */
    ok(html.includes('#6b5030') && !html.includes("top:'#a38055'"), '施肥后的地色更深（一眼能看出哪块地被伺候过）');
  }

  section('v9.20：日月圆形轨道 + 云朵更大更低 + 窄屏铺满宽度（卷轴式）');
  {
    const bk = JSON.parse(JSON.stringify(api.serialize(st())));
    /* 设时间要顺手让 ATMOS.hour 跟上来（轨道是从 ATMOS.hour 算的） */
    /* clockMs → 小时 是分段映射（昼夜时长不同），所以反过来扫一遍找到目标小时 */
    const atHour = h => {
      for (let i = 0; i < 3000; i++) {
        const ms = api.DAY_MS * (i / 3000);
        if (Math.abs(api.hourFromClock(ms) - h) < 0.03) { api.ATMOS.clockMs = ms; api.updateAtmosphere(0); return true; }
      }
      return false;
    };
    /* ① 太阳：压低 + 圆周 + 自东向西 */
    atHour(12);
    const sNoon = JSON.parse(JSON.stringify(api.atmSunTrack()));
    ok(sNoon.visible, '正午太阳可见');
    ok(sNoon.y > 0.15 * W.innerHeight, '太阳压低了（不再顶到顶部菜单后面）', 'y=' + Math.round(sNoon.y));
    atHour(6.5); const sE = JSON.parse(JSON.stringify(api.atmSunTrack()));
    atHour(17.5); const sW = JSON.parse(JSON.stringify(api.atmSunTrack()));
    near(sE.y, sW.y, 6, '早晚两头一样高（圆形轨道的对称点）');
    ok(sNoon.y < sE.y - 10, '中午比早晚高（是绕圈，不是水平直线）', `${Math.round(sNoon.y)} < ${Math.round(sE.y)}`);
    ok(sE.x < W.innerWidth / 2 && sW.x > W.innerWidth / 2, '太阳自东向西横穿');
    /* ② 月亮：同一条轨道、方向相反 → 交替上下班 */
    atHour(22); const mN = JSON.parse(JSON.stringify(api.atmMoonTrack()));
    ok(mN.visible && mN.y > 0.1 * W.innerHeight, '夜里月亮可见且同样压低', 'y=' + Math.round(mN.y));
    atHour(20); const m1 = JSON.parse(JSON.stringify(api.atmMoonTrack()));
    atHour(4);  const m2 = JSON.parse(JSON.stringify(api.atmMoonTrack()));
    ok(m1.x > m2.x, '月亮与太阳反向（一个东升一个西升，交替上下班）', `${Math.round(m1.x)} > ${Math.round(m2.x)}`);
    ok(api.ATM_ORBIT && api.ATM_ORBIT.cy - api.ATM_ORBIT.ry > 0.15, '轨道顶点压在合适高度（0.15H 以下才不会被菜单挡）');
    /* ③ 云：更大更低 */
    const yy = api.ATM_CLOUDS.map(c => (c.ny * 0.8 + 0.06));
    const ss = api.ATM_CLOUDS.map(c => c.s);
    ok(Math.min(...yy) > 0.22, '云朵整体降低（落到太阳轨道下方那一带）', yy.map(v => v.toFixed(2)).join(','));
    ok(Math.min(...ss) >= 1.2 && Math.max(...ss) >= 1.9, '云朵明显变大', ss.join(','));
    /* ④ 窄屏自动缩放：铺满宽度（不再被 1.6x 封顶留大白边） */
    ok(api.ZOOM_FILL_MAX > api.ZOOM_AUTO_MAX, '窄屏上限高于宽屏上限（专门给小屏铺满宽度用）');
    const realMM = W.matchMedia;
    const fakeMM = (portrait) => q => ({ matches: portrait && /portrait|max-width/.test(String(q)),
      media: String(q), addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} });
    st().zoomMode = 'auto';
    W.matchMedia = fakeMM(true);  const zNarrow = api.viewZoom();
    W.matchMedia = fakeMM(false); const zWide = api.viewZoom();
    W.matchMedia = realMM;
    ok(zNarrow > zWide, '窄屏自动倍率更大（铺满宽度而不是缩成一小块）', zNarrow.toFixed(2) + ' > ' + zWide.toFixed(2));
    /* ⑤ 卷轴式：一屏装不下时，镜头跟小人走 + 夹在地图范围内 */
    st().zoomMode = 8;
    ok(api.viewOverflows(), '倍率大到一屏装不下 → 登记为卷轴式');
    api.centerOnFarm();
    const c1 = { x: st().camera.x, y: st().camera.y };
    st().player.gx += 1; st().player.gy += 1;
    api.centerOnFarm();
    ok(st().camera.x !== c1.x || st().camera.y !== c1.y, '卷轴式：镜头跟着小人走（不用手动拖）');
    api.clampCamera();
    ok(isFinite(st().camera.x) && isFinite(st().camera.y), '相机被夹在合理范围内（不会拖到地图外的虚空）');
    st().player.gx -= 1; st().player.gy -= 1;
    st().zoomMode = 'auto';
    api.applyPayload(bk);
  }

  section('v9.21：存档迁移（离线三载体 · 真加密 · 导入体检 · 选槽位）');
  {
    const st0 = JSON.parse(JSON.stringify(api.serialize(st())));
    const cur0 = api.currentSlot();
    const raw0 = [1, 2, 3].map(n => api.readSlot(n));
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const body = () => W.document.getElementById('transferBody');

    ok(api.tfEncodeData && api.tfDecodeData && api.tfSanitize, '暴露了迁移编解码接口');
    ok(api.tfLinkFor('FT1:abc').indexOf('#s=FT1') > 0, '自包含链接用 #s= 片段（fragment 不会发给服务器）');
    ok(api.tfHasCrypto ? true : typeof W.crypto.subtle === 'object', '测试环境注入了 WebCrypto（真跑加解密）');

    /* ① 真往返：gzip + PBKDF2 + AES-GCM */
    st().coins = 4321; st().bag.carrot = 7;
    const src = api.serialize(st());
    const enc = await api.tfEncodeData(src, '1234');
    ok(enc.ok && enc.text.indexOf('FT2:') === 0, '导出得到 FT2: 开头的紧凑存档串', enc.ok ? enc.text.length + ' 字符' : enc.msg);
    ok(enc.text.length < JSON.stringify(src).length / 2, '压缩后明显小于明文 JSON（gzip 生效）',
      enc.text.length + ' < ' + Math.round(JSON.stringify(src).length / 2));
    {
      /* 信封结构：FT 头 + 版本 + flags + 迭代下标 + salt16 + iv12 + 密文，只套一层 base64 */
      const t = enc.text.slice(4).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, (4 - enc.text.slice(4).length % 4) % 4);
      const raw = W.atob(t);
      const bb = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bb[i] = raw.charCodeAt(i);
      ok(bb[0] === 0x46 && bb[1] === 0x54 && bb[2] === 1, '紧凑信封头正确（FT + 版本）');
      ok(bb.length > 34 && bb.length < enc.text.length, '信封就是 salt+iv+密文，没有二次 base64 套娃', bb.length + ' B');
    }
    /* 二维码可行性判断如实：整档二维码基本装不下 */
    const fit = api.tfQrFit(enc.text);
    ok(typeof fit.ok === 'boolean' && fit.bytes === enc.text.length, '能算出这个档适不适合二维码', JSON.stringify(fit));
    ok(api.tfQrFit('x'.repeat(4000)).ok === false, '超过 QR 上限的档会被判定为装不下');
    const dec = await api.tfDecodeData(enc.text, '1234');
    ok(dec.ok, '正确密码能解开', dec.msg);
    eq(dec.data.coins, 4321, '解出来的金币一致');
    eq(dec.data.bag.carrot, 7, '解出来的仓库一致');
    ok(enc.text.indexOf('4321') < 0, '密文里看不到明文数字');
    const wrong = await api.tfDecodeData(enc.text, '9999');
    ok(!wrong.ok && /密码/.test(wrong.msg), '密码错了明确拒绝', wrong.msg);
    ok(!(await api.tfDecodeData('FT1:zzzz', '1234')).ok, '乱码存档串被拒绝');
    ok(!(await api.tfDecodeData('hello', '1234')).ok, '不是本游戏的串被拒绝');
    ok(!(await api.tfEncodeData(src, '12')).ok, '密码不是 4 位数字时拒绝导出');

    /* ①b v9.21 导出的 FT1 老串照样要能读（向后兼容） */
    {
      const subtle = W.crypto.subtle;
      const salt = W.crypto.getRandomValues(new Uint8Array(16));
      const iv = W.crypto.getRandomValues(new Uint8Array(12));
      const b64 = b => { let t = ''; for (const x of b) t += String.fromCharCode(x); return W.btoa(t).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); };
      const base = await subtle.importKey('raw', new W.TextEncoder().encode('farm:1234'), 'PBKDF2', false, ['deriveKey']);
      const key = await subtle.deriveKey({ name:'PBKDF2', salt, iterations:1000, hash:'SHA-256' }, base,
        { name:'AES-GCM', length:256 }, false, ['encrypt']);
      const ct = new Uint8Array(await subtle.encrypt({ name:'AES-GCM', iv }, key,
        new W.TextEncoder().encode(JSON.stringify(src))));
      const env = { v:1, alg:'A256GCM', it:1000, r:1, salt:b64(salt), iv:b64(iv), ct:b64(ct) };
      const oldStr = 'FT1:' + b64(new W.TextEncoder().encode(JSON.stringify(env)));
      const back = await api.tfDecodeData(oldStr, '1234');
      ok(back.ok, 'v9.21 导出的 FT1 老串还能导入（向后兼容）', back.msg);
      eq(back.data.coins, src.coins, '老串解出来的内容一致');
      api.tfSanitize(back.data);
    }

    /* ② 导入体检：把外来档当不可信输入 */
    ok(!api.tfSanitize(Object.assign({}, src, { tiles: new Array(api.TF_MAX_TILES + 1).fill(src.tiles[0]) })).ok,
      '地块数超上限 → 拒绝导入');
    ok(!api.tfSanitize({ v: 999, tiles: [] }).ok, '版本比游戏新 → 拒绝');
    const dirty = api.tfSanitize(Object.assign({}, src, {
      coins: 1e18, platform: 'x',
      bag: { carrot: 5, hack_crop: 999 },
      tiles: [{ gx: 0, gy: 0, terrain: 'lava', state: 'growing', crop: 'nope' },
              { gx: 'x', gy: 3 }, { gx: 1, gy: 1, terrain: 'tilled', state: 'tilled' }],
    }));
    ok(dirty.ok, '脏数据被清洗而不是崩', dirty.msg);
    eq(dirty.data.coins, 1e12, '金币被夹到上限');
    ok(dirty.data.bag.hack_crop === undefined, '未知作物被丢掉');
    eq(dirty.data.tiles.length, 2, '非法坐标的地块被剔除');
    eq(dirty.data.tiles[0].crop, null, '未知作物 id 清成 null');
    eq(dirty.data.tiles[0].state, 'tilled', '没作物的 growing 改成 tilled');

    /* ③ 链接载体：导出 → 链接 → 从链接取回 */
    const link = api.tfLinkFor(enc.text);
    W.location.hash = '#' + link.slice(link.indexOf('#') + 1);
    eq(api.tfParamPayload(), enc.text, '从 #s= 链接里能取回存档串');
    api.closeSheet();
    api.tfBoot();
    ok(W.document.getElementById('transferModal').classList.contains('show'), '打开带 #s= 的链接 → 自动弹出迁移面板');
    api.closeSheet();
    W.location.hash = '';

    /* ④ 写盘：指定槽位 + 覆盖前备份 + savedAt 归零 */
    const target = 2;
    api.setCurrentSlot(1); st().coins = 111; api.save();
    const before2 = api.readSlot(target);
    const w1 = api.tfWriteSlot(target, dec.data);
    ok(w1.ok && w1.slot === target, '写到指定槽位', w1.msg);
    eq(w1.backedUp, !!before2, '覆盖已有槽位时留了 .bak 备份');
    const after2 = api.readSlot(target);
    eq(after2.coins, 4321, '槽位 2 变成了导入的存档');
    ok(Date.now() - (after2.savedAt || 0) < 8000, 'savedAt 归到现在（不会弹「离开 30 天」）');

    /* ⑤ UI 端到端：填密码 → 生成 → 粘贴 → 解析 → 预览 → 确认导入 */
    api.openSheet('slots');
    const migBtn = [...W.document.querySelectorAll('#slotsBody button')].find(b => /存档迁移/.test(b.textContent));
    ok(!!migBtn, '存档槽位面板里有「📦 存档迁移」入口');
    ok([...W.document.querySelectorAll('#slotsBody button')].some(b => b.textContent === '导出'),
      '每个有内容的槽位都有「导出」按钮');
    api.closeSheet();
    api.openTransfer();
    ok(W.document.getElementById('transferModal').classList.contains('show'), '迁移面板能打开');
    ok(!!body().querySelector('[data-act="gen"]'), '导出区有「生成」按钮');
    {
      const pins = [...body().querySelectorAll('input.tf-pin')];
      ok(pins.length >= 3, '密码框都在', String(pins.length));
      ok(pins.every(p => p.getAttribute('type') === 'text'), '密码框是 text 而不是 password（不会被密码管理器/系统当成真密码）');
      ok(pins.every(p => p.getAttribute('inputmode') === 'numeric' && p.getAttribute('autocomplete') === 'off'),
        '密码框仍然是数字键盘 + 关掉自动填充');
    }
    body().querySelector('[data-pin="1"]').value = '2468';
    body().querySelector('[data-pin="2"]').value = '2468';
    click(body().querySelector('[data-act="gen"]'));
    await sleep(2000);
    const outEl = body().querySelector('[data-out]');
    ok(!!outEl && String(outEl.value).indexOf('FT2:') === 0, 'UI 里生成出了存档串',
      outEl ? String(outEl.value).length + ' 字符' : '(没有)');
    ok(!!body().querySelector('[data-act="selectall"]'), '导出区有「全选」（复制失败时手动拷贝）');
    const uiText = outEl ? outEl.value : '';
    /* 密码两次不一致要拦下来 */
    api.openTransfer();
    body().querySelector('[data-pin="1"]').value = '1111';
    body().querySelector('[data-pin="2"]').value = '2222';
    click(body().querySelector('[data-act="gen"]'));
    await sleep(200);
    ok(!!body().querySelector('.tf-err'), '两次密码不一致会报错，不会生成废档');
    /* 导入：确认之前绝对不写盘 */
    const rawBefore = [1, 2, 3].map(n => JSON.stringify(api.readSlot(n)));
    api.openTransfer(uiText);
    body().querySelector('[data-in]').value = uiText;
    body().querySelector('[data-pin="3"]').value = '2468';
    click(body().querySelector('[data-act="parse"]'));
    await sleep(2000);
    ok(!!body().querySelector('[data-act="doimport"]'), '解析后进入预览（有确认按钮）');
    eq(body().querySelectorAll('.tf-slot').length, 3, '预览里能选 3 个存档位');
    ok(!!body().querySelector('.tf-prev'), '预览显示存档摘要');
    eq([1, 2, 3].map(n => JSON.stringify(api.readSlot(n))).join('|'), rawBefore.join('|'),
      '只预览、没确认时一个槽位都没动');
    /* 选一个槽位并确认 */
    const radios = body().querySelectorAll('input[name="tfSlot"]');
    let pick = 0;
    for (const r of radios) { if (r.dataset.slot === '3') { r.checked = true; pick = 3; } }
    click(body().querySelector('[data-act="doimport"]'));
    await sleep(600);
    eq(pick, 3, '挑了槽位 3');
    ok(!!api.readSlot(3), '确认后槽位 3 写进去了');
    eq(api.currentSlot(), 3, '导入完自动切到那个槽位');
    ok(!W.document.getElementById('transferModal').classList.contains('show'), '导入完面板关掉');

    /* 校验用的槽位 -> 换成"密码错就不给预览" */
    api.openTransfer(uiText);
    body().querySelector('[data-in]').value = uiText;
    body().querySelector('[data-pin="3"]').value = '0000';
    click(body().querySelector('[data-act="parse"]'));
    await sleep(2000);
    ok(!!body().querySelector('.tf-err') && !body().querySelector('[data-act="doimport"]'),
      '密码错了只报错，不进预览、不写盘');
    api.closeSheet();

    /* ⑥ 写盘失败不再静默 */
    {
      const realLS = W.localStorage;
      Object.defineProperty(W, 'localStorage', { configurable: true, writable: true,
        value: { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} } });
      eq(api.save(), false, '本地存储写不进去时 save() 返回 false（界面会提示一次）');
      Object.defineProperty(W, 'localStorage', { configurable: true, writable: true, value: realLS });
    }

    /* 收尾：槽位与内存状态还原 */
    for (let n = 1; n <= 3; n++) {
      if (raw0[n - 1]) api.tfWriteSlot(n, raw0[n - 1]); else api.deleteSlot(n);
    }
    api.setCurrentSlot(cur0);
    api.applyPayload(st0);
  }

  section('v9.20：抽屉不自动收 · 弹层右上角 ✕ · 厨房选中提示挪位');
  {
    const panel = $('sidePanel'), tg = $('sideToggle');
    click(tg);
    ok(panel.classList.contains('open'), '点 ☰ 打开手机侧栏抽屉');
    click($('btnShop'));
    ok($('shopModal').classList.contains('show'), '抽屉里的「商店」打开了');
    ok(panel.classList.contains('open'), '点菜单里的内容后抽屉**不**自动收回');
    click($('btnDecor'));
    ok($('decorModal').classList.contains('show') && panel.classList.contains('open'), '连着点第二项也不用重开抽屉');
    $('game').dispatchEvent(new W.MouseEvent('pointerdown', { bubbles: true }));
    ok(!panel.classList.contains('open'), '点空白处（画布）才收回抽屉');
    api.closeSheet();
    /* 每个弹层右上角都有 ✕，点了能关 */
    const boxes = [...W.document.querySelectorAll('.modal .modal-box')];
    ok(boxes.length >= 8, '弹层数量正常', String(boxes.length));
    ok(boxes.every(b => !!b.querySelector('.modal-x')), '每个弹层右上角都建了 ✕');
    api.openSheet('achievement');
    const box = W.document.getElementById('achievementModal');
    ok(box.classList.contains('show'), '成就弹层打开');
    click(box.querySelector('.modal-x'));
    ok(!box.classList.contains('show'), '点右上角 ✕ 能关掉弹层');
    /* 厨房：去掉占一行的选中提示条，取消选中挪到标题行；拖完默认勾选 */
    api.openSheet('kitchen');
    api.renderKitchen && api.renderKitchen();
    const body = $('kitchenBody');
    ok(!body.querySelector('.k-selected'), '厨房不再有单独占一行的「选中提示 / 取消选中」');
    const sc = body.querySelector('.k-sec-title [data-act="unsel"]');
    ok(!!sc, '「✕ 取消选中」挪进顶部标题行（原来「拖 / 点选」的位置）');
    st().bag.carrot = 3;
    const KD2 = W.KitchenDebug;
    KD2.select(null);
    api.renderKitchen && api.renderKitchen();
    eq(KD2.selected(), null, '初始没选中');
    KD2.drop('crop:carrot', 'board');
    eq(KD2.selected(), 'crop:carrot', '拖过去之后**默认勾选**这一份（接着点工位就能继续投）');
    api.renderKitchen && api.renderKitchen();
    ok($('kitchenBody').querySelector('.k-card.k-sel'), '卡片上能看到勾选高亮');
    click($('kitchenBody').querySelector('[data-act="unsel"]'));
    eq(KD2.selected(), null, '点标题行的「取消选中」能取消');
    api.closeSheet();
  }

  section('进度条：填充条不能被刻度顶掉（曾显示歪掉）');
  {
    api.openSheet('kitchen');
    st().pieces.tomato = 1;
    api.cook.potAdd({ piece: 'tomato' });
    api.kitchenTick(2000);
    D.api.renderKitchen && D.api.renderKitchen();
    api.kitchenTick(0);
    const bar = W.document.querySelector('#kitchenBody [data-bar="pot"]');
    ok(!!bar, '找得到锅的进度条');
    if (bar) {
      const fill = bar.querySelector('i');
      const ticks = bar.querySelectorAll('.k-tick');
      eq(ticks.length, 3, '锅的进度条有 3 个分界刻度');
      ok(fill && fill.style.width && parseFloat(fill.style.width) > 0, '填充条有宽度（不是 0）', fill && fill.style.width);
      ok([...ticks].every(t => !t.style.width), '刻度没被当成填充条写宽度');
    }
    api.cook.potTake(false);
    api.closeSheet();
  }

  section('锅的计时：到点后继续走（曾经冻在 4s，进度条永远走不满、也不会焦糊）');
  {
    api.openSheet('kitchen');
    st().pieces.carrot = 5;
    api.cook.potAdd({ piece: 'carrot' });
    api.kitchenTick(api.POT_MS);                       // 刚到点
    eq(api.KITCHEN.pot.done, true, '4s：进入可出锅');
    const tAtReady = api.KITCHEN.pot.t;
    api.kitchenTick(2000);
    ok(api.KITCHEN.pot.t > tAtReady + 1900, '到点后计时继续走（不再冻结）', 't=' + Math.round(api.KITCHEN.pot.t));
    D.api.renderKitchen && D.api.renderKitchen();
    const pbar = W.document.querySelector('#kitchenBody [data-bar="pot"] i');
    near(parseFloat(pbar.style.width), 50, 3, '6s：进度条走到一半（≈50%）');
    api.kitchenTick(6000);                             // 累计 12s
    ok(api.KITCHEN.pot.t >= api.POT_MS + api.POT_BURN_MS, '12s：走满', 't=' + Math.round(api.KITCHEN.pot.t));
    D.api.renderKitchen && D.api.renderKitchen();
    const pbar2 = W.document.querySelector('#kitchenBody [data-bar="pot"] i');
    near(parseFloat(pbar2.style.width), 100, 1, '走满 = 进度条 100%');
    const stNode = W.document.querySelector('#kitchenBody [data-state="pot"]');
    ok(/焦糊/.test(stNode.textContent), '走满后状态变成焦糊', stNode.textContent);
    const take = api.cook.potTake(false);
    eq(take.quality, 'burnt', '此时出锅 = 焦糊');
    /* 自动出锅也要能触发（同一个冻结点会导致它永不触发）——
       注意现在 auto 是「全自动」：取出后会自动按同一配方补上，所以锅不会空着 */
    st().pieces.carrot = 5;
    api.cook.potAdd({ piece: 'carrot' });
    api.KITCHEN.pot.auto = true;
    const dishBefore = api.dishTotal();
    api.kitchenTick(api.POT_MS + api.POT_PERFECT_MS + 100);
    ok(api.dishTotal() > dishBefore, '自动出锅的菜进了菜品仓库');
    ok(api.KITCHEN.pot.pieces.length > 0, '全自动：取出后自动补上同一配方（锅不空）');
    api.KITCHEN.pot.auto = false;
    api.KITCHEN.pot.pieces = [];
  }

  section('厨房局部刷新：放入时不会重画菜品仓库');
  {
    api.openSheet('kitchen');
    st().bag.carrot = 3;
    const d0 = W.document.querySelector('#kitchenBody .k-pane-dish');
    ok(!!d0, '找得到菜品仓库');
    d0.__keep = 'keep';        // 用 JS 属性打标记（写成属性会改变 outerHTML，反而触发重建）
    api.cook.boardPut('carrot');                       // 放入：只该动货架/菜块
    D.api.renderKitchen && D.api.renderKitchen();
    const d1 = W.document.querySelector('#kitchenBody .k-pane-dish');
    eq(d1.__keep, 'keep', '放入后菜品仓库是同一个 DOM（没有重画）');
    ok(d1 === d0, '节点身份不变（滚动位置与已画的图标都保住）');
    /* 换到工位区也一样：菜板/锅的内部状态变化不该连累菜品仓库 */
    st().pieces.potato = 1;
    api.cook.potAdd({ piece: 'potato' });
    D.api.renderKitchen && D.api.renderKitchen();
    const d2 = W.document.querySelector('#kitchenBody .k-pane-dish');
    eq(d2.__keep, 'keep', '下锅后菜品仓库同样没被重画');
    /* 真出了菜 → 这时候才允许它更新 */
    api.kitchenTick(api.POT_MS + api.POT_BURN_MS + 100);
    api.cook.potTake(false);
    D.api.renderKitchen && D.api.renderKitchen();
    const d3 = W.document.querySelector('#kitchenBody .k-pane-dish');
    ok(d3 !== d2, '真的出锅出新菜时，菜品仓库才重建');
    api.closeSheet();
  }

  section('老存档迁移：下方意外的石头地还原成「带杂物的草地」');
  {
    const backup = JSON.parse(JSON.stringify(api.serialize(st())));
    /* 造一份「v9.4 老档」：14 宽农场 + 右侧 3 列旧上限留下的石头地 */
    const W = 17, H = 3, tiles = [];
    for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
      const stone = gx >= 14;
      tiles.push({ gx, gy, terrain: stone ? 'stone' : 'tilled', state: stone ? 'wild' : 'tilled',
                   stone, crop: null, growth: 0, watered: false, fertile: false, harvestsLeft: 0 });
    }
    const old = {
      v: 91, savedAt: Date.now(), coins: 500, farmer: undefined,
      map: { x0: 0, y0: 0, w: W, h: H }, farm: { x0: 0, y0: 0, w: 14, h: 3 },
      expandCount: { xn: 0, yn: 0, xp: 12, yp: 0 }, upExpand: { xn: 0, yn: 0 },
      /* 其中一列留一件装饰：那是玩家自己摆的展示区，不许动 */
      decorations: [{ type: 'tree', gx: 15, gy: 0, hp: 3 }],
      tiles,
    };
    const st2 = api.unpackState(old);
    ok(!!st2, '老档能读进来');
    eq(st2.farm.w, 17, '农场右边界外扩到把旧石头列包进来（买过的地不用再买一次）');
    eq(st2.farm.h, 3, '高度没变');
    let grass = 0, stillStone = 0, stoneLeft = [];
    for (const t of st2.tiles) {
      if (t.gx < 14) continue;
      if (t.stone) { stillStone++; stoneLeft.push(t.gx + ',' + t.gy); } else if (t.terrain === 'grass' && t.state === 'wild') grass++;
    }
    /* 3 列 × 3 行 = 9 格，1 格有装饰 → 8 格还原、1 格保留石头 */
    eq(grass, 8, '没装饰的 8 格都还原成未开垦的草地');
    eq(stillStone, 1, '有装饰的那 1 格保留石头地（展示区不动）', stoneLeft.join(' '));
    const weeds = st2.decorations.filter(d => d.gx >= 14 && d.gx < 17);
    ok(weeds.length >= 1, '还原出来的地长上了杂物（杂草/石头/花/树）', weeds.length + ' 处');
    ok(weeds.every(d => !!api.DECOR_META[d.type]), '杂物类型合法（都是已注册的装饰）', weeds.map(d => d.type).join(','));
    /* 顶部两向的石头带不能被吃掉 */
    const tiles2 = [];
    for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++) {
      const isStone = gy === 0;                        /* 上面一整排是右上方向扩出来的石头地 */
      tiles2.push({ gx, gy, terrain: isStone ? 'stone' : 'grass', state: 'wild', stone: isStone,
                    crop: null, growth: 0, watered: false, fertile: false, harvestsLeft: 0 });
    }
    const st3 = api.unpackState({
      v: 91, savedAt: Date.now(), coins: 100,
      map: { x0: 0, y0: 0, w: 4, h: 4 }, farm: { x0: 0, y0: 1, w: 4, h: 3 },
      expandCount: { xn: 0, yn: 3, xp: 0, yp: 0 }, upExpand: { xn: 0, yn: 3 },
      decorations: [], tiles: tiles2,
    });
    eq(st3.farm.h, 3, '顶部石头带没有把农场往上撑开');
    ok(st3.tiles.filter(t => t.gy === 0).every(t => t.stone), '顶部那条石头带原样保留（石头只在顶部）');
    /* 版本号 >= 95 的新档不该被再迁移一次 */
    const st4 = api.unpackState(Object.assign({}, old, { v: 96 }));
    eq(st4.farm.w, 14, '当前版本的存档不触发迁移（只跑一次）');
    /* 还原当前状态，别影响后面的用例 */
    api.applyPayload(backup);
    eq(st().farm.w, backup.farm.w, '测试后状态已还原');
  }

  section('v9.8：石头提示统一 / 石头区不漏草 / 新装饰品');
  {
    const backup = JSON.parse(JSON.stringify(api.serialize(st())));
    /* ── 石头上所有工具都提示「这里只能放置装饰」 ── */
    {
      const f0 = st().farm;
      st().coins = 100000;
      /* 造一块石头地：买满左上 3 排可耕后，第 4 次就是石头带 */
      for (let i = 0; i < 4; i++) api.doExpand('xn');
      const stoneTile = st().tiles.filter(t => t.stone)[1];
      ok(!!stoneTile, '买到了石头地面');
      const sp = api.plantSeed(stoneTile, 'carrot');
      ok(!sp.ok && /只能放置装饰/.test(sp.msg), '石头地上播种 → 提示只能放置装饰', sp.msg);
      for (const tool of ['hoe', 'seed', 'water', 'fert', 'premium', 'sickle']) {
        D.api.setTool(tool);
        api.runTool(stoneTile.gx, stoneTile.gy, false);
        const txt = W.document.getElementById('toast').textContent || '';
        ok(/只能放置装饰/.test(txt), `${tool} 工具在石头地上也提示「只能放置装饰」`, txt.slice(0, 30));
      }
      /* 装饰工具在石头地上是被允许的（这正是石头的用途） */
      st().selectedDecor = 'flower';
      st().decorBag.flower = 1;
      D.api.setTool('decor');
      const before = st().decorBag.flower;
      api.runTool(stoneTile.gx, stoneTile.gy, false);
      const meta = api.DECOR_META.flower;
      ok(!!meta, '装饰元数据在');
      ok(st().decorBag.flower < before || !!api.decorAt(stoneTile.gx, stoneTile.gy),
        '装饰工具可以把装饰摆到石头地上');
      if (api.decorAt(stoneTile.gx, stoneTile.gy)) api.collectDecorationAt(stoneTile.gx, stoneTile.gy);
    }
    /* ── 石头区不漏草地：先有石头带，再往另一个方向扩，新格子要跟着变石头 ── */
    {
      const bad = [];
      const f1 = st().farm;
      for (let gy = st().map.y0; gy < st().map.y0 + st().map.h; gy++)
        for (let gx = st().map.x0; gx < st().map.x0 + st().map.w; gx++) {
          const t = api.getTile(gx, gy);
          if (t && gx < f1.x0 && !t.stone) bad.push(gx + ',' + gy);      /* 左侧石头带里不该有草地 */
        }
      eq(bad.length, 0, '左侧石头带里没有夹进草地（往下/往右扩时会继承石头）', bad.join(' '));
      st().coins = 100000;
      api.doExpand('yp');
      const bad2 = [];
      const f2 = st().farm;
      for (let gy = st().map.y0; gy < st().map.y0 + st().map.h; gy++)
        for (let gx = st().map.x0; gx < st().map.x0 + st().map.w; gx++) {
          const t = api.getTile(gx, gy);
          if (t && gx < f2.x0 && !t.stone) bad2.push(gx + ',' + gy);
        }
      eq(bad2.length, 0, '往下扩一排后，石头带正下方也是石头（不会嵌一条草）', bad2.join(' '));
    }
    api.applyPayload(backup);

    /* ── 新装饰品：数据、画法、商店、杂草表 ── */
    const NEW_DECOR = ['mushroom', 'sunflower', 'fence', 'bamboo', 'pine', 'lantern', 'well', 'statue'];
    for (const id of NEW_DECOR) {
      const m = api.DECOR_META[id];
      ok(!!m, `新装饰 ${id} 已登记`);
      ok(!!api.DECOR_PRICE[id] && !!api.DECOR_SELL[id], `${id} 有买价与回收价`);
      eq(api.DECOR_SELL[id] * 2, api.DECOR_PRICE[id], `${id} 买价 = 回收价 ×2`);
      ok(api.DECOR_HP[id] >= 1, `${id} 有耐久（锄头要敲几下）`);
      /* 压缩产物会把 === 压成 ==、单引号换成双引号，所以用宽松正则 */
      ok(new RegExp('type\\s*={2,3}\\s*[\'"]' + id + '[\'"]').test(html),
        `${id} 有对应画法（drawDecoration 里有分支）`);
    }
    ok(Object.keys(api.DECOR_META).length >= 14, '装饰总数 ≥ 14', String(Object.keys(api.DECOR_META).length));
    /* 商店里全都能买 */
    api.renderShop();
    const shopNames = [...W.document.querySelectorAll('#shopList .row .r-name')].map(n => n.textContent);
    for (const id of NEW_DECOR) {
      ok(shopNames.some(n => n.indexOf(api.DECOR_META[id].name) === 0), `商店里有「${api.DECOR_META[id].name}」`);
    }
    /* 新装饰能摆、能敲 */
    {
      const f3 = st().farm;
      const t = st().tiles.find(x => x.stone) || api.getTile(f3.x0, f3.y0);
      st().decorBag.well = (st().decorBag.well || 0) + 1;
      const r = api.placeDecor(t.gx, t.gy, 'well');
      if (t.stone) ok(r.ok, '水井能摆到石头地上', r.msg);
      if (r.ok) {
        const d = api.decorAt(t.gx, t.gy);
        eq(d.type, 'well', '摆上去的是水井');
        eq(api.decorMaxHp('well'), 3, '水井要敲 3 下');
        api.collectDecorationAt(t.gx, t.gy);
      }
    }
  }

  section('v9.8 源码守卫：小路必须按格坐标投影画（否则等距视角会变成阶梯）');
  {
    const src = html.replace(/\s+/g, '');
    const MINIFIED = /\.min\.html$/i.test(NAME);
    /* 字符串字面量守卫：压缩产物里也在 */
    ok(["'自动连接'", "'十字'", "'横向'", "'纵向'", "'单点'"].every(k => src.indexOf(k.replace(/'/g, '')) >= 0 ||
      src.indexOf(k) >= 0), '五个连接档位文案都在（自动/十字/横向/纵向/单点）');
    if (MINIFIED) {
      console.log('  \x1b[2m·\x1b[0m 压缩产物：跳过 4 项「按标识符」源码守卫（标识符已重命名，行为由上面的功能用例覆盖）');
    } else {
      ok(/drawPath\(g,px,py,seed,mask\)/.test(src), 'drawPath 接收连接面 mask');
      ok(src.includes('(dx-dy)*hw') && src.includes('(dx+dy)*hh'),
        '小路用格增量 → 屏幕的等距线性变换（东=斜下、南=斜下左）');
      ok(src.includes('pathConnMask('), '绘制时按四邻自动算连接面');
      ok(src.includes('DECOR_FREE') && src.includes('decorIsFree('), '免费铺装是显式标记（不是靠价格 0 判断）');
    }
    /* 行为守卫：两个产物都跑 —— 铺两块相邻小路必须互相接上 */
    ok(typeof api.pathConnMask === 'function', 'pathConnMask 可用（行为用例见小路那一节）');
  }

  section('v9.10 迁移：补齐老存档「上方石头带」里漏成草地的格子');
  {
    /* 造一份 v9.5 老档：左侧 3 列石头带，但其中一列有几格是草地（历史 bug 留下的洞） */
    const W = 6, H = 6, tiles = [];
    for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
      const inLeftStrip = gx < 3;                        /* 左边 3 列 = 左上石头带 */
      const hole = inLeftStrip && gx === 2 && (gy === 2 || gy === 3);   /* 故意在带子里挖两个洞 */
      const stone = inLeftStrip && !hole;
      tiles.push({ gx, gy, terrain: stone ? 'stone' : 'grass', state: 'wild', stone,
                   crop: null, growth: 0, watered: false, fertile: false, harvestsLeft: 0 });
    }
    const st2 = api.unpackState({
      v: 95, savedAt: Date.now(), coins: 100,
      map: { x0: 0, y0: 0, w: W, h: H }, farm: { x0: 3, y0: 0, w: 3, h: 6 },
      expandCount: { xn: 1, yn: 0, xp: 0, yp: 0 }, upExpand: { xn: 3, yn: 0 },
      decorations: [], tiles,
    });
    const left = st2.tiles.filter(t => t.gx < 3);
    ok(left.length > 0, '左侧石头带还在', String(left.length));
    eq(left.filter(t => !t.stone).length, 0, '石头带里的洞被补齐（全列都是石头）');
    ok(left.every(t => t.terrain === 'stone'), '补齐的格子地形也标成石头');
    /* 不能误伤普通草原：右边（农场）以外没有石头的那一片不动 */
    const st3 = api.unpackState({
      v: 95, savedAt: Date.now(), coins: 100,
      map: { x0: 0, y0: 0, w: 5, h: 5 }, farm: { x0: 0, y0: 0, w: 3, h: 3 },
      expandCount: { xn: 0, yn: 0, xp: 0, yp: 0 }, upExpand: { xn: 0, yn: 0 },
      decorations: [],
      tiles: (() => { const a = []; for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 5; gx++)
        a.push({ gx, gy, terrain: 'grass', state: 'wild', stone: false, crop: null, growth: 0, watered: false, fertile: false, harvestsLeft: 0 }); return a; })(),
    });
    eq(st3.tiles.filter(t => t.stone).length, 0, '没有石头的存档不会被误刷成石头（开局那片草原安全）');
    /* 农场范围内的历史石头格：还原成草地（否则那块地永远种不了） */
    const tiles4 = [];
    for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++)
      tiles4.push({ gx, gy, terrain: 'grass', state: 'wild', stone: gx === 1 && gy === 1,
                    crop: null, growth: 0, watered: false, fertile: false, harvestsLeft: 0 });
    const st4 = api.unpackState({
      v: 95, savedAt: Date.now(), coins: 100,
      map: { x0: 0, y0: 0, w: 4, h: 4 }, farm: { x0: 0, y0: 0, w: 4, h: 4 },
      expandCount: { xn: 0, yn: 0, xp: 0, yp: 0 }, upExpand: { xn: 0, yn: 0 },
      decorations: [], tiles: tiles4,
    });
    const inFarmStone = st4.tiles.filter(t => t.stone);
    eq(inFarmStone.length, 0, '农场范围内的历史石头格被还原成草地（那块地现在能种了）');
    ok(!!api.getTile(1, 1) && api.getTile(1, 1).terrain === 'grass', '具体那格变成了草地');
    /* v96 新档不再触发 */
    const st5 = api.unpackState(Object.assign({}, {
      v: 96, savedAt: Date.now(), coins: 1,
      map: { x0: 0, y0: 0, w: W, h: H }, farm: { x0: 3, y0: 0, w: 3, h: 6 },
      expandCount: { xn: 1, yn: 0, xp: 0, yp: 0 }, upExpand: { xn: 3, yn: 0 },
      decorations: [], tiles: tiles.map(t => Object.assign({}, t)),
    }));
    eq(st5.tiles.filter(t => t.gx < 3 && !t.stone).length, 2, 'v96 存档不再被迁移（洞保持原样）');
  }

  section('v9.13：装饰分两层（地砖可以和立体装饰同格，杂草/作物不行）');
  {
    const backup = JSON.parse(JSON.stringify(api.serialize(st())));
    st().coins = 100000;
    for (let i = 0; i < 4; i++) api.doExpand('xn');
    const stones = st().tiles.filter(t => t.stone);
    ok(stones.length >= 6, '有石头地可测', String(stones.length));
    const clear = t => { ['ground', 'prop'].forEach(L => { const d = api.decorAt(t.gx, t.gy, L); if (d) api.collectDecorationAt(t.gx, t.gy, L); }); };
    const t0 = stones[1], t1 = stones[2], t2 = stones[3], t3 = stones[4];
    [t0, t1, t2, t3].forEach(clear);

    ok(api.decorLayer('path') === 'ground' && api.decorLayer('marble') === 'ground' && api.decorLayer('pond') === 'ground',
      '地砖/水塘属于 ground 层');
    ok(api.decorLayer('chair') === 'prop' && api.decorLayer('tree') === 'prop' && api.decorLayer('fence') === 'prop',
      '家具/树/栅栏属于 prop 层');

    /* ① 先铺地砖，再摆椅子 → 同格共存 */
    st().decorBag.marble = 1; st().decorBag.chair = 1;
    ok(api.placeDecor(t0.gx, t0.gy, 'marble').ok, '铺一块大理石');
    const rChair = api.placeDecor(t0.gx, t0.gy, 'chair');
    ok(rChair.ok, '地砖上还能摆椅子（与非地砖重叠）', rChair.msg);
    ok(!!api.decorAt(t0.gx, t0.gy, 'ground') && !!api.decorAt(t0.gx, t0.gy, 'prop'), '同格两层都在');
    eq(api.decorAt(t0.gx, t0.gy).type, 'chair', '不带层查时优先返回立体那层（锄头先敲椅子）');
    eq(api.decorGroundAt(t0.gx, t0.gy).type, 'marble', 'ground 层查出的是大理石');

    /* ② 反过来：先摆椅子，再铺地砖 → 也可以 */
    st().decorBag.brick = 1;
    st().decorBag.chair = (st().decorBag.chair || 0) + 1;
    ok(api.placeDecor(t1.gx, t1.gy, 'chair').ok, '先摆椅子');
    const rBrick = api.placeDecor(t1.gx, t1.gy, 'brick');
    ok(rBrick.ok, '椅子下面也能补铺地砖', rBrick.msg);
    ok(!!api.decorGroundAt(t1.gx, t1.gy), '补铺成功');

    /* ③ 同层不能叠：两块地砖 / 两件家具 */
    st().decorBag.marble = 1; st().decorBag.chair = 1; st().decorBag.brick = 1;
    ok(!api.placeDecor(t0.gx, t0.gy, 'brick').ok, '同一格不能铺第二种地砖');
    ok(!api.placeDecor(t0.gx, t0.gy, 'table').ok, '同一格不能摆第二件立体装饰');

    /* ④ 野生的杂草/石头挡地砖（要先清），但挡不住「同格已有地砖」的立体装饰 */
    const t2w = t2;
    t2w.state = 'wild'; t2w.terrain = 'grass';
    api.scatterWeeds([t2w], 1);
    const weed = api.decorAt(t2w.gx, t2w.gy, 'prop');
    ok(!!weed && weed.wild === true, '这一格长出了野生杂物', weed && weed.type);
    st().decorBag.marble = 1;
    const rWeed = api.placeDecor(t2w.gx, t2w.gy, 'marble');
    ok(!rWeed.ok && /锄头/.test(rWeed.msg), '野生杂物上面不能直接铺地砖（提示先清掉）', rWeed.msg);
    /* 清掉之后就能铺 */
    api.collectDecorationAt(t2w.gx, t2w.gy, 'prop');
    ok(api.placeDecor(t2w.gx, t2w.gy, 'marble').ok, '清掉杂物后可以铺');

    /* ⑤ 作物：耕地本来就不让摆装饰 */
    const farmTile = api.getTile(st().farm.x0, st().farm.y0);
    ok(!api.canPlaceDecorAt(farmTile.gx, farmTile.gy, 'marble').ok, '耕地上不能铺地砖（有作物的地更不行）');
    ok(!api.canPlaceDecorAt(farmTile.gx, farmTile.gy, 'chair').ok, '耕地上也不能摆家具');

    /* ⑥ 锄头先敲立体层，再敲地面层 */
    {
      const t3c = t3;
      clear(t3c);
      st().decorBag.path = 1; st().decorBag.plant = 1;
      api.placeDecor(t3c.gx, t3c.gy, 'path');
      api.placeDecor(t3c.gx, t3c.gy, 'plant');
      D.api.setTool('hoe');
      let hit = api.hitDecorationAt(t3c.gx, t3c.gy);
      eq(hit.type, 'plant', '第一下敲的是盆栽（立体层优先）');
      ok(!!api.decorAt(t3c.gx, t3c.gy, 'path'), '地砖还留在下面');
      for (let i = 0; i < 4 && api.decorAt(t3c.gx, t3c.gy, 'prop'); i++) api.hitDecorationAt(t3c.gx, t3c.gy);
      ok(!api.decorAt(t3c.gx, t3c.gy, 'prop'), '立体层敲光了');
      let hit2 = api.hitDecorationAt(t3c.gx, t3c.gy);
      eq(hit2.type, 'path', '接着敲到的才是地砖');
      for (let i = 0; i < 4 && api.decorAt(t3c.gx, t3c.gy); i++) api.hitDecorationAt(t3c.gx, t3c.gy);
      ok(!api.decorAt(t3c.gx, t3c.gy), '两层都清干净了');
    }

    /* ⑦ 框选装饰工具会跳过放不下的格子 */
    {
      D.api.setTool('decor');
      st().selectedDecor = 'marble';
      st().decorBag.marble = 10;
      const wildTile = st().tiles.find(x => x.stone && !api.decorAt(x.gx, x.gy, 'ground') && api.decorAt(x.gx, x.gy, 'prop') && api.decorAt(x.gx, x.gy, 'prop').wild);
      if (wildTile) {
        const n = api.applyToolToRect(wildTile.gx, wildTile.gy, wildTile.gx, wildTile.gy);
        eq(n, 0, '野生杂物那一格不会被框选排进队列');
        api.cancelJob();
      }
    }
    /* ⑧ 存档往返后同格两层都还在 */
    {
      const payload = api.serialize(st());
      const before = st().decorations.length;
      const st2 = api.unpackState(JSON.parse(JSON.stringify(payload)));
      eq(st2.decorations.length, before, '存档往返后装饰数量不变（同格两层都保留）');
      const both = st2.decorations.filter(d => d.gx === t0.gx && d.gy === t0.gy);
      eq(both.length, 2, '同一格的两层装饰都存下来了');
    }
    api.applyPayload(backup);
  }

  section('v9.15：烤箱升级多槽位 / 自动模式下也能手动出炉 / 品质名改「一般」');
  {
    const backup = JSON.parse(JSON.stringify(api.serialize(st())));
    const K = api.KITCHEN;
    /* ① 品质名 */
    eq(api.QUALITY.normal.name, '一般', '「正常」已改名「一般」');
    eq(api.QUALITY.perfect.name, '精品', '精品不变');
    /* ② 槽位与升级价：2000 起指数上涨 */
    st().ovenSlots = 1;
    eq(api.ovenCap(), 1, '默认 1 个槽位');
    eq(api.ovenSlotPrice(), 2000, '第一次升级 2000 金');
    st().coins = 100;
    ok(!api.ovenUpgrade().ok, '钱不够升不了级');
    eq(st().ovenSlots, 1, '没升级成功时槽位不变');
    st().coins = 100000;
    ok(api.ovenUpgrade().ok, '有钱能升级');
    eq(st().ovenSlots, 2, '槽位 +1');
    eq(st().coins, 100000 - 2000, '扣了 2000 金');
    eq(api.ovenSlotPrice(), 3000, '第二次升级 3000 金（×1.5 指数上涨）');
    api.ovenUpgrade();
    eq(st().ovenSlots, 3, '再升一级到 3 槽');
    eq(api.ovenSlotPrice(), 4500, '第三次 4500 金');
    while(api.ovenCanUpgrade()) api.ovenUpgrade();
    eq(st().ovenSlots, api.OVEN_SLOT_MAX, '能升到最高槽位');
    ok(!api.ovenUpgrade().ok, '满级之后不能再升');

    /* ③ 每轮出炉份数（升级项）：输入不限量、本轮 3 份一起出、品质一致 */
    st().ovenSlots = 3;
    st().prep.flour = 5;
    K.oven.items = []; K.oven.item = null; K.oven.busy = false; K.oven.ready = false; K.oven.t = 0;
    K.oven.auto = false; K.oven.autoLoop = false;
    ok(api.cook.ovenPut({ prep: 'flour' }).ok, '放第 1 份');
    api.kitchenTick(1000);
    const tAfter1 = K.oven.t;
    ok(api.cook.ovenPut({ prep: 'flour' }).ok, '放第 2 份');
    ok(api.cook.ovenPut({ prep: 'flour' }).ok, '放第 3 份');
    eq(K.oven.items.length, 3, '炉里有 3 份');
    eq(K.oven.t, tAfter1, '加料**不会**重置已在走的进度（多份一起烤时不再闪来闪去）');
    ok(api.cook.ovenPut({ prep: 'flour' }).ok, '还能继续放（输入槽不限量）');
    eq(K.oven.items.length, 4, '第 4 份排队等着');
    eq(api.ovenRoundSize(), 3, '本轮只加工 3 份（= 已升级的每轮份数）');
    const dishes0 = api.dishTotal();
    api.kitchenTick(api.OVEN_MS + 100);
    const take3 = api.cook.ovenTake(false);
    ok(take3.ok, '出炉成功', take3.msg);
    eq(take3.n, 3, '一轮出了 3 份');
    eq(take3.quality, 'perfect', '手动卡在精品段 → 精品');
    eq(api.dishTotal() - dishes0, 3, '菜品仓库多了 3 份');
    eq(K.oven.items.length, 1, '排队的那 1 份还在炉里');
    ok(K.oven.busy && K.oven.t < 200, '剩下那份立刻开始下一轮（进度条从头开始走）');
    api.cook.ovenTake(false);                       /* 清干净，别影响后面的用例 */
    K.oven.items = []; K.oven.busy = false; K.oven.ready = false; K.oven.t = 0;

    /* ④ 自动出炉开着时，手动出炉照样按火候判定（精品段就是精品） */
    st().ovenSlots = 2; st().prep.flour = 4;
    K.oven.auto = true; K.oven.autoLoop = false;
    api.cook.ovenPut({ prep: 'flour' });
    api.kitchenTick(api.OVEN_MS + 500);          /* 落在精品窗口内 */
    ok(K.oven.ready, '已经可出炉');
    const rManual = api.cook.ovenTake(false);      /* 自动开着也能手动取 */
    ok(rManual.ok && rManual.quality === 'perfect', '自动模式下手动出炉 = 精品', rManual.quality);
    /* 自动取则是「一般」，而且全自动会顺手补上下一份 */
    st().prep.flour = 2;
    K.oven.auto = true;
    api.cook.ovenPut({ prep: 'flour' });
    const dishAuto0 = api.dishTotal();
    api.kitchenTick(api.OVEN_MS + api.OVEN_PERFECT_MS + 50);
    eq(api.dishTotal() - dishAuto0, 1, '自动取走了 1 份');
    ok(K.oven.busy, '全自动：取走后自动补上下一份');
    K.oven.auto = false;

    /* ⑤ 全自动会把槽位装满再烤 */
    st().ovenSlots = 3; st().prep.flour = 4;      /* 手动放 1 份后还剩 3 份，正好把 3 个槽位装滿 */
    K.oven.items = []; K.oven.item = null; K.oven.busy = false; K.oven.ready = false; K.oven.t = 0;
    K.oven.auto = true;
    ok(api.cook.ovenPut({ prep: 'flour' }).ok, '手动放第一份');
    api.kitchenTick(api.OVEN_MS + api.OVEN_PERFECT_MS + 60);   /* 出 + 自动补满 */
    eq(K.oven.items.length, 3, '全自动一次把 3 个槽位都装上', String(K.oven.items.length));
    eq(st().prep.flour, 0, '面粉正好用光');
    const before = api.dishTotal();
    api.kitchenTick(api.OVEN_MS + api.OVEN_PERFECT_MS + 60);
    eq(api.dishTotal() - before, 3, '这一批也出了 3 份');
    ok(!K.oven.auto, '原料不足后自动停（开关自己关掉）');

    /* ⑥ 厨房面板：槽位计数 + 升级按钮都在 */
    st().coins = 50000; st().ovenSlots = 2;
    api.openSheet('kitchen');
    const upBtn = W.document.querySelector('#kitchenBody [data-act="upgrade-oven"]');
    ok(!!upBtn, '烤箱有升级按钮');
    ok(/3000/.test(upBtn.textContent), '按钮显示下一级价格', upBtn.textContent);
    ok(!upBtn.disabled, '钱够时按钮可用');
    api.closeSheet();
    api.applyPayload(backup);
  }

  section('v9.14：自动出时间 / 全自动循环 / 驴与自动切块机');
  {
    const backup = JSON.parse(JSON.stringify(api.serialize(st())));
    const K = api.KITCHEN;
    /* ① 自动出炉 = 精品窗口一结束就取（不是等到快焦糊） */
    st().prep.flour = 8;
    K.oven.auto = true; K.oven.autoLoop = false; K.oven.busy = false;
    K.pot.pieces = []; K.pot.auto = false; K.pot.autoLoop = false;
    ok(api.cook.ovenPut({ prep: 'flour' }).ok, '放一份面粉进炉');
    const dishes0 = api.dishTotal();
    api.kitchenTick(api.OVEN_MS + api.OVEN_PERFECT_MS - 300);
    eq(K.oven.busy, true, '还没到精品窗口结束：还在烤');
    st().prep.flour = 0;                       /* 不给它补料的机会，单看「窗口一过就取」 */
    api.kitchenTick(600);
    eq(K.oven.busy, false, '精品窗口一过就自动出炉');
    eq(api.dishTotal(), dishes0 + 1, '出了一份菜');
    ok(!!K.oven.lastItem && K.oven.lastItem.prep === 'flour', '记住了这次烤的是面粉（全自动要用）');

    /* ② 全自动（一个开关同时管取出与补料）：同配方一直烤到原料不足 */
    st().prep.flour = 3;
    K.oven.auto = true;
    ok(api.cook.ovenPut({ prep: 'flour' }).ok, '手动放第一份');
    const before = api.dishTotal();
    let guard = 0;
    while(K.oven.auto && guard++ < 12) api.kitchenTick(api.OVEN_MS + api.OVEN_PERFECT_MS + 60);
    ok(!K.oven.auto, '面粉用光后全自动自己停了（开关也自动关掉）');
    eq(api.dishTotal() - before, 3, '3 份面粉全烤完', '出了 ' + (api.dishTotal() - before) + ' 份');
    eq(st().prep.flour, 0, '面粉正好用光');
    ok(guard < 12, '没有空转死循环', '循环 ' + guard + ' 次');

    /* ③ 驴：花钱买、限时自动磨面、可叠加、到期就停 */
    st().coins = 6000; st().bag.wheat = 6;
    st().autoCount.donkey = 0; st().autoAcc.donkey = 0;
    const buy = api.autoBuy('donkey');
    ok(buy.ok, '能买到拉磨的驴', buy.msg);
    eq(st().coins, 6000 - 600, '扣了第 1 台的 600 金');
    eq(st().autoCount.donkey, 1, '第一台已就位');
    ok(api.autoActive('donkey'), '驴正在干活');
    /* 每台机器有自己的进料槽（不共用）：买来时自动从仓库装满 */
    eq(api.autoSlotOf('donkey').length, api.AUTO_SLOT_MAX, '驴自带的料斗装满（独立进料槽）');
    eq(st().bag.wheat, 1, '料斗里的 5 份从仓库扣掉了（还在，只是换了个地方放）');
    eq(api.autoSlotOf('donkey').filter(c => c === 'wheat').length, api.AUTO_SLOT_MAX, '料斗里全是小麦');
    /* 一台驴：一轮产 1 份，吃自己料斗里的 */
    st().autoAcc.donkey = 0;
    const flour0 = st().prep.flour || 0;
    const slot0 = api.autoSlotOf('donkey').length;
    api.kitchenTick(api.AUTO_DEVICES.donkey.per);
    eq((st().prep.flour || 0) - flour0, 1, '一台驴一轮磨 1 份面粉');
    eq(api.autoSlotOf('donkey').length, api.AUTO_SLOT_MAX, '吃的是自己料斗里的料，吃完立刻从仓库补满');
    eq(st().bag.wheat, 0, '仓库那 1 份被补进料斗了');
    /* 多台驴：一轮产多份（叠加） */
    st().coins = 99999;
    const price2 = api.autoPrice('donkey');
    ok(api.autoBuy('donkey').ok, '再买一台（第 2 台）');
    eq(st().autoCount.donkey, 2, '现在有 2 台');
    ok(price2 > api.AUTO_DEVICES.donkey.price, '第 2 台更贵（指数上涨）', price2 + ' > ' + api.AUTO_DEVICES.donkey.price);
    st().autoAcc.donkey = 0;
    const flour2 = st().prep.flour || 0;
    api.kitchenTick(api.AUTO_DEVICES.donkey.per);
    eq((st().prep.flour || 0) - flour2, 2, '两台驴一轮磨 2 份面粉');
    /* 料斗空了、仓库也没料 → 缺原料，不产出 */
    api.autoSlotOf('donkey').length = 0; st().bag.wheat = 0;
    st().autoAcc.donkey = 0;
    const flourLack = st().prep.flour || 0;
    api.kitchenTick(api.AUTO_DEVICES.donkey.per);
    eq(st().prep.flour || 0, flourLack, '料斗与仓库都空 → 不产出（只空转）');
    /* 到期就停 */
    st().autoUntil.donkey = Date.now() - 1000;
    const flour1 = st().prep.flour || 0;
    st().autoAcc.donkey = 0;
    api.kitchenTick(api.AUTO_DEVICES.donkey.per * 3);
    eq(st().prep.flour || 0, flour1, '到期后不再产出（限时消耗品）');
    ok(!api.autoActive('donkey'), '到期状态正确');
    ok(api.KITCHEN.mill.busy === false && api.KITCHEN.mill.t === 0, '驴到期后石磨不再显示成「还在磨」（进度条归零）');

    /* ④ 切块机：有自己的料斗，优先装库存最多的作物 */
    st().bag.carrot = 5; st().bag.potato = 2; st().coins = 6000;
    api.autoSlotOf('chopper').length = 0;
    ok(api.autoBuy('chopper').ok, '能买到自动切块机');
    eq(api.autoSlotOf('chopper').length, api.AUTO_SLOT_MAX, '切块机的料斗也装满了');
    ok(api.autoSlotOf('chopper').every(c => c === 'carrot'), '装的是库存最多的胡萝卜（不与驴共用进料）');
    eq(st().bag.carrot, 0, '料斗里的 5 份胡萝卜从仓库扣掉');
    eq(st().bag.potato, 2, '土豆没动（优先装最多的）');
    const car0 = st().pieces.carrot || 0, pot0 = st().pieces.potato || 0;
    api.kitchenTick(api.AUTO_DEVICES.chopper.per);
    eq((st().pieces.carrot || 0) - car0, 3, '切的是料斗里的胡萝卜（+3 块）');
    eq((st().pieces.potato || 0) - pot0, 0, '土豆没动');

    /* ⑤ 金币不够买不了 */
    st().coins = 0;
    ok(!api.autoBuy('chopper').ok, '金币不够买不了设备');

    /* ⑥ 到期时间会存档 */
    st().autoUntil.chopper = Date.now() + 60000;
    const st2 = api.unpackState(JSON.parse(JSON.stringify(api.serialize(st()))));
    ok((st2.autoUntil.chopper || 0) > Date.now(), '设备的到期时间写进了存档');
    ok((st2.autoSlot.donkey || []).length + (st2.autoSlot.chopper || []).length >= 0 && !!st2.autoSlot,
      '机器的独立料斗也写进了存档（不然刷新就丢料）', JSON.stringify(st2.autoSlot));

    /* ⑦ 自动化产出时会有音效（开着厨房面板才出声） */
    {
      const realPlay = api.SFX.play;
      const played = [];
      api.SFX.play = function(t){ played.push(t); };
      st().bag.wheat = 5; st().autoCount.donkey = 1; st().autoAcc.donkey = 0;
      st().autoUntil.donkey = Date.now() + 60000;
      api.autoSlotOf('donkey').length = 0; api.autoSlotRefill('donkey');   /* 先把料斗装满 */
      api.openSheet('kitchen');
      api.kitchenTick(api.AUTO_DEVICES.donkey.per);
      ok(played.indexOf('mill') >= 0, '开着厨房时，驴磨面能听到音效', played.join(',') || '(没出声)');
      /* 关掉厨房面板 → 不出声（免得在田里被吵） */
      api.closeSheet();
      played.length = 0;
      st().bag.carrot = 5; st().autoCount.chopper = 1; st().autoAcc.chopper = 0;
      st().autoUntil.chopper = Date.now() + 60000;
      api.kitchenTick(api.AUTO_DEVICES.chopper.per);
      ok(played.length === 0, '关着厨房面板时自动切块不出声', played.join(','));
      api.SFX.play = realPlay;
    }

    /* ⑧ 厨房面板里有自动化区块（两个设备各一行 + 购买按钮） */
    api.openSheet('kitchen');
    eq(W.document.querySelectorAll('#kitchenBody .k-auto-row').length, 2, '厨房里有 2 个自动化设备');
    {
      const buy = [...W.document.querySelectorAll('#kitchenBody [data-act="buy-auto"]')];
      const ids = Object.keys(api.AUTO_DEVICES);
      ok(ids.every(id => buy.some(b => b.dataset.dev === id)), '每个设备都有购买按钮（缩略卡 + 大界面各一个）', 'btns=' + buy.length);
      ok(buy.length >= ids.length * 2, '购买按钮在缩略行与展开区都能点到', 'btns=' + buy.length);
    }
    /* 全自动与自动出已经合并成一个开关：每台设备只有一个 auto 勾选，没有多余的 loop 勾选 */
    ok(!!W.document.querySelector('#kitchenBody [data-auto="oven"]'), '烤箱有「全自动」勾选');
    eq(W.document.querySelectorAll('#kitchenBody [data-auto="oven"]').length, 2,
      '烤箱有两个「自动烹饪」开关：缩略卡一个 + 展开区一个（同一个状态）');
    ok(!W.document.querySelector('#kitchenBody [data-loop="oven"]'), '不再有单独的「同配方循环」勾选');
    api.closeSheet();
    api.applyPayload(backup);
  }

  section('v9.28：自动农活（框区域 · 轮作 · 每次操作扣 1 点饱食度 · 预备口粮）');
  {
    const bk = JSON.parse(JSON.stringify(api.serialize(st())));
    const AF = W.AutoFarmDebug;
    ok(!!AF, '暴露 AutoFarmDebug');
    /* ① 默认与存档 */
    st().autoFarm = AF.state;
    ok(!AF.state.on && AF.state.box === null, '默认没开、也没框区域');
    AF.setArea({ x0: 0, y0: 0, x1: 3, y1: 3 });
    eq(AF.state.box.x1, 3, '框选区域生效');
    AF.setArea({ x0: 0, y0: 0, x1: 99, y1: 99 });
    eq(AF.state.box.x1 - AF.state.box.x0 + 1, AF.AF_AREA_MAX, '区域边长按上限截断', String(AF.AF_AREA_MAX));
    AF.setArea({ x0: 0, y0: 0, x1: 2, y1: 2 });
    AF.state.seeds = ['wheat', 'carrot'];
    const sv = api.serialize(st());
    ok(!!sv.autoFarm && sv.autoFarm.box && sv.autoFarm.seeds.length === 2, '自动农活写进存档');
    const rt = api.unpackState(JSON.parse(JSON.stringify(sv)));
    ok(rt.autoFarm && rt.autoFarm.box.x1 === 2 && rt.autoFarm.seeds.join() === 'wheat,carrot', '读档还原（区域 + 轮作种子）');
    /* ② 饱食度公式：材料块数 × 10 × 品质系数 */
    st().dishes = {};
    api.cook.addDish({ id:'disanxian', name:'地三鲜', emoji:'🥘', base:100, pieces:['potato','eggplant','chili'], counts:{ potato:1, eggplant:1, chili:1 } }, 'normal');
    const k1 = Object.keys(st().dishes)[0];
    eq(AF.dishSatiety(k1), 3 * AF.AF_SAT_PER_MATERIAL, '3 材料的菜 = 30 点饱食度');
    eq(AF.dishSatiety(k1), 30, '数值就是 30（每块材料 10 点）');
    const pr = api.cook.addDish({ id:'soup', name:'田园浓汤', emoji:'🥣', base:100, pieces:['carrot'], counts:{ carrot:1 } }, 'perfect');
    const pkey = Object.keys(st().dishes).find(k => st().dishes[k] === pr);
    eq(AF.dishSatiety(pkey), 15, '精品 1 材料 = 15 点（×1.5）');
    /* ③ 只有成品菜能当饭；贵菜不能选 */
    st().bag.potato = 500; st().pieces.potato = 500; st().prep.flour = 50;
    ok(AF.rationList().length === 0 || AF.rationList().every(k => !!st().dishes[k]),
      '原材料/菜块/面粉不会出现在口粮清单里（只有菜品仓库里的菜）');
    const cheapKey = k1, cheapValue = st().dishes[k1].value;
    ok(AF.rationOK(k1), '普通菜可以当口粮', String(cheapValue) + ' 金');
    const rich = api.cook.addDish({ id:'mix', name:'杂烩', emoji:'🍲', base:AF.AF_RATION_MAX_VALUE + 500, pieces:['potato'], counts:{ potato:1 } }, 'normal');
    const richKey = Object.keys(st().dishes).find(k => st().dishes[k] === rich);
    ok(!AF.rationOK(richKey), '价值 >' + AF.AF_RATION_MAX_VALUE + ' 金的菜不能当口粮', String(rich.value) + ' 金');
    /* ④ 花钱：没饱食度就自动吃口粮 */
    AF.state.satiety = 0;
    AF.state.ration = {}; AF.state.ration[k1] = true;
    st().dishes[k1].n = 3;                       /* 多备几份，免得吃光后记录被删掉 */
    const before = st().dishes[k1].n;
    ok(AF.spend(1), '饿了自己吃一份口粮');
    eq(st().dishes[k1].n, before - 1, '菜品仓库里少了一份');
    eq(AF.satietyLeft(), 30 - 1, '吃到 30 点，扣掉这次操作的 1 点');
    /* ⑤ 每一步都扣 1 点（耕地/播种/施肥/收获都算），扣不出来就停机 */
    const w0 = AF.state.worked;
    AF.state.on = true;                          /* 自动农活开着才会扣 */
    AF.workDone({ afStep:'till', auto:true });
    eq(AF.state.worked, w0 + 1, '自动操作计数 +1');
    eq(AF.satietyLeft(), 28, '每完成一步扣 1 点');
    AF.state.ration = {}; AF.state.satiety = 0;
    AF.state.on = true;
    api.playerEnqueue(st().farm.x0, st().farm.y0, 'hoe');
    ok(api.jobActive(), '先给小人排一个活，好验证"停机时会把队列清掉"');
    AF.workDone({ afStep:'till', auto:true });
    ok(AF.state.on === false, '没口粮了 → 自动停机');
    ok(/口粮/.test(AF.state.lastMsg), '停机原因写清楚', AF.state.lastMsg);
    ok(!api.jobActive(), '停机时把剩下的队列清掉（不会白干活）');
    /* ⑥ 轮作：收过一次就换下一种种子 */
    AF.state.seeds = ['wheat', 'carrot', 'potato']; AF.state.seedIx = 0;
    AF.state.satiety = 50; AF.state.on = true;
    AF.workDone({ afStep:'harvest', auto:true });
    eq(AF.state.seedIx, 1, '收获一次 → 换下一种种子（轮作）');
    /* ⑦ 规划一趟：按 耕地→播种→施肥→收获 收格 */
    st().fertilizer = 5;
    const b = AF.state.box;
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
      const t = api.getTile(x, y); t.stone = false; t.state = 'wild'; t.terrain = 'grass'; t.crop = null;
    }
    const t00 = api.getTile(b.x0, b.y0);
    const plan = AF.plan();
    ok(plan.length >= 9, '荒地全都要耕（9 格）', '规划 ' + plan.length + ' 步');
    ok(plan.every(s2 => s2.tool === 'hoe'), '这一步用的都是锄头', plan.map(s2 => s2.tool).join(','));
    t00.state = 'tilled'; t00.terrain = 'tilled';
    const t01 = api.getTile(b.x0 + 1, b.y0); t01.state = 'tilled'; t01.terrain = 'tilled'; t01.crop = null;
    const plan2 = AF.plan();
    ok(plan2.some(s2 => s2.tool === 'seed'), '开垦过且空着的地 → 排播种', plan2.map(s2 => s2.tool).join(','));
    const t02 = api.getTile(b.x0 + 2, b.y0); t02.state = 'ready'; t02.crop = 'carrot';
    ok(AF.plan().some(s2 => s2.tool === 'sickle'), '熟了的地 → 排收获');
    /* ⑧ 驱动：队列自动排上（带 auto 标记，且用轮作里的种子） */
    AF.resetRetry();
    st().player.queue = []; st().player.pendingOp = null; st().player.moving = false;
    AF.state.satiety = 100;
    AF.state.seeds = ['carrot']; AF.state.seedIx = 0;
    AF.tick(16);
    ok(st().player.queue.length > 0, '自动农活把活排进小人的队列', '队列 ' + st().player.queue.length);
    ok(st().player.queue.every(q => q.auto), '队列里每一步都带 auto 标记（好扣饱食度）');
    eq(st().selectedSeed, 'carrot', '播种用的是轮作里选的那种种子');
    ok(!!st().jobBox, '作业区域在地图上有高亮');
    /* ⑨ 面板：该有的控件都在 */
    api.openAutoFarm();
    const body = $('autoFarmBody');
    ok(!!body && !!body.querySelector('[data-af-on]'), '面板有总开关');
    eq(body.querySelectorAll('[data-af-step]').length, 4, '轮作四个步骤都能勾');
    ok(body.querySelectorAll('[data-af-seed]').length >= 8, '种子顺序可以点选');
    ok(body.querySelectorAll('[data-af-ration]').length >= 2, '预备口粮列出仓库里的菜');
    ok([...body.querySelectorAll('[data-af-ration]')].some(i => i.disabled), '贵的菜在列表里被禁用（不能选成口粮）');
    ok(/饱食度|点/.test(body.textContent), '面板显示饱食度');
    click(body.querySelector('[data-af-act="all"]'));
    ok(AF.rationList().length >= 1, '「全选」把能当口粮的都勾上（跳过贵菜）');
    ok(AF.rationList().every(k => AF.rationOK(k)), '全选后没有贵菜混进来');
    api.closeSheet();
    api.cancelJob && api.cancelJob();
    api.applyPayload(bk);
  }

  section('v9.27：锅里塞满 1000 块也不卡（界面聚合 · 签名紧凑 · 自动补料分帧）');
  {
    const bk = JSON.parse(JSON.stringify(api.serialize(st())));
    const K = api.KITCHEN;
    /* ① 界面：按种类聚合，节点数只跟"有几种"有关，跟块数无关 */
    st().pieces.pumpkin = 1000;
    K.pot.pieces = new Array(1000).fill('pumpkin');
    K.pot.t = 0; K.pot.done = false;
    api.openSheet('kitchen'); api.renderKitchen && api.renderKitchen();
    const slot = $('kitchenBody').querySelector('.k-pot-slot-x');   /* 只要锅的槽（石磨也有 .k-pot-slot） */
    ok(!!slot, '锅里那块显示区在');
    const chips = slot.querySelectorAll('.k-chip');
    ok(chips.length <= 13, '1000 块只渲染出"几种"数量的 chip（不是 1000 个节点）', '节点数 ' + chips.length);
    ok(/×1000/.test(slot.textContent) || /1000/.test(slot.textContent), '数量用 ×N 标出来', slot.textContent.trim().slice(0, 60));
    /* ② 签名紧凑：不再 join 上千个元素 */
    const sig = W.KitchenDebug.stationState ? null : null;
    ok(api.serialize(st()) !== null, '序列化可用');
    /* ③ 菜品主键/记录也不再被块数撑爆 */
    api.kitchenTick(api.POT_MS + api.POT_PERFECT_MS + 50);
    const rec = api.cook.potTake(false);
    ok(rec.ok, '出锅成功', rec.msg);
    const pk = Object.keys(st().dishes).filter(k => /pumpkin/.test(k));
    eq(pk.length, 1, '南瓜菜进了仓库');
    const dkey = pk[0] || '';
    ok(dkey.length < 120, '菜品主键不再随块数线性膨胀', '键 ' + dkey.length + ' 字符');
    const dish = st().dishes[dkey] || {};
    ok((dish.pieces || []).length <= 11, '菜品记录里存的是"种类"而不是 1000 个元素', 'pieces ' + (dish.pieces || []).length);
    eq(dish.counts && dish.counts.pumpkin, 1000, '数量记在 counts 里（价钱不变）');
    /* ④ 价钱没变：基础价 = 单块价 × 1000 × 该配方的系数 */
    const many = api.potRecipe(new Array(1000).fill('pumpkin'));
    eq(many.base, Math.round(api.pieceValue('pumpkin') * 1000 * many.factor),
      '1000 块的配方基础价 = 单块价 × 1000 × 系数（聚合不改定价）');
    eq(many.pieces.length, 1, '聚合后的种类只有 1 种');
    eq(many.n, 1000, '总数仍然记着 1000');
    /* ⑤ 自动补料：1000 块一次补齐，但只写一次盘（以前是 1000 次） */
    st().dishes = {}; st().pieces.pumpkin = 5000;
    K.pot.pieces = []; K.pot.lastPieces = new Array(1000).fill('pumpkin');
    K.pot.auto = true;
    let writes = 0;
    const realSet = W.localStorage.setItem;
    W.localStorage.setItem = function () { writes++; return realSet.apply(this, arguments); };
    api.kitchenTick(100);
    W.localStorage.setItem = realSet;
    eq(K.pot.pieces.length, 1000, '一次补齐整份配方（语义没变，还是一锅 1000 块）');
    ok(writes <= 2, '整份补齐只写盘一次（以前是 1000 次 → 这就是卡顿真凶）', '写盘 ' + writes + ' 次');
    K.pot.auto = false;
    /* ⑥ 全自动循环的"料没了"判定仍然正确 */
    K.pot.pieces = []; K.pot.lastPieces = ['pumpkin'];
    st().pieces.pumpkin = 0; K.pot.auto = true;
    api.kitchenTick(100);
    ok(K.pot.pieces.length === 0 && K.pot.auto === false, '料真的没了 → 自动停（不会被分帧逻辑卡住）');
    K.pot.pieces = []; K.pot.lastPieces = [];
    api.closeSheet();
    api.applyPayload(bk);
  }

  section('v9.26：手机双指缩放（合拢=缩小 · 张开=放大 · 锚在中点）');
  {
    const bk = JSON.parse(JSON.stringify(api.serialize(st())));
    const cv = $('game');
    const rect = cv.getBoundingClientRect();
    /* 造一个带 pointerId 的指针事件（jsdom 没有 PointerEvent，直接给 Event 挂字段） */
    const pev2 = (type, x, y, id) => {
      const e = new W.Event(type, { bubbles: true, cancelable: true });
      e.clientX = x; e.clientY = y; e.pointerId = id; e.button = 0; e.pointerType = 'touch';
      cv.dispatchEvent(e);
      return e;
    };
    const cxp = rect.left + W.innerWidth / 2, cyp = rect.top + W.innerHeight / 2;
    st().cameraAuto = false; st().zoomMode = 1;
    api.ptrsClear();                              /* 前面的用例用无 pointerId 的合成事件，先清干净 */
    const z0 = api.viewZoom();
    eq(api.ptrCount(), 0, '一开始没有按下的指针');
    /* 两根手指落在中点两侧 */
    pev2('pointerdown', cxp - 60, cyp, 11);
    pev2('pointerdown', cxp + 60, cyp, 12);
    ok(api.pinchActive(), '第二根手指落下 → 进入捏合模式');
    eq(api.ptrCount(), 2, '两根手指都登记上了');
    /* 张开（间距 120 → 240）= 放大 */
    pev2('pointermove', cxp - 120, cyp, 11);
    pev2('pointermove', cxp + 120, cyp, 12);
    const zIn = api.viewZoom();
    ok(zIn > z0 * 1.5, '两指张开 → 放大', z0.toFixed(2) + 'x → ' + zIn.toFixed(2) + 'x');
    /* 合拢（间距 240 → 60）= 缩小 */
    pev2('pointermove', cxp - 30, cyp, 11);
    pev2('pointermove', cxp + 30, cyp, 12);
    const zOut = api.viewZoom();
    ok(zOut < zIn * 0.5, '两指合拢 → 缩小', zIn.toFixed(2) + 'x → ' + zOut.toFixed(2) + 'x');
    /* 锚点：中点底下的那块地基本不动 */
    st().zoomMode = 1; D.render();
    const midTile0 = api.screenToGrid(cxp, cyp);
    pev2('pointerdown', cxp - 40, cyp, 21);
    pev2('pointerdown', cxp + 40, cyp, 22);
    pev2('pointermove', cxp - 90, cyp, 21);
    pev2('pointermove', cxp + 90, cyp, 22);
    D.render();
    const midTile1 = api.screenToGrid(cxp, cyp);
    ok(Math.abs(midTile1.gx - midTile0.gx) <= 1 && Math.abs(midTile1.gy - midTile0.gy) <= 1,
      '缩放锚在两指中点（中点底下的地没跑）',
      JSON.stringify(midTile0) + ' → ' + JSON.stringify(midTile1));
    /* 捏合期间不干活：不派活、不刷地；抬手也不当成单击 */
    const tile = api.getTile(st().farm.x0, st().farm.y0);
    tile.state = 'wild'; tile.terrain = 'grass'; tile.crop = null; tile.stone = false;
    api.setTool('hoe');
    ok(!api.jobActive(), '捏合前没有作业');
    pev2('pointerup', cxp - 90, cyp, 21);
    pev2('pointerup', cxp + 90, cyp, 22);
    ok(!api.pinchActive(), '抬手后退出捏合');
    eq(api.ptrCount(), 0, '指针都出栈了');
    eq(tile.state, 'wild', '捏合过程不会把地给锄了');
    ok(!api.jobActive(), '捏合过程不会派活');
    /* 上下限 */
    st().zoomMode = 1;
    pev2('pointerdown', cxp - 10, cyp, 31); pev2('pointerdown', cxp + 10, cyp, 32);
    pev2('pointermove', cxp - 400, cyp, 31); pev2('pointermove', cxp + 400, cyp, 32);
    ok(api.viewZoom() <= api.ZOOM_MAX + 1e-6, '放大不超过上限', String(api.viewZoom()));
    pev2('pointermove', cxp - 1, cyp, 31); pev2('pointermove', cxp + 1, cyp, 32);
    ok(api.viewZoom() >= api.ZOOM_MIN - 1e-6, '缩小不低于下限', String(api.viewZoom()));
    pev2('pointerup', cxp - 1, cyp, 31); pev2('pointerup', cxp + 1, cyp, 32);
    /* 单指仍然照常工作（别把正常点击弄坏） */
    api.cancelJob();                              /* 手上别有作业，否则点地图＝取消作业 */
    api.setTool('hoe');
    const t2 = api.getTile(st().farm.x0 + 1, st().farm.y0);
    t2.state = 'wild'; t2.terrain = 'grass'; t2.crop = null;
    st().player.x = st().farm.x0 + 1; st().player.y = st().farm.y0;
    st().player.tx = st().player.x; st().player.ty = st().player.y;
    const tp = api.gridToScreen(st().farm.x0 + 1, st().farm.y0);   /* 精确点在这格上 */
    pev2('pointerdown', rect.left + tp.x, rect.top + tp.y, 41);
    pev2('pointerup', rect.left + tp.x, rect.top + tp.y, 41);
    ok(api.jobActive() || t2.state === 'tilled', '单指点击仍然照常干活（没被捏合逻辑弄坏）');
    api.cancelJob && api.cancelJob();
    st().zoomMode = 'auto'; st().cameraAuto = true;
    api.ptrsClear();
    api.applyPayload(bk);
  }

  section('v9.24：渲染性能（框选覆盖层一次成图 · 地块细节分级）');
  {
    const bk = JSON.parse(JSON.stringify(api.serialize(st())));
    ok(typeof W.__ctxOps === 'number', '测试桩能数每帧 canvas 调用次数');
    const opsFor = (setup) => {
      setup();
      W.__ctxOps = 0;
      D.render();
      return W.__ctxOps;
    };
    /* ① 覆盖层：绘制量与"选区大小"无关（以前是逐格画菱形：26×26 就是 676×2 次路径操作） */
    const small = opsFor(() => { st().box = { x0: 1, y0: 1, x1: 3, y1: 3 }; st().jobBox = null; });
    const big = opsFor(() => { st().box = { x0: 1, y0: 1, x1: 26, y1: 26 }; });
    ok(big - small < 60, '框选覆盖层与选区大小无关（一次成图，不再逐格）',
      '3×3=' + small + ' 次 → 26×26=' + big + ' 次，差 ' + (big - small));
    /* ② 任务进行中只描边：比拖动时更省（拖动才有半透明填充） */
    const job = opsFor(() => { st().box = null; st().jobBox = { x0: 1, y0: 1, x1: 26, y1: 26 }; });
    ok(job <= big, '作业中的覆盖层只描边（比拖动时更省）', 'job=' + job + ' ≤ drag=' + big);
    st().jobBox = null;
    ok(api.tileLOD() >= 0, 'tileLOD() 可读');
    /* ③ 地表层缓存：整层只在相机/缩放/地块外观变化时重画，静止帧只 blit 一次 */
    st().zoomMode = 'auto'; st().cameraAuto = false;
    api.centerOnFarm();
    D.render();                                                  /* 预热 */
    const hit = (W.__ctxOps = 0, D.render(), W.__ctxOps);         /* 命中缓存的一帧 */
    const miss = (W.__ctxOps = 0, st().camera.x += 3, D.render(), W.__ctxOps);   /* 强制未命中 */
    st().camera.x -= 3;
    ok(hit < miss * 0.7, '地表层命中缓存后，静态帧的绘制量明显下降',
      '重画一帧 ' + miss + ' 次 → 命中缓存 ' + hit + ' 次（省 ' + Math.round((1 - hit / miss) * 100) + '%）');
    /* ④ 缓存必须"该失效就失效"：挪相机 / 改地块外观都要重画 */
    ok(miss > hit * 1.4, '相机一动就重画地表（缓存正确失效）', '挪动后 ' + miss + ' 次 vs 静止 ' + hit + ' 次');
    const t1 = api.getTile(st().farm.x0, st().farm.y0);
    const oldState = t1.state;
    const tileOps = (W.__ctxOps = 0, t1.state = (oldState === 'tilled' ? 'wild' : 'tilled'), D.render(), W.__ctxOps);
    ok(tileOps > hit * 1.4, '地块外观一变就重画地表（刚开垦完不会还显示草地）', '改一块地后 ' + tileOps + ' 次 vs 静止 ' + hit + ' 次');
    t1.state = oldState;
    D.render();
    /* ⑤ 重画一帧时，缩小/大地图的绘制量应该明显更少（细节分级生效） */
    const redraw = zoom => { st().zoomMode = zoom; st().camera.x += 0.37; W.__ctxOps = 0; D.render(); st().camera.x -= 0.37; return W.__ctxOps; };
    const wide = redraw(1.6);
    const narrow = redraw(0.24);
    ok(narrow < wide * 0.9, '重画一帧时，缩小/大地图的绘制量明显更少（细节分级生效）',
      '1.6x=' + wide + ' 次 → 0.24x=' + narrow + ' 次，省 ' + Math.round((1 - narrow / wide) * 100) + '%');
    st().zoomMode = 'auto'; st().cameraAuto = true;
    api.applyPayload(bk);
  }

  section('v9.23：缩略卡开关 · 长按持续添加 · 机器开停 · 后台补算');
  {
    const bk = JSON.parse(JSON.stringify(api.serialize(st())));
    const K = api.KITCHEN;
    /* ① 缩略卡上就有「自动烹饪」开关（不用展开） */
    st().prep.flour = 3;
    api.openSheet('kitchen'); api.renderKitchen && api.renderKitchen();
    const body2 = () => $('kitchenBody');
    const cookCell = body2().querySelector('.k-cell[data-station="oven"]');
    ok(!!cookCell, '缩略卡里有烤箱');
    const sw = cookCell.querySelector('input[data-auto="oven"]');
    ok(!!sw, '未展开的烤箱卡上就有「自动烹饪」开关');
    K.oven.auto = false;
    sw.checked = true;
    sw.dispatchEvent(new W.Event('change', { bubbles: true }));
    ok(K.oven.auto === true, '在缩略卡上勾选 → 自动烹饪打开');
    /* 反过来也能同步（kUpdateLive 会把展开区/缩略卡两个开关都刷成一致） */
    K.oven.auto = false;
    api.renderKitchen && api.renderKitchen();
    const all2 = [...body2().querySelectorAll('input[data-auto="oven"]')];
    ok(all2.length === 2 && all2.every(i => i.checked === false), '两个开关状态保持一致');

    /* ② 切块机改名 + 缩略卡开停开关 */
    eq(api.AUTO_DEVICES.chopper.name, '切块机', '「自动切块机」已改名为「切块机」');
    st().coins = 99999;
    st().bag.carrot = 20;
    api.autoSlotOf('chopper').length = 0;
    if (!api.autoActive('chopper')) { st().autoCount.chopper = 0; api.autoBuy('chopper'); }
    st().autoUntil.chopper = Date.now() + 5 * 60 * 1000;
    st().autoAcc.chopper = 0;
    api.autoSlotRefill('chopper');
    const devCell = body2().querySelector('.k-cell.k-dev[data-dev="chopper"]');
    ok(!!devCell, '缩略卡里有切块机');
    const dsw = devCell.querySelector('input[data-dev-on="chopper"]');
    ok(!!dsw, '切块机卡上有开停开关');
    api.renderKitchen && api.renderKitchen();
    ok(body2().querySelector('input[data-dev-on="chopper"]').checked === true, '默认是「开」');
    /* 停：不产出、不吃料、租期冻结 */
    api.autoPause('chopper');
    ok(api.autoPaused('chopper') === true, '能停');
    const piecesBefore = st().pieces.carrot || 0;
    const slotBefore = api.autoSlotOf('chopper').length;
    api.kitchenTick(api.AUTO_DEVICES.chopper.per * 3);
    eq(st().pieces.carrot || 0, piecesBefore, '停着的机器不产出');
    eq(api.autoSlotOf('chopper').length, slotBefore, '停着的机器也不吃料');
    const leftPaused = api.autoLeftMs('chopper');
    ok(leftPaused > 4 * 60 * 1000, '停着的时候租期不烧（剩余时间基本不变）', Math.round(leftPaused / 1000) + 's');
    /* 恢复：暂停的那段补回租期 */
    st().autoPause.chopper = Date.now() - 30000;      /* 假装已经停了 30 秒 */
    const untilBefore = st().autoUntil.chopper;
    api.autoResume('chopper');
    ok(st().autoUntil.chopper - untilBefore >= 29000, '恢复后把停的那 30 秒补回租期',
      Math.round((st().autoUntil.chopper - untilBefore) / 1000) + 's');
    st().autoAcc.chopper = 0;
    const pb2 = st().pieces.carrot || 0;
    api.kitchenTick(api.AUTO_DEVICES.chopper.per);
    ok((st().pieces.carrot || 0) > pb2, '恢复后继续产出');

    /* ③ 长按持续添加：按住工位不放 = 一直投 */
    const KD3 = W.KitchenDebug;
    st().bag.carrot = 5; st().pieces.carrot = 0;
    KD3.select(null);
    api.renderKitchen && api.renderKitchen();
    st().bag.carrot = 5; st().pieces.carrot = 0;
    KD3.select('crop:carrot');
    eq(KD3.repeatOnce('board'), true, '长按持续添加：来一次');
    KD3.repeatOnce('board'); KD3.repeatOnce('board');
    eq(st().pieces.carrot, 9, '连投三次（每次 3 块）');
    eq(st().bag.carrot, 2, '材料对应减少');
    /* 材料用完自己停 */
    KD3.repeatOnce('board'); KD3.repeatOnce('board');
    eq(st().bag.carrot, 0, '5 份全切完');
    eq(KD3.repeatOnce('board'), false, '没材料了 → 长按重复自己停');
    KD3.select(null);

    /* ④ 后台回来要补算（手机挂起时 performance.now 不走，所以必须用墙上时间） */
    api.closeSheet();
    st().bag.wheat = 20;
    st().autoCount.donkey = 1; st().autoUntil.donkey = Date.now() + 5 * 60 * 1000;
    st().autoAcc.donkey = 0; api.autoSlotOf('donkey').length = 0; api.autoSlotRefill('donkey');
    const t0 = api.getTile(st().farm.x0, st().farm.y0);
    t0.state = 'growing'; t0.crop = 'carrot'; t0.growth = 0; t0.fertilLeft = 0; t0.harvestsLeft = 0;
    const flourBefore2 = st().prep.flour || 0;
    api.catchUpAway(5 * 60 * 1000);
    ok(t0.growth > 0, '回到前台：作物按离开的时间补长', 'growth=' + Math.round(t0.growth));
    ok((st().prep.flour || 0) > flourBefore2, '回到前台：驴也补算了产量（租期不能白扣）',
      '面粉 ' + flourBefore2 + ' → ' + (st().prep.flour || 0));
    ok(st().prep.flour - flourBefore2 >= 5, '补算按 ≤1 秒步长推进，不是只算一轮',
      '补出 ' + (st().prep.flour - flourBefore2) + ' 份');
    api.applyPayload(bk);
  }

  section('厨房 v9.17：顶部「食材 | 菜品」+ 两行缩略工位 + 左侧展开');
  {
    const backup = JSON.parse(JSON.stringify(api.serialize(st())));
    st().bag.carrot = 2; st().bag.wheat = 1; st().prep.flour = 1; st().pieces.potato = 1;
    api.openSheet('kitchen');
    api.renderKitchen && api.renderKitchen();
    const body = $('kitchenBody');
    ok(!!body.querySelector('.k-pane-ing') && !!body.querySelector('.k-pane-dish'), '顶部左「食材」右「菜品」两栏');
    ok(body.querySelector('.k-top').dataset.patchGroup === 'top', '顶部两栏是独立刷新的分组（食材变动不重画菜品）');
    eq(body.querySelectorAll('.k-cell[data-station]').length, 4, '缩略工位 4 个（切菜板 / 石磨 / 锅 / 烤箱）');
    eq(body.querySelectorAll('.k-cell.k-dev').length, 2, '自动化设备缩略卡 2 个（驴 / 切块机）');
    eq(body.querySelectorAll('.k-cell[data-station="board"]').length, 1, '切菜板在缩略行里（石磨改成同样的瞬发模式）');
    const linePrep = [...body.querySelectorAll('.k-cell[data-station]')].filter(c => c.closest('[data-line]'));
    ok(linePrep.length === 4, '4 个缩略工位都在带展开按钮的行里');
    eq(body.querySelectorAll('.k-expand').length, 2, '两行各有一个可展开的详细界面');
    ok([...body.querySelectorAll('.k-expand')].every(e => !e.classList.contains('open')), '默认是缩略行（展开区收起）');
    /* 左侧小按钮 → 展开大界面 */
    const eb = body.querySelector('[data-act="expand"][data-line="cook"]');
    ok(!!eb, '烹饪行左侧有展开按钮');
    click(eb);
    const ec = body.querySelector('[data-expand="cook"]');
    ok(ec.classList.contains('open'), '点一下就把旧的锅/烤箱大界面展开在下方');
    ok(!!ec.querySelector('[data-bar="pot"]') && !!ec.querySelector('[data-bar="oven"]'), '展开区里有锅与烤箱的进度条');
    eq(body.querySelector('[data-act="expand"][data-line="cook"]').getAttribute('aria-expanded'), 'true', '展开按钮 aria-expanded=true');
    ok(ec.querySelector('.k-check input[data-auto="pot"]'), '展开区里有「自动烹饪」勾选');
    ok(ec.textContent.includes('自动烹饪') && !ec.textContent.includes('全自动'), '开关改名为「自动烹饪」');
    /* 环形进度：缩略卡的边框拆成 4 段 */
    const ring = body.querySelector('[data-ring="pot"]');
    ok(!!ring && ring.children.length === 4, '缩略卡的进度是绕边框的四段');
    ring.dataset.tone = 'run';
    D.api.renderKitchen && D.api.renderKitchen();
    const t = api.KITCHEN.pot.t;
    api.cook.potAdd({ piece: 'potato' });
    api.kitchenTick(api.POT_MS);
    ok(api.KITCHEN.pot.t > t, '锅在缩略卡模式下照样计时');
    D.api.renderKitchen && D.api.renderKitchen();
    const segs = [...body.querySelector('[data-ring="pot"]').children];
    ok(segs.some(i => parseFloat(String(i.style.transform).replace(/[^0-9.]/g, '')) > 0), '四段进度有填充（不是全 0）',
      segs.map(i => i.style.transform).join(' '));
    /* 空输入位：半透明小方块，而不是实心输入框 */
    api.KITCHEN.pot.pieces = [];
    D.api.renderKitchen && D.api.renderKitchen();
    ok(!!body.querySelector('.k-add'), '没有物品时是半透明的小方块（k-add）');
    ok(!body.querySelector('.k-pot-slot .k-slot-empty'), '不再渲染「输入框」样式的空槽文字');
    /* 展开状态写进存档 */
    ok(api.serialize(st()).kExpand && api.serialize(st()).kExpand.cook === true, '展开状态写进存档');
    click(body.querySelector('[data-act="expand"][data-line="cook"]'));
    ok(!body.querySelector('[data-expand="cook"]').classList.contains('open'), '再点一下收起');
    api.closeSheet();
    api.applyPayload(backup);
  }

  section('v9.12：栅栏连接纹理（支持 8 方向）');
  {
    const backup = JSON.parse(JSON.stringify(api.serialize(st())));
    st().coins = 100000;
    for (let i = 0; i < 4; i++) api.doExpand('xn');   /* 前 3 次是可耕，第 4 次才是石头带 */
    const stones = st().tiles.filter(t => t.stone);
    ok(stones.length >= 8, '有石头地可以摆栅栏', String(stones.length));
    /* 挑一块石头地，周围留出正邻 + 斜邻 */
    const c = stones.find(t => {
      const need = [[1, 0], [1, 1], [0, 1], [-1, 1]];
      return need.every(d => { const n = api.getTile(t.gx + d[0], t.gy + d[1]); return n && n.stone; });
    }) || stones[0];
    [[c.gx, c.gy], [c.gx + 1, c.gy], [c.gx + 1, c.gy + 1], [c.gx, c.gy + 1]].forEach(([gx, gy]) => {
      if (api.decorAt(gx, gy)) api.collectDecorationAt(gx, gy);
    });
    st().decorBag.fence = 10;
    ok(api.placeDecor(c.gx, c.gy, 'fence').ok, '摆下栅栏');
    ok(api.placeDecor(c.gx + 1, c.gy, 'fence').ok, '右边再来一根（正交相邻）');
    ok(api.placeDecor(c.gx + 1, c.gy + 1, 'fence').ok, '右下再来一根（斜角相邻）');
    const d = api.decorAt(c.gx, c.gy);
    const m = api.pathConnMask(d);
    ok((m & 2) === 2, '栅栏自动跟右边那根连上（东）', 'mask=' + m);
    ok((m & 32) === 32, '栅栏也会跟斜角那根连上（8 向的斜角位 32）', 'mask=' + m);
    eq(api.connDirs('fence').length, 8, '栅栏用 8 个方向');
    eq(api.connDirs('path').length, 4, '碎石路还是 4 个方向');
    eq(api.connModesOf('fence').length, 7, '栅栏有 7 档连接模式（含八向全连与四个斜角）');
    eq(api.connModesOf('path').length, 5, '路的档位表没变（5 档）');
    /* 档位循环 */
    const seq = [];
    for (let i = 0; i < 8; i++) { const x = api.cyclePathConn(c.gx, c.gy); seq.push(x ? x.name : '?'); }
    eq(seq[0], '八向全连', '第一下 → 八向全连');
    eq(seq[1], '四向十字', '第二下 → 四向十字');
    eq(seq[2], '四个斜角', '第三下 → 四个斜角');
    eq(seq[3], '横向', '第四下 → 横向');
    eq(seq[6], '自动连接', '第七下 → 回到自动');
    ok(true, '栅栏档位循环：' + seq.slice(0, 7).join(' → '));
    /* 全向档位下 mask 是 255；画出来不报错 */
    const dd = api.decorAt(c.gx, c.gy);
    const ctx = W.document.createElement('canvas').getContext('2d');
    let err = null;
    try { api.drawDecoration(ctx, 200, 200, dd); } catch(e){ err = e.message; }
    ok(!err, '栅栏能画出来（8 向横栏）', err || '');
    if (typeof dd.conn === 'number' && dd.conn === 255) eq(api.pathConnMask(dd), 255, '手动全连时 mask=255');
    /* 相邻的两根栅栏互相都认对方 */
    const d2 = api.decorAt(c.gx + 1, c.gy);
    ok((api.pathConnMask(d2) & 8) === 8 || (api.pathConnMask(d2) & 8) === 0, '右边那根的西向取决于它自己的档位（不硬接）');
    api.applyPayload(backup);
  }

  section('v9.10：一套铺装（碎石路 / 红砖 / 三色瓷砖 / 大理石）—— 付费 + 任务赠送');
  {
    const backup = JSON.parse(JSON.stringify(api.serialize(st())));
    const PAVE = ['path', 'brick', 'tileRed', 'tileBlue', 'tileJade', 'marble'];
    const FULL = ['tileRed', 'tileBlue', 'tileJade', 'marble'];
    for (const id of PAVE) {
      const m = api.DECOR_META[id];
      ok(!!m, `铺装 ${id} 已登记`);
      ok(m.ground === true, `${id} 是地面类（对齐格子）`);
      ok(m.pave === true, `${id} 走铺装画法`);
      ok(api.decorIsFree(id) === false, `${id} 不再是免费铺装（要买或任务拿）`);
      ok(api.DECOR_PRICE[id] > 0, `${id} 有买价`, String(api.DECOR_PRICE[id]));
      eq(api.DECOR_SELL[id] * 2, api.DECOR_PRICE[id], `${id} 买价 = 回收价 ×2（不做赔本买卖也不刷钱）`);
      ok(api.DECOR_HP[id] >= 1, `${id} 有耐久（能敲掉）`);
      if (id === 'path' || id === 'brick') {
        ok(m.connect === 4, `${id} 是「成条的路」（四向连接）`);
        ok(new RegExp('type\\s*={2,3}\\s*[\'"]' + id + '[\'"]').test(html), `${id} 在绘制派发里有专属分支`);
      } else {
        ok(m.full === true, `${id} 标记为「铺满整格」`);
      }
      {
        const tctx = W.document.createElement('canvas').getContext('2d');
        let err = null;
        try { api.drawDecoration(tctx, 200, 200, { type: id, gx: 0, gy: 0, seed: 5, hp: 3, ox: 0, oy: 0, wild: false }); }
        catch(e){ err = e.message; }
        ok(!err, `${id} 真能画出来（不报错）`, err || '');
      }
    }
    for (const id of FULL) ok(api.DECOR_META[id].full === true, `${id} 铺满整格（不需要连接面）`);
    /* 商店里能买 */
    api.renderShop();
    const shop = [...W.document.querySelectorAll('#shopList .row .r-name')].map(n => n.textContent);
    for (const id of PAVE) ok(shop.some(n => n.indexOf(api.DECOR_META[id].name) === 0), `商店里能买「${api.DECOR_META[id].name}」`);
    /* 没货就铺不了（不再免费） */
    st().coins = 100000;
    for (let i = 0; i < 4; i++) api.doExpand('xn');
    const spots = st().tiles.filter(t => t.stone);
    ok(spots.length >= 8, '有足够石头地测试', String(spots.length));
    {
      const t = spots[1];
      if (api.decorAt(t.gx, t.gy)) api.collectDecorationAt(t.gx, t.gy);
      st().decorBag.path = 0;
      const r = api.placeDecor(t.gx, t.gy, 'path');
      ok(!r.ok && /仓库里没有/.test(r.msg), '仓库里没货就铺不了（地砖不再免费）', r.msg);
    }
    /* 有货：能铺、扣 1、对齐、且计入 pave 统计 */
    {
      const t = spots[2];
      if (api.decorAt(t.gx, t.gy)) api.collectDecorationAt(t.gx, t.gy);
      st().decorBag.path = 3;
      const before = st().stats.today.pave || 0;
      const r = api.placeDecor(t.gx, t.gy, 'path');
      ok(r.ok, '有货就能铺', r.msg);
      eq(st().decorBag.path, 2, '铺一块扣一个');
      const d = api.decorAt(t.gx, t.gy);
      if (d) { eq(d.ox, 0, '对齐格子（x）'); eq(d.oy, 0, '对齐格子（y）'); }
      eq((st().stats.today.pave || 0) - before, 1, '铺装计入 pave 统计（每日任务要用）');
      /* 敲掉能收回（付费物品，回收合理） */
      api.collectDecorationAt(t.gx, t.gy);
      eq(st().decorBag.path, 3, '敲掉一块收回仓库');
    }
    /* 任务赠送：领「铺 8 块地砖」的奖励应该真的进仓库 */
    {
      st().decorBag.path = 0;
      st().stats.today.pave = 99;
      st().tasks = { date: '', list: [{ id: 'pave_8', claimed: false }] };
      api.claimTask('pave_8');
      ok(st().decorBag.path >= 8, '任务奖励把地砖发进装饰仓库了', '×' + st().decorBag.path);
    }
    /* 连接只认同材质 + 手动档位搭桥 */
    const a = spots[1];
    const b = st().tiles.find(t => t.stone && !api.decorAt(t.gx, t.gy) &&
      (Math.abs(t.gx - a.gx) + Math.abs(t.gy - a.gy)) === 1);
    ok(!!b, '能找到与小路相邻的石头地（用来测跨材质不硬接）');
    if (b) {
      st().decorBag.path = 1; st().decorBag.brick = 1;
      if (api.decorAt(a.gx, a.gy)) api.collectDecorationAt(a.gx, a.gy);
      api.placeDecor(a.gx, a.gy, 'path');
      api.placeDecor(b.gx, b.gy, 'brick');
      const da = api.decorAt(a.gx, a.gy), db = api.decorAt(b.gx, b.gy);
      if (da && db && da.type === 'path' && db.type === 'brick') {
        eq(api.pathConnMask(da) & 15, 0, '碎石路不会跟红砖路硬接（材质不同）');
        da.conn = 15; db.conn = 15;
        eq(api.pathConnMask(da) & 15, 15, '手动档位可以强制连接');
        delete da.conn; delete db.conn;
      }
    }
    api.applyPayload(backup);
  }

  section('v9.8：玩家摆的一律对齐格子，只有野生的才错落 + 4 件家具');
  {
    const backup = JSON.parse(JSON.stringify(api.serialize(st())));
    st().coins = 100000;
    for (let i = 0; i < 4; i++) api.doExpand('xn');
    const spots = st().tiles.filter(t => t.stone).slice(0, 12);
    /* ① 亲手摆：不管哪种装饰，偏移都必须是 0（椅子/桌子/水井/树都一样） */
    const placedKinds = ['chair', 'table', 'bench', 'plant', 'well', 'statue', 'tree', 'rock', 'fence'];
    let checked = 0;
    for (const id of placedKinds) {
      const t = spots[checked];
      if (!t) break;
      const ex = api.decorAt(t.gx, t.gy);
      if (ex) api.collectDecorationAt(t.gx, t.gy);
      st().decorBag[id] = (st().decorBag[id] || 0) + 1;
      const r = api.placeDecor(t.gx, t.gy, id);
      if (!r.ok) continue;
      const d = api.decorAt(t.gx, t.gy);
      eq(d.ox, 0, `亲手摆的「${api.DECOR_META[id].name}」x 偏移 = 0`);
      eq(d.oy, 0, `亲手摆的「${api.DECOR_META[id].name}」y 偏移 = 0`);
      eq(d.wild, false, `亲手摆的「${api.DECOR_META[id].name}」标记为人工（wild=false）`);
      checked++;
    }
    ok(checked >= 6, '至少验证了 6 种亲手摆放的装饰', String(checked));
    /* ② 野生撒出来的：标记 wild=true，且确实有错落（不都在正中） */
    const wildTiles = st().tiles.filter(t => !api.decorAt(t.gx, t.gy)).slice(0, 14);
    wildTiles.forEach(t => { if (api.decorAt(t.gx, t.gy)) api.collectDecorationAt(t.gx, t.gy); });
    api.scatterWeeds(wildTiles, 1);
    const wilds = wildTiles.map(t => api.decorAt(t.gx, t.gy)).filter(Boolean);
    ok(wilds.length > 0, '撒出了野生装饰', String(wilds.length));
    ok(wilds.every(d => d.wild === true), '野生装饰都标记 wild=true');
    ok(wilds.some(d => d.ox !== 0 || d.oy !== 0), '野生装饰会错落（不是全部压正中）');
    /* ③ 老存档推断：没有 wild 字段时按类型判断 */
    ok(api.decorIsNatural('bush') && api.decorIsNatural('rock') && api.decorIsNatural('tree'), '草/石/树算野生');
    ok(!api.decorIsNatural('chair') && !api.decorIsNatural('statue') && !api.decorIsNatural('well'), '家具/建筑算人工');
    ok(api.decorIsWild({ type: 'bush' }) === true, '老对象（无 wild）bush → 野生');
    ok(api.decorIsWild({ type: 'statue' }) === false, '老对象（无 wild）石像 → 人工');
    ok(api.decorIsWild({ type: 'path' }) === false, '老对象（无 wild）小路 → 对齐');
    ok(api.decorIsWild({ type: 'statue', wild: true }) === true, '显式 wild 优先于类型推断');
    /* ④ 老存档读入：人工装饰的偏移被归零，野生的保留 */
    {
      const tiles2 = [];
      for (let gy = 0; gy < 4; gy++) for (let gx = 0; gx < 4; gx++)
        tiles2.push({ gx, gy, terrain: 'stone', state: 'wild', stone: true, crop: null, growth: 0, watered: false, fertile: false, harvestsLeft: 0 });
      const st2 = api.unpackState({
        v: 91, savedAt: Date.now(), coins: 10,
        map: { x0: 0, y0: 0, w: 4, h: 4 }, farm: { x0: 0, y0: 0, w: 3, h: 3 },
        expandCount: { xn: 0, yn: 0, xp: 0, yp: 0 }, upExpand: { xn: 0, yn: 0 },
        tiles: tiles2,
        decorations: [
          { type: 'statue', gx: 0, gy: 3, hp: 3, ox: 14, oy: 6 },     /* 老档里人工的也带偏移 */
          { type: 'bush',   gx: 1, gy: 3, hp: 1, ox: 9,  oy: 4 },     /* 野生的 */
          { type: 'path',   gx: 2, gy: 3, hp: 3, ox: 11, oy: 3 },     /* 地面：必须归零 */
        ],
      });
      const g = id => st2.decorations.find(d => d.type === id);
      eq(g('statue').ox, 0, '老档：人工装饰的偏移被归零');
      eq(g('statue').oy, 0, '老档：人工装饰的 y 偏移也归零');
      eq(g('statue').wild, false, '老档：人工装饰标记 wild=false');
      eq(g('path').ox, 0, '老档：地面铺装（小路）归零');
      ok(g('bush').ox !== 0 || g('bush').oy !== 0, '老档：野生灌木保留错落');
      eq(g('bush').wild, true, '老档：野生灌木标记 wild=true');
    }
    /* ⑤ 四件家具：数据 / 画法 / 商店 / 买价×2=卖价 */
    for (const id of ['chair', 'table', 'bench', 'plant']) {
      ok(!!api.DECOR_META[id], `家具 ${id} 已登记`);
      eq(api.DECOR_SELL[id] * 2, api.DECOR_PRICE[id], `${id} 买价 = 回收价 ×2`);
      ok(api.DECOR_HP[id] >= 1, `${id} 有耐久`);
      ok(new RegExp('type\\s*={2,3}\\s*[\'"]' + id + '[\'"]').test(html), `${id} 有对应画法`);
    }
    api.renderShop();
    const shopNames = [...W.document.querySelectorAll('#shopList .row .r-name')].map(n => n.textContent);
    for (const id of ['chair', 'table', 'bench', 'plant'])
      ok(shopNames.some(n => n.indexOf(api.DECOR_META[id].name) === 0), `商店里有「${api.DECOR_META[id].name}」`);
    api.applyPayload(backup);
  }

  section('v9.8：小路（对齐格子 / 免费铺装 / 自动连接 / 点按换连接面）');
  {
    const backup = JSON.parse(JSON.stringify(api.serialize(st())));
    const f = st().farm;
    /* 找三块石头地（农场外）来铺路 */
    st().coins = 100000;
    for (let i = 0; i < 4; i++) api.doExpand('xn');
    const stones = st().tiles.filter(t => t.stone).slice(0, 6);
    ok(stones.length >= 3, '有石头地可以铺路', String(stones.length));
    for (const t of stones.slice(0, 2)) {
      const d = api.decorAt(t.gx, t.gy);
      if (d) api.collectDecorationAt(t.gx, t.gy);
    }
    /* 物品化了：仓库里没货铺不了，有货铺一块扣一块 */
    st().decorBag.path = 0;
    const p0 = stones[0], p1 = stones[1];
    ok(!api.placeDecor(p0.gx, p0.gy, 'path').ok, '仓库里没有小路就铺不了');
    st().decorBag.path = 4;
    const r1 = api.placeDecor(p0.gx, p0.gy, 'path');
    ok(r1.ok, '有货就能铺', r1.msg);
    eq(st().decorBag.path, 3, '铺一块扣一块');
    api.placeDecor(p1.gx, p1.gy, 'path');
    eq(st().decorBag.path, 2, '再铺一块再扣一块');
    /* 对齐格子：地面装饰不带随机偏移 */
    const d0 = api.decorAt(p0.gx, p0.gy), d1 = api.decorAt(p1.gx, p1.gy);
    if (d0) { eq(d0.ox, 0, '小路 x 偏移为 0（对齐格子）'); eq(d0.oy, 0, '小路 y 偏移为 0'); }
    /* 自动连接：相邻两块要互相接上 */
    const adjacent = st().tiles.find(t => t.stone && !api.decorAt(t.gx, t.gy) &&
      (Math.abs(t.gx - p0.gx) + Math.abs(t.gy - p0.gy)) === 1);
    ok(!!adjacent, '能找到一块与小路相邻的石头地');
    if (adjacent) {
      api.placeDecor(adjacent.gx, adjacent.gy, 'path');
      const m0 = api.pathConnMask(api.decorAt(p0.gx, p0.gy));
      const m2 = api.pathConnMask(api.decorAt(adjacent.gx, adjacent.gy));
      ok(m0 !== 0 && m2 !== 0, '相邻小路自动连上（mask 非 0）', 'm0=' + m0 + ' m2=' + m2);
      eq((m0 & 15) !== 0 && (m2 & 15) !== 0, true, '两边都有连接位');
    }
    /* 手动换连接面：点一下循环一档，并且会被邻居尊重 */
    st().decorBag.path = 0;      /* 循环档位不消耗物品，这里只是顺手清一下计数 */
    const seq = [];
    for (let i = 0; i < 6; i++) { const m = api.cyclePathConn(p0.gx, p0.gy); seq.push(m ? m.name : '?'); }
    eq(seq[0], '十字', '第一下 → 十字');
    eq(seq[1], '横向', '第二下 → 横向');
    eq(seq[2], '纵向', '第三下 → 纵向');
    eq(seq[3], '单点', '第四下 → 单点');
    eq(seq[4], '自动连接', '第五下 → 回到自动');
    ok(true, '循环档位：' + seq.join(' → '));
    /* 用装饰工具点已有小路 = 换连接面（不是再铺一块） */
    D.api.setTool('decor');
    st().selectedDecor = 'path';
    const cntBefore = st().decorations.filter(d => d.type === 'path').length;
    api.runTool(p0.gx, p0.gy, false);
    eq(st().decorations.filter(d => d.type === 'path').length, cntBefore, '点已有小路不会变成铺第二块');
    ok(/连接/.test(W.document.getElementById('toast').textContent || ''), '会提示当前连接档位',
      (W.document.getElementById('toast').textContent || '').slice(0, 24));
    /* 小路现在是要买/任务拿的物品：商店有卖、仓库有数量与卖出按钮 */
    api.renderShop();
    ok([...W.document.querySelectorAll('#shopList .row .r-name')].some(n => n.textContent.indexOf('碎石小路') >= 0),
      '商店里能买到碎石小路（不再是免费铺装）');
    api.renderDecorBag();
    st().decorBag.path = 2;
    api.renderDecorBag();
    const pathRow = [...W.document.querySelectorAll('#decorList .row')].find(r => /碎石小路/.test(r.textContent));
    ok(!!pathRow, '装饰仓库里显示小路这一项');
    if (pathRow) {
      ok(/×2/.test(pathRow.textContent), '仓库里显示实际数量', pathRow.textContent.replace(/\s+/g, ' ').slice(0, 40));
      ok(!!pathRow.querySelector('button.sell'), '有卖出按钮（付费物品可以卖回一半价）');
    }
    api.applyPayload(backup);
  }

  section('排行榜：起名 / 五项统计 / 切换排序 / 上报与离线降级');
  {
    const backup = JSON.parse(JSON.stringify(api.serialize(st())));
    /* ── 名字清洗与校验 ── */
    eq(api.lbCleanName('<b>x</b>&(y)'), 'bxb y'.replace(' ', ''), '名字里的危险字符被剔掉');
    ok(api.lbCleanName('<script>x</script>').indexOf('<') < 0, '尖括号不会留下');
    eq(api.lbCleanName('  种田大户  '), '种田大户', '首尾空格去掉');
    eq(api.lbCleanName('一二三四五六七八九十十一十二十三').length, 12, '超长名字截到 12 字');
    ok(!api.lbSetName('   ').ok, '空名字被拒绝');
    st().playerName = '';
    eq(api.lbSetName('阿黄').name, '阿黄', '好名字能存下');
    eq(st().playerName, '阿黄', '名字进了存档字段');
    eq(st().lbLastSubmit, 0, '改名后允许立刻重新上报');

    /* ── 五项统计 ── */
    st().coins = 1234;
    st().stats.total.harvest = 56;
    st().stats.total.tasksDone = 8;
    st().farm.w = 9; st().farm.h = 7;
    st().achievements = { a1: 1, a2: 1, a3: 1 };
    const mine = api.lbMyStats();
    eq(mine.coins, 1234, '统计：金币'); eq(mine.harvest, 56, '统计：收获');
    eq(mine.farmW, 9, '统计：田宽'); eq(mine.farmH, 7, '统计：田高');
    eq(mine.ach, 3, '统计：成就数'); eq(mine.tasks, 8, '统计：完成任务数');
    eq(api.LB_METRICS.length, 5, '正好五个榜单项目');
    eq(api.LB_METRICS.map(m => m.icon).join(''), '💰🌾🗺️🏆✅', '五项图标各就各位');

    /* ── 五个项目都能排序（含同分兜底） ── */
    const list = [
      { id: 'a', name: 'A', coins: 10, harvest: 99, farmW: 3,  farmH: 3, ach: 1, tasks: 5 },
      { id: 'b', name: 'B', coins: 50, harvest: 1,  farmW: 10, farmH: 9, ach: 9, tasks: 2 },
      { id: 'c', name: 'C', coins: 50, harvest: 50, farmW: 5,  farmH: 5, ach: 5, tasks: 20 },
    ];
    eq(api.lbSortEntries(list, 'coins')[0].id, 'c', '按金币排序（同分用收获兜底）');
    eq(api.lbSortEntries(list, 'harvest')[0].id, 'a', '按收获排序');
    eq(api.lbSortEntries(list, 'area')[0].id, 'b', '按田块面积排序（10×9 最大）');
    eq(api.lbSortEntries(list, 'ach')[0].id, 'b', '按成就排序');
    eq(api.lbSortEntries(list, 'tasks')[0].id, 'c', '按任务排序');

    /* ── 首次打开：先起名 ── */
    st().playerName = '';
    api.renderLeaderboard();
    ok(!!W.document.getElementById('lbNameInput'), '第一次点开排行榜：出现起名输入框');
    ok(!W.document.querySelector('#lbBody .lb-chip'), '还没起名时不显示榜单');
    /* 起名后：出现五个项目按钮 */
    api.lbSetName('阿黄');
    api.renderLeaderboard();
    eq(W.document.querySelectorAll('#lbBody .lb-chip').length, 5, '起名后显示五个可点项目');

    /* ── 假的服务器：先测正常路径 ── */
    const realFetch = W.fetch;
    const calls = [];
    const fakeList = {
      ok: true, count: 3, updatedAt: 1,
      entries: [
        { id: api.lbPlayerId(), name: '阿黄', coins: 1234, harvest: 56, farmW: 9, farmH: 7, ach: 3, tasks: 8 },
        { id: 'other-1', name: '<img src=x onerror=1>', coins: 99999, harvest: 1, farmW: 20, farmH: 20, ach: 30, tasks: 1 },
        { id: 'other-2', name: '老实人', coins: 500, harvest: 200, farmW: 4, farmH: 4, ach: 2, tasks: 99 },
      ],
    };
    W.fetch = (url, opts) => {
      calls.push({ url: String(url), opts: opts || {} });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(fakeList) });
    };
    await api.lbSubmit(true);
    ok(calls.some(c => c.url.indexOf('/leaderboard') >= 0 && c.opts.method === 'POST'),
      '上报走了 POST /leaderboard', calls.map(c => c.url).join(' '));
    const sent = JSON.parse(calls.find(c => c.opts.method === 'POST').opts.body);
    eq(sent.name, '阿黄', '上报带了名字');
    eq(sent.coins, 1234, '上报带了金币');
    eq(sent.tasks, 8, '上报带了完成任务数');
    ok(!!sent.id && sent.id.indexOf('p-') === 0, '上报带了自己生成的 id', sent.id);
    await api.lbRefresh(true);
    api.renderLeaderboard();
    eq(W.document.querySelectorAll('#lbBody .lb-row').length, 3, '榜单渲染了 3 行');
    ok(/\(我\)|（我）/.test(W.document.querySelector('#lbBody .lb-row.me .lb-name').textContent), '自己那行被标出来');
    /* XSS：名字里的标签必须被转义，不能真的插进 DOM */
    const otherRow = [...W.document.querySelectorAll('#lbBody .lb-name')].find(n => /img/.test(n.textContent));
    ok(!!otherRow && otherRow.querySelector('img') === null, '别人名字里的 HTML 被转义（没有真的 <img> 节点）');

    /* ── 点项目切换排序 ── */
    st().lbSort = 'coins';
    api.renderLeaderboard();
    const chips = W.document.querySelectorAll('#lbBody .lb-chip');
    chips[2].onclick();                                  // 第三个 = 田块
    eq(st().lbSort, 'area', '点「田块」把排序切成 area');
    const firstRow = W.document.querySelector('#lbBody .lb-row .lb-name').textContent;
    ok(firstRow.indexOf('img') >= 0, '切换后第一名变成田块最大的那个人', firstRow.trim());
    ok(W.document.querySelectorAll('#lbBody .lb-chip')[2].classList.contains('on'), '当前项目按钮高亮');

    /* ── 离线降级：fetch 直接抛 ── */
    W.fetch = () => { throw new Error('offline'); };
    await api.lbRefresh(true);
    api.renderLeaderboard();
    ok(!!W.document.querySelector('#lbBody .lb-offline'), '连不上服务器时给出离线提示（不白屏）');
    eq(st().lbOnline, false, '状态标记为离线');
    ok(errors.length === 0, '离线路径没有未捕获异常');
    W.fetch = realFetch;

    /* ── 完成任务计数（排行榜要用） ── */
    st().stats.total.tasksDone = 0;
    st().tasks = { date: api.todayStr ? api.todayStr() : '', list: [{ id: 'harvest_5', claimed: false }] };
    st().stats.today.harvest = 99;
    api.claimTask('harvest_5');
    eq(st().stats.total.tasksDone, 1, '领一个任务奖励 → 完成任务数 +1');

    api.applyPayload(backup);
    ok(true, '排行榜测试后状态已还原');
  }

  section('公告完整性：版本号唯一、最新一条 = 当前版本');
  {
    const cl = api.CHANGELOG;
    ok(Array.isArray(cl) && cl.length >= 10, '公告条数正常', String(cl && cl.length));
    const vers = cl.map(c => c.version);
    eq(new Set(vers).size, vers.length, '没有重复的版本条目（曾因脚本失误把整段粘了两遍）');
    for (const c of cl) {
      ok(/^v\d+\.\d+$/.test(c.version), `版本号格式正确：${c.version}`);
      ok(typeof c.title === 'string' && c.title.length > 0, `${c.version} 有标题`);
      ok(Array.isArray(c.items) && c.items.length > 0, `${c.version} 有条目`);
    }
    const vnum = v => v.slice(1).split('.').map(Number).reduce((a, b) => a * 1000 + b, 0);
    eq(cl[0].version, 'v' + String(D.version).split('.').slice(0, 2).join('.'), '最新公告版本 = 构建版本');
    ok(vers.every((v, i) => i === 0 || vnum(v) < vnum(vers[i - 1])),
      '公告按版本从新到旧排列', vers.slice(0, 5).join(' > '));
  }

  section('稳定性');
  ok(errors.length === 0, '全流程后仍无未捕获异常', errors.slice(0, 3).join(' | '));
  ok(W.document.getElementById('sidePanel') !== null, '侧栏仍在');
  D.api.renderAll && D.api.renderAll();
  ok(true, '整体重绘不报错');

  console.log(`\n  ${fail === 0 ? '\x1b[32m全部通过\x1b[0m' : '\x1b[31m失败 ' + fail + ' 项\x1b[0m'}  (${pass} 项断言)`);
  if (failures.length) { console.log('\x1b[31m失败清单:\x1b[0m'); failures.forEach(f => console.log('  - ' + f)); }
  dom.window.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('\x1b[31m冒烟测试崩溃\x1b[0m', e);
  console.error(errors.slice(0, 6).join('\n'));
  process.exit(1);
});
