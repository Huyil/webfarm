/* ============ 装饰绘制 ============
 * 全部矢量绘制：任何缩放倍率下都不重采样（清晰、不抖）。
 * 每种装饰都用 seed 做确定性变化；被敲击时按 hp 显示剩余次数小点 + 抖动。
 */
function decoT(g, px, py, s){ g.save(); g.translate(px, py); g.scale(s, s); }

/* ---------- 树 ---------- */
function drawTree(g, px, py, seed){
  const s = 0.85 + (seed % 3) * 0.1;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const sway = Math.sin(now / 1400 + seed) * 1.2 * s;
  /* 影子 */
  g.beginPath(); g.ellipse(px, py + 2, 17 * s, 6.5 * s, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,.3)'; g.fill();
  /* 树根 */
  g.fillStyle = '#3f2812';
  for(let i = 0; i < 3; i++){
    const dx = (i - 1) * 5 * s;
    g.beginPath();
    g.ellipse(px + dx, py + 0.6, 3.4 * s, 1.6 * s, (i - 1) * 0.4, 0, Math.PI * 2);
    g.fill();
  }
  /* 树干：带树皮纹理 */
  const tw = 4.2 * s, th = 24 * s;
  const trunkGrad = g.createLinearGradient(px - tw, py - th, px + tw, py);
  trunkGrad.addColorStop(0, '#7a5024'); trunkGrad.addColorStop(0.45, '#5a3a1a'); trunkGrad.addColorStop(1, '#38220e');
  g.beginPath();
  g.moveTo(px - tw, py); g.quadraticCurveTo(px - tw * 0.7, py - th * 0.6, px - tw * 0.62, py - th);
  g.lineTo(px + tw * 0.62, py - th);
  g.quadraticCurveTo(px + tw * 0.7, py - th * 0.6, px + tw, py);
  g.closePath(); g.fillStyle = trunkGrad; g.fill();
  g.strokeStyle = 'rgba(30,18,8,.6)'; g.lineWidth = 0.9; g.stroke();
  g.strokeStyle = 'rgba(120,84,44,.5)'; g.lineWidth = 0.8;
  for(let i = 0; i < 3; i++){
    const bx = px - tw * 0.5 + i * tw * 0.5;
    g.beginPath(); g.moveTo(bx, py - 2); g.lineTo(bx + 0.8, py - th * 0.85); g.stroke();
  }
  /* 树冠：三层 + 高光 + 缝隙 */
  g.save(); g.translate(sway, 0);
  const cy = py - th - 10 * s;
  const layers = [
    { cx: px - 9 * s, cy: cy + 5 * s, r: 12 * s },
    { cx: px + 9 * s, cy: cy + 5 * s, r: 12 * s },
    { cx: px,        cy: cy - 5 * s, r: 14 * s },
  ];
  layers.forEach(l => {
    g.beginPath(); g.arc(l.cx, l.cy + 2, l.r, 0, Math.PI * 2);
    g.fillStyle = '#16330b'; g.fill();
  });
  layers.forEach(l => {
    const grad = g.createRadialGradient(l.cx - l.r * 0.45, l.cy - l.r * 0.5, l.r * 0.1, l.cx, l.cy, l.r);
    grad.addColorStop(0, '#9aea66'); grad.addColorStop(0.55, '#4ea832'); grad.addColorStop(1, '#2a5f16');
    g.beginPath(); g.arc(l.cx, l.cy, l.r, 0, Math.PI * 2);
    g.fillStyle = grad; g.fill();
    g.strokeStyle = 'rgba(20,48,10,.55)'; g.lineWidth = 0.8; g.stroke();
  });
  /* 叶簇纹理 */
  for(let i = 0; i < 9; i++){
    const a = (i / 9) * Math.PI * 2 + seed;
    const rr = (8 + (i % 3) * 3) * s;
    g.beginPath();
    g.arc(px + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.75, 2.6 * s, 0, Math.PI * 2);
    g.fillStyle = i % 2 ? 'rgba(180,245,140,.5)' : 'rgba(30,70,14,.32)'; g.fill();
  }
  /* 果子 */
  if(seed % 4 === 0){
    g.fillStyle = '#e8503a';
    for(let i = 0; i < 3; i++){
      const a = seed + i * 2.1;
      g.beginPath(); g.arc(px + Math.cos(a) * 9 * s, cy + Math.sin(a) * 6 * s + 2, 2.1 * s, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
}

/* ---------- 石头 ---------- */
function drawRock(g, px, py, seed){
  const s = 0.9 + (seed % 2) * 0.15;
  g.beginPath(); g.ellipse(px, py + 2, 13 * s, 4.5 * s, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,.32)'; g.fill();
  /* 主体 */
  g.beginPath();
  g.moveTo(px - 11 * s, py);
  g.quadraticCurveTo(px - 13 * s, py - 8 * s, px - 5 * s, py - 11 * s);
  g.quadraticCurveTo(px + 2 * s, py - 13 * s, px + 9 * s, py - 9 * s);
  g.quadraticCurveTo(px + 13 * s, py - 5 * s, px + 11 * s, py);
  g.closePath();
  const grad = g.createLinearGradient(px - 9 * s, py - 12 * s, px + 9 * s, py);
  grad.addColorStop(0, '#c6c6d2'); grad.addColorStop(0.45, '#8e8ea4'); grad.addColorStop(1, '#4c4c62');
  g.fillStyle = grad; g.fill();
  g.strokeStyle = '#33334a'; g.lineWidth = 1.2; g.stroke();
  /* 切面：两块明暗不同的多边形，做出体积 */
  g.beginPath();
  g.moveTo(px - 8 * s, py - 2 * s); g.lineTo(px - 4 * s, py - 10 * s);
  g.lineTo(px + 2 * s, py - 11 * s); g.lineTo(px + 1 * s, py - 3 * s);
  g.closePath();
  g.fillStyle = 'rgba(255,255,255,.22)'; g.fill();
  g.beginPath();
  g.moveTo(px + 3 * s, py - 9 * s); g.lineTo(px + 9 * s, py - 8 * s);
  g.lineTo(px + 11 * s, py - 2 * s); g.lineTo(px + 3 * s, py - 3 * s);
  g.closePath();
  g.fillStyle = 'rgba(20,20,40,.22)'; g.fill();
  /* 裂纹 */
  g.strokeStyle = 'rgba(30,30,50,.5)'; g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(px - 1 * s, py - 10 * s); g.lineTo(px + 0.5 * s, py - 6 * s); g.lineTo(px - 2 * s, py - 3 * s);
  g.stroke();
  /* 高光 + 苔藓 */
  g.beginPath(); g.ellipse(px - 4 * s, py - 8 * s, 3.6 * s, 2.2 * s, -0.35, 0, Math.PI * 2);
  g.fillStyle = 'rgba(240,240,255,.55)'; g.fill();
  g.fillStyle = 'rgba(72,132,52,.5)';
  for(let i = 0; i < 3; i++){
    g.beginPath();
    g.ellipse(px + (i - 1) * 7 * s, py - 1.5 * s, 3 * s, 1.5 * s, 0.2 * (i - 1), 0, Math.PI * 2);
    g.fill();
  }
}

/* ---------- 灌木 ---------- */
function drawBush(g, px, py, seed){
  const s = 0.9 + (seed % 3) * 0.08;
  g.beginPath(); g.ellipse(px, py + 1, 13 * s, 4.5 * s, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,.26)'; g.fill();
  const blobs = [
    { cx: px - 7 * s, cy: py - 6 * s, r: 7.5 * s },
    { cx: px + 7 * s, cy: py - 6 * s, r: 7.5 * s },
    { cx: px - 3 * s, cy: py - 11 * s, r: 6.5 * s },
    { cx: px + 4 * s, cy: py - 12 * s, r: 6 * s },
    { cx: px,        cy: py - 7 * s, r: 8.5 * s },
  ];
  blobs.forEach(b => {
    g.beginPath(); g.arc(b.cx, b.cy + 1.5, b.r, 0, Math.PI * 2);
    g.fillStyle = '#16330b'; g.fill();
  });
  blobs.forEach(b => {
    const grad = g.createRadialGradient(b.cx - b.r * 0.35, b.cy - b.r * 0.4, b.r * 0.1, b.cx, b.cy, b.r);
    grad.addColorStop(0, '#86dd5e'); grad.addColorStop(0.65, '#43982c'); grad.addColorStop(1, '#255a12');
    g.beginPath(); g.arc(b.cx, b.cy, b.r, 0, Math.PI * 2);
    g.fillStyle = grad; g.fill();
    g.strokeStyle = 'rgba(18,44,8,.5)'; g.lineWidth = 0.7; g.stroke();
  });
  /* 叶片纹理 */
  for(let i = 0; i < 7; i++){
    const a = i * 1.31 + seed * 0.7;
    const rr = 7 * s;
    g.beginPath();
    g.ellipse(px + Math.cos(a) * rr, py - 8 * s + Math.sin(a) * rr * 0.6, 2.6 * s, 1.3 * s, a, 0, Math.PI * 2);
    g.fillStyle = i % 2 ? 'rgba(190,250,150,.45)' : 'rgba(24,60,10,.35)'; g.fill();
  }
  /* 浆果 */
  if(seed % 3 === 0){
    g.fillStyle = '#d2402f';
    for(let i = 0; i < 3; i++){
      g.beginPath();
      g.arc(px + (i - 1) * 6 * s, py - 9 * s - (i % 2) * 3 * s, 1.8 * s, 0, Math.PI * 2);
      g.fill();
    }
  }
}

/* ---------- 花 ---------- */
function drawFlower(g, px, py, seed){
  const colors = ['#ff7eb5', '#ffd76e', '#b48dff', '#35b8f0'];
  const c = colors[seed % colors.length];
  const s = 0.95 + (seed % 3) * 0.06;
  /* 草簇底座 */
  g.strokeStyle = 'rgba(70,140,50,.85)'; g.lineWidth = 1.3; g.lineCap = 'round';
  for(let i = -2; i <= 2; i++){
    g.beginPath(); g.moveTo(px + i * 1.6 * s, py);
    g.quadraticCurveTo(px + i * 2.6 * s, py - 4 * s, px + i * 3.4 * s, py - 7 * s);
    g.stroke();
  }
  const draw1 = (bx, by, sc) => {
    /* 茎 + 叶 */
    g.strokeStyle = '#3f8a2a'; g.lineWidth = 1.4 * sc;
    g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + 1.5 * sc, by - 6 * sc, bx, by - 11 * sc); g.stroke();
    g.fillStyle = '#5cbf3a';
    g.beginPath(); g.ellipse(bx - 2.4 * sc, by - 5 * sc, 3 * sc, 1.5 * sc, -0.5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(bx + 2.4 * sc, by - 7.5 * sc, 2.6 * sc, 1.3 * sc, 0.5, 0, Math.PI * 2); g.fill();
    /* 花瓣 */
    const fy = by - 12 * sc;
    for(let i = 0; i < 6; i++){
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const pxx = bx + Math.cos(a) * 3.1 * sc, pyy = fy + Math.sin(a) * 3.1 * sc;
      const pg = g.createRadialGradient(pxx - 1, pyy - 1, 0.2, pxx, pyy, 2.6 * sc);
      pg.addColorStop(0, '#ffffff'); pg.addColorStop(0.45, c); pg.addColorStop(1, 'rgba(0,0,0,.25)');
      g.beginPath(); g.ellipse(pxx, pyy, 2.6 * sc, 2.1 * sc, a, 0, Math.PI * 2);
      g.fillStyle = pg; g.fill();
      g.strokeStyle = 'rgba(70,40,30,.35)'; g.lineWidth = 0.5 * sc; g.stroke();
    }
    /* 花心 */
    g.beginPath(); g.arc(bx, fy, 1.7 * sc, 0, Math.PI * 2); g.fillStyle = '#ffce2e'; g.fill();
    g.strokeStyle = 'rgba(140,90,10,.6)'; g.lineWidth = 0.5 * sc; g.stroke();
  };
  draw1(px - 3 * s, py - 1, 0.92 * s);
  draw1(px + 3.6 * s, py, 1.0 * s);
}

/* ---------- 小路（地砖） ---------- */
/* ============ 铺装（路面/地砖） ============
 * 全部免费铺装、对齐格子。所有形状都在**格坐标**里画再投影（iso 线性），
 * 否则等距视角里按屏幕横竖画会变成阶梯。
 *   path    碎石小路：土基 + 一地碎石子，边界故意不齐，脚感"野"
 *   brick   红砖路：错缝砖块 + 灰浆
 *   tileX   彩色瓷砖：铺满整格，2×2 分块 + 勾缝 + 釉面高光
 *   marble  大理石：铺满整格，浅底 + 石纹脉络 + 抛光高光
 */
function paveBasis(px, py){
  const hw = (TILE_W * SCALE) / 2, hh = (TILE_H * SCALE) / 2;
  return { hw, hh, P: (dx, dy) => [px + (dx - dy) * hw, py + (dx + dy) * hh] };
}
/* 路面形状：直道一条带子；其余用中央枢纽 + 短臂；返回 { polys, inside } */
function paveShape(mask, gw, hs){
  const polys = [];
  let inside;
  if(mask === 10){
    polys.push([[-0.5, -gw], [0.5, -gw], [0.5, gw], [-0.5, gw]]);
    inside = (dx, dy) => Math.abs(dy) <= gw && Math.abs(dx) <= 0.5;
  } else if(mask === 5){
    polys.push([[-gw, -0.5], [gw, -0.5], [gw, 0.5], [-gw, 0.5]]);
    inside = (dx, dy) => Math.abs(dx) <= gw && Math.abs(dy) <= 0.5;
  } else {
    const rects = [[-hs, -hs, hs, hs]];
    if(mask & 1) rects.push([-gw, -0.5, gw, -hs * 0.6]);
    if(mask & 4) rects.push([-gw, hs * 0.6, gw, 0.5]);
    if(mask & 8) rects.push([-0.5, -gw, -hs * 0.6, gw]);
    if(mask & 2) rects.push([hs * 0.6, -gw, 0.5, gw]);
    for(const r of rects) polys.push([[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]);
    inside = (dx, dy) => rects.some(r => dx >= r[0] && dx <= r[2] && dy >= r[1] && dy <= r[3]);
  }
  return { polys, inside };
}
function pavePaint(g, P, polys, fill, stroke, lw){
  g.beginPath();
  for(const poly of polys){
    for(let i = 0; i < poly.length; i++){
      const sp = P(poly[i][0], poly[i][1]);
      if(i) g.lineTo(sp[0], sp[1]); else g.moveTo(sp[0], sp[1]);
    }
    g.closePath();
  }
  if(fill){ g.fillStyle = fill; g.fill(); }
  if(stroke){ g.strokeStyle = stroke; g.lineWidth = lw || 1; g.stroke(); }
}
/* 碎石小路 */
function drawPath(g, px, py, seed, mask){
  if(mask == null) mask = 15;
  const { hw, hh, P } = paveBasis(px, py);
  const gw = 0.36, hs = 0.44;
  const shape = paveShape(mask, gw, hs);
  const grow = p => p.map(q => [q[0] * 1.06, q[1] * 1.06]);
  g.save();
  /* ① 土基：比石子略宽一圈，颜色深一点，像被踩出来的土 */
  const dirt = g.createLinearGradient(px - hw, py - hh, px + hw, py + hh);
  dirt.addColorStop(0, '#9a7750'); dirt.addColorStop(0.5, '#85643f'); dirt.addColorStop(1, '#63492c');
  pavePaint(g, P, shape.polys.map(grow), dirt, 'rgba(70,50,28,.35)', 1);
  /* ② 碎石子：按 seed 确定性地撒，一颗颗带高光和阴影 */
  /* 土基上的碎屑，让底色不空 */
  for(let i = 0; i < 16; i++){
    const h1 = hash2((seed | 0) * 53 + i * 11, (px | 0) * 3 + i * 19);
    const h2 = hash2((px | 0) * 41 + i * 23, (seed | 0) * 89 + i * 29);
    const dx = (h1 - 0.5) * 1.0, dy = (h2 - 0.5) * 1.0;
    if(!shape.inside(dx, dy)) continue;
    const sp = P(dx, dy);
    g.fillStyle = h2 > 0.5 ? 'rgba(60,42,22,.35)' : 'rgba(180,150,110,.25)';
    g.beginPath(); g.arc(sp[0], sp[1], 0.5 + h1 * 0.7, 0, Math.PI * 2); g.fill();
  }
  const cols = ['#d8d1c0', '#c2baa8', '#a49c8b', '#e6dfcd', '#b0a48e', '#cbbb9f', '#8f8878'];
  const N = 46;
  const pts = [];
  for(let i = 0; i < N * 3 && pts.length < N; i++){
    const h1 = hash2((seed | 0) * 131 + i * 7 + 11, (px | 0) + i * 13);
    const h2 = hash2((px | 0) * 17 + i * 29, (seed | 0) * 197 + i * 31);
    const dx = (h1 - 0.5) * 1.02, dy = (h2 - 0.5) * 1.02;
    if(shape.inside(dx, dy)) pts.push([dx, dy, h1, h2]);
  }
  for(const q of pts){
    const sp = P(q[0], q[1]);
    /* 大小分明：大部分小石子，偶尔来一颗大的 */
    const big = q[2] > 0.88;
    const r = (big ? 1.7 : 0.6) + q[2] * (big ? 1.1 : 1.0);
    g.beginPath(); g.ellipse(sp[0], sp[1] + r * 0.42, r * 1.05, r * 0.6, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(48,34,18,.38)'; g.fill();
    g.beginPath(); g.ellipse(sp[0], sp[1], r, r * 0.74, 0, 0, Math.PI * 2);
    g.fillStyle = cols[(q[3] * cols.length) | 0]; g.fill();
    g.beginPath(); g.ellipse(sp[0] - r * 0.28, sp[1] - r * 0.3, r * 0.42, r * 0.3, -0.4, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,252,240,.5)'; g.fill();
  }
  /* ③ 边上再撒几颗滚出去的石子，边界就不齐了 */
  for(let i = 0; i < 7; i++){
    const h1 = hash2((seed | 0) * 311 + i * 17, (px | 0) * 7 + i * 23);
    const h2 = hash2((px | 0) * 29 + i * 37, (seed | 0) * 401 + i * 41);
    const dx = (h1 - 0.5) * 1.3, dy = (h2 - 0.5) * 1.3;
    if(shape.inside(dx * 0.86, dy * 0.86)) continue;      /* 里面的已经画过 */
    if(Math.abs(dx) > 0.56 || Math.abs(dy) > 0.56) continue;
    const sp = P(dx, dy);
    const r = 0.55 + h1 * 0.7;
    g.beginPath(); g.ellipse(sp[0], sp[1], r, r * 0.72, 0, 0, Math.PI * 2);
    g.fillStyle = cols[(h2 * cols.length) | 0]; g.globalAlpha = 0.85; g.fill(); g.globalAlpha = 1;
  }
  g.restore();
}
/* 红砖路 */
function drawBrick(g, px, py, seed, mask){
  if(mask == null) mask = 15;
  const { hw, hh, P } = paveBasis(px, py);
  const gw = 0.40, hs = 0.46;
  const shape = paveShape(mask, gw, hs);
  g.save();
  /* 灰浆底 */
  pavePaint(g, P, shape.polys, '#c2b09a', 'rgba(88,68,46,.4)', 1);
  const brick = (x0, y0, w, h, tint) => {
    const p1 = P(x0, y0), p2 = P(x0 + w, y0), p3 = P(x0 + w, y0 + h), p4 = P(x0, y0 + h);
    g.beginPath();
    g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.lineTo(p4[0], p4[1]);
    g.closePath();
    const cx = (p1[0] + p3[0]) / 2, cy = (p1[1] + p3[1]) / 2;
    const bg = g.createLinearGradient(cx - 14, cy - 9, cx + 14, cy + 9);
    bg.addColorStop(0, tint[0]); bg.addColorStop(1, tint[1]);
    g.fillStyle = bg; g.fill();
    g.strokeStyle = 'rgba(78,40,26,.45)'; g.lineWidth = 0.7; g.stroke();
    g.beginPath(); g.moveTo(p1[0] + 0.7, p1[1] + 0.5); g.lineTo(p2[0] + 0.7, p2[1] + 0.5);
    g.strokeStyle = 'rgba(255,228,206,.30)'; g.lineWidth = 0.9; g.stroke();
  };
  const tints = [['#cd6a4e', '#a8442e'], ['#c25b41', '#9a3826'], ['#d67a5c', '#b04c33']];
  /* 中央枢纽里铺 4 行错缝砖（砖 ≈ 2 倍长） */
  const rows = 4, bh = (hs * 2) / rows - 0.02, bw = 0.30;
  for(let r = 0; r < rows; r++){
    const y0 = -hs + r * (bh + 0.02) + 0.01;
    for(let k = 0; k < 4; k++){
      const x0 = -hs + k * bw + ((r % 2) ? bw * 0.5 : 0) - ((r % 2) ? bw : 0);
      const x1 = Math.min(x0 + bw - 0.015, hs);
      if(x1 <= -hs) continue;
      const cx = Math.max(x0, -hs);
      if(x1 - cx < 0.03) continue;
      brick(cx, y0, x1 - cx, bh, tints[(r + k) % 3]);
    }
  }
  /* 短臂：灰浆上补两道砖缝，别是一片死灰 */
  g.strokeStyle = 'rgba(120,92,64,.4)'; g.lineWidth = 0.8;
  for(const poly of shape.polys){
    for(let i = 1; i < 3; i++){
      const t = i / 3;
      const a = P(poly[0][0] + (poly[2][0] - poly[0][0]) * t, poly[0][1] + (poly[2][1] - poly[0][1]) * t);
      const b = P(poly[1][0] + (poly[3][0] - poly[1][0]) * t, poly[1][1] + (poly[3][1] - poly[1][1]) * t);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
  }
  g.restore();
}
/* 铺满整格的瓷砖 / 大理石 */
function drawFullPave(g, px, py, seed, type){
  const meta = DECOR_META[type] || {};
  const marble = (type === 'marble');
  const base = meta.tile || '#c9c4b8';
  const { hw, hh, P } = paveBasis(px, py);
  g.save();
  /* 勾缝底色（铺满整格，相邻同款自然连成一片） */
  pavePaint(g, P, [[[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]], marble ? '#cbc6b9' : '#b7b1a4', null);
  const n = 2;                                  /* 2×2 分块 */
  const gap = 0.022;
  for(let i = 0; i < n; i++){
    for(let j = 0; j < n; j++){
      const x0 = -0.5 + i * (1 / n) + gap, y0 = -0.5 + j * (1 / n) + gap;
      const x1 = -0.5 + (i + 1) * (1 / n) - gap, y1 = -0.5 + (j + 1) * (1 / n) - gap;
      const q1 = P(x0, y0), q2 = P(x1, y0), q3 = P(x1, y1), q4 = P(x0, y1);
      const cx = (q1[0] + q3[0]) / 2, cy = (q1[1] + q3[1]) / 2;
      const lg = g.createLinearGradient(cx - hw * 0.5, cy - hh * 0.6, cx + hw * 0.5, cy + hh * 0.6);
      /* 每块砖一点色差，铺开才不呆 */
      const v = hash2((seed | 0) * 71 + i * 13 + j * 29, (px | 0) + i * 7);
      const mix = (c, k) => c;                  /* 颜色微调用 alpha 叠 */
      lg.addColorStop(0, marble ? '#f2efe6' : base);
      lg.addColorStop(1, marble ? '#e0dbcd' : base);
      g.beginPath();
      g.moveTo(q1[0], q1[1]); g.lineTo(q2[0], q2[1]); g.lineTo(q3[0], q3[1]); g.lineTo(q4[0], q4[1]);
      g.closePath();
      g.fillStyle = lg; g.fill();
      if(v > 0.5){ g.fillStyle = 'rgba(255,255,255,.06)'; g.fill(); }
      g.strokeStyle = marble ? 'rgba(120,116,104,.35)' : 'rgba(60,54,44,.28)';
      g.lineWidth = 0.7; g.stroke();
      if(marble){
        /* 石纹脉络 */
        g.save();
        g.beginPath();
        g.moveTo(q1[0], q1[1]); g.lineTo(q2[0], q2[1]); g.lineTo(q3[0], q3[1]); g.lineTo(q4[0], q4[1]);
        g.closePath(); g.clip();
        const h1 = hash2((seed | 0) * 97 + i * 17, (px | 0) + j * 19);
        for(let v = 0; v < 2; v++){
          const hh2 = hash2((seed | 0) * 137 + i * 31 + v * 7, (px | 0) + j * 23 + v * 11);
          g.strokeStyle = v ? 'rgba(120,112,96,.40)' : 'rgba(96,90,74,.52)';
          g.lineWidth = v ? 0.7 : 1.15;
          g.beginPath();
          g.moveTo(q1[0] - 3, q1[1] + (q3[1] - q1[1]) * (0.12 + hh2 * 0.5));
          g.bezierCurveTo(cx - 8 + v * 6, cy - 7 + hh2 * 12, cx + 7 - v * 5, cy + 5 - hh2 * 9,
                          q2[0] + 3, q2[1] + (q3[1] - q1[1]) * (0.35 + hh2 * 0.4));
          g.stroke();
        }
        g.restore();
      }
    }
  }
  /* 釉面/抛光高光：左上到右下一条亮带 */
  g.save();
  pavePaint(g, P, [[[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]], null, null);
  g.clip();
  const gl = g.createLinearGradient(px - hw, py - hh, px + hw * 0.4, py + hh);
  gl.addColorStop(0, marble ? 'rgba(255,255,255,.42)' : 'rgba(255,255,255,.30)');
  gl.addColorStop(0.45, 'rgba(255,255,255,.06)');
  gl.addColorStop(1, 'rgba(0,0,0,.10)');
  g.fillStyle = gl;
  g.fillRect(px - hw, py - hh, hw * 2, hh * 2);
  g.restore();
  g.restore();
}
function drawPond(g, px, py, seed){
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  /* 湿边 */
  g.beginPath(); g.ellipse(px, py + 1, 30, 15.5, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(40,60,40,.35)'; g.fill();
  /* 水体 */
  g.beginPath(); g.ellipse(px, py, 26, 13, 0, 0, Math.PI * 2);
  const grad = g.createRadialGradient(px - 7, py - 5, 2, px, py, 28);
  grad.addColorStop(0, '#8fe0ff'); grad.addColorStop(0.45, '#3fa3dc'); grad.addColorStop(1, '#17527d');
  g.fillStyle = grad; g.fill();
  g.strokeStyle = 'rgba(18,54,72,.6)'; g.lineWidth = 1.4; g.stroke();
  /* 反光条 */
  g.save();
  g.beginPath(); g.ellipse(px, py, 26, 13, 0, 0, Math.PI * 2); g.clip();
  g.fillStyle = 'rgba(255,255,255,.22)';
  g.fillRect(px - 20, py - 6, 9, 3.2);
  g.fillRect(px - 6, py - 1, 12, 2.4);
  g.restore();
  /* 涟漪 */
  for(let i = 0; i < 3; i++){
    const t = ((now / 1600) + i * 0.33 + seed * 0.1) % 1;
    g.beginPath();
    g.ellipse(px, py, 3 + t * 19, 1.5 + t * 9.5, 0, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(255,255,255,' + (0.45 * (1 - t)).toFixed(3) + ')';
    g.lineWidth = 1.1; g.stroke();
  }
  /* 岸边芦苇 + 荷叶 */
  g.strokeStyle = '#3f8a2a'; g.lineWidth = 1.3; g.lineCap = 'round';
  for(let i = 0; i < 5; i++){
    const a = Math.PI * (0.1 + i * 0.2);
    const bx = px + Math.cos(a) * 25, by = py + Math.sin(a) * 12.5;
    g.beginPath(); g.moveTo(bx, by);
    g.quadraticCurveTo(bx + 1, by - 6, bx + (i % 2 ? 3 : -3), by - 11);
    g.stroke();
  }
  g.fillStyle = 'rgba(70,150,60,.85)';
  for(const p of [[-8, 2, 5.5], [7, 4, 4]]){
    g.beginPath(); g.ellipse(px + p[0], py + p[1], p[2], p[2] * 0.5, 0, 0, Math.PI * 2); g.fill();
  }
}

/* 被敲击时显示剩余次数的小圆点 */
/* ---------- 蘑菇 ---------- */
function drawMushroom(g, px, py, seed){
  const s = 0.9 + (seed % 3) * 0.08;
  g.beginPath(); g.ellipse(px, py + 1.5, 11 * s, 4 * s, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,.28)'; g.fill();
  const spec = [[-5, 0, 1], [4, 1, 0.8], [0, 3, 0.62]];
  for(let i = 0; i < spec.length; i++){
    const dx = spec[i][0] * s, dy = spec[i][1] * s, k = spec[i][2] * s;
    /* 柄 */
    g.beginPath();
    g.moveTo(px + dx - 2.1 * k, py + dy);
    g.quadraticCurveTo(px + dx - 1.5 * k, py + dy - 5 * k, px + dx - 1.7 * k, py + dy - 7 * k);
    g.lineTo(px + dx + 1.7 * k, py + dy - 7 * k);
    g.quadraticCurveTo(px + dx + 1.5 * k, py + dy - 5 * k, px + dx + 2.1 * k, py + dy);
    g.closePath();
    g.fillStyle = '#efe3c8'; g.fill();
    g.strokeStyle = 'rgba(120,100,70,.5)'; g.lineWidth = .7; g.stroke();
    /* 伞盖 */
    g.beginPath();
    g.moveTo(px + dx - 6.4 * k, py + dy - 6.6 * k);
    g.quadraticCurveTo(px + dx, py + dy - 14.5 * k, px + dx + 6.4 * k, py + dy - 6.6 * k);
    g.quadraticCurveTo(px + dx, py + dy - 4.6 * k, px + dx - 6.4 * k, py + dy - 6.6 * k);
    g.closePath();
    const cg = g.createLinearGradient(px + dx - 6 * k, py + dy - 13 * k, px + dx + 6 * k, py + dy - 5 * k);
    cg.addColorStop(0, i === 1 ? '#e8663c' : '#d9503a'); cg.addColorStop(1, '#a02a22');
    g.fillStyle = cg; g.fill();
    g.fillStyle = 'rgba(255,245,220,.85)';
    for(const sp of [[-3, -9.4, 1.5], [1.6, -10.6, 1.2], [4, -8.2, 1.1]]){
      g.beginPath(); g.arc(px + dx + sp[0] * k, py + dy + sp[1] * k, sp[2] * k, 0, Math.PI * 2); g.fill();
    }
  }
}
/* ---------- 向日葵 ---------- */
function drawSunflower(g, px, py, seed){
  const s = 0.92 + (seed % 3) * 0.06;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const sway = Math.sin(now / 1500 + seed) * 1.6 * s;
  g.beginPath(); g.ellipse(px, py + 1.5, 9 * s, 3.6 * s, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,.26)'; g.fill();
  /* 茎 */
  g.strokeStyle = '#4f8f2c'; g.lineWidth = 2.4 * s; g.lineCap = 'round';
  g.beginPath(); g.moveTo(px, py);
  g.quadraticCurveTo(px + sway * .5, py - 12 * s, px + sway, py - 22 * s); g.stroke();
  /* 叶 */
  for(const sd of [-1, 1]){
    g.beginPath();
    g.moveTo(px + sway * .3, py - 9 * s);
    g.quadraticCurveTo(px + sd * 8 * s, py - 13 * s, px + sd * 10 * s, py - 7 * s);
    g.quadraticCurveTo(px + sd * 5 * s, py - 6 * s, px + sway * .3, py - 9 * s);
    g.closePath(); g.fillStyle = '#3f7a24'; g.fill();
  }
  /* 花盘 */
  const cx = px + sway, cy = py - 23 * s, r = 6.4 * s;
  for(let i = 0; i < 12; i++){
    const a = i / 12 * Math.PI * 2;
    g.beginPath();
    g.ellipse(cx + Math.cos(a) * r * 1.25, cy + Math.sin(a) * r * 1.25, r * .62, r * .34, a, 0, Math.PI * 2);
    g.fillStyle = i % 2 ? '#ffd23c' : '#ffb52a'; g.fill();
  }
  const hg = g.createRadialGradient(cx - 1.5, cy - 1.5, 1, cx, cy, r);
  hg.addColorStop(0, '#8a5a20'); hg.addColorStop(1, '#5a3610');
  g.beginPath(); g.arc(cx, cy, r * .82, 0, Math.PI * 2); g.fillStyle = hg; g.fill();
  g.fillStyle = 'rgba(255,235,150,.5)';
  for(let i = 0; i < 6; i++){
    const a = i / 6 * Math.PI * 2;
    g.beginPath(); g.arc(cx + Math.cos(a) * r * .4, cy + Math.sin(a) * r * .4, .9 * s, 0, Math.PI * 2); g.fill();
  }
}
/* ---------- 木栅栏 ---------- */
function drawFence(g, px, py, seed, mask){
  /* 木栅栏：中央一根立柱，朝每个「连上的方向」拉两道横栏（8 向都支持）。
     形状同样在格坐标里算再投影，跟铺装同一套线性变换。 */
  if(mask == null) mask = 15;
  const hw = (TILE_W * SCALE) / 2, hh = (TILE_H * SCALE) / 2;
  const P = (dx, dy) => [px + (dx - dy) * hw, py + (dx + dy) * hh];
  const dirs = (typeof connDirs === 'function' ? connDirs('fence') : PATH_SIDES);
  g.save();
  /* 影子 */
  g.beginPath(); g.ellipse(px, py + 1.5, 13, 4.6, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,.26)'; g.fill();
  /* 横栏（两根）：从立柱拉到邻居方向的一半格处，正好跟隔壁那根接上 */
  const rail = (dx, dy) => {
    const a = P(0, 0), b = P(dx * 0.5, dy * 0.5);
    for(const hy of [-11, -6]){
      g.strokeStyle = 'rgba(70,45,18,.5)'; g.lineWidth = 4.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(a[0], a[1] + hy); g.lineTo(b[0], b[1] + hy); g.stroke();
      g.strokeStyle = '#b98a4e'; g.lineWidth = 3.2;
      g.beginPath(); g.moveTo(a[0], a[1] + hy); g.lineTo(b[0], b[1] + hy); g.stroke();
      g.strokeStyle = 'rgba(255,238,205,.35)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(a[0], a[1] + hy - 0.9); g.lineTo(b[0], b[1] + hy - 0.9); g.stroke();
    }
  };
  for(const sd of dirs) if(mask & sd.bit) rail(sd.dx, sd.dy);
  /* 立柱 */
  const h = 16 + (seed % 2) * 1.5;
  const wg = g.createLinearGradient(px - 3, py - h, px + 3, py);
  wg.addColorStop(0, '#d3a669'); wg.addColorStop(0.5, '#ab7c44'); wg.addColorStop(1, '#6f4a22');
  g.fillStyle = wg;
  g.beginPath();
  g.moveTo(px - 2.8, py);
  g.lineTo(px - 2.8, py - (h - 3));
  g.lineTo(px, py - h);
  g.lineTo(px + 2.8, py - (h - 3));
  g.lineTo(px + 2.8, py);
  g.closePath(); g.fill();
  g.strokeStyle = 'rgba(60,38,14,.55)'; g.lineWidth = 0.8; g.stroke();
  g.strokeStyle = 'rgba(255,240,210,.28)'; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(px - 1.4, py - 2); g.lineTo(px - 1.4, py - h + 3.4); g.stroke();
  g.restore();
}
/* ---------- 竹子 ---------- */
function drawBamboo(g, px, py, seed){
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const sway = Math.sin(now / 1600 + seed) * 2.2;
  g.beginPath(); g.ellipse(px, py + 1.5, 10, 4, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,.26)'; g.fill();
  const stalks = [[-6, 26], [0, 32], [6, 24]];
  for(let i = 0; i < stalks.length; i++){
    const dx = stalks[i][0], h = stalks[i][1], bend = sway * (0.5 + i * .18);
    const top = { x: px + dx + bend, y: py - h };
    g.strokeStyle = i === 1 ? '#5fae37' : '#4d9430';
    g.lineWidth = 3.1; g.lineCap = 'round';
    g.beginPath(); g.moveTo(px + dx, py);
    g.quadraticCurveTo(px + dx + bend * .4, py - h * .55, top.x, top.y); g.stroke();
    /* 竹节 */
    g.strokeStyle = 'rgba(30,70,15,.55)'; g.lineWidth = 1.1;
    for(let k = 1; k <= 5; k++){
      const t = k / 6;
      const bx = px + dx + bend * t * t, by = py - h * t;
      g.beginPath(); g.moveTo(bx - 2.1, by); g.lineTo(bx + 2.1, by); g.stroke();
    }
    /* 竹叶 */
    g.fillStyle = i === 1 ? '#6cc23f' : '#57a834';
    for(const lf of [[-1, -4, -.5], [1, -7, .5], [-1, -12, -.35]]){
      const bx = px + dx + bend, by = top.y + 6 + lf[1] * .5;
      g.save(); g.translate(bx, by); g.rotate(lf[2] + sway * .02);
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(lf[0] * 7, -3.2, lf[0] * 12, -1.2);
      g.quadraticCurveTo(lf[0] * 6, 1.2, 0, 0);
      g.closePath(); g.fill();
      g.restore();
    }
  }
}
/* ---------- 松树 ---------- */
function drawPine(g, px, py, seed){
  const s = 0.9 + (seed % 2) * 0.1;
  g.beginPath(); g.ellipse(px, py + 2, 13 * s, 5 * s, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,.3)'; g.fill();
  const tg = g.createLinearGradient(px - 3, py, px + 3, py);
  tg.addColorStop(0, '#6b4620'); tg.addColorStop(1, '#3a2410');
  g.fillStyle = tg;
  g.fillRect(px - 2.6 * s, py - 9 * s, 5.2 * s, 9 * s);
  for(let i = 0; i < 3; i++){
    const y = py - 8 * s - i * 8 * s;
    const w = (17 - i * 3.6) * s, h = 12 * s;
    const fg = g.createLinearGradient(px - w, y - h, px + w, y);
    fg.addColorStop(0, i === 0 ? '#1f5a2c' : '#24663a');
    fg.addColorStop(1, '#123d1f');
    g.beginPath();
    g.moveTo(px, y - h);
    g.lineTo(px + w, y);
    g.quadraticCurveTo(px, y - 2.2 * s, px - w, y);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(10,35,15,.5)'; g.lineWidth = .8; g.stroke();
  }
}
/* ---------- 石灯笼 ---------- */
function drawLantern(g, px, py, seed){
  g.beginPath(); g.ellipse(px, py + 1.5, 10, 4, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,.3)'; g.fill();
  const sg = g.createLinearGradient(px - 7, py - 20, px + 7, py);
  sg.addColorStop(0, '#b9bcc4'); sg.addColorStop(.5, '#8e929c'); sg.addColorStop(1, '#5f636c');
  /* 底座 */
  g.fillStyle = sg;
  g.beginPath(); g.moveTo(px - 8, py); g.lineTo(px + 8, py); g.lineTo(px + 6, py - 5); g.lineTo(px - 6, py - 5); g.closePath(); g.fill();
  /* 柱 */
  g.fillRect(px - 2.4, py - 13, 4.8, 8.4);
  /* 灯室 */
  const lit = ATMOS && (ATMOS.hour >= 18.5 || ATMOS.hour < 5.5);
  g.fillStyle = lit ? 'rgba(255,214,120,.92)' : 'rgba(226,220,200,.5)';
  g.beginPath(); g.moveTo(px - 6, py - 13); g.lineTo(px + 6, py - 13); g.lineTo(px + 5, py - 21); g.lineTo(px - 5, py - 21); g.closePath(); g.fill();
  if(lit){
    g.save();
    const gl = g.createRadialGradient(px, py - 17, 1, px, py - 17, 16);
    gl.addColorStop(0, 'rgba(255,206,110,.55)'); gl.addColorStop(1, 'rgba(255,206,110,0)');
    g.fillStyle = gl; g.beginPath(); g.arc(px, py - 17, 16, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  g.strokeStyle = '#5a5e66'; g.lineWidth = 1; g.stroke();
  /* 顶盖 */
  g.fillStyle = sg;
  g.beginPath(); g.moveTo(px - 9, py - 21); g.lineTo(px + 9, py - 21); g.lineTo(px, py - 26); g.closePath(); g.fill();
  g.beginPath(); g.arc(px, py - 27, 1.8, 0, Math.PI * 2); g.fill();
}
/* ---------- 水井 ---------- */
function drawWell(g, px, py, seed){
  g.beginPath(); g.ellipse(px, py + 2, 15, 6, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,.3)'; g.fill();
  /* 石圈 */
  const rg = g.createLinearGradient(px - 13, py - 8, px + 13, py + 2);
  rg.addColorStop(0, '#a8aab2'); rg.addColorStop(.55, '#82858f'); rg.addColorStop(1, '#585c66');
  g.fillStyle = rg;
  g.beginPath(); g.ellipse(px, py - 1, 13, 7.5, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2a2f38';
  g.beginPath(); g.ellipse(px, py - 1.6, 9.4, 5, 0, 0, Math.PI * 2); g.fill();
  const wg = g.createLinearGradient(px, py - 6, px, py + 2);
  wg.addColorStop(0, '#2f6ea8'); wg.addColorStop(1, '#123a5f');
  g.fillStyle = wg;
  g.beginPath(); g.ellipse(px, py - 0.4, 8.6, 4.4, 0, 0, Math.PI * 2); g.fill();
  /* 立柱 + 顶棚 */
  g.fillStyle = '#8a5f30';
  g.fillRect(px - 11, py - 22, 3, 14); g.fillRect(px + 8, py - 22, 3, 14);
  g.beginPath();
  g.moveTo(px - 15, py - 21); g.lineTo(px + 15, py - 21);
  g.lineTo(px + 10, py - 30); g.lineTo(px - 10, py - 30); g.closePath();
  g.fillStyle = '#b4482f'; g.fill();
  g.strokeStyle = 'rgba(60,20,10,.5)'; g.lineWidth = .8; g.stroke();
  /* 吊桶 */
  g.strokeStyle = 'rgba(230,220,190,.7)'; g.lineWidth = .9;
  g.beginPath(); g.moveTo(px, py - 21); g.lineTo(px, py - 10); g.stroke();
  g.fillStyle = '#6b4620';
  g.beginPath(); g.moveTo(px - 3.2, py - 10); g.lineTo(px + 3.2, py - 10); g.lineTo(px + 2.4, py - 6); g.lineTo(px - 2.4, py - 6); g.closePath(); g.fill();
}
/* ---------- 石像 ---------- */
function drawStatue(g, px, py, seed){
  g.beginPath(); g.ellipse(px, py + 2, 12, 4.6, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,.32)'; g.fill();
  const sg = g.createLinearGradient(px - 8, py - 30, px + 8, py);
  sg.addColorStop(0, '#c3c6cd'); sg.addColorStop(.45, '#9a9ea8'); sg.addColorStop(1, '#5c606a');
  /* 台座 */
  g.fillStyle = sg;
  g.beginPath(); g.moveTo(px - 9, py); g.lineTo(px + 9, py); g.lineTo(px + 7, py - 5); g.lineTo(px - 7, py - 5); g.closePath(); g.fill();
  /* 身体 */
  g.beginPath();
  g.moveTo(px - 6, py - 5); g.lineTo(px - 5.4, py - 20);
  g.quadraticCurveTo(px, py - 23, px + 5.4, py - 20);
  g.lineTo(px + 6, py - 5); g.closePath(); g.fill();
  /* 头 */
  g.beginPath(); g.ellipse(px, py - 24, 4.6, 5.4, 0, 0, Math.PI * 2); g.fill();
  /* 五官（简） */
  g.fillStyle = 'rgba(40,44,52,.55)';
  g.beginPath(); g.ellipse(px - 1.8, py - 25.4, .9, 1.2, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(px + 1.8, py - 25.4, .9, 1.2, 0, 0, Math.PI * 2); g.fill();
  g.fillRect(px - 2.2, py - 21.6, 4.4, 1);
  /* 手臂 */
  g.strokeStyle = '#8b8f99'; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(px - 5.6, py - 17); g.lineTo(px - 8.6, py - 10); g.stroke();
  g.beginPath(); g.moveTo(px + 5.6, py - 17); g.lineTo(px + 8.6, py - 10); g.stroke();
  g.strokeStyle = 'rgba(30,34,42,.35)'; g.lineWidth = .8;
  g.beginPath(); g.moveTo(px, py - 20); g.lineTo(px, py - 7); g.stroke();   /* 衣褶 */
}

/* ---------- 木椅 ---------- */
function drawChair(g, px, py, seed){
  const s = 1;
  const wob = ((seed % 3) - 1) * 0.06;
  g.save(); g.translate(px, py); g.rotate(wob);
  g.beginPath(); g.ellipse(0, 1.5, 11, 4.4, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,.28)'; g.fill();
  const wood = g.createLinearGradient(-10, -14, 10, 4);
  wood.addColorStop(0, '#c99a5e'); wood.addColorStop(0.55, '#a97a42'); wood.addColorStop(1, '#7a5228');
  /* 后腿 + 靠背立柱 */
  g.fillStyle = '#8a6234';
  g.fillRect(-8, -20, 2.6, 20); g.fillRect(5.4, -20, 2.6, 20);
  /* 靠背横档 */
  g.fillStyle = wood;
  g.fillRect(-8.6, -19, 17.2, 4);
  g.fillRect(-8.6, -13, 17.2, 3.2);
  /* 坐面（等距菱形） */
  g.beginPath();
  g.moveTo(0, -6); g.lineTo(11, -1); g.lineTo(0, 4); g.lineTo(-11, -1); g.closePath();
  g.fillStyle = wood; g.fill();
  g.strokeStyle = 'rgba(70,45,18,.55)'; g.lineWidth = 1; g.stroke();
  /* 前腿 */
  g.fillStyle = '#8a6234';
  g.fillRect(-9.4, -1, 2.4, 8); g.fillRect(7, -1, 2.4, 8);
  g.strokeStyle = 'rgba(255,240,210,.25)'; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(-9, -19.5); g.lineTo(8, -19.5); g.stroke();
  g.restore();
}
/* ---------- 木桌 ---------- */
function drawTable(g, px, py, seed){
  g.beginPath(); g.ellipse(px, py + 2, 16, 6, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,.3)'; g.fill();
  const wood = g.createLinearGradient(px - 15, py - 12, px + 15, py + 2);
  wood.addColorStop(0, '#d3a768'); wood.addColorStop(0.55, '#b3813f'); wood.addColorStop(1, '#7f5a2a');
  /* 桌腿 */
  g.fillStyle = '#7f5a2a';
  for(const d of [[-11, -2], [11, -2], [-11, 6], [11, 6]]){
    g.save(); g.translate(px + d[0], py + d[1]);
    g.beginPath(); g.rect(-1.4, 0, 2.8, 7); g.fill();
    g.restore();
  }
  /* 桌面：等距菱形 + 厚度 */
  g.beginPath();
  g.moveTo(px, py - 12); g.lineTo(px + 17, py - 3); g.lineTo(px, py + 6); g.lineTo(px - 17, py - 3); g.closePath();
  g.fillStyle = wood; g.fill();
  g.strokeStyle = 'rgba(70,45,18,.55)'; g.lineWidth = 1; g.stroke();
  g.beginPath();
  g.moveTo(px - 17, py - 3); g.lineTo(px, py + 6); g.lineTo(px, py + 9); g.lineTo(px - 17, py); g.closePath();
  g.fillStyle = '#6d4a20'; g.fill();
  /* 木纹 */
  g.strokeStyle = 'rgba(120,80,35,.35)'; g.lineWidth = 0.8;
  for(let i = 1; i <= 2; i++){
    g.beginPath();
    g.moveTo(px - 12 + i * 3, py - 5 + i * 1.2);
    g.lineTo(px + 3 + i * 3, py + 1 + i * 1.2);
    g.stroke();
  }
  /* 桌上摆件：一个盘子 + 杯子（按 seed 有时有） */
  if(seed % 2 === 0){
    g.beginPath(); g.ellipse(px + 4, py - 3, 5, 2.2, 0, 0, Math.PI * 2);
    g.fillStyle = '#f2ead6'; g.fill();
    g.strokeStyle = 'rgba(120,100,70,.5)'; g.lineWidth = 0.7; g.stroke();
    g.beginPath(); g.ellipse(px + 4, py - 3.6, 3, 1.2, 0, 0, Math.PI * 2);
    g.fillStyle = '#e0d3b4'; g.fill();
  }
  g.beginPath(); g.rect(px - 10, py - 8, 3, 3.4); g.fillStyle = '#8fb7d6'; g.fill();
}
/* ---------- 长椅 ---------- */
function drawBench(g, px, py, seed){
  g.beginPath(); g.ellipse(px, py + 2, 18, 5.6, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,.28)'; g.fill();
  const wood = g.createLinearGradient(px - 16, py - 14, px + 16, py + 2);
  wood.addColorStop(0, '#c79b60'); wood.addColorStop(0.55, '#a67a41'); wood.addColorStop(1, '#77522a');
  /* 靠背 */
  g.fillStyle = '#8a6234';
  g.fillRect(px - 15, py - 18, 2.6, 16); g.fillRect(px + 12.4, py - 18, 2.6, 16);
  g.fillStyle = wood;
  g.fillRect(px - 15.6, py - 17, 31.2, 3.4);
  g.fillRect(px - 15.6, py - 12, 31.2, 3.0);
  /* 坐面（等距宽菱形） */
  g.beginPath();
  g.moveTo(px - 8, py - 6); g.lineTo(px + 18, py + 3); g.lineTo(px + 8, py + 7); g.lineTo(px - 18, py - 2); g.closePath();
  g.fillStyle = wood; g.fill();
  g.strokeStyle = 'rgba(70,45,18,.5)'; g.lineWidth = 1; g.stroke();
  /* 腿 */
  g.fillStyle = '#6d4a20';
  g.fillRect(px - 16, py - 1, 2.6, 8);
  g.fillRect(px + 13.4, py + 4, 2.6, 8);
}
/* ---------- 盆栽 ---------- */
function drawPlant(g, px, py, seed){
  g.beginPath(); g.ellipse(px, py + 1.5, 9, 3.6, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,.28)'; g.fill();
  /* 花盆 */
  const pot = g.createLinearGradient(px - 8, py - 10, px + 8, py);
  pot.addColorStop(0, '#d98a5a'); pot.addColorStop(0.6, '#b96b3f'); pot.addColorStop(1, '#8a4a26');
  g.fillStyle = pot;
  g.beginPath();
  g.moveTo(px - 8, py - 9); g.lineTo(px + 8, py - 9); g.lineTo(px + 5.6, py); g.lineTo(px - 5.6, py);
  g.closePath(); g.fill();
  g.strokeStyle = 'rgba(80,40,18,.5)'; g.lineWidth = 0.9; g.stroke();
  g.fillStyle = '#a95c33';
  g.beginPath(); g.moveTo(px - 9, py - 9); g.lineTo(px + 9, py - 9); g.lineTo(px + 8, py - 11.6); g.lineTo(px - 8, py - 11.6); g.closePath(); g.fill();
  /* 叶子：一丛 */
  const sway = Math.sin((typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1700 + seed) * 0.9;
  g.save(); g.translate(px, py - 11.5);
  for(const lf of [[-6, -7, -0.7], [6, -7, 0.7], [0, -12, 0.05], [-2.5, -5, -0.3], [3, -5, 0.35]]){
    g.save(); g.translate(lf[0] + sway * 0.5, lf[1] * 0.5); g.rotate(lf[2] + sway * 0.02);
    const lg = g.createLinearGradient(0, -9, 0, 2);
    lg.addColorStop(0, '#6cc23f'); lg.addColorStop(1, '#2f6a22');
    g.beginPath();
    g.moveTo(0, 2);
    g.quadraticCurveTo(-5.2, -4, 0, -9.5);
    g.quadraticCurveTo(5.2, -4, 0, 2);
    g.closePath(); g.fillStyle = lg; g.fill();
    g.strokeStyle = 'rgba(20,50,15,.4)'; g.lineWidth = 0.6; g.stroke();
    g.restore();
  }
  g.restore();
}

function drawDecorHp(g, px, py, d){
  if(typeof decorMaxHp !== 'function') return;
  const max = decorMaxHp(d.type);
  const hp = (typeof d.hp === 'number') ? d.hp : max;
  if(hp >= max || hp <= 0) return;
  const w = max * 7, y = py - 30;
  g.save();
  for(let i = 0; i < max; i++){
    g.beginPath();
    g.arc(px - w / 2 + 3.5 + i * 7, y, 2.6, 0, Math.PI * 2);
    g.fillStyle = i < hp ? '#ffd76e' : 'rgba(0,0,0,.35)';
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 0.8; g.stroke();
  }
  g.restore();
}
function drawDecoration(g, px, py, d){
  /* 自动生成的装饰带随机偏移，不落在格子正中 */
  px += (typeof d.ox === 'number') ? d.ox : 0;
  py += (typeof d.oy === 'number') ? d.oy : 0;
  const windy = (d.type === 'tree' || d.type === 'bush' || d.type === 'flower' ||
                 d.type === 'sunflower' || d.type === 'bamboo' || d.type === 'pine');
  const sway = windy ? (ATMOS.windSway - 0.5) * 3.2 : 0;
  /* 刚被敲过 → 抖一下 */
  const shaking = d.shakeUntil && Date.now() < d.shakeUntil;
  g.save();
  g.translate((sway || 0) + (shaking ? (Math.random() - 0.5) * 3.2 : 0), shaking ? (Math.random() - 0.5) * 1.6 : 0);
  if(d.type === 'tree') drawTree(g, px, py, d.seed);
  else if(d.type === 'rock') drawRock(g, px, py, d.seed);
  else if(d.type === 'bush') drawBush(g, px, py, d.seed);
  else if(d.type === 'flower') drawFlower(g, px, py, d.seed);
  else if(d.type === 'pond') drawPond(g, px, py, d.seed);
  else if(d.type === 'path') drawPath(g, px, py, d.seed, pathConnMask(d));
  else if(d.type === 'brick') drawBrick(g, px, py, d.seed, pathConnMask(d));
  else if(d.type && DECOR_META[d.type] && DECOR_META[d.type].full) drawFullPave(g, px, py, d.seed, d.type);
  else if(d.type === 'mushroom') drawMushroom(g, px, py, d.seed);
  else if(d.type === 'sunflower') drawSunflower(g, px, py, d.seed);
  else if(d.type === 'fence') drawFence(g, px, py, d.seed, fenceConnMask(d));
  else if(d.type === 'bamboo') drawBamboo(g, px, py, d.seed);
  else if(d.type === 'pine') drawPine(g, px, py, d.seed);
  else if(d.type === 'lantern') drawLantern(g, px, py, d.seed);
  else if(d.type === 'well') drawWell(g, px, py, d.seed);
  else if(d.type === 'statue') drawStatue(g, px, py, d.seed);
  else if(d.type === 'chair') drawChair(g, px, py, d.seed);
  else if(d.type === 'table') drawTable(g, px, py, d.seed);
  else if(d.type === 'bench') drawBench(g, px, py, d.seed);
  else if(d.type === 'plant') drawPlant(g, px, py, d.seed);
  g.restore();
  drawDecorHp(g, px, py, d);
}

/* ============ 小人绘制 ============ */
