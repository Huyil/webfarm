/* ============ 作物绘制 ============ */
function getAnchorOffset(cropId, ratio){
  const p = Math.pow(ratio, 1.5);
  if(cropId === 'carrot') return p * 6;
  if(cropId === 'potato') return p * 9;
  if(cropId === 'rice') return p * 14;
  if(cropId === 'wheat') return p * 12;
  if(cropId === 'chili') return p * 11;
  if(cropId === 'eggplant') return p * 13;
  if(cropId === 'tomato') return p * 12;
  return p * 10;
}
function drawCarrot(g, x, y, ratio){
  const stage = ratio<0.33?0:ratio<0.66?1:ratio<1?2:3;
  const scale = 0.6 + ratio*0.55, rootY = y+2, leafBase = y-2;
  const leafSpecs = stage===0?[{a:-0.85,len:0.55},{a:0.85,len:0.55}]:
    stage===1?[{a:-1.0,len:0.75},{a:-0.35,len:0.95},{a:0.35,len:0.95},{a:1.0,len:0.75}]:
    stage===2?[{a:-1.15,len:0.75},{a:-0.6,len:1.0},{a:-0.15,len:1.1},{a:0.15,len:1.1},{a:0.6,len:1.0},{a:1.15,len:0.75}]:
    [{a:-1.25,len:0.8},{a:-0.75,len:1.0},{a:-0.35,len:1.15},{a:0,len:1.2},{a:0.35,len:1.15},{a:0.75,len:1.0},{a:1.25,len:0.8}];
  const maxLen = 12*scale;
  for(const sp of leafSpecs){
    const a = sp.a - Math.PI/2, len = maxLen*sp.len;
    const tipX = x + Math.cos(a)*len, tipY = leafBase + Math.sin(a)*len;
    g.beginPath(); g.moveTo(x, leafBase);
    g.quadraticCurveTo(x+Math.cos(a)*len*0.4, leafBase+Math.sin(a)*len*0.55, tipX, tipY);
    g.lineWidth = 3.2*scale; g.strokeStyle = '#2e5c1a'; g.lineCap = 'round'; g.stroke();
    g.lineWidth = 2.0*scale; g.strokeStyle = '#4ea832'; g.stroke();
    g.lineWidth = 0.9*scale; g.strokeStyle = '#7ad654'; g.stroke();
    g.beginPath(); g.arc(tipX-0.5, tipY-0.5, 0.9*scale, 0, Math.PI*2);
    g.fillStyle = 'rgba(200,255,160,0.85)'; g.fill();
  }
  /* 萝卜是长在地下的：只画露出地面的一小截，剩下的用土堆盖住 */
  if(stage >= 2){
    const rH = (7+ratio*11)*scale*0.85, rW = (4+ratio*4.5)*scale, rTopY = rootY-1;
    const showH = rH * 0.52;                       // 露出地面的部分
    const rootGrad = g.createLinearGradient(x-rW, rTopY, x+rW, rTopY+rH);
    rootGrad.addColorStop(0, '#ffb066'); rootGrad.addColorStop(0.4, '#ff9040');
    rootGrad.addColorStop(0.75, '#e86820'); rootGrad.addColorStop(1, '#a83810');
    g.save();
    g.beginPath(); g.rect(x - rW * 1.6 - 2, rTopY - 3, rW * 3.2 + 4, showH + 3); g.clip();
    g.beginPath(); g.moveTo(x-rW, rTopY+1);
    g.quadraticCurveTo(x-rW*1.1, rTopY+rH*0.55, x-0.2, rTopY+rH-1);
    g.quadraticCurveTo(x+0.2, rTopY+rH, x+0.2, rTopY+rH-1);
    g.quadraticCurveTo(x+rW*1.1, rTopY+rH*0.55, x+rW, rTopY+1);
    g.closePath(); g.fillStyle = rootGrad; g.fill();
    g.beginPath(); g.moveTo(x-rW*0.5, rTopY+2);
    g.quadraticCurveTo(x-rW*0.75, rTopY+rH*0.5, x-rW*0.15, rTopY+rH*0.85);
    g.lineWidth = 1.6*scale; g.strokeStyle = 'rgba(255,220,180,0.85)'; g.stroke();
    g.restore();
    drawSoilMound(g, x, rTopY + showH, rW * 1.35, 2.8 + 1.4 * ratio);
  } else {
    const rH = (2+ratio*4)*scale;
    const showH = rH * 0.55;
    g.save();
    g.beginPath(); g.rect(x - 6, rootY - 3, 12, showH + 3); g.clip();
    g.beginPath(); g.ellipse(x, rootY+rH*0.5, 2*scale, rH, 0, 0, Math.PI*2);
    g.fillStyle = '#e87828'; g.fill();
    g.restore();
    drawSoilMound(g, x, rootY + showH, 3.4 * scale + 1, 1.8);
  }
}
/* 盖住萝卜切口的小土堆 */
function drawSoilMound(g, x, y, rx, ry){
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = '#7a5637'; g.fill();
  g.strokeStyle = 'rgba(52,32,16,.45)'; g.lineWidth = 0.9; g.stroke();
  g.beginPath(); g.ellipse(x - rx * 0.25, y - ry * 0.35, rx * 0.45, ry * 0.4, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(180,142,96,.5)'; g.fill();
}
function drawPotato(g, x, y, ratio){
  const stage = ratio<0.33?0:ratio<0.66?1:ratio<1?2:3;
  const scale = 0.6+ratio*0.55, baseY = y+1, stemH = (8+ratio*17)*scale;
  g.beginPath(); g.moveTo(x, baseY); g.lineTo(x, baseY-stemH);
  g.lineWidth = 3.2*scale; g.strokeStyle = '#2e5c1a'; g.lineCap = 'round'; g.stroke();
  g.lineWidth = 1.8*scale; g.strokeStyle = '#4ea832'; g.stroke();
  const pairs = stage===0?0:stage===1?1:stage===2?2:3;
  for(let p=0; p<pairs; p++){
    const t = (p+1)/(pairs+0.5), ly = baseY - stemH*t;
    const lw = (5.5+p*1.2)*scale, lh = lw*0.62;
    for(const side of [-1,1]){
      const lx = x + side*(lw*0.75), tilt = side*0.32;
      g.save(); g.translate(lx, ly); g.rotate(tilt);
      g.beginPath(); g.ellipse(0, 0, lw, lh, 0, 0, Math.PI*2);
      g.fillStyle = '#1e4410'; g.fill();
      const lg = g.createLinearGradient(-lw, -lh, lw, lh);
      lg.addColorStop(0, '#8ae05c'); lg.addColorStop(0.5, '#5cbf3a'); lg.addColorStop(1, '#3a8a20');
      g.beginPath(); g.ellipse(0, 0, lw-0.5, lh-0.5, 0, 0, Math.PI*2);
      g.fillStyle = lg; g.fill();
      g.beginPath(); g.ellipse(-lw*0.35, -lh*0.35, lw*0.28, lh*0.28, 0, 0, Math.PI*2);
      g.fillStyle = 'rgba(220,255,180,0.55)'; g.fill();
      g.restore();
    }
  }
  if(stage === 2){
    const fy = baseY - stemH;
    for(let i=0; i<5; i++){
      const a = (i/5)*Math.PI*2 - Math.PI/2;
      g.beginPath(); g.arc(x+Math.cos(a)*2.8*scale, fy+Math.sin(a)*2.8*scale, 2.1*scale, 0, Math.PI*2);
      g.fillStyle = '#fff8e8'; g.fill();
      g.lineWidth = 0.7*scale; g.strokeStyle = '#4a2e1a'; g.stroke();
    }
    g.beginPath(); g.arc(x, fy, 1.6*scale, 0, Math.PI*2); g.fillStyle = '#ffce2e'; g.fill();
  }
  if(stage >= 3){
    const tubers = [
      {x:x-9*scale, y:baseY+2, rw:5.5, rh:4.2, rot:-0.3},
      {x:x+9*scale, y:baseY+2.5, rw:5, rh:3.8, rot:0.3},
      {x:x, y:baseY+8*scale, rw:6, rh:4.5, rot:0}
    ];
    for(const t of tubers){
      const tw = t.rw*scale, th = t.rh*scale;
      g.save(); g.translate(t.x, t.y); g.rotate(t.rot);
      g.beginPath(); g.ellipse(0.5, 0.5, tw, th, 0, 0, Math.PI*2); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fill();
      const tg = g.createRadialGradient(-tw*0.35, -th*0.35, 0, 0, 0, tw);
      tg.addColorStop(0, '#ffe8a0'); tg.addColorStop(0.5, '#e8b860'); tg.addColorStop(1, '#a86828');
      g.beginPath(); g.ellipse(0, 0, tw, th, 0, 0, Math.PI*2); g.fillStyle = tg; g.fill();
      g.lineWidth = 0.9*scale; g.strokeStyle = '#6a4020'; g.stroke();
      g.beginPath(); g.ellipse(-tw*0.35, -th*0.4, tw*0.3, th*0.28, 0, 0, Math.PI*2);
      g.fillStyle = 'rgba(255,250,220,0.9)'; g.fill();
      g.restore();
    }
  }
}
function drawRice(g, x, y, ratio){
  const stage = ratio<0.33?0:ratio<0.66?1:ratio<1?2:3;
  const scale = 0.6+ratio*0.55, baseY = y+1, stemH = (10+ratio*22)*scale;
  const stems = stage===0?2:3;
  for(let i=0; i<stems; i++){
    const offset = (i - (stems-1)/2) * 7 * scale;
    const sx = x + offset, topX = x + offset*1.5, topY = baseY - stemH;
    g.beginPath(); g.moveTo(sx, baseY);
    g.quadraticCurveTo(sx + offset*0.1, baseY-stemH*0.5, topX, topY);
    g.lineWidth = 2.6*scale; g.strokeStyle = '#1e4410'; g.lineCap = 'round'; g.stroke();
    g.lineWidth = 1.6*scale; g.strokeStyle = '#4ea832'; g.stroke();
    if(stage >= 1){
      const lc = stage >= 2 ? 3 : 2;
      for(let l=0; l<lc; l++){
        const lt = 0.35 + l*0.2;
        const ly = baseY - stemH*lt, lx = sx + (topX-sx)*lt;
        const side = l%2===0?-1:1, leafLen = 8*scale;
        const leafAngle = side*(0.5 + l*0.08);
        const leafEndX = lx + Math.cos(leafAngle)*leafLen;
        const leafEndY = ly + Math.sin(leafAngle)*leafLen*0.55;
        g.beginPath(); g.moveTo(lx, ly);
        g.quadraticCurveTo((lx+leafEndX)/2, (ly+leafEndY)/2 - 2*scale, leafEndX, leafEndY);
        g.lineWidth = 3.2*scale; g.strokeStyle = '#1e4410'; g.stroke();
        g.lineWidth = 1.9*scale; g.strokeStyle = '#5cbf3a'; g.stroke();
      }
    }
    if(stage >= 2){
      const grains = stage===2?4:6;
      for(let k=0; k<grains; k++){
        const gx = topX + (k%2===0?-1.8:1.8)*scale, gy = topY - k*3.2*scale;
        const gw = 2.2*scale, gh = 2.8*scale;
        const gg = g.createLinearGradient(gx-gw, gy-gh, gx+gw, gy+gh);
        gg.addColorStop(0, '#fff0a8'); gg.addColorStop(0.5, '#ffd64a'); gg.addColorStop(1, '#c89820');
        g.beginPath(); g.ellipse(gx, gy, gw, gh, 0, 0, Math.PI*2); g.fillStyle = gg; g.fill();
        g.beginPath(); g.ellipse(gx-gw*0.35, gy-gh*0.4, gw*0.35, gh*0.3, 0, 0, Math.PI*2);
        g.fillStyle = 'rgba(255,250,220,0.9)'; g.fill();
      }
    }
  }
}
/* 兜底：新作物在没有专属画法时的通用幼苗 */
function drawGenericSprout(g, x, y, ratio, color){
  const s = 0.6 + ratio * 0.55;
  g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x, y + 2 - (6 + ratio * 12) * s);
  g.lineWidth = 3 * s; g.strokeStyle = '#2e5c1a'; g.stroke();
  g.lineWidth = 1.6 * s; g.strokeStyle = '#4ea832'; g.stroke();
  const leaves = ratio < 0.33 ? 1 : ratio < 0.66 ? 2 : 3;
  for(let i = 0; i < leaves; i++){
    const side = i % 2 === 0 ? -1 : 1;
    const ly = y - (4 + i * 5) * s;
    g.beginPath();
    g.ellipse(x + side * 5 * s, ly, 5.5 * s, 2.6 * s, side * 0.4, 0, Math.PI * 2);
    g.fillStyle = color || '#5cbf3a'; g.fill();
  }
}
/* 植株本体（不含水滴/肥料/进度条这些覆盖物）：抽出来是为了能烧进精灵图 */
function drawCropBody(g, crop, x, y, ratio){
  if(crop === 'carrot') drawCarrot(g, x, y, ratio);
  else if(crop === 'potato') drawPotato(g, x, y, ratio);
  else if(crop === 'rice') drawRice(g, x, y, ratio);
  else if(typeof drawVeggieField === 'function') drawVeggieField(g, crop, x, y, ratio);
  else drawGenericSprout(g, x, y, ratio, (CROPS[crop] && CROPS[crop].color) || '#5cbf3a');
}
/* ============ 作物精灵缓存（v9.25） ============
 * 一株作物的矢量画法是"曲线 + 多层描边 + 渐变"，40×40 农场实测每帧 **7.3 万次** 绘制调用
 * （占整帧 87%，是现在最大的一块）。
 * 缩得比较小时（`tileLOD() < 2`，一株在屏幕上只有 15~25px）把它按 (作物, 生长档)
 * 预渲染成一张小图，每株只 drawImage 一次；**放大看时仍旧走矢量**，所以绝不会糊。
 * 生长进度量化成 CROP_SPR_STEPS 档（每档 ~8% 大小差，那个尺寸下看不出来）。 */
