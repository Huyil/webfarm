/* ============ 大气：昼夜 + 天气 ============
 * 契约（其他模块只读这些字段，实现方可增字段但不要改名）：
 *   ATMOS.clockMs   当天已过毫秒 [0, DAY_MS)
 *   ATMOS.hour      0..24 浮点
 *   ATMOS.weather   'clear' | 'cloudy' | 'rain'
 *   ATMOS.flash     白闪强度 0..1（自行衰减到 0）
 * 渲染钩子由 50-render.js 调用：drawAtmosphereBack(g) / drawAtmosphereFront(g)
 * 主循环钩子：updateAtmosphere(dt)
 * 46-shadow.js 复用本文件的 atmDrawCloudShadows / atmDrawGroundRain。
 */
const ATMOS = {
  clockMs: DAY_MS * 0.16,
  hour: 8,
  weather: 'clear',
  weatherLeftMs: 60000,
  cloud: 0,
  flash: 0,
  rainAcc: 0,
  windSway: 0,
  /* —— 以下为实现细节，外部不要依赖 —— */
  windPhase: 0,
  rainFade: 0,
  lightningMs: 6000,
};

function atmosIsNight(){ return ATMOS.hour < 6 || ATMOS.hour >= 19; }
function atmosLight(){                       /* 0=深夜 1=正午 */
  const h = ATMOS.hour;
  if(h < 5 || h >= 21) return 0.12;
  if(h < 8)  return 0.12 + (h - 5) / 3 * 0.88;
  if(h < 17) return 1;
  return Math.max(0.12, 1 - (h - 17) / 4 * 0.88);
}
/* 一天 22 分钟：清晨 2 / 白天 10 / 傍晚 2 / 夜晚 8（小时推进速度分段，夜长昼短） */
const DAY_PHASES = [
  { min: 2,  h0: 5,  h1: 8  },   /* 清晨 */
  { min: 10, h0: 8,  h1: 17 },   /* 白天 */
  { min: 2,  h0: 17, h1: 20 },   /* 傍晚 */
  { min: 8,  h0: 20, h1: 29 },   /* 夜晚（29 ≡ 次日 5 点） */
];
function hourFromClock(ms){
  let t = Math.max(0, ms) / 60000, acc = 0;
  for(const p of DAY_PHASES){
    if(t < acc + p.min){
      const k = (t - acc) / p.min;
      return (p.h0 + (p.h1 - p.h0) * k) % 24;
    }
    acc += p.min;
  }
  return 5;
}
/* 反函数：给定小时求当天进度（用于调试/出图脚本 setAtmos） */
function clockFromHour(h){
  h = ((h % 24) + 24) % 24;
  let acc = 0;
  for(const p of DAY_PHASES){
    const lo = p.h0 % 24, hi = p.h1 % 24;
    const inPhase = (p.h1 > 24)
      ? (h >= lo || h < hi)          /* 跨零点的夜晚段 */
      : (h >= lo && h < hi);
    if(inPhase){
      const span = p.h1 - p.h0;
      const off = (p.h1 > 24 && h < hi) ? (h + 24 - p.h0) : (h - p.h0);
      return (acc + off / span * p.min) * 60000;
    }
    acc += p.min;
  }
  return 0;
}
function updateAtmosphere(dt){
  ATMOS.clockMs = (ATMOS.clockMs + dt) % DAY_MS;
  ATMOS.hour = hourFromClock(ATMOS.clockMs);
  /* 云相位：晴天飘得慢，阴雨被风吹得快 */
  const cloudSpd = ATMOS.weather === 'clear' ? 0.9 : ATMOS.weather === 'cloudy' ? 1.35 : 2.0;
  ATMOS.cloud = (ATMOS.cloud + dt * 0.00009 * cloudSpd) % 1;
  /* 风：阴雨更大；windSway 保持 0..1 供 42-decor-art.js 摇摆 */
  const windy = ATMOS.weather === 'rain' ? 0.0026 : ATMOS.weather === 'cloudy' ? 0.0015 : 0.0011;
  ATMOS.windPhase += dt * windy;
  ATMOS.windSway = Math.sin(ATMOS.windPhase) * 0.5 + 0.5;
  if(ATMOS.flash > 0) ATMOS.flash = Math.max(0, ATMOS.flash - dt / 260);
  /* 雨量平滑过渡：天气切换时雨丝渐显 / 渐隐 */
  const rainTarget = ATMOS.weather === 'rain' ? 1 : 0;
  ATMOS.rainFade += (rainTarget - ATMOS.rainFade) * Math.min(1, dt / 650);
  if(Math.abs(ATMOS.rainFade - rainTarget) < 0.004) ATMOS.rainFade = rainTarget;
  if(ATMOS.rainFade > 0.01){
    /* 雨滴下落 + 按雨量节奏生成地面涟漪 */
    const step = dt * (0.85 + ATMOS.windSway * 0.6);
    for(let i = 0; i < ATM_RAIN_N; i++){
      const d = atmRainDrops[i];
      d.y += d.spd * step / 900;
      d.x += d.drift * step / 900;
      if(d.y > 1.12){ d.y -= 1.24; d.x = Math.random() * 1.24 - 0.12; }
      if(d.x > 1.12) d.x -= 1.24;
    }
    ATMOS.rainAcc += dt * 0.02 * ATMOS.rainFade;
    if(ATMOS.rainAcc > 40) ATMOS.rainAcc = 40;      /* 掉帧保护 */
    while(ATMOS.rainAcc >= 1){ ATMOS.rainAcc -= 1; atmSpawnRipple(); }
  } else {
    ATMOS.rainAcc = 0;
  }
  for(let i = 0; i < ATM_RIPPLE_N; i++){
    const r = atmRipples[i];
    if(r.life > 0) r.life -= dt / 1000;
  }
  /* 闪电：只在雨天，随机间隔 */
  if(ATMOS.weather === 'rain'){
    ATMOS.lightningMs -= dt;
    if(ATMOS.lightningMs <= 0){ ATMOS.lightningMs = 3200 + Math.random() * 6400; atmStrikeLightning(); }
  } else {
    ATMOS.lightningMs = 2200 + Math.random() * 3200;
  }
  /* 天气轮换 */
  ATMOS.weatherLeftMs -= dt;
  if(ATMOS.weatherLeftMs <= 0) rollWeather();
}
function rollWeather(){
  const r = Math.random();
  const old = ATMOS.weather;
  ATMOS.weather = r < 0.24 ? 'rain' : r < 0.52 ? 'cloudy' : 'clear';
  ATMOS.weatherLeftMs = (ATMOS.weather === 'rain' ? 45000 : 70000) + Math.random() * 60000;
  ATMOS.rainAcc = 0;
  if(ATMOS.weather === 'rain') ATMOS.lightningMs = 1200 + Math.random() * 2600;
  if(ATMOS.weather === 'rain' && old !== 'rain' && typeof onRainStart === 'function') onRainStart();
}

