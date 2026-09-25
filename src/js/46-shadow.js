/* ============ 地面细节 & 动态阴影 ============
 * 契约（由 50-render.js 调用，实现方只填空函数体）：
 *   drawGroundLayer(g, cx, cy)   地块之上、边界线下方的常驻细节（苔藓/草簇/碎石/土色高亮/水汽/云影/雨涟漪）
 *   drawShadows(g, cx, cy)       作物与小人之前绘制的投影（装饰物自带影子，这里不重复画）
 * 实现要点：
 *   · 每帧都要跑，必须做视口裁剪；同色图元合并成一条路径一次填充/描边，避免大量 draw call。
 *   · 细节位置一律用 hash2(格号) 决定，固定不闪烁；坐标用 HALF_W/HALF_H 直接算，不 new 对象。
 */
const SH_CULL_W = TILE_W * SCALE;
const SH_CULL_H = (TILE_H + THICKNESS) * SCALE;

/* 格坐标 → 屏幕坐标（写入模块级暂存，返回是否在视口内，避免每格 new 对象） */
let shSX = 0, shSY = 0;
/* 可见格范围（带 pad 格余量）：把视口四角反投影回网格。
 * 下面这几个"全表遍历"的函数本来就逐格做屏幕剔除，但大地图上光是遍历 + 算坐标
 * 就要好几千次（而且每次还带一次函数调用）；直接按可见矩形遍历，只碰真可能画出来的格子。
 * 注意：render() 里 W/H 已被换成"未缩放坐标系下的视口大小"，cx/cy 也是同一套坐标。 */
function visibleGridRect(cx, cy, pad){
  const p = (pad == null) ? 3 : pad;
  const xs = [cx - W / 2, cx + W / 2], ys = [cy - H / 2, cy + H / 2];
  let ax = Infinity, bx = -Infinity, ay = Infinity, by = -Infinity;
  for(let i = 0; i < 2; i++) for(let j = 0; j < 2; j++){
    const q = unIso((xs[i] - cx) / SCALE, (ys[j] - cy) / SCALE);
    if(q.wx < ax) ax = q.wx; if(q.wx > bx) bx = q.wx;
    if(q.wy < ay) ay = q.wy; if(q.wy > by) by = q.wy;
  }
  return { x0:Math.floor(ax) - p, x1:Math.ceil(bx) + p, y0:Math.floor(ay) - p, y1:Math.ceil(by) + p };
}
/* 可见地块清单（复用模块级数组，不每帧分配）。
 * 下面几个函数原本都遍历全部地块、再逐格做屏幕剔除 —— 大地图上"遍历 + 算坐标 + 函数调用"
 * 本身就要几千次；换成只收可见矩形内的格子，通道里的逻辑一行都不用改。 */
const shVisBuf = [];
function shVisibleTiles(cx, cy, pad){
  const vr = visibleGridRect(cx, cy, pad == null ? 3 : pad);
  shVisBuf.length = 0;
  for(let gy = vr.y0; gy <= vr.y1; gy++) for(let gx = vr.x0; gx <= vr.x1; gx++){
    const t = getTile(gx, gy);
    if(t) shVisBuf.push(t);
  }
  return shVisBuf;
}
function shTilePos(t, cx, cy){
  shSX = cx + (t.gx - t.gy) * HALF_W * SCALE;
  shSY = cy + (t.gx + t.gy) * HALF_H * SCALE;
  return !(shSX < -SH_CULL_W || shSX > W + SH_CULL_W || shSY < -SH_CULL_H || shSY > H + SH_CULL_H);
}
function shGridPos(gx, gy, cx, cy){
  shSX = cx + (gx - gy) * HALF_W * SCALE;
  shSY = cy + (gx + gy) * HALF_H * SCALE;
  return shSX > -140 && shSX < W + 140 && shSY > -180 && shSY < H + 140;
}
function shIsTilled(t){ return t.terrain === 'tilled'; }

/* 批量椭圆必须逐个 moveTo 起点：否则每次 ellipse() 会从上一个子路径终点连一条直线过来，
   填充时那些连线就变成跨格的大三角/多边形（这就是"白色与黑色透明叠加层/封闭色块"的真凶）。 */
