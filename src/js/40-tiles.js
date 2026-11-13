/* ============ 瓦片 ============ */
/* 一、外观码与配色
 * 把「配色」从「格子对象」里解耦出来（tileLookCode → tileColorsByLook），是为了能把
 * 整块瓦片**预烘成贴图**（见下方二、贴图缓存）：贴图按外观码共享，格子只决定用哪一套。
 * 外观码的顺序必须与配色分支一一对应，改一处就得改另一处。 */
function tileLookCode(t){
  if(t.stone) return 1;
  if(t.state === 'ready') return 2;
  if(t.state === 'wild') return 3;
  /* 多年生（多次收获作物）地块偏苔绿，和一年生区分开 */
  if(t.state === 'growing' && t.harvestsLeft > 0) return t.watered ? 4 : 5;
  if(t.watered && t.fertile) return 6;
  if(t.watered) return 7;
  /* 施过肥（或还有「不返草地」次数）的地颜色更深，一眼能看出这块地被伺候过 */
  if(t.fertile || (t.fertLeft || 0) > 0) return 8;
  return 9;
}
function tileColorsByLook(look){
  switch(look){
    /* 石头地面：只能放装饰，不能开垦/种植 */
    case 1: return { top:'#a2a2ae', wallL:'#787884', wallR:'#52525e', noise:'rgba(40,40,52,.40)', noise2:'rgba(226,226,238,.38)' };
    case 2: return { top:'#ffd76e', wallL:'#c4a050', wallR:'#8e7030', noise:'rgba(140,100,30,.35)', noise2:'rgba(255,240,180,.35)' };
    case 3: return { top:'#7fbf5a', wallL:'#5c9440', wallR:'#3e6a28', noise:'rgba(40,80,20,.35)', noise2:'rgba(200,240,160,.4)' };
    case 4: return { top:'#5c5a30', wallL:'#3e3c1e', wallR:'#262412', noise:'rgba(20,30,5,.4)', noise2:'rgba(160,190,110,.3)' };
    case 5: return { top:'#7d7a44', wallL:'#5a582e', wallR:'#3a3818', noise:'rgba(40,50,10,.4)', noise2:'rgba(210,220,160,.3)' };
    case 6: return { top:'#5e4229', wallL:'#3a2818', wallR:'#241808', noise:'rgba(20,10,0,.4)', noise2:'rgba(120,90,60,.3)' };
    case 7: return { top:'#775438', wallL:'#543a24', wallR:'#362418', noise:'rgba(30,15,5,.4)', noise2:'rgba(140,110,80,.35)' };
    case 8: return { top:'#6b5030', wallL:'#523c22', wallR:'#33240e', noise:'rgba(36,22,7,.5)', noise2:'rgba(186,156,106,.28)' };
    default: return { top:'#8b6340', wallL:'#654522', wallR:'#432c14', noise:'rgba(40,20,5,.4)', noise2:'rgba(180,150,110,.35)' };
  }
}
function tileColors(t){ return tileColorsByLook(tileLookCode(t)); }
/* 确定性伪随机 0..1。
   注意：旧实现用 `*` 做 32 位乘法（大数下丢低位）、又用有符号右移 `>>`，
   结果**永远只返回 [0, 0.5)** —— 所有基于它的撒点都被挤到每格左上四分之一，
   地面因此完全没有土壤/草地的颗粒感。改用 Math.imul + 无符号移位。 */