/* ============================================================
 * 天空配色：按小时插值（top=屏幕上方 / bot=屏幕下方）
 * ============================================================ */
const ATM_SKY_STOPS = [
  { h: 0.0,  top: [  8,  14,  36], bot: [ 22,  32,  62] },
  { h: 4.6,  top: [ 14,  22,  52], bot: [ 46,  48,  84] },
  { h: 6.2,  top: [ 56,  62, 116], bot: [255, 152,  96] },
  { h: 8.0,  top: [104, 166, 226], bot: [255, 214, 160] },
  { h: 12.0, top: [ 62, 152, 224], bot: [188, 230, 255] },
  { h: 16.5, top: [ 74, 152, 214], bot: [255, 214, 150] },
  { h: 18.6, top: [ 60,  70, 140], bot: [255, 118,  70] },
  { h: 20.2, top: [ 22,  30,  66], bot: [ 74,  60, 100] },
  { h: 24.0, top: [  8,  14,  36], bot: [ 22,  32,  62] },
];
const atmSkyTop = [0, 0, 0], atmSkyBot = [0, 0, 0], atmCloudCol = [0, 0, 0];

function atmSkySample(){
  const h = ATMOS.hour;
  let i = 0;
  while(i < ATM_SKY_STOPS.length - 2 && h > ATM_SKY_STOPS[i + 1].h) i++;
  const a = ATM_SKY_STOPS[i], b = ATM_SKY_STOPS[i + 1];
  const k = Math.max(0, Math.min(1, (h - a.h) / (b.h - a.h)));
  /* 阴雨天把天空往灰蓝压，整体降饱和 */
  const w = ATMOS.weather;
  const gray = w === 'rain' ? [96, 106, 124] : w === 'cloudy' ? [132, 148, 170] : null;
  const mix = w === 'rain' ? 0.62 : w === 'cloudy' ? 0.34 : 0;
  const dim = w === 'rain' ? 0.82 : w === 'cloudy' ? 0.93 : 1;
  for(let c = 0; c < 3; c++){
    let top = a.top[c] + (b.top[c] - a.top[c]) * k;
    let bot = a.bot[c] + (b.bot[c] - a.bot[c]) * k;
    if(gray){ top = top + (gray[c] - top) * mix; bot = bot + (gray[c] - bot) * mix; }
    atmSkyTop[c] = Math.round(top * dim);
    atmSkyBot[c] = Math.round(bot * dim);
  }
}
function atmRgb(c, a){
  return a == null ? 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'
                   : 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
}
/* 夜色浓度：0=白天 1=深夜（星星 / 月亮 / 压暗都按它算） */
function atmNightFactor(){
  const l = atmosLight();
  return Math.max(0, Math.min(1, (0.5 - l) / 0.38));
}
/* 晨昏暖色浓度（清晨 6 点 / 傍晚 18 点半各一个峰） */
function atmWarmFactor(){
  const h = ATMOS.hour;
  const dawn = Math.max(0, 1 - Math.abs(h - 6.3) / 2.2);
  const dusk = Math.max(0, 1 - Math.abs(h - 18.4) / 2.2);
  return Math.min(1, Math.max(dawn, dusk));
}