function shAddEllipse(g, cx, cy, rx, ry){
  g.moveTo(cx + rx, cy);
  g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}
/* ============================================================
 * 地面细节：五道批处理通道
 * ============================================================ */
function shDrawTileDetails(g, cx, cy){
  const tiles = shVisibleTiles(cx, cy, 3), n = tiles.length;
  const w = TILE_W * SCALE, h = TILE_H * SCALE, hw = w / 2, hh = h / 2;
  let i, t, k, x, y, u, v, r1, r2, hb, any;
  /* 点缀跟着世界一起缩放（不做反向补偿，否则高倍率下小草会小得离谱） */
  const ns = 1;

  /* ① 浇水后的湿润反光（铺在最底层；椭圆逐个 moveTo，见 shAddEllipse） */
  any = false; g.beginPath();
  for(i = 0; i < n; i++){
    t = tiles[i];
    if(!t.watered || (t.state !== 'growing' && t.state !== 'ready')) continue;
    if(!shTilePos(t, cx, cy)) continue;
    shAddEllipse(g, shSX, shSY, hw * 0.66, hh * 0.66);
    any = true;
  }
  if(any){ g.fillStyle = 'rgba(26,18,10,.15)'; g.fill(); }

  /* ② 耕地纹理：改为在 40-tiles.js 里铺「图案」(pattern)，不再画线条 */

  /* ② 苔藓斑（荒地） */
  any = false; g.beginPath();
  for(i = 0; i < n; i++){
    t = tiles[i];
    if(shIsTilled(t) || !shTilePos(t, cx, cy)) continue;
    hb = t.gx * 1000 + t.gy;
    r1 = hash2(hb + 7, 151);
    if(r1 < 0.42) continue;
    r2 = hash2(hb + 7, 157);
    u = (r2 * 2 - 1) * 0.4;
    v = (hash2(hb + 7, 163) * 2 - 1) * 0.4;
    shAddEllipse(g, shSX + u * hw, shSY + v * hh, (5 + r1 * 5) * ns, (2.6 + r1 * 2.4) * ns);
    any = true;
  }
  if(any){ g.fillStyle = 'rgba(52,104,42,.20)'; g.fill(); }

  /* ④ 碎石（荒地）/ 土块（耕地） */
  any = false; g.beginPath();
  for(i = 0; i < n; i++){
    t = tiles[i];
    if(!shTilePos(t, cx, cy)) continue;
    hb = t.gx * 1000 + t.gy;
    for(k = 0; k < 2; k++){
      r1 = hash2(hb + k * 13, 91);
      r2 = hash2(hb + k * 13, 97);
      u = (r1 * 2 - 1) * 0.6;
      v = (r2 * 2 - 1) * 0.6;
      if(Math.abs(u) + Math.abs(v) > 0.84) continue;
      shAddEllipse(g, shSX + u * hw, shSY + v * hh, (1.6 + r1 * 1.6) * ns, (1 + r2 * 1) * ns);
      any = true;
    }
  }
  if(any){ g.fillStyle = 'rgba(198,198,210,.20)'; g.fill(); }

  any = false; g.beginPath();
  for(i = 0; i < n; i++){
    t = tiles[i];
    if(!shIsTilled(t) || !shTilePos(t, cx, cy)) continue;
    hb = t.gx * 1000 + t.gy;
    r1 = hash2(hb + 3, 61);
    r2 = hash2(hb + 3, 71);
    u = (r1 * 2 - 1) * 0.6;
    v = (r2 * 2 - 1) * 0.6;
    if(Math.abs(u) + Math.abs(v) > 0.78) continue;
    shAddEllipse(g, shSX + u * hw, shSY + v * hh, (2.2 + r1 * 1.8) * ns, (1.2 + r2 * 1.1) * ns);
    any = true;
  }
  if(any){ g.fillStyle = 'rgba(72,44,20,.26)'; g.fill(); }

  /* ⑤ 草簇（荒地，一条路径一次描边） */
  any = false; g.beginPath();
  for(i = 0; i < n; i++){
    t = tiles[i];
    if(shIsTilled(t) || !shTilePos(t, cx, cy)) continue;
    hb = t.gx * 1000 + t.gy;
    for(k = 0; k < 2; k++){
      r1 = hash2(hb + k * 29, 131);
      r2 = hash2(hb + k * 29, 137);
      u = (r1 * 2 - 1) * 0.58;
      v = (r2 * 2 - 1) * 0.58;
      if(Math.abs(u) + Math.abs(v) > 0.8) continue;
      x = shSX + u * hw; y = shSY + v * hh;
      g.moveTo(x, y); g.lineTo(x - 1.6 * ns, y - 4.2 * ns);
      g.moveTo(x, y); g.lineTo(x + 1.6 * ns, y - 4.8 * ns);
      any = true;
    }
  }
  if(any){ g.strokeStyle = 'rgba(88,156,58,.55)'; g.lineWidth = Math.max(0.4, 1.2 * ns); g.stroke(); }
}