const cropSpriteCache = Object.create(null);
const cropSpriteStats = { baked: 0, drawn: 0 };
const CROP_SPR_STEPS = 12;
const CROP_SPR_PAD = 6;
/* 植株本体在"艺术像素"里的包围盒（要盖住所有作物：番茄/茄子最高，萝卜的土堆最靠下） */
const CROP_SPR_BOX = { x0: -22, y0: -40, x1: 22, y1: 18 };
function cropSpriteFor(crop, ratio){
  const step = Math.max(0, Math.min(CROP_SPR_STEPS - 1, Math.floor(ratio * CROP_SPR_STEPS)));
  const key = crop + '#' + step;
  const hit = cropSpriteCache[key];
  if(hit !== undefined) return hit;
  const q = (step + 0.5) / CROP_SPR_STEPS;
  const w = CROP_SPR_BOX.x1 - CROP_SPR_BOX.x0 + CROP_SPR_PAD * 2;
  const h = CROP_SPR_BOX.y1 - CROP_SPR_BOX.y0 + CROP_SPR_PAD * 2;
  let sp = null;
  try{
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    if(g){
      g.translate(-CROP_SPR_BOX.x0 + CROP_SPR_PAD, -CROP_SPR_BOX.y0 + CROP_SPR_PAD);
      drawCropBody(g, crop, 0, 0, q);                       /* 以 (0,0) 为原点烧制 */
      sp = { canvas:cv, w, h, ox:CROP_SPR_BOX.x0 - CROP_SPR_PAD, oy:CROP_SPR_BOX.y0 - CROP_SPR_PAD };
      cropSpriteStats.baked++;
    }
  }catch(e){ sp = null; }
  cropSpriteCache[key] = sp;
  return sp;
}
function drawCrop(px, py, t){
  const def = CROPS[t.crop]; if(!def) return;
  const ratio = Math.min(1, t.growth / (def.stageMs * 3));
  const anchorOffset = getAnchorOffset(t.crop, ratio);
  /* 成熟后整体上移一点，果实不再贴着瓦片前沿 */
  const lift = (t.state === 'ready') ? 7 : 0;
  const baseX = px, baseY = py + anchorOffset - lift;
  ctx.save();
  const sp = (typeof tileLOD === 'function' && tileLOD() < 2 && !window.FARM_NO_SPRITES) ? cropSpriteFor(t.crop, ratio) : null;
  if(sp){
    ctx.drawImage(sp.canvas, baseX + sp.ox, baseY + sp.oy, sp.w, sp.h);
    cropSpriteStats.drawn++;
  } else {
    drawCropBody(ctx, t.crop, baseX, baseY, ratio);
  }
  ctx.restore();

  if(t.watered && t.state === 'growing'){
    ctx.save(); ctx.font = '12px serif'; ctx.textAlign = 'center';
    ctx.fillText('💧', px + 16, py - 8); ctx.restore();
  }
  if(t.fertile && t.state === 'growing'){
    ctx.save(); ctx.font = '12px serif'; ctx.textAlign = 'center';
    ctx.fillText('🧪', px - 16, py - 8); ctx.restore();
  }
  /* 多次收获：剩余次数小圆点 */
  if(cropIsMulti(def) && t.harvestsLeft > 0 && t.state !== 'wild'){
    ctx.save();
    const n = def.harvests, r = 2.1;
    const w = n * (r * 2 + 2);
    for(let i = 0; i < n; i++){
      ctx.beginPath();
      ctx.arc(px - w / 2 + r + i * (r * 2 + 2), py + 14, r, 0, Math.PI * 2);
      ctx.fillStyle = i < t.harvestsLeft ? '#ff8f5a' : 'rgba(0,0,0,.28)';
      ctx.fill();
    }
    ctx.restore();
  }
  /* 生长进度条。
   * 圆角是靠 arcTo 画的，一条进度条 = 2 次 roundRect = 8 次 arcTo + 8 次 moveTo/lineTo + 2 次 fill；
   * 40×40 农场一拍就是 1600 条，光这一项每帧就 2.5 万次调用。缩小时圆角根本看不出来，
   * 所以按 tileLOD() 分级：贴近看用圆角，缩小/大地图直接用 fillRect。 */
  if(t.state === 'growing' && ratio > 0.03 && state.showCropBars !== false){
    ctx.save();
    const w = 30, h = 3.4, x0 = px - w / 2, y0 = py - 42;
    const round = (typeof tileLOD === 'function') && tileLOD() >= 2;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    if(round){ roundRect(ctx, x0, y0, w, h, h / 2); ctx.fill(); }
    else ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = t.watered ? '#6fd0ff' : '#9fe07a';
    const fw = w * ratio;
    if(round){ roundRect(ctx, x0, y0, fw, h, h / 2); ctx.fill(); }
    else ctx.fillRect(x0, y0, fw, h);
    ctx.restore();
  }
}