/* ============================================================
 * 太阳 / 月亮 / 星星
 * ============================================================ */
const atmSunPos = { x: 0, y: 0, visible: false, t: 0 };
const atmMoonPos = { x: 0, y: 0, visible: false, t: 0 };
/* 日月同一条**圆形轨道**（圆心在地平线下方）：
 *   x = cx + rx·cos(πt)，y = cy - ry·sin(πt)   —— t: 0→1 走半圈
 * 太阳自东向西、月亮自西向东，正好**交替**上下班。
 * v9.20：轨道整体压低（顶点 0.22H，以前 0.08H 会顶到顶部菜单后面），
 *        并且是真正的圆周运动，不再是「x 线性 + y 正弦」拼出来的怪弧线。 */
const ATM_ORBIT = { cx: 0.5, rx: 0.34, cy: 0.62, ry: 0.40 };
function atmOrbit(t, dir){
  const a = Math.PI * t;                       /* 0 → π */
  return {
    x: W * (ATM_ORBIT.cx + dir * ATM_ORBIT.rx * Math.cos(a)),
    y: H * (ATM_ORBIT.cy - ATM_ORBIT.ry * Math.sin(a)),
  };
}
function atmSunTrack(){
  const t = (ATMOS.hour - 6) / 12;                 /* 6:00 → 18:00 */
  atmSunPos.t = t;
  atmSunPos.visible = (t >= 0 && t <= 1);
  if(atmSunPos.visible){
    const p = atmOrbit(t, -1);                     /* 东边（左）升起，西边（右）落下 */
    atmSunPos.x = p.x; atmSunPos.y = p.y;
  }
  return atmSunPos;
}
function atmMoonTrack(){
  const h = ATMOS.hour < 12 ? ATMOS.hour + 24 : ATMOS.hour;
  const t = (h - 19) / 11.5;                       /* 19:00 → 6:30 */
  atmMoonPos.t = t;
  atmMoonPos.visible = (t >= 0 && t <= 1);
  if(atmMoonPos.visible){
    const p = atmOrbit(t, 1);                      /* 与太阳反向：一个东升一个西升 */
    atmMoonPos.x = p.x; atmMoonPos.y = p.y;
  }
  return atmMoonPos;
}
/* 星星：hash2 确定性随机，只在夜里出现（不用离屏 canvas，省一次拷贝） */
const ATM_STAR_N = 140;
const atmStarX = new Float32Array(ATM_STAR_N);
const atmStarY = new Float32Array(ATM_STAR_N);
const atmStarMag = new Float32Array(ATM_STAR_N);
const atmStarPh = new Float32Array(ATM_STAR_N);
(function atmBuildStars(){
  for(let i = 0; i < ATM_STAR_N; i++){
    atmStarX[i] = hash2(i, 3);
    atmStarY[i] = hash2(i, 17) * 0.8;
    atmStarMag[i] = 0.35 + hash2(i, 29) * 0.65;
    atmStarPh[i] = hash2(i, 41) * 6.2832;
  }
})();
function atmDrawStars(g, nl){
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  g.fillStyle = '#ffffff';
  for(let i = 0; i < ATM_STAR_N; i++){
    const tw = 0.62 + 0.38 * Math.sin(now * (0.8 + atmStarMag[i]) + atmStarPh[i]);
    const a = nl * atmStarMag[i] * tw;
    if(a < 0.04) continue;
    const x = atmStarX[i] * W, y = atmStarY[i] * H;
    g.globalAlpha = a;
    if(atmStarMag[i] > 0.78){
      g.fillRect(x, y, 2, 2);
      g.globalAlpha = a * 0.32;
      g.fillRect(x - 2, y, 1, 1); g.fillRect(x + 3, y, 1, 1);
      g.fillRect(x, y - 2, 1, 1); g.fillRect(x, y + 3, 1, 1);
    } else {
      g.fillRect(x, y, 1, 1);
    }
  }
  g.globalAlpha = 1;
}
function atmDrawSun(g, x, y, t){
  const low = 1 - Math.sin(Math.PI * t);           /* 靠近地平线时更大更暖 */
  /* 阴雨天太阳被云挡掉大半 */
  const vis = ATMOS.weather === 'rain' ? 0.22 : ATMOS.weather === 'cloudy' ? 0.62 : 1;
  const glow = g.createRadialGradient(x, y, 4, x, y, 150);
  glow.addColorStop(0, 'rgba(255,246,214,' + (0.95 * vis).toFixed(3) + ')');
  glow.addColorStop(0.24, 'rgba(255,214,140,' + (0.52 * vis).toFixed(3) + ')');
  glow.addColorStop(0.6, 'rgba(255,178,96,' + (0.16 * vis).toFixed(3) + ')');
  glow.addColorStop(1, 'rgba(255,160,80,0)');
  g.fillStyle = glow;
  g.beginPath(); g.arc(x, y, 150, 0, Math.PI * 2); g.fill();
  if(vis < 0.4) return;
  g.fillStyle = 'rgba(255,250,232,' + (0.96 * vis).toFixed(3) + ')';
  g.beginPath(); g.arc(x, y, 24 + low * 9, 0, Math.PI * 2); g.fill();
}
function atmDrawMoon(g, x, y, nl){
  const a = 0.22 + nl * 0.78;
  const glow = g.createRadialGradient(x, y, 3, x, y, 100);
  glow.addColorStop(0, 'rgba(226,236,255,' + (0.30 * a).toFixed(3) + ')');
  glow.addColorStop(0.55, 'rgba(196,214,255,' + (0.10 * a).toFixed(3) + ')');
  glow.addColorStop(1, 'rgba(180,200,255,0)');
  g.fillStyle = glow;
  g.beginPath(); g.arc(x, y, 100, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(242,247,255,' + (0.94 * a).toFixed(3) + ')';
  g.beginPath(); g.arc(x, y, 21, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(198,212,240,' + (0.70 * a).toFixed(3) + ')';
  g.beginPath(); g.arc(x - 7, y - 6, 4.2, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(x + 6, y + 5, 5.4, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(x + 2, y - 10, 3, 0, Math.PI * 2); g.fill();
}

/* ============================================================
 * 云：天上飘的云 + 地面缓慢移动的云影（相位用 ATMOS.cloud）
 * ============================================================ */
/* v9.20：云朵**更大**、**更低**（落在太阳轨道下方那一带），
   以前又小又贴顶，看起来像几块灰斑飘在菜单后面。 */
const ATM_CLOUDS = [
  { nx: 0.05, ny: 0.30, s: 1.70, spd: 0.55, a: 0.85 },
  { nx: 0.34, ny: 0.26, s: 1.25, spd: 0.40, a: 0.70 },
  { nx: 0.60, ny: 0.42, s: 2.00, spd: 0.68, a: 0.90 },
  { nx: 0.81, ny: 0.32, s: 1.50, spd: 0.47, a: 0.75 },
  { nx: 0.19, ny: 0.52, s: 1.20, spd: 0.34, a: 0.60 },
];
function atmCloudX(c){
  const p = (c.nx + ATMOS.cloud * c.spd) % 1.3;
  return (p - 0.15) * W;
}
/* 云朵：每团云由若干「各自带径向渐变」的圆团拼成——
   之前用 4 个椭圆共享一个大渐变，椭圆边界落在渐变还没淡出的地方，就会出现生硬的椭圆覆盖层 */
const ATM_PUFFS = [
  { dx: 0,   dy: 0,   rx: 46, ry: 15 },
  { dx: 34,  dy: 4,   rx: 33, ry: 12 },
  { dx: -32, dy: 5,   rx: 29, ry: 11 },
  { dx: 6,   dy: -10, rx: 27, ry: 14 },
];
/* 云朵精灵：每帧现算 20 个径向渐变（4 个 puff × 3~5 团云），径向渐变的**光栅化**在手机上
 * 是实打实的开销。这里把每团云烧成一张小图，每帧只 drawImage；颜色/夜色变化时重烧
 * （rgb 量化到 8 一档，所以黄昏那会儿也只重烧几次）。 */
const ATM_CLOUD_SPR = [];
function atmCloudSprite(i, c, rgb, a){
  const rq = rgb.split(',').map(v => Math.round(v / 8) * 8).join(',');
  const key = rq + '|' + a.toFixed(3) + '|' + c.s.toFixed(2);
  let sp = ATM_CLOUD_SPR[i];
  if(sp && sp.key === key) return sp;
  const s = c.s;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for(const p of ATM_PUFFS){
    const px = p.dx * s, py = p.dy * s, rx = p.rx * s, ry = p.ry * s;
    if(px - rx < x0) x0 = px - rx; if(px + rx > x1) x1 = px + rx;
    if(py - ry < y0) y0 = py - ry; if(py + ry > y1) y1 = py + ry;
  }
  const pad = 2, sc = DPR || 1;
  const w = Math.ceil(x1 - x0 + pad * 2), h = Math.ceil(y1 - y0 + pad * 2);
  try{
    const cv = (sp && sp.canvas) || document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * sc));
    cv.height = Math.max(1, Math.round(h * sc));
    const cg = cv.getContext('2d');
    if(!cg) return null;
    cg.setTransform(sc, 0, 0, sc, 0, 0);
    cg.clearRect(0, 0, w, h);
    cg.translate(-x0 + pad, -y0 + pad);
    for(const p of ATM_PUFFS){
      const px = p.dx * s, py = p.dy * s, rx = p.rx * s, ry = p.ry * s;
      cg.save();
      cg.translate(px, py);
      cg.scale(1, ry / rx);
      const grd = cg.createRadialGradient(0, 0, 0, 0, 0, rx);
      grd.addColorStop(0, 'rgba(' + rgb + ',' + a.toFixed(3) + ')');
      grd.addColorStop(0.45, 'rgba(' + rgb + ',' + (a * 0.62).toFixed(3) + ')');
      grd.addColorStop(0.78, 'rgba(' + rgb + ',' + (a * 0.18).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(' + rgb + ',0)');
      cg.fillStyle = grd;
      cg.beginPath(); cg.arc(0, 0, rx, 0, Math.PI * 2); cg.fill();
      cg.restore();
    }
    sp = { canvas:cv, w, h, ox:x0 - pad, oy:y0 - pad, key };
    ATM_CLOUD_SPR[i] = sp;
    return sp;
  }catch(e){ return null; }
}
function atmDrawClouds(g, nl){
  const cnt = ATMOS.weather === 'clear' ? 3 : 5;
  const amul = ATMOS.weather === 'rain' ? 0.95 : ATMOS.weather === 'cloudy' ? 0.82 : 0.55;
  const shade = ATMOS.weather === 'rain' ? 0.64 : ATMOS.weather === 'cloudy' ? 0.86 : 1;
  const nightMul = 1 - nl * 0.55;
  for(let i = 0; i < 3; i++) atmCloudCol[i] = Math.round((atmSkyBot[i] * 0.4 + 255 * 0.6) * shade * nightMul);
  const rgb = atmCloudCol[0] + ',' + atmCloudCol[1] + ',' + atmCloudCol[2];
  for(let i = 0; i < cnt; i++){
    const c = ATM_CLOUDS[i];
    const x = atmCloudX(c);
    const y = (c.ny * 0.8 + 0.06) * H;
    const s = c.s;
    const a = 0.24 * amul * c.a;
    const spr = atmCloudSprite(i, c, rgb, a);
    if(spr){ g.drawImage(spr.canvas, x + spr.ox, y + spr.oy, spr.w, spr.h); continue; }
    for(const p of ATM_PUFFS){
      const px = x + p.dx * s, py = y + p.dy * s;
      const rx = p.rx * s, ry = p.ry * s;
      /* 关键：先把坐标系压扁再画「圆」+圆形渐变。
         若直接用椭圆填充一个大渐变，椭圆短轴方向的边缘只衰减到渐变半径的 rx/ry 处，
         边缘仍是不透明的 → 就是那层灰色椭圆。压扁后渐变正好在椭圆边界归零。 */
      g.save();
      g.translate(px, py);
      g.scale(1, ry / rx);
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, rx);
      grd.addColorStop(0, 'rgba(' + rgb + ',' + a.toFixed(3) + ')');
      grd.addColorStop(0.45, 'rgba(' + rgb + ',' + (a * 0.62).toFixed(3) + ')');
      grd.addColorStop(0.78, 'rgba(' + rgb + ',' + (a * 0.18).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(' + rgb + ',0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }
}
/* 云影：投在地图上，由 46-shadow.js 在地面细节层调用；用径向渐变，避免地上出现硬边椭圆 */
function atmDrawCloudShadows(g, cx, cy){
  const l = atmosLight();
  const base = (0.045 + 0.055 * l) * (ATMOS.weather === 'rain' ? 0.6 : 1) * (1 - ATMOS.flash * 0.8);
  if(base <= 0.004) return;
  const cnt = ATMOS.weather === 'clear' ? 3 : 5;
  for(let i = 0; i < cnt; i++){
    const c = ATM_CLOUDS[i];
    const x = (atmCloudX(c) - W / 2) * 0.9 + cx;
    const y = cy + (c.ny - 0.2) * H * 0.62;
    const rx = 130 * c.s, ry = 62 * c.s, k = ry / rx;
    g.save();
    g.translate(x, y);
    g.scale(1, k);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    grd.addColorStop(0, 'rgba(24,30,48,' + (base * c.a).toFixed(3) + ')');
    grd.addColorStop(0.6, 'rgba(24,30,48,' + (base * c.a * 0.55).toFixed(3) + ')');
    grd.addColorStop(1, 'rgba(24,30,48,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill();
    g.restore();
  }
}

/* ============================================================
 * 雨：雨丝（屏幕空间）+ 地面涟漪（贴等距地面，2:1 椭圆）
 * ============================================================ */
const ATM_RAIN_N = 240;
const atmRainDrops = [];
(function atmBuildRain(){
  for(let i = 0; i < ATM_RAIN_N; i++){
    atmRainDrops.push({
      x: Math.random() * 1.2 - 0.1,
      y: Math.random() * 1.2 - 0.1,
      len: 0.018 + Math.random() * 0.05,
      spd: 0.85 + Math.random() * 0.85,
      drift: 0.1 + Math.random() * 0.35,
    });
  }
})();
function atmDrawRainStreaks(g){
  const f = ATMOS.rainFade;
  if(f <= 0.02) return;
  const slant = 1.4 + ATMOS.windSway * 3.6;
  g.strokeStyle = 'rgba(196,226,255,' + (0.52 * f).toFixed(3) + ')';
  g.lineWidth = 1.3;
  /* 240 根雨丝合成一条路径，只 stroke 一次 */
  g.beginPath();
  for(let i = 0; i < ATM_RAIN_N; i++){
    const d = atmRainDrops[i];
    const x = d.x * W, y = d.y * H;
    g.moveTo(x, y);
    g.lineTo(x - slant, y - d.len * H);
  }
  g.stroke();
}
const ATM_RIPPLE_N = 36;
const atmRipples = [];
let atmRippleIdx = 0;
(function atmBuildRipples(){
  for(let i = 0; i < ATM_RIPPLE_N; i++) atmRipples.push({ life: 0, max: 0.85, x: 0, y: 0, r: 6 });
})();
function atmSpawnRipple(){
  const tiles = state.tiles;
  if(!tiles || !tiles.length) return;
  for(let k = 0; k < 3; k++){
    const t = tiles[(Math.random() * tiles.length) | 0];
    if(!t) return;
    const sp = worldToScreen(t);
    if(sp.x < -40 || sp.x > W + 40 || sp.y < -40 || sp.y > H + 40) continue;
    atmRippleIdx = (atmRippleIdx + 1) % ATM_RIPPLE_N;
    const r = atmRipples[atmRippleIdx];
    r.max = 0.85; r.life = 0.85;
    r.x = sp.x + (Math.random() - 0.5) * 26;
    r.y = sp.y + (Math.random() - 0.5) * 13;
    r.r = 5 + Math.random() * 5;
    return;
  }
}
function atmDrawGroundRain(g){
  if(ATMOS.rainFade <= 0.02) return;
  for(let i = 0; i < ATM_RIPPLE_N; i++){
    const r = atmRipples[i];
    if(r.life <= 0) continue;
    const k = 1 - r.life / r.max;
    const rad = r.r + k * 11;
    g.beginPath();
    g.ellipse(r.x, r.y, rad, rad * 0.5, 0, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(214,240,255,' + ((r.life / r.max) * 0.62 * ATMOS.rainFade).toFixed(3) + ')';
    g.lineWidth = 1.4;
    g.stroke();
  }
}

/* ============================================================
 * 闪电
 * ============================================================ */
const ATM_BOLT_N = 9;
const atmBolt = new Float32Array(ATM_BOLT_N * 2);
function atmStrikeLightning(){
  ATMOS.flash = 1;
  let x = 0.12 + Math.random() * 0.72, y = -0.02;
  for(let i = 0; i < ATM_BOLT_N; i++){
    atmBolt[i * 2] = x;
    atmBolt[i * 2 + 1] = y;
    x += (Math.random() - 0.5) * 0.08;
    y += 0.05 + Math.random() * 0.04;
  }
}
function atmDrawBolt(g){
  const a = Math.min(1, (ATMOS.flash - 0.25) / 0.6);
  if(a <= 0) return;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for(let pass = 0; pass < 2; pass++){
    g.beginPath();
    for(let i = 0; i < ATM_BOLT_N; i++){
      const x = atmBolt[i * 2] * W, y = atmBolt[i * 2 + 1] * H * 1.15;
      if(i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    if(pass === 0){ g.strokeStyle = 'rgba(180,210,255,' + (0.35 * a).toFixed(3) + ')'; g.lineWidth = 7; }
    else { g.strokeStyle = 'rgba(255,255,255,' + (0.92 * a).toFixed(3) + ')'; g.lineWidth = 2; }
    g.stroke();
  }
}

/* ============================================================
 * 两个渲染钩子（50-render.js 只传 ctx，cx/cy 缺省时自己算）
 * ============================================================ */
function drawAtmosphereBack(g, cx, cy){
  atmSkySample();
  const nl = atmNightFactor();
  /* 整屏渐变天空 */
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, atmRgb(atmSkyTop));
  sky.addColorStop(1, atmRgb(atmSkyBot));
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  /* 星星 → 月亮 → 太阳 → 云 → 闪电 */
  if(nl > 0.02) atmDrawStars(g, nl);
  const moon = atmMoonTrack();
  if(moon.visible) atmDrawMoon(g, moon.x, moon.y, nl);
  const sun = atmSunTrack();
  if(sun.visible) atmDrawSun(g, sun.x, sun.y, sun.t);
  atmDrawClouds(g, nl);
  if(ATMOS.flash > 0.25) atmDrawBolt(g);
  /* 悬浮岛周围一圈柔光，让地图从背景里浮起来 */
  const ccx = (cx == null) ? W / 2 + state.camera.x : cx;
  const ccy = (cy == null) ? H / 2 + state.camera.y : cy;
  const halo = g.createRadialGradient(ccx, ccy, 30, ccx, ccy, Math.max(W, H) * 0.6);
  halo.addColorStop(0, 'rgba(255,246,220,' + (0.05 * (1 - nl) + 0.015).toFixed(3) + ')');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, W, H);
}
function drawAtmosphereFront(g){
  const l = atmosLight();
  /* 夜晚整体压暗（偏深蓝）；UI 是 DOM，不受影响 */
  const dark = Math.max(0, Math.min(0.62, (1 - l) * 0.62)) * (1 - ATMOS.flash * 0.75);
  if(dark > 0.01){
    g.fillStyle = 'rgba(10,20,52,' + dark.toFixed(3) + ')';
    g.fillRect(0, 0, W, H);
  }
  /* 晨昏暖色 */
  const warm = atmWarmFactor();
  if(warm > 0.01){
    g.fillStyle = 'rgba(255,124,54,' + (warm * 0.15).toFixed(3) + ')';
    g.fillRect(0, 0, W, H);
  }
  /* 雨天压暗 + 雨丝 */
  if(ATMOS.rainFade > 0.02){
    g.fillStyle = 'rgba(40,60,92,' + (0.13 * ATMOS.rainFade).toFixed(3) + ')';
    g.fillRect(0, 0, W, H);
    atmDrawRainStreaks(g);
  }
  /* 闪电全屏白闪（同时抵消上面的压暗，形成"短暂提亮"） */
  if(ATMOS.flash > 0.01){
    g.fillStyle = 'rgba(255,255,255,' + (ATMOS.flash * 0.5).toFixed(3) + ')';
    g.fillRect(0, 0, W, H);
  }
}
