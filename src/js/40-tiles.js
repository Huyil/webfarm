/* ============ 瓦片 ============ */
/* 耕地纹理用**矢量**小颗粒铺（不用位图 pattern）：
   位图在 canvas 被缩放时要重采样 —— 放大发虚、缩放过程中还会因为采样相位变化而抖动。
   矢量 fillRect 每帧按当前变换重新光栅化，任何倍率都清晰。 */
function tileColors(t){
  /* 石头地面：只能放装饰，不能开垦/种植 */
  if(t.stone) return { top:'#a2a2ae', wallL:'#787884', wallR:'#52525e', noise:'rgba(40,40,52,.40)', noise2:'rgba(226,226,238,.38)' };
  if(t.state === 'ready') return { top:'#ffd76e', wallL:'#c4a050', wallR:'#8e7030', noise:'rgba(140,100,30,.35)', noise2:'rgba(255,240,180,.35)' };
  if(t.state === 'wild')  return { top:'#7fbf5a', wallL:'#5c9440', wallR:'#3e6a28', noise:'rgba(40,80,20,.35)', noise2:'rgba(200,240,160,.4)' };
  /* 多年生（多次收获作物）地块偏苔绿，和一年生区分开 */
  if(t.state === 'growing' && t.harvestsLeft > 0){
    if(t.watered) return { top:'#5c5a30', wallL:'#3e3c1e', wallR:'#262412', noise:'rgba(20,30,5,.4)', noise2:'rgba(160,190,110,.3)' };
    return { top:'#7d7a44', wallL:'#5a582e', wallR:'#3a3818', noise:'rgba(40,50,10,.4)', noise2:'rgba(210,220,160,.3)' };
  }
  if(t.watered && t.fertile) return { top:'#5e4229', wallL:'#3a2818', wallR:'#241808', noise:'rgba(20,10,0,.4)', noise2:'rgba(120,90,60,.3)' };
  if(t.watered) return { top:'#775438', wallL:'#543a24', wallR:'#362418', noise:'rgba(30,15,5,.4)', noise2:'rgba(140,110,80,.35)' };
  /* 施过肥（或还有「不返草地」次数）的地颜色更深，一眼能看出这块地被伺候过 */
  if(t.fertile || (t.fertLeft || 0) > 0) return { top:'#6b5030', wallL:'#523c22', wallR:'#33240e', noise:'rgba(36,22,7,.5)', noise2:'rgba(186,156,106,.28)' };
  return { top:'#8b6340', wallL:'#654522', wallR:'#432c14', noise:'rgba(40,20,5,.4)', noise2:'rgba(180,150,110,.35)' };
}
/* 确定性伪随机 0..1。
   注意：旧实现用 `*` 做 32 位乘法（大数下丢低位）、又用有符号右移 `>>`，
   结果**永远只返回 [0, 0.5)** —— 所有基于它的撒点都被挤到每格左上四分之一，
   地面因此完全没有土壤/草地的颗粒感。改用 Math.imul + 无符号移位。 */
function hash2(x, y){
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function drawTileBlock(px, py, t){
  const w = TILE_W*SCALE, h = TILE_H*SCALE, D = THICKNESS*SCALE, c = tileColors(t);
  const top = {x:px, y:py-h/2}, right = {x:px+w/2, y:py}, bottom = {x:px, y:py+h/2}, left = {x:px-w/2, y:py};

  ctx.beginPath();
  ctx.moveTo(left.x, left.y); ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(bottom.x, bottom.y+D); ctx.lineTo(left.x, left.y+D);
  ctx.closePath(); ctx.fillStyle = c.wallL; ctx.fill();

  ctx.beginPath();
  ctx.moveTo(bottom.x, bottom.y); ctx.lineTo(right.x, right.y);
  ctx.lineTo(right.x, right.y+D); ctx.lineTo(bottom.x, bottom.y+D);
  ctx.closePath(); ctx.fillStyle = c.wallR; ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(top.x, top.y); ctx.lineTo(right.x, right.y);
  ctx.lineTo(bottom.x, bottom.y); ctx.lineTo(left.x, left.y);
  ctx.closePath(); ctx.fillStyle = c.top; ctx.fill(); ctx.clip();

  /* 纹理跟着世界一起缩放（放大就是放大，不做反向补偿——那会让高倍率下只剩大块平色） */
  const hb = t.gx * 1000 + t.gy;
  for(let i=0; i<22; i++){
    const r1 = hash2(hb+i, 7), r2 = hash2(hb+i, 13);
    const u = r1*2-1, v = r2*2-1;
    if(Math.abs(u) + Math.abs(v) > 0.95) continue;
    ctx.fillStyle = r1 > 0.5 ? c.noise : c.noise2;
    ctx.fillRect(px + u*w*0.5, py + v*h*0.5, 1+r2*1.5, 1+r2*1.5);
  }
  /* 耕地/石头：矢量土壤纹理 —— 参数与之前那版「位图图案」对齐
     （菱形过滤会滤掉约一半，所以按 ~195 颗投放、落点约 95 颗 + 10 条短垄痕），所以观感一致；
     但用 fillRect 逐帧光栅化，任何倍率都清晰、缩放时也不抖。 */
  if(!(t.state === 'wild' && !t.stone)){
    const liteC = t.stone ? 'rgba(226,226,238,.22)' : 'rgba(216,188,150,.22)';
    const darkC = t.stone ? 'rgba(52,52,64,.24)'   : 'rgba(56,34,16,.20)';
    const dashA = t.stone ? 'rgba(150,150,168,.16)' : 'rgba(150,116,80,.16)';
    const dashB = t.stone ? 'rgba(206,206,220,.16)' : 'rgba(196,166,124,.16)';
    /* ① 细砂：铺满整格、两色交错 */
    for(let i=0; i<195; i++){
      const q1 = hash2(hb + i * 11, 811), q2 = hash2(hb + i * 11, 823);
      const cu = q1*2-1, cv = q2*2-1;
      if(Math.abs(cu) + Math.abs(cv) > 1.0) continue;
      const r = 0.6 + q2 * 1.7;
      ctx.fillStyle = (i % 3 === 0) ? liteC : darkC;
      ctx.fillRect(px + cu*w*0.5, py + cv*h*0.5, r, r * (0.75 + q1 * 0.5));
    }
    /* ② 短垄痕：3~6px 的浅短痕，只是"耙过土"的暗示，不是长线条 */
    for(let i=0; i<10; i++){
      const q1 = hash2(hb + i * 71, 907), q2 = hash2(hb + i * 71, 911);
      const cu = q1*2-1, cv = q2*2-1;
      if(Math.abs(cu) + Math.abs(cv) > 0.85) continue;
      ctx.fillStyle = (i % 2) ? dashA : dashB;
      ctx.fillRect(px + cu*w*0.42, py + cv*h*0.42, 2.6 + q2 * 3.2, 1.1 + q1 * 0.5);
    }
  }
  /* 明暗交给瓦片配色与昼夜光照；上面这些噪点/图案就是全部纹理。 */

  ctx.restore();
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