/* 已开垦区域外沿一圈柔和的土色高亮 */
function shDrawTilledRing(g, cx, cy){
  const w = TILE_W * SCALE, h = TILE_H * SCALE, hw = w / 2, hh = h / 2;
  const tiles = shVisibleTiles(cx, cy, 3), n = tiles.length;
  let i, t, any = false;
  g.beginPath();
  for(i = 0; i < n; i++){
    t = tiles[i];
    if(!shIsTilled(t) || !shTilePos(t, cx, cy)) continue;
    const topX = shSX, topY = shSY - hh, rightX = shSX + hw, rightY = shSY;
    const botX = shSX, botY = shSY + hh, leftX = shSX - hw, leftY = shSY;
    const nTR = getTile(t.gx, t.gy - 1), nBR = getTile(t.gx + 1, t.gy);
    const nBL = getTile(t.gx, t.gy + 1), nTL = getTile(t.gx - 1, t.gy);
    if(!nTR || !shIsTilled(nTR)){ g.moveTo(topX, topY); g.lineTo(rightX, rightY); any = true; }
    if(!nBR || !shIsTilled(nBR)){ g.moveTo(rightX, rightY); g.lineTo(botX, botY); any = true; }
    if(!nBL || !shIsTilled(nBL)){ g.moveTo(botX, botY); g.lineTo(leftX, leftY); any = true; }
    if(!nTL || !shIsTilled(nTL)){ g.moveTo(leftX, leftY); g.lineTo(topX, topY); any = true; }
  }
  if(!any) return;
  /* 只做一圈很淡的暗色收边：早期版本用了 7px 浅米色描边，在深色背景上像一条条白色条纹 */
  g.strokeStyle = 'rgba(42,26,12,.20)'; g.lineWidth = 2.6; g.stroke();
}

/* 水塘附近：湿润的暗色光晕 + 缓缓升起的水汽 */
function shDrawPond(g, cx, cy){
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  const l = atmosLight();
  for(const d of state.decorations){
    if(d.type !== 'pond') continue;
    if(!shGridPos(d.gx, d.gy, cx, cy)) continue;
    const px = shSX, py = shSY;
    /* 湿润光晕（在塘体之下） */
    const grd = g.createRadialGradient(px, py, 4, px, py, 46);
    grd.addColorStop(0, 'rgba(30,52,64,.22)');
    grd.addColorStop(0.7, 'rgba(30,52,64,.09)');
    grd.addColorStop(1, 'rgba(30,52,64,0)');
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(px, py + 1, 46, 23, 0, 0, Math.PI * 2); g.fill();
    /* 水汽 */
    for(let i = 0; i < 3; i++){
      const ph = (now * 0.3 + i * 0.33 + d.seed * 0.07) % 1;
      const a = (1 - ph) * (0.05 + 0.08 * l);
      if(a < 0.02) continue;
      const rx = 8 + ph * 13;
      g.beginPath();
      g.ellipse(px + Math.sin(ph * 6.2832 + i) * 5, py - 3 - ph * 24, rx, rx * 0.55, 0, 0, Math.PI * 2);
      g.fillStyle = 'rgba(220,242,255,' + a.toFixed(3) + ')';
      g.fill();
    }
  }
}