function hash2(x, y){
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/* 当前渲染倍率下，"一格地在屏幕上有多宽"（设备像素）。
 * 由 render() 每帧写一次。 */
let renderZoom = 1;
/* 屏幕格子宽 ≥34px / ≥30px 分档。注意：砂粒早已不是逐颗 fillRect 画的，
 * 而是**烘进瓦片贴图**（见下），所以这个档位只影响"贴图烘不烘砂粒"，
 * 不影响每帧成本；真正的砂粒开关是 tileWantSand()。保留它是因为
 * 别处（作物精灵分档、性能面板、自检）还在读。 */
const LOD_FULL = 34, LOD_MID = 30;
function tileLOD(){
  const tw = TILE_W * SCALE * renderZoom;
  return tw >= LOD_FULL ? 2 : (tw >= LOD_MID ? 1 : 0);
}
/* ============================================================
 * 二、瓦片贴图缓存
 * 每格 3 个面 + 砂粒/噪点/垄痕，原来要 ~227 次 fillRect 才画完一格。
 * 一片 48×48 农场重烘一次地表层就是 22 万次调用 —— 这是"拖动/缩放掉帧"的元凶，
 * 而且成本随缩放跳变（LOD2 门槛正好落在可见格数还很大的 0.44x 上）。
 *
 * 现在把整块瓦片按「外观码 × 纹理变体 × 是否铺砂粒」预烘成小贴图，绘制时一格一次
 * drawImage：重烘成本从 O(格数 × 227) 降到 O(格数)，于是帧率不再随缩放/农场大小剧变。
 * · 变体：砂粒是 1~3px 的随机点，8 套变体按坐标打散，看不出周期重复；
 * · 清晰度：贴图按 renderZoom×DPR 的整数倍烘（亚像素位置由 drawImage 插值），
 *   缩放时按 0.25 档向上取整重烘，避免放大发虚；
 * · 上限：设备像素/世界像素 > TEX_MAX_SCALE 时退回矢量绘制 —— 那时可见格子已经很少。
 * ============================================================ */
const TILE_TEX_VARIANTS = 8;
const TEX_MAX_SCALE = 4;
const TILE_SAND_MIN_PX = 30;        /* 屏幕格子宽不到这个值就不铺砂粒 */
const TILE_SAND_BUDGET = 60000;     /* 矢量回退路径一次重烘的砂粒填充上限（≈264 格全细节） */
let tileTexScale = 0;
let tileTexMap = Object.create(null);
/* 可见格数估计：视口面积 ÷ 半格面积（等距格子铺满屏幕的块数）。
 * 只给"矢量回退路径"的砂粒预算用 —— 贴图路径里砂粒是烘进去的，绘制时零成本。 */
function visTileEstimate(){
  const w = TILE_W * SCALE, h = TILE_H * SCALE;
  const n = Math.round((W * H) / ((w * h) / 2));
  return Math.min(state.tiles.length, Math.max(1, n));
}
function tileVariant(t){
  return ((Math.imul(t.gx, 73856093) ^ Math.imul(t.gy, 19349663)) >>> 0) & (TILE_TEX_VARIANTS - 1);
}
function tileTexResetIfNeeded(sc){
  if(sc === tileTexScale) return;
  tileTexScale = sc;
  tileTexMap = Object.create(null);       /* 缩放变了：整批重烘（懒烘，只烘真正用到的） */
}
function tileWantSand(t){
  if(t.state === 'wild' && !t.stone) return false;                  /* 草地本来就没有砂粒 */
  return TILE_W * SCALE * renderZoom >= TILE_SAND_MIN_PX;           /* 屏幕上糊成一团就不铺 */
}
function drawTileBlock(px, py, t){
  const look = tileLookCode(t), variant = tileVariant(t), sand = tileWantSand(t);
  if(renderZoom * DPR <= TEX_MAX_SCALE){
    /* 贴图路径：砂粒是烘进贴图的，绘制时零成本 —— 所以这里不需要预算上限，
       视觉和「逐颗 fillRect」那版一致（缩放档变了才重烘一次贴图）。 */
    const tex = tileTexFor(look, variant, sand);
    if(tex){ ctx.drawImage(tex.cv, px + tex.ox, py + tex.oy, tex.w, tex.h); return; }
  }
  /* 矢量回退（放到很大时）：这时砂粒是逐颗画的，才需要按可见格数设预算 */
  drawTileBlockVector(ctx, px, py, look, variant, sand && visTileEstimate() * 227 <= TILE_SAND_BUDGET);
}
/* 单块瓦片的矢量绘制（贴图烘焙与高倍率回退都走这里）。
 * g 显式传入：烘焙时画在离屏 ctx 上，不能再依赖全局 ctx。
 * hb 只由「外观码 + 变体」决定 —— 同一套贴图里的砂粒位置必须完全一致。 */
function drawTileBlockVector(g, px, py, look, variant, wantSand){
  const w = TILE_W*SCALE, h = TILE_H*SCALE, D = THICKNESS*SCALE, c = tileColorsByLook(look);
  const top = {x:px, y:py-h/2}, right = {x:px+w/2, y:py}, bottom = {x:px, y:py+h/2}, left = {x:px-w/2, y:py};

  g.beginPath();
  g.moveTo(left.x, left.y); g.lineTo(bottom.x, bottom.y);
  g.lineTo(bottom.x, bottom.y+D); g.lineTo(left.x, left.y+D);
  g.closePath(); g.fillStyle = c.wallL; g.fill();

  g.beginPath();
  g.moveTo(bottom.x, bottom.y); g.lineTo(right.x, right.y);
  g.lineTo(right.x, right.y+D); g.lineTo(bottom.x, bottom.y+D);
  g.closePath(); g.fillStyle = c.wallR; g.fill();

  g.save();
  g.beginPath();
  g.moveTo(top.x, top.y); g.lineTo(right.x, right.y);
  g.lineTo(bottom.x, bottom.y); g.lineTo(left.x, left.y);
  g.closePath(); g.fillStyle = c.top; g.fill(); g.clip();

  /* 纹理跟着世界一起缩放（放大就是放大，不做反向补偿——那会让高倍率下只剩大块平色） */
  const hb = variant * 7919 + look * 131;
  const nNoise = wantSand ? 22 : 0;
  for(let i=0; i<nNoise; i++){
    const r1 = hash2(hb+i, 7), r2 = hash2(hb+i, 13);
    const u = r1*2-1, v = r2*2-1;
    if(Math.abs(u) + Math.abs(v) > 0.95) continue;
    g.fillStyle = r1 > 0.5 ? c.noise : c.noise2;
    g.fillRect(px + u*w*0.5, py + v*h*0.5, 1+r2*1.5, 1+r2*1.5);
  }
  if(wantSand){
    const stone = (look === 1);
    const liteC = stone ? 'rgba(226,226,238,.22)' : 'rgba(216,188,150,.22)';
    const darkC = stone ? 'rgba(52,52,64,.24)'   : 'rgba(56,34,16,.20)';
    const dashA = stone ? 'rgba(150,150,168,.16)' : 'rgba(150,116,80,.16)';
    const dashB = stone ? 'rgba(206,206,220,.16)' : 'rgba(196,166,124,.16)';
    /* ① 细砂：铺满整格、两色交错（菱形过滤会滤掉约一半，所以按 ~195 颗投放） */
    for(let i=0; i<195; i++){
      const q1 = hash2(hb + i * 11, 811), q2 = hash2(hb + i * 11, 823);
      const cu = q1*2-1, cv = q2*2-1;
      if(Math.abs(cu) + Math.abs(cv) > 1.0) continue;
      const r = 0.6 + q2 * 1.7;
      g.fillStyle = (i % 3 === 0) ? liteC : darkC;
      g.fillRect(px + cu*w*0.5, py + cv*h*0.5, r, r * (0.75 + q1 * 0.5));
    }
    /* ② 短垄痕：3~6px 的浅短痕，只是"耙过土"的暗示，不是长线条 */
    for(let i=0; i<10; i++){
      const q1 = hash2(hb + i * 71, 907), q2 = hash2(hb + i * 71, 911);
      const cu = q1*2-1, cv = q2*2-1;
      if(Math.abs(cu) + Math.abs(cv) > 0.85) continue;
      g.fillStyle = (i % 2) ? dashA : dashB;
      g.fillRect(px + cu*w*0.42, py + cv*h*0.42, 2.6 + q2 * 3.2, 1.1 + q1 * 0.5);
    }
  }
  /* 明暗交给瓦片配色与昼夜光照；上面这些噪点/图案就是全部纹理。 */
  g.restore();
}
/* 取（或烘）一张瓦片贴图。纹理尺寸 = 世界尺寸 × 烘焙倍率，锚点用 ox/oy 回到格子中心。 */
function tileTexFor(look, variant, wantSand){
  const sc = Math.min(TEX_MAX_SCALE, Math.ceil(renderZoom * DPR * 4) / 4);
  tileTexResetIfNeeded(sc);
  const key = look + ',' + variant + ',' + (wantSand ? 1 : 0);
  const hit = tileTexMap[key];
  if(hit !== undefined) return hit;
  const w = TILE_W*SCALE, h = TILE_H*SCALE, D = THICKNESS*SCALE, pad = 1;
  const totalW = w + pad * 2, totalH = h + D + pad * 2;
  try{
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(totalW * sc));
    cv.height = Math.max(1, Math.round(totalH * sc));
    const g = cv.getContext('2d');
    if(!g){ tileTexMap[key] = null; return null; }
    /* 世界坐标 (0,0)（= 格子中心）落在画布 (w/2+pad, h/2+pad) 处 */
    g.setTransform(sc, 0, 0, sc, (w / 2 + pad) * sc, (h / 2 + pad) * sc);
    drawTileBlockVector(g, 0, 0, look, variant, wantSand);
    const tex = { cv, w: totalW, h: totalH, ox: -(w / 2 + pad), oy: -(h / 2 + pad) };
    tileTexMap[key] = tex;
    return tex;
  }catch(e){ tileTexMap[key] = null; return null; }
}
function drawTileEdges(px, py, w, h){
  const topX=px, topY=py-h/2, rightX=px+w/2, rightY=py, leftX=px-w/2, leftY=py;
  ctx.beginPath(); ctx.moveTo(topX, topY); ctx.lineTo(rightX, rightY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(leftX, leftY); ctx.lineTo(topX, topY); ctx.stroke();
}
function drawTerrainBoundaries(cx, cy){
  const w = TILE_W*SCALE, h = TILE_H*SCALE;
  ctx.strokeStyle = 'rgba(0,0,0,.20)'; ctx.lineWidth = 1.2;
  for(const t of state.tiles){
    const { sx, sy } = iso(t.gx, t.gy);
    const px = cx + sx*SCALE, py = cy + sy*SCALE;
    if(px < -w || px > W+w || py < -h || py > H+h) continue;
    const top={x:px,y:py-h/2}, right={x:px+w/2,y:py}, bottom={x:px,y:py+h/2}, left={x:px-w/2,y:py};
    const nbTR = getTile(t.gx, t.gy-1), nbBR = getTile(t.gx+1, t.gy);
    const nbBL = getTile(t.gx, t.gy+1), nbTL = getTile(t.gx-1, t.gy);
    if(!nbTR || nbTR.terrain !== t.terrain){ ctx.beginPath(); ctx.moveTo(top.x,top.y); ctx.lineTo(right.x,right.y); ctx.stroke(); }
    if(!nbBR || nbBR.terrain !== t.terrain){ ctx.beginPath(); ctx.moveTo(right.x,right.y); ctx.lineTo(bottom.x,bottom.y); ctx.stroke(); }
    if(!nbBL || nbBL.terrain !== t.terrain){ ctx.beginPath(); ctx.moveTo(bottom.x,bottom.y); ctx.lineTo(left.x,left.y); ctx.stroke(); }
    if(!nbTL || nbTL.terrain !== t.terrain){ ctx.beginPath(); ctx.moveTo(left.x,left.y); ctx.lineTo(top.x,top.y); ctx.stroke(); }
  }
}