function drawGroundLayer(g, cx, cy){
  const ccx = (cx == null) ? W / 2 + state.camera.x : cx;
  const ccy = (cy == null) ? H / 2 + state.camera.y : cy;
  shDrawPond(g, ccx, ccy);                       /* 塘边湿润感（在细节之下） */
  shDrawTileDetails(g, ccx, ccy);
  shDrawTilledRing(g, ccx, ccy);
  if(SH_CLOUD_SHADOWS) atmDrawCloudShadows(g, ccx, ccy);   /* 云影：默认关闭（见文件头开关） */
  atmDrawGroundRain(g);                          /* 雨点涟漪 */
}

/* ============================================================
 * 动态阴影：按 ATMOS.hour 推算太阳方位
 *   正午影子最短、清晨黄昏拉长；夜间仅剩一点月光淡影
 * ============================================================ */
let shOffX = 0, shOffY = 0, shAlpha = 0;
let shStyleFull = 'rgba(22,28,44,.3)', shStyleSoft = 'rgba(22,28,44,.24)';
/* 云影（投在地面上的大椭圆）：用户反馈像"封闭的灰色色块"，草地上也有 → 默认关闭。
   想重新打开改成 true 即可（天空的云本身不受影响）。 */
const SH_CLOUD_SHADOWS = true;
function shUpdateSun(){
  const t = (ATMOS.hour - 6) / 12;                 /* 0=6:00 1=18:00 */
  const day = (t >= 0 && t <= 1);
  const hgt = day ? Math.sin(Math.PI * t) : 0;     /* 太阳高度 0..1 */
  if(day){
    shOffX = Math.cos(Math.PI * t) * (1 - hgt) * 14;   /* 东西向拉长 */
    shOffY = 3 + (1 - hgt) * 5;                        /* 越长越朝下 */
    shAlpha = 0.34 * (0.45 + 0.55 * hgt);
  } else {
    shOffX = 6; shOffY = 3; shAlpha = 0.05;            /* 夜里只有一点月光淡影 */
  }
  if(ATMOS.weather === 'rain') shAlpha *= 0.45;
  else if(ATMOS.weather === 'cloudy') shAlpha *= 0.7;
  shStyleFull = 'rgba(22,28,44,' + shAlpha.toFixed(3) + ')';
  shStyleSoft = 'rgba(22,28,44,' + (shAlpha * 0.72).toFixed(3) + ')';
}
/* 一枚随日照倾斜的柔和椭圆影 */
function shEllipse(g, x, y, r, style){
  const sl = Math.sqrt(shOffX * shOffX + shOffY * shOffY);
  const rx = r + sl * 0.55;
  const ry = r * 0.5 + sl * 0.16;
  const rot = Math.atan2(shOffY, shOffX) * 0.45;
  g.beginPath();
  g.ellipse(x + shOffX * 0.45, y + shOffY * 0.45, rx, ry, rot, 0, Math.PI * 2);
  g.fillStyle = style;
  g.fill();
}
function drawShadows(g, cx, cy){
  const ccx = (cx == null) ? W / 2 + state.camera.x : cx;
  const ccy = (cy == null) ? H / 2 + state.camera.y : cy;
  shUpdateSun();
  if(shAlpha <= 0.008) return;
  /* 作物：影子落在根部（只遍历可见范围） */
  const visList = shVisibleTiles(ccx, ccy, 2);
  for(let vi = 0; vi < visList.length; vi++){
    const t = visList[vi];
    if(!t.crop || t.state === 'wild') continue;
    if(!shTilePos(t, ccx, ccy)) continue;
    const ratio = tileProgress(t);
    const r = 6 + ratio * 7;
    shEllipse(g, shSX, shSY + getAnchorOffset(t.crop, ratio), r, shStyleFull);
  }
  /* 小人（贴地那层影子由 43-player.js 自己画，这里补一层随太阳拉长的投影） */
  const p = state.player;
  if(p){
    const { x, y } = playerScreen(ccx, ccy);
    if(x > -80 && x < W + 80 && y > -140 && y < H + 120) shEllipse(g, x, y + 1, 12, shStyleSoft);
  }
}
