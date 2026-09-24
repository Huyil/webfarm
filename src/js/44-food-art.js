/* 44-food-art — 食材 / 加工品 / 菜品绘制库（拖拽厨房与田间共用）
 *
 * 对外接口（签名固定，其它模块会调用）：
 *   drawVeggieField(g, cropId, x, y, ratio)  田间作物：wheat|chili|eggplant|tomato
 *   drawItemIcon(g, key, cx, cy, size)       UI 图标：crop:<id> / piece:<id> / prep:<id> / dish:<dishKey>
 *   veggiePalette(cropId)                    单色板 { body, leaf }
 *
 * 全部是纯绘制函数：不碰 DOM、不读键盘，可安全地在离屏 canvas 上预渲染。
 * 命名统一 k 前缀，避免与其它模块的全局名冲突。
 */

/* ---------- 色板（内部含高光/暗部，veggiePalette 只暴露 body/leaf） ---------- */
const K_VEGGIE_PALETTE = {
  carrot:  { body:'#e87828', body2:'#ffb066', dark:'#a83810', leaf:'#4ea832' },
  potato:  { body:'#c8963c', body2:'#e8c070', dark:'#8a5a20', leaf:'#4ea832' },
  rice:    { body:'#e8d68a', body2:'#fff0a8', dark:'#b08a30', leaf:'#4ea832' },
  wheat:   { body:'#e0c060', body2:'#ffe9a0', dark:'#a8822c', leaf:'#8aa832' },
  chili:   { body:'#d63a2a', body2:'#ff8a6a', dark:'#8a1c14', leaf:'#3f8a2a' },
  eggplant:{ body:'#8a5bc0', body2:'#c39bff', dark:'#4a2a78', leaf:'#4a8a34' },
  tomato:  { body:'#e04a2a', body2:'#ff8a5a', dark:'#9a2410', leaf:'#3f8a2a' },
  cabbage: { body:'#a8d86a', body2:'#e6f6bc', dark:'#4a7a24', leaf:'#6aa832' },
  corn:    { body:'#f0d060', body2:'#fff2b0', dark:'#a87818', leaf:'#54a034' },
  pumpkin: { body:'#e08030', body2:'#ffbb68', dark:'#96440f', leaf:'#3f8a2a' },
  strawberry:{ body:'#e8405a', body2:'#ff97a8', dark:'#9c1430', leaf:'#3f8a2a' },
};
const K_VEGGIE_FALLBACK = { body:'#8fbf6a', body2:'#c8e8a0', dark:'#4a7a30', leaf:'#4ea832' };

function veggiePalette(cropId){
  const p = K_VEGGIE_PALETTE[cropId] || K_VEGGIE_FALLBACK;
  return { body:p.body, leaf:p.leaf };
}

/* ============================================================
 * 一、通用画笔
 * ============================================================ */

/* 茎：两遍描边做出体积感 */
function kStem(g, x0, y0, x1, y1, w, dark, light){
  g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0, y0);
  g.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2, x1, y1);
  g.lineWidth = w; g.strokeStyle = dark; g.stroke();
  g.lineWidth = Math.max(0.7, w * 0.55); g.strokeStyle = light; g.stroke();
}
/* 叶片：从 (x,y) 沿 ang 方向长出，len 长 wid 半宽 */
function kLeafBlade(g, x, y, len, wid, ang, fill, dark, vein){
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath(); g.moveTo(0, 0);
  g.quadraticCurveTo(len * 0.45, -wid, len, 0);
  g.quadraticCurveTo(len * 0.45, wid, 0, 0);
  g.closePath();
  if(dark){ g.lineWidth = Math.max(0.6, wid * 0.4); g.strokeStyle = dark; g.stroke(); }
  g.fillStyle = fill; g.fill();
  if(vein){
    g.beginPath(); g.moveTo(len * 0.12, 0); g.lineTo(len * 0.82, 0);
    g.lineWidth = Math.max(0.4, wid * 0.22); g.strokeStyle = vein; g.stroke();
  }
  g.restore();
}
/* 果萼：小星形绿萼 + 短柄（西红柿 / 茄子 / 辣椒共用） */
function kCalyx(g, x, y, r, leaf, dark){
  g.save(); g.translate(x, y);
  g.strokeStyle = dark; g.lineWidth = Math.max(0.5, r * 0.24);
  g.beginPath(); g.moveTo(0, -r * 0.9); g.lineTo(0, 0); g.stroke();
  g.fillStyle = leaf;
  for(let i = 0; i < 5; i++){
    const a = (i - 2) * 0.62;
    g.save(); g.rotate(a);
    g.beginPath(); g.moveTo(0, 0);
    g.quadraticCurveTo(r * 0.7, -r * 0.42, r * 1.5, -r * 0.05);
    g.quadraticCurveTo(r * 0.7, r * 0.3, 0, 0);
    g.closePath(); g.fill();
    g.restore();
  }
  g.restore();
}
/* 辣椒：从 (x,y) 向下垂的锥形果 */
function kChiliPod(g, x, y, s, len, ang, pal){
  g.save(); g.translate(x, y); g.rotate(ang);
  const w = Math.max(1.4, 2.3 * s) * (0.7 + len / (16 * s));
  g.beginPath(); g.moveTo(0, 0);
  g.quadraticCurveTo(-w, len * 0.45, -w * 0.34, len * 0.92);
  g.quadraticCurveTo(0, len * 1.1, w * 0.34, len * 0.92);
  g.quadraticCurveTo(w, len * 0.45, 0, 0);
  g.closePath();
  const grd = g.createLinearGradient(-w, 0, w, len);
  grd.addColorStop(0, pal.body2); grd.addColorStop(0.5, pal.body); grd.addColorStop(1, pal.dark);
  g.fillStyle = grd; g.fill();
  g.lineWidth = Math.max(0.4, 0.5 * s); g.strokeStyle = pal.dark; g.stroke();
  g.beginPath(); g.ellipse(-w * 0.3, len * 0.32, w * 0.16, len * 0.22, -0.25, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,.4)'; g.fill();
  kCalyx(g, 0, 0, Math.max(1.6, w * 0.95), pal.leaf, '#2e5c1a');
  g.restore();
}
/* 茄子果：竖直纺锤形，萼在顶端 */
function kEggplantFruit(g, x, y, len, ang, s, pal){
  g.save(); g.translate(x, y); g.rotate(ang);
  const w = len * 0.42;
  g.beginPath();
  g.moveTo(0, -len * 0.5);
  g.quadraticCurveTo(w * 1.5, -len * 0.1, w * 0.85, len * 0.35);
  g.quadraticCurveTo(0, len * 0.62, -w * 0.85, len * 0.35);
  g.quadraticCurveTo(-w * 1.5, -len * 0.1, 0, -len * 0.5);
  g.closePath();
  const grd = g.createLinearGradient(-w, -len * 0.4, w, len * 0.5);
  grd.addColorStop(0, '#c9a6f0'); grd.addColorStop(0.45, pal.body); grd.addColorStop(1, pal.dark);
  g.fillStyle = grd; g.fill();
  g.lineWidth = Math.max(0.4, 0.7 * s); g.strokeStyle = pal.dark; g.stroke();
  g.beginPath(); g.ellipse(-w * 0.35, -len * 0.1, w * 0.2, len * 0.2, -0.3, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,.35)'; g.fill();
  kCalyx(g, 0, -len * 0.46, w * 0.85, pal.leaf, '#2e5c1a');
  g.restore();
}
/* 西红柿果：圆球 + 萼 + 高光 */
function kTomatoFruit(g, x, y, r, pal, green){
  const grd = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.15);
  grd.addColorStop(0, '#ff9a72'); grd.addColorStop(0.5, pal.body); grd.addColorStop(1, pal.dark);
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = grd; g.fill();
  g.beginPath(); g.arc(x - r * 0.35, y - r * 0.4, r * 0.22, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,.7)'; g.fill();
  kCalyx(g, x, y - r * 0.82, r * 0.72, green || pal.leaf, '#2e5c1a');
}

/* ---------- 新作物的专用画笔 ---------- */
/* 白菜叶：宽卵形包叶。(x,y)=叶柄端，ang 为偏离竖直的角度（0=朝上，正=向右歪） */
function kCabbageLeaf(g, x, y, w, h, ang, fill, dark, vein){
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(-w * 1.15, -h * 0.32, -w * 0.6, -h * 0.8);
  g.quadraticCurveTo(-w * 0.24, -h * 1.06, 0, -h);
  g.quadraticCurveTo(w * 0.24, -h * 1.06, w * 0.6, -h * 0.8);
  g.quadraticCurveTo(w * 1.15, -h * 0.32, 0, 0);
  g.closePath();
  const grd = g.createLinearGradient(0, 0, 0, -h);
  grd.addColorStop(0, dark); grd.addColorStop(0.5, fill); grd.addColorStop(1, dark);
  g.fillStyle = grd; g.fill();
  if(vein){
    g.beginPath(); g.moveTo(0, -h * 0.06);
    g.quadraticCurveTo(w * 0.12, -h * 0.5, 0, -h * 0.88);
    g.lineWidth = Math.max(0.4, w * 0.2); g.strokeStyle = vein; g.stroke();
  }
  g.restore();
}
/* 玉米长叶：从秆上抽出并向外下垂，dir=-1 时镜像，tilt>0 越往外翻 */
function kCornBlade(g, x, y, len, w, tilt, droop, dir, fill, dark){
  g.save(); g.translate(x, y); g.scale(dir, 1); g.rotate(tilt);
  g.beginPath();
  g.moveTo(0, -w * 0.9);
  g.quadraticCurveTo(len * 0.5, -w * 1.6, len, droop);
  g.quadraticCurveTo(len * 0.42, w * 1.05, 0, w * 0.7);
  g.closePath();
  const grd = g.createLinearGradient(0, 0, len * 0.8, droop);
  grd.addColorStop(0, dark); grd.addColorStop(0.45, fill); grd.addColorStop(1, dark);
  g.fillStyle = grd; g.fill();
  g.lineWidth = 0.5; g.strokeStyle = dark; g.stroke();
  g.beginPath(); g.moveTo(0, w * 0.06);
  g.quadraticCurveTo(len * 0.45, -w * 0.2, len * 0.94, droop * 0.86);
  g.lineWidth = Math.max(0.35, w * 0.42); g.strokeStyle = 'rgba(225,255,175,.5)'; g.stroke();
  g.restore();
}
/* 玉米棒：苞叶包着、上端露出金黄颗粒；L 为整根长度 */
function kCornEar(g, x, y, L, ang, pal, ripe){
  g.save(); g.translate(x, y); g.rotate(ang);
  const w = L * 0.3;
  /* 苞叶外壳 */
  g.beginPath();
  g.moveTo(0, L * 0.5);
  g.quadraticCurveTo(-w * 1.45, L * 0.14, -w * 0.92, -L * 0.5);
  g.quadraticCurveTo(-w * 0.48, -L * 0.95, 0, -L * 0.98);
  g.quadraticCurveTo(w * 0.48, -L * 0.95, w * 0.92, -L * 0.5);
  g.quadraticCurveTo(w * 1.45, L * 0.14, 0, L * 0.5);
  g.closePath();
  const hg = g.createLinearGradient(-w, 0, w, 0);
  hg.addColorStop(0, '#2c5f1c'); hg.addColorStop(0.42, ripe ? '#68b03a' : '#7fbc52'); hg.addColorStop(1, '#2c5f1c');
  g.fillStyle = hg; g.fill();
  g.lineWidth = 0.5; g.strokeStyle = '#244c14'; g.stroke();
  /* 露出的玉米粒 */
  g.save();
  g.beginPath();
  g.moveTo(0, -L * 0.02);
  g.quadraticCurveTo(-w * 0.76, -L * 0.3, -w * 0.58, -L * 0.6);
  g.quadraticCurveTo(-w * 0.3, -L * 0.92, 0, -L * 0.94);
  g.quadraticCurveTo(w * 0.3, -L * 0.92, w * 0.58, -L * 0.6);
  g.quadraticCurveTo(w * 0.76, -L * 0.3, 0, -L * 0.02);
  g.closePath();
  const kg = g.createLinearGradient(-w, 0, w, 0);
  kg.addColorStop(0, ripe ? pal.dark : '#8f9a3a');
  kg.addColorStop(0.45, ripe ? pal.body : '#c8d878');
  kg.addColorStop(1, ripe ? pal.dark : '#8f9a3a');
  g.fillStyle = kg; g.fill(); g.clip();
  const rows = Math.max(3, Math.round(L / (w * 0.62)));
  for(let r = 0; r < rows; r++){
    const yy = -L * 0.08 - r * (L * 0.82 / rows);
    for(let c2 = 0; c2 < 4; c2++){
      const xx = ((c2 - 1.5) + (r % 2 ? 0.5 : 0)) * w * 0.34;
      g.beginPath(); g.arc(xx, yy, w * 0.21, 0, Math.PI * 2);
      g.fillStyle = ripe ? ((r + c2) % 2 ? pal.body2 : pal.body) : ((r + c2) % 2 ? '#dbe89a' : '#c2d478');
      g.fill();
    }
  }
  g.restore();
  /* 苞叶接缝 */
  g.beginPath(); g.moveTo(-w * 0.42, L * 0.36);
  g.quadraticCurveTo(-w * 0.22, -L * 0.12, -w * 0.06, -L * 0.34);
  g.lineWidth = 0.55; g.strokeStyle = 'rgba(22,52,10,.4)'; g.stroke();
  g.beginPath(); g.moveTo(w * 0.46, L * 0.32);
  g.quadraticCurveTo(w * 0.3, -L * 0.1, w * 0.1, -L * 0.3);
  g.stroke();
  g.restore();
}
/* 南瓜果：竖向瓣纹（凹槽）+ 高光 + 果梗；ripe=false 时是青果 */
function kPumpkinFruit(g, cx, cy, r, pal, ripe){
  const cols = ripe
    ? ['#b4560f', pal.body, pal.body2, pal.body, '#b4560f']
    : ['#3d6a22', '#6da842', '#a2d06c', '#6da842', '#3d6a22'];
  const edge = ripe ? pal.dark : '#2b4f16';
  /* 底影 */
  g.beginPath(); g.ellipse(cx, cy + r * 0.9, r * 0.92, r * 0.22, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(30,50,20,.22)'; g.fill();
  /* 整体底色，避免瓣间露底 */
  g.beginPath(); g.ellipse(cx, cy, r * 0.98, r * 0.94, 0, 0, Math.PI * 2);
  g.fillStyle = cols[0]; g.fill();
  /* 五瓣：中间亮、两侧暗，形成竖向凹槽 */
  for(let i = 0; i < cols.length; i++){
    const t = (i - (cols.length - 1) / 2) / ((cols.length - 1) / 2);
    const rx = r * 0.3, ry = r * (0.94 - Math.abs(t) * 0.13);
    g.beginPath(); g.ellipse(cx + t * r * 0.67, cy, rx, ry, 0, 0, Math.PI * 2);
    g.fillStyle = cols[i]; g.fill();
    g.save(); g.globalAlpha = 0.5; g.lineWidth = Math.max(0.4, r * 0.05);
    g.strokeStyle = edge; g.stroke(); g.restore();
  }
  /* 顶部高光 */
  g.beginPath(); g.ellipse(cx - r * 0.3, cy - r * 0.46, r * 0.3, r * 0.15, -0.44, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,.45)'; g.fill();
  /* 果梗 */
  kStem(g, cx, cy - r * 0.84, cx - r * 0.05, cy - r * 1.3,
    Math.max(1.1, r * 0.18), '#3f6a20', '#8fa04a');
}
/* 南瓜大叶：三裂掌状 */
function kPumpkinLeaf(g, x, y, len, wid, ang, fill, dark){
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(len * 0.18, -wid * 0.95, len * 0.5, -wid * 0.84);
  g.quadraticCurveTo(len * 0.8, -wid * 1.02, len * 0.86, -wid * 0.42);
  g.quadraticCurveTo(len * 0.6, -wid * 0.32, len * 0.6, -wid * 0.14);
  g.quadraticCurveTo(len * 0.95, -wid * 0.28, len, 0);
  g.quadraticCurveTo(len * 0.95, wid * 0.28, len * 0.6, wid * 0.14);
  g.quadraticCurveTo(len * 0.6, wid * 0.32, len * 0.86, wid * 0.42);
  g.quadraticCurveTo(len * 0.8, wid * 1.02, len * 0.5, wid * 0.84);
  g.quadraticCurveTo(len * 0.18, wid * 0.95, 0, 0);
  g.closePath();
  const grd = g.createLinearGradient(0, 0, len, 0);
  grd.addColorStop(0, dark); grd.addColorStop(0.55, fill); grd.addColorStop(1, dark);
  g.fillStyle = grd; g.fill();
  g.lineWidth = 0.5; g.strokeStyle = dark; g.stroke();
  g.strokeStyle = 'rgba(220,255,180,.45)'; g.lineWidth = Math.max(0.35, wid * 0.1);
  for(const t of [-0.42, 0, 0.42]){
    g.beginPath(); g.moveTo(len * 0.08, 0);
    g.quadraticCurveTo(len * 0.5, t * wid * 0.7, len * 0.88, t * wid * 0.62);
    g.stroke();
  }
  g.restore();
}
/* 草莓小叶（三出复叶的一片）：圆叶 + 中脉 */
function kStrawLeaflet(g, x, y, rx, ry, ang, fill, dark){
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath(); g.ellipse(0, -ry * 0.42, rx, ry, 0, 0, Math.PI * 2);
  const grd = g.createLinearGradient(-rx, -ry, rx * 0.8, ry * 0.4);
  grd.addColorStop(0, fill); grd.addColorStop(1, dark);
  g.fillStyle = grd; g.fill();
  g.lineWidth = Math.max(0.35, rx * 0.14); g.strokeStyle = dark; g.stroke();
  g.beginPath(); g.moveTo(0, ry * 0.28); g.lineTo(0, -ry * 1.05);
  g.lineWidth = Math.max(0.3, rx * 0.12); g.strokeStyle = 'rgba(225,255,185,.5)'; g.stroke();
  g.restore();
}
/* 草莓果萼：围绕果肩辐射的小尖叶 */
function kBerryCalyx(g, x, y, r, leaf, dark){
  kStem(g, x, y, x + r * 0.12, y - r * 0.5, Math.max(0.5, r * 0.24), dark, leaf);
  for(let i = 0; i < 5; i++){
    g.save(); g.translate(x, y); g.rotate((i - 2) * 0.72);
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(-r * 0.52, -r * 0.5, 0, -r * 1.35);
    g.quadraticCurveTo(r * 0.52, -r * 0.5, 0, 0);
    g.closePath();
    g.fillStyle = i % 2 ? dark : leaf; g.fill();
    g.restore();
  }
}
/* 草莓果：心形果 + 籽 + 绿萼；ripeness<1 时是青果（多轮收获的"再长一轮"） */
function kStrawberryFruit(g, x, y, r, pal, ripeness){
  const ripe = ripeness == null ? 1 : Math.max(0, Math.min(1, ripeness));
  const grd = g.createRadialGradient(x - r * 0.34, y - r * 0.24, r * 0.08, x, y, r * 1.3);
  grd.addColorStop(0, pal.body2);
  grd.addColorStop(0.48, pal.body);
  grd.addColorStop(1, pal.dark);
  g.beginPath();
  g.moveTo(x, y + r * 1.02);
  g.quadraticCurveTo(x - r * 1.14, y + r * 0.12, x - r * 0.78, y - r * 0.46);
  g.quadraticCurveTo(x - r * 0.4, y - r * 0.88, x, y - r * 0.52);
  g.quadraticCurveTo(x + r * 0.4, y - r * 0.88, x + r * 0.78, y - r * 0.46);
  g.quadraticCurveTo(x + r * 1.14, y + r * 0.12, x, y + r * 1.02);
  g.closePath();
  g.fillStyle = grd; g.fill();
  if(ripe < 0.99){
    g.save(); g.globalAlpha = (1 - ripe) * 0.8;
    g.fillStyle = '#bfe089'; g.fill(); g.restore();
  }
  if(r > 4){   /* 籽：太小就不画，避免糊成一团 */
    g.fillStyle = 'rgba(255,244,190,.92)';
    const rows = [[-0.3, 0.3], [0.06, 0.28], [0.42, 0.24]];
    for(let i = 0; i < rows.length; i++){
      for(let j = -1; j <= 1; j++){
        g.beginPath();
        g.ellipse(x + j * r * 0.42 + (i % 2 ? r * 0.18 : 0), y + (rows[i][0] - 0.05) * r,
          r * 0.1, r * 0.14, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  g.beginPath(); g.ellipse(x - r * 0.36, y - r * 0.16, r * 0.2, r * 0.28, -0.4, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,.42)'; g.fill();
  kBerryCalyx(g, x, y - r * 0.3, r * 0.5, pal.leaf, '#2e5c1a');
}

/* ============================================================
 * 二、田间作物：小麦 / 辣椒 / 茄子 / 西红柿 / 白菜 / 玉米 / 南瓜 / 草莓
 * ============================================================ */
function kFieldWheat(g, x, baseY, ratio, stage, s, pal){
  const n = 3, H = (10 + ratio * 26) * s;
  for(let i = 0; i < n; i++){
    const off = (i - (n - 1) / 2) * 5.5 * s;
    const topX = x + off * 1.3, topY = baseY - H * (1 - Math.abs(i - 1) * 0.07);
    kStem(g, x + off, baseY, topX, topY, 2.3 * s, '#8a7420', '#c8a83c');
    if(stage >= 1){
      const side = i % 2 === 0 ? -1 : 1;
      kLeafBlade(g, x + off, baseY - H * 0.45, 9 * s, 2.1 * s, side * (0.95 + i * 0.12), pal.leaf, '#5a6a1a');
    }
    if(stage >= 2){
      const pairs = stage >= 3 ? 5 : 3;
      for(let k = 0; k < pairs; k++){
        const gy = topY + k * 2.5 * s;
        for(const sd of [-1, 1]){
          g.beginPath();
          g.ellipse(topX + sd * 1.7 * s, gy, 1.6 * s, 2.5 * s, sd * 0.5, 0, Math.PI * 2);
          const gg = g.createLinearGradient(topX - 3 * s, gy - 3 * s, topX + 3 * s, gy + 3 * s);
          gg.addColorStop(0, pal.body2); gg.addColorStop(1, pal.body);
          g.fillStyle = gg; g.fill();
        }
      }
      if(stage >= 3){
        g.strokeStyle = 'rgba(245,225,160,.85)'; g.lineWidth = 0.7 * s;
        for(let k = 0; k < 4; k++){
          const gy = topY + k * 2.2 * s;
          g.beginPath(); g.moveTo(topX, gy + 3 * s); g.lineTo(topX - 3.4 * s, gy - 2 * s); g.stroke();
          g.beginPath(); g.moveTo(topX, gy + 3 * s); g.lineTo(topX + 3.4 * s, gy - 2 * s); g.stroke();
        }
      }
    }
  }
}
function kFieldChili(g, x, baseY, ratio, stage, s, pal){
  const H = (8 + ratio * 20) * s;
  kStem(g, x, baseY, x, baseY - H, 2.5 * s, '#2e5c1a', '#4ea832');
  if(stage >= 1){
    const leaves = stage >= 3 ? 4 : 2;
    for(let i = 0; i < leaves; i++){
      const side = i % 2 === 0 ? -1 : 1;
      kLeafBlade(g, x, baseY - H * (0.32 + i * 0.16), 11 * s, 3.3 * s,
        side * (0.5 + i * 0.12), pal.leaf, '#2e5c1a', 'rgba(220,255,180,.45)');
    }
  }
  if(stage === 2){
    for(let i = 0; i < 2; i++){
      const side = i % 2 === 0 ? -1 : 1;
      const fx = x + side * 6 * s, fy = baseY - H * 0.72;
      g.beginPath(); g.arc(fx, fy, 1.9 * s, 0, Math.PI * 2); g.fillStyle = '#fff6e8'; g.fill();
      g.beginPath(); g.arc(fx, fy, 0.8 * s, 0, Math.PI * 2); g.fillStyle = '#ffce2e'; g.fill();
    }
  }
  if(stage >= 3){
    for(let i = 0; i < 4; i++){
      const side = i % 2 === 0 ? -1 : 1;
      kChiliPod(g, x + side * (3.5 + i * 1.1) * s, baseY - H * (0.55 - i * 0.06),
        s, (6.5 + i * 1.1) * s, side * 0.32, pal);
    }
  }
}
function kFieldEggplant(g, x, baseY, ratio, stage, s, pal){
  const H = (9 + ratio * 22) * s, topX = x - 1 * s;
  kStem(g, x, baseY, topX, baseY - H, 2.7 * s, '#2e5c1a', '#4ea832');
  if(stage >= 1){
    for(let i = 0; i < 3; i++){
      const side = i % 2 === 0 ? -1 : 1;
      kLeafBlade(g, topX, baseY - H * (0.3 + i * 0.2), 13 * s, 5 * s,
        side * (0.35 + i * 0.2), pal.leaf, '#2e5c1a', 'rgba(210,255,190,.4)');
    }
  }
  if(stage === 2){
    for(let i = 0; i < 2; i++){
      const side = i % 2 === 0 ? -1 : 1;
      g.beginPath(); g.arc(topX + side * 7 * s, baseY - H * 0.8, 2.2 * s, 0, Math.PI * 2);
      g.fillStyle = '#c79bff'; g.fill();
      g.beginPath(); g.arc(topX + side * 7 * s, baseY - H * 0.8, 0.9 * s, 0, Math.PI * 2);
      g.fillStyle = '#ffd76e'; g.fill();
    }
  }
  if(stage >= 3){
    kEggplantFruit(g, x + 7 * s, baseY - H * 0.42, 10 * s, 0.35, s, pal);
    kEggplantFruit(g, x - 8 * s, baseY - H * 0.28, 7.8 * s, -0.4, s, pal);
  }
}
function kFieldTomato(g, x, baseY, ratio, stage, s, pal){
  const H = (9 + ratio * 20) * s;
  kStem(g, x, baseY, x, baseY - H, 2.5 * s, '#2e5c1a', '#4ea832');
  if(stage >= 1){
    for(let i = 0; i < 3; i++){
      const side = i % 2 === 0 ? -1 : 1;
      kLeafBlade(g, x, baseY - H * (0.3 + i * 0.22), 11 * s, 3.8 * s,
        side * (0.5 + i * 0.15), pal.leaf, '#2e5c1a');
    }
  }
  if(stage === 2){
    for(const p of [[-7, 0.42], [7, 0.5], [0.5, 0.28]]){
      g.beginPath(); g.arc(x + p[0] * s, baseY - H * p[1], 3.2 * s, 0, Math.PI * 2);
      g.fillStyle = '#8fbf4a'; g.fill();
      g.beginPath(); g.arc(x + p[0] * s - 1 * s, baseY - H * p[1] - 1 * s, 1.1 * s, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,.5)'; g.fill();
    }
  }
  if(stage >= 3){
    const fruits = [[-8, 0.45, 4.6], [7, 0.55, 4.0], [0.5, 0.30, 3.4]];
    for(const f of fruits) kTomatoFruit(g, x + f[0] * s, baseY - H * f[1], f[2] * s, pal);
  }
}
/* 白菜：贴地叶球。stage0-1＝散开的莲座叶，stage2 开始抱心，stage3 抱成球 */
function kFieldCabbage(g, x, baseY, ratio, stage, s, pal){
  const y = baseY - 1;
  const spread = stage >= 3 ? 1.05 : stage === 2 ? 0.85 : 1.25;
  const n = stage === 0 ? 3 : stage === 1 ? 5 : 6;
  const L = (7.2 + ratio * 5.4) * s, W = (3.2 + ratio * 2.4) * s;
  for(let i = 0; i < n; i++){
    const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2;
    const ang = t * (1.0 + spread * 0.78);
    const h = L * (0.68 + 0.32 * Math.cos(t * 1.15));
    kCabbageLeaf(g, x + t * 2.4 * s, y, W, h, ang,
      i % 2 ? pal.leaf : pal.body, pal.dark, 'rgba(238,255,205,.55)');
  }
  if(stage >= 2){
    const full = stage >= 3;
    const R = (full ? 7.6 : 5.1) * s;
    const cy = y - R * (full ? 0.82 : 0.52);
    /* 抱球外叶：叶根藏在球里，只让叶尖从球后面探出来 */
    kCabbageLeaf(g, x, cy + R * 0.62, R * 0.7, R * 1.9, 0, pal.dark, pal.dark, null);
    kCabbageLeaf(g, x - R * 0.5, cy + R * 0.5, R * 0.62, R * 2.0, -0.62, pal.leaf, pal.dark, null);
    kCabbageLeaf(g, x + R * 0.5, cy + R * 0.5, R * 0.62, R * 2.0, 0.62, pal.body, pal.dark, null);
    kCabbageLeaf(g, x - R * 0.6, cy + R * 0.3, R * 0.5, R * 1.2, -1.25, pal.leaf, pal.dark, null);
    kCabbageLeaf(g, x + R * 0.6, cy + R * 0.3, R * 0.5, R * 1.2, 1.25, pal.body, pal.dark, null);
    /* 球体 */
    const grd = g.createRadialGradient(x - R * 0.34, cy - R * 0.42, R * 0.12, x, cy, R * 1.12);
    grd.addColorStop(0, pal.body2); grd.addColorStop(0.48, pal.body); grd.addColorStop(1, pal.dark);
    g.beginPath(); g.ellipse(x, cy, R * 0.99, R * 0.95, 0, 0, Math.PI * 2);
    g.fillStyle = grd; g.fill();
    /* 内层浅色菜心 + 叶脉 */
    g.beginPath(); g.ellipse(x, cy - R * 0.1, R * 0.58, R * 0.63, 0, 0, Math.PI * 2);
    const ig = g.createLinearGradient(x, cy - R * 0.76, x, cy + R * 0.55);
    ig.addColorStop(0, '#f8fce8'); ig.addColorStop(1, pal.body2);
    g.fillStyle = ig; g.fill();
    g.lineWidth = Math.max(0.35, R * 0.075); g.strokeStyle = 'rgba(126,170,74,.5)';
    for(const t of [-0.78, -0.26, 0.26, 0.78]){
      g.beginPath();
      g.moveTo(x + t * R * 0.3, cy + R * 0.5);
      g.quadraticCurveTo(x + t * R * 0.72, cy - R * 0.08, x + t * R * 0.62, cy - R * 0.54);
      g.stroke();
    }
    /* 高光 + 外轮廓 */
    g.beginPath(); g.ellipse(x - R * 0.34, cy - R * 0.44, R * 0.26, R * 0.2, -0.5, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,.45)'; g.fill();
    g.beginPath(); g.ellipse(x, cy, R * 0.99, R * 0.95, 0, 0, Math.PI * 2);
    g.lineWidth = Math.max(0.5, R * 0.1); g.strokeStyle = pal.dark; g.stroke();
  }
}
/* 玉米：直立高秆 + 长条垂叶（逐阶段抽出）+ 成熟时 2 个带苞叶的玉米棒 */
function kFieldCorn(g, x, baseY, ratio, stage, s, pal){
  const H = (11 + ratio * 30) * s, lean = 0.9 * s;
  kStem(g, x, baseY, x + lean, baseY - H, 2.8 * s, '#2e5c1a', '#4ea832');
  /* 叶片：从下往上逐片抽出，越长越外翻下垂 */
  const blades = stage === 0 ? 2 : stage === 1 ? 3 : stage === 2 ? 4 : 5;
  for(let i = 0; i < blades; i++){
    const h = Math.min(0.88, 0.26 + i * 0.16);
    const side = i % 2 === 0 ? 1 : -1;
    const len = (12.5 + i * 1.4) * s * (0.72 + ratio * 0.4);
    kCornBlade(g, x + lean * h, baseY - H * h, len, (1.7 + i * 0.14) * s,
      0.3 + i * 0.07, (2.6 + i * 0.9) * s, side, pal.leaf, '#2e5c1a');
  }
  /* 天花（雄穗） */
  if(stage >= 2){
    const tx = x + lean, ty = baseY - H;
    g.strokeStyle = '#d8c060'; g.lineWidth = Math.max(0.5, 0.8 * s);
    for(let i = 0; i < 5; i++){
      const a = -Math.PI / 2 + (i - 2) * 0.36;
      g.beginPath(); g.moveTo(tx, ty + 1.5 * s);
      g.lineTo(tx + Math.cos(a) * 6 * s, ty + Math.sin(a) * 7 * s + 1.5 * s);
      g.stroke();
    }
    g.fillStyle = '#f0dc86';
    for(let i = 0; i < 4; i++){
      g.beginPath(); g.arc(tx + (i - 1.5) * 1.5 * s, ty - 4.4 * s, 0.7 * s, 0, Math.PI * 2); g.fill();
    }
  }
  /* 玉米棒 */
  if(stage === 2){
    kCornEar(g, x + 3.4 * s, baseY - H * 0.5, 8 * s, 0.3, pal, false);
  } else if(stage >= 3){
    kCornEar(g, x + 3.6 * s, baseY - H * 0.5, (11 + ratio * 3) * s, 0.32, pal, true);
    kCornEar(g, x - 3.2 * s, baseY - H * 0.34, (8.4 + ratio * 2) * s, -0.3, pal, true);
  }
}
/* 南瓜：爬地藤蔓 + 大裂叶 + 成熟时一颗带竖向瓣纹的橙南瓜 */
function kFieldPumpkin(g, x, baseY, ratio, stage, s, pal){
  const y = baseY - 1, viny = y - (3 + ratio * 2.5) * s;
  /* 藤蔓：从根部短短爬出去，末端带卷须（别铺成一根长棍） */
  g.save(); g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x - 0.4 * s, y);
  g.quadraticCurveTo(x - 6 * s, y - (1.6 + ratio * 1.6) * s, x - 3.6 * s, viny);
  g.quadraticCurveTo(x - 1.8 * s, y - (4.6 + ratio * 3) * s, x + 2.6 * s, y - (1.8 + ratio * 1.6) * s);
  g.lineWidth = 2.1 * s; g.strokeStyle = '#2a5418'; g.stroke();
  g.lineWidth = 1.1 * s; g.strokeStyle = '#5aa83a'; g.stroke();
  g.restore();
  /* 卷须 */
  g.strokeStyle = '#5aa83a'; g.lineWidth = Math.max(0.5, 0.7 * s);
  g.beginPath();
  g.moveTo(x - 4 * s, viny);
  g.quadraticCurveTo(x - 7 * s, viny - 3.6 * s, x - 5.2 * s, viny - 5.2 * s);
  g.quadraticCurveTo(x - 3.6 * s, viny - 6 * s, x - 4.6 * s, viny - 4 * s);
  g.stroke();
  /* 大叶 */
  const leaves = stage === 0 ? 1 : stage === 1 ? 2 : stage === 2 ? 3 : 4;
  {
    const specs = [[-7, -2.8, 2.5], [6.4, -1.2, -0.5], [-2.2, -3.4, 1.9], [3.4, -2.4, -1.9]];
    for(let i = 0; i < leaves; i++){
      const lp = specs[i];
      kPumpkinLeaf(g, x + lp[0] * s, y + lp[1] * s, (8.2 + ratio * 3.4) * s, (5.2 + ratio * 1.7) * s,
        lp[2], pal.leaf, '#2a5418');
    }
  }
  /* 花 / 青果 → 熟果 */
  if(stage === 2){
    const fx = x + 6 * s, fy = y - 5 * s;
    for(let i = 0; i < 5; i++){
      const a = -Math.PI / 2 + (i - 2) * 0.5;
      g.beginPath();
      g.moveTo(fx, fy);
      g.quadraticCurveTo(fx + Math.cos(a - 0.3) * 4 * s, fy + Math.sin(a - 0.3) * 4 * s,
        fx + Math.cos(a) * 5.4 * s, fy + Math.sin(a) * 5.4 * s);
      g.quadraticCurveTo(fx + Math.cos(a + 0.3) * 4 * s, fy + Math.sin(a + 0.3) * 4 * s, fx, fy);
      g.closePath();
      g.fillStyle = i % 2 ? '#ffd24a' : '#ffe98a'; g.fill();
    }
    g.beginPath(); g.arc(fx, fy, 1.6 * s, 0, Math.PI * 2); g.fillStyle = '#c88a20'; g.fill();
    kPumpkinFruit(g, x - 3 * s, y - 3.2 * s, 4.6 * s, pal, false);
  } else if(stage >= 3){
    kPumpkinFruit(g, x + 1.5 * s, y - 6.4 * s, (8.4 + ratio * 1.2) * s, pal, true);
  }
}
/* 草莓：矮丛常驻（3~5 片圆叶），只有果实随成熟度长出来（多轮收获） */
function kFieldStrawberry(g, x, baseY, ratio, stage, s, pal){
  const y = baseY - 1;
  const bush = (0.7 + ratio * 0.45) * s;      /* 叶子随生长略放大，收获后不回缩太多 */
  /* 常驻的矮丛：每片叶＝三出复叶 */
  const specs = [[-1.15, 1], [1.15, -1], [-0.34, 1], [0.36, -1]];
  const leaves = stage === 0 ? 2 : stage === 1 ? 3 : 4;
  for(let i = 0; i < leaves; i++){
    const sp = specs[i], side = sp[1], ang = sp[0];
    const lx = x + Math.sin(ang) * 4.2 * bush, ly = y - (1.4 + Math.cos(ang) * 1.6) * bush;
    const rr = (2.6 + ratio * 0.6) * s;
    for(const off of [[-0.6, 1], [0.6, 1], [0, 1]]){
      kStrawLeaflet(g, lx + off[0] * rr * 1.2 * side, ly - (off[0] === 0 ? rr * 1.0 : rr * 0.55),
        rr * 0.92, rr * 1.0, off[0] * 0.7 * side, i % 2 ? pal.leaf : '#57a832', '#2a5418');
    }
  }
  /* 白花 */
  if(stage === 2){
    for(const p of [[-3.4, -5.2], [3.2, -4.4]]){
      const fx = x + p[0] * s, fy = y + p[1] * s;
      for(let i = 0; i < 5; i++){
        const a = (i / 5) * Math.PI * 2 - 0.3;
        g.beginPath();
        g.ellipse(fx + Math.cos(a) * 1.8 * s, fy + Math.sin(a) * 1.8 * s, 1.5 * s, 1.5 * s, 0, 0, Math.PI * 2);
        g.fillStyle = '#fffdf2'; g.fill();
      }
      g.beginPath(); g.arc(fx, fy, 1.1 * s, 0, Math.PI * 2); g.fillStyle = '#ffd24a'; g.fill();
    }
  }
  /* 果实：3~5 颗，按成熟度从青变红（复熟时看得见"再长一轮"） */
  if(stage >= 2){
    const ripe = Math.max(0, Math.min(1, (ratio - 0.84) / 0.16));
    const spots = [[-4.8, 2.6, 1], [4.4, 3.2, 1], [-1.0, 4.4, 1], [6.2, 1.6, 0.82], [-6.6, 1.8, 0.72]];
    const n = stage >= 3 ? (ratio >= 0.99 ? 5 : 4) : 3;
    for(let i = 0; i < n; i++){
      const p = spots[i];
      const r = 3.1 * s * p[2] * (0.7 + 0.3 * (0.5 + ripe * 0.5));
      kStrawberryFruit(g, x + p[0] * s, y + p[1] * s, r, pal, i === n - 1 && ripe < 1 ? ripe * 0.75 : ripe);
    }
  }
}
/* 田间入口：drawCrop 只对 wheat/chili/eggplant/tomato/cabbage/corn/pumpkin/strawberry 调用这里 */
function drawVeggieField(g, cropId, x, y, ratio){
  if(!g) return;
  ratio = Math.max(0, Math.min(1, ratio || 0));
  const pal = K_VEGGIE_PALETTE[cropId] || K_VEGGIE_FALLBACK;
  const stage = ratio < 0.33 ? 0 : ratio < 0.66 ? 1 : ratio < 1 ? 2 : 3;
  const s = 0.6 + ratio * 0.55;
  const baseY = y + 1;
  g.save();
  g.lineCap = 'round';
  if(cropId === 'wheat')          kFieldWheat(g, x, baseY, ratio, stage, s, pal);
  else if(cropId === 'chili')     kFieldChili(g, x, baseY, ratio, stage, s, pal);
  else if(cropId === 'eggplant')  kFieldEggplant(g, x, baseY, ratio, stage, s, pal);
  else if(cropId === 'tomato')    kFieldTomato(g, x, baseY, ratio, stage, s, pal);
  else if(cropId === 'cabbage')   kFieldCabbage(g, x, baseY, ratio, stage, s, pal);
  else if(cropId === 'corn')      kFieldCorn(g, x, baseY, ratio, stage, s, pal);
  else if(cropId === 'pumpkin')   kFieldPumpkin(g, x, baseY, ratio, stage, s, pal);
  else if(cropId === 'strawberry')kFieldStrawberry(g, x, baseY, ratio, stage, s, pal);
  else if(typeof drawGenericSprout === 'function') drawGenericSprout(g, x, baseY, ratio, pal.body);
  g.restore();
}

/* ============================================================
 * 三、UI 图标：把食材 / 加工品 / 菜品画进 32×32 设计栅格
 * drawItemIcon 会把原点平移到 (cx,cy) 并按 size/32 缩放，
 * 因此下面的坐标都可以直接按 -16..16 来写。
 * ============================================================ */

/* ---------- 整颗食材 ---------- */
function kCarrotIcon(g, pal){
  for(let i = -1; i <= 1; i++){
    g.save(); g.translate(0, -5); g.rotate(i * 0.5);
    g.beginPath(); g.moveTo(0, 2);
    g.quadraticCurveTo(3.4, -6, 0.6, -11);
    g.quadraticCurveTo(-3.4, -6, 0, 2);
    g.closePath();
    g.fillStyle = i === 0 ? '#5cbf3a' : pal.leaf; g.fill();
    g.restore();
  }
  const grd = g.createLinearGradient(-6, -6, 7, 14);
  grd.addColorStop(0, '#ffb066'); grd.addColorStop(0.45, '#ff9040');
  grd.addColorStop(0.8, pal.body); grd.addColorStop(1, pal.dark);
  g.beginPath();
  g.moveTo(-4.6, -5);
  g.quadraticCurveTo(-5.4, 4, -0.6, 14);
  g.quadraticCurveTo(0.4, 15.2, 1.2, 13.6);
  g.quadraticCurveTo(5.4, 4, 4.6, -5);
  g.closePath();
  g.fillStyle = grd; g.fill();
  g.lineWidth = 0.8; g.strokeStyle = 'rgba(120,50,10,.45)'; g.stroke();
  g.strokeStyle = 'rgba(255,220,180,.55)'; g.lineWidth = 0.9;
  for(let i = 0; i < 3; i++){
    const yy = -0.5 + i * 4;
    g.beginPath(); g.moveTo(-2.8 + i * 0.6, yy); g.lineTo(2.4 - i * 0.4, yy + 0.6); g.stroke();
  }
}
function kPotatoIcon(g, pal){
  g.save(); g.rotate(-0.26);
  const grd = g.createRadialGradient(-4, -5, 1, 0, 0, 14);
  grd.addColorStop(0, '#f0d79a'); grd.addColorStop(0.5, pal.body); grd.addColorStop(1, pal.dark);
  g.beginPath(); g.ellipse(0, 0, 11.5, 8.6, 0.12, 0, Math.PI * 2);
  g.fillStyle = grd; g.fill();
  g.lineWidth = 0.9; g.strokeStyle = '#7a5220'; g.stroke();
  g.fillStyle = 'rgba(90,60,20,.5)';
  for(const p of [[-5, 2], [2, -4], [5, 3], [-2, 5], [6, -2]]){
    g.beginPath(); g.ellipse(p[0], p[1], 1.1, 0.85, 0.4, 0, Math.PI * 2); g.fill();
  }
  g.beginPath(); g.ellipse(-4.5, -4.2, 3.2, 2.2, -0.4, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,250,220,.5)'; g.fill();
  g.restore();
}
function kRiceIcon(g, pal){
  kLeafBlade(g, -3, 12, 10, 3.2, -2.35, pal.leaf, '#2e5c1a');
  kLeafBlade(g, 3, 12, 10, 3.2, -0.8, pal.leaf, '#2e5c1a');
  const grains = [[-6, 1, -0.5], [0, -2, 0.1], [6, 1, 0.5], [-3, -7, -0.3], [3, -7, 0.3], [0, 6, 0]];
  for(const gr of grains){
    g.save(); g.translate(gr[0], gr[1]); g.rotate(gr[2]);
    const grd = g.createLinearGradient(-3, -4, 3, 4);
    grd.addColorStop(0, pal.body2); grd.addColorStop(0.5, '#ffd64a'); grd.addColorStop(1, pal.dark);
    g.beginPath(); g.ellipse(0, 0, 3.1, 4.4, 0, 0, Math.PI * 2); g.fillStyle = grd; g.fill();
    g.beginPath(); g.ellipse(-1, -1.2, 1, 1.7, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,250,220,.85)'; g.fill();
    g.restore();
  }
}
function kWheatIcon(g, pal){
  kStem(g, 0, 14, -1, -5, 2.2, '#a8822c', '#e0c060');
  kLeafBlade(g, 0, 8, 10, 3, 0.85, pal.leaf, '#5a6a1a');
  for(let k = 0; k < 5; k++){
    const yy = -7 + k * 3.2;
    for(const sd of [-1, 1]){
      g.beginPath(); g.ellipse(sd * 2.9 - k * 0.12, yy, 2.3, 3.5, sd * 0.5, 0, Math.PI * 2);
      const grd = g.createLinearGradient(-4, yy - 4, 4, yy + 4);
      grd.addColorStop(0, pal.body2); grd.addColorStop(1, pal.body);
      g.fillStyle = grd; g.fill();
    }
  }
  g.strokeStyle = 'rgba(245,225,160,.85)'; g.lineWidth = 0.7;
  for(const sd of [-1, 1]){
    g.beginPath(); g.moveTo(sd * 3, -7); g.lineTo(sd * 6.5, -14); g.stroke();
  }
}
function kChiliIcon(g, pal){ kChiliPod(g, 0, -11, 1.1, 20, 0.22, pal); }
function kEggplantIcon(g, pal){ kEggplantFruit(g, 0, 1, 22, 0.16, 1.05, pal); }
function kTomatoIcon(g, pal){ kTomatoFruit(g, 0, 1, 11, pal); }
/* 白菜：外层深绿包叶 + 浅色菜心（与田间 stage3 同形） */
function kCabbageIcon(g, pal){
  const wraps = [
    [0, 5, 6.4, 20, 0, pal.dark],
    [-4, 4, 6.2, 20, -0.6, pal.leaf],
    [4, 4, 6.2, 20, 0.6, pal.body],
    [-4.5, 6, 5.2, 11.5, -1.28, pal.leaf],
    [4.5, 6, 5.2, 11.5, 1.28, pal.body],
  ];
  for(const w of wraps) kCabbageLeaf(g, w[0], w[1], w[2], w[3], w[4], w[5], pal.dark, null);
  g.beginPath(); g.ellipse(0, 0, 12, 11.4, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(30,60,20,.22)'; g.fill();
  const grd = g.createRadialGradient(-3.6, -4.4, 1.2, 0, 0, 13);
  grd.addColorStop(0, pal.body2); grd.addColorStop(0.5, pal.body); grd.addColorStop(1, pal.dark);
  g.beginPath(); g.ellipse(0, 0, 11.8, 11.2, 0, 0, Math.PI * 2);
  g.fillStyle = grd; g.fill();
  g.beginPath(); g.ellipse(0, -1.2, 7, 7.5, 0, 0, Math.PI * 2);
  const ig = g.createLinearGradient(0, -8.7, 0, 6.3);
  ig.addColorStop(0, '#f9fde9'); ig.addColorStop(1, pal.body2);
  g.fillStyle = ig; g.fill();
  g.lineWidth = 0.95; g.strokeStyle = 'rgba(126,170,74,.5)';
  for(const t of [-0.78, -0.26, 0.26, 0.78]){
    g.beginPath(); g.moveTo(t * 3.6, 6);
    g.quadraticCurveTo(t * 8.6, -1, t * 7.4, -6.6); g.stroke();
  }
  g.beginPath(); g.ellipse(-3.8, -5.2, 2.8, 2.1, -0.5, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,.45)'; g.fill();
  g.beginPath(); g.ellipse(0, 0, 11.8, 11.2, 0, 0, Math.PI * 2);
  g.lineWidth = 1.1; g.strokeStyle = pal.dark; g.stroke();
}
/* 玉米：苞叶裹着的玉米棒，露出金黄颗粒 */
function kCornIcon(g, pal){
  for(const h of [[-4.6, 13, -8], [-6, 15, -13.5], [6, 15, -13.5], [4.6, 13, -8]]){
    kCornBlade(g, h[0], 12, h[1], 3.4, 0, h[2], h[0] > 0 ? 1 : -1, pal.leaf, '#2a5418');
  }
  kCornEar(g, 0, 0.5, 26, 0.06, pal, true);
  /* 顶端玉米须 */
  g.strokeStyle = '#c8a24a'; g.lineWidth = 0.8;
  for(let i = 0; i < 4; i++){
    const a = -Math.PI / 2 + (i - 1.5) * 0.3;
    g.beginPath(); g.moveTo(0, -12);
    g.quadraticCurveTo(Math.cos(a) * 4, -15, Math.cos(a) * 6.6, -15.2 + Math.abs(i - 1.5));
    g.stroke();
  }
}
/* 南瓜：橙黄大果 + 竖向瓣纹 + 果梗卷须 */
function kPumpkinIcon(g, pal){
  g.strokeStyle = '#5aa83a'; g.lineWidth = 1.3;
  g.beginPath();
  g.moveTo(-2, -11);
  g.quadraticCurveTo(-9, -15, -11.5, -9.5);
  g.quadraticCurveTo(-12.5, -6.5, -9.5, -8.6);
  g.stroke();
  kPumpkinFruit(g, 0, 2.5, 12.2, pal, true);
}
/* 草莓：一颗大果，籽 + 绿萼（与田间同形） */
function kStrawberryIcon(g, pal){
  kStrawberryFruit(g, 0, 1.8, 11.4, pal, 1);
  kStem(g, 0.3, -3.4, 1, -15.4, 1.5, '#2e5c1a', '#5aa83a');
}
function kCrateIcon(g){
  roundRect(g, -11, -8, 22, 18, 3);
  g.fillStyle = '#6a5236'; g.fill();
  g.strokeStyle = '#3a2c1c'; g.lineWidth = 1; g.stroke();
  g.beginPath(); g.moveTo(-11, -2); g.lineTo(11, -2); g.moveTo(-11, 4); g.lineTo(11, 4); g.stroke();
}
/* 面粉：一碗面粉 + 粉尘 */
function kFlourIcon(g){
  g.beginPath();
  g.moveTo(-12, 2); g.quadraticCurveTo(0, 18, 12, 2); g.closePath();
  const bg = g.createLinearGradient(0, 2, 0, 15);
  bg.addColorStop(0, '#efe7d4'); bg.addColorStop(1, '#a89c84');
  g.fillStyle = bg; g.fill();
  g.beginPath(); g.moveTo(-9, 1.6);
  g.quadraticCurveTo(-5, -8.5, 0, -9.2);
  g.quadraticCurveTo(5, -8.5, 9, 1.6);
  g.closePath();
  g.fillStyle = '#fffaf0'; g.fill();
  g.beginPath(); g.ellipse(0, 2, 12, 3.6, 0, 0, Math.PI * 2);
  g.fillStyle = '#f7f1e2'; g.fill();
  g.lineWidth = 0.9; g.strokeStyle = 'rgba(110,100,80,.6)'; g.stroke();
  g.fillStyle = 'rgba(255,255,255,.85)';
  for(const p of [[-6, -11], [2, -13], [7, -9], [-1, -14]]){
    g.beginPath(); g.arc(p[0], p[1], 0.9, 0, Math.PI * 2); g.fill();
  }
}
function kProduceIcon(g, id){
  const pal = K_VEGGIE_PALETTE[id] || K_VEGGIE_FALLBACK;
  if(id === 'carrot')        kCarrotIcon(g, pal);
  else if(id === 'potato')   kPotatoIcon(g, pal);
  else if(id === 'rice')     kRiceIcon(g, pal);
  else if(id === 'wheat')    kWheatIcon(g, pal);
  else if(id === 'chili')    kChiliIcon(g, pal);
  else if(id === 'eggplant') kEggplantIcon(g, pal);
  else if(id === 'tomato')   kTomatoIcon(g, pal);
  else if(id === 'cabbage')  kCabbageIcon(g, pal);
  else if(id === 'corn')     kCornIcon(g, pal);
  else if(id === 'pumpkin')  kPumpkinIcon(g, pal);
  else if(id === 'strawberry') kStrawberryIcon(g, pal);
  else if(id === 'flour')    kFlourIcon(g);
  else kCrateIcon(g);
}

/* ---------- 切好的菜块 ---------- */
function kChunkCube(g, r, pal, id){
  roundRect(g, -r, -r * 0.86, r * 2, r * 1.72, r * 0.42);
  const grd = g.createLinearGradient(-r, -r, r, r);
  grd.addColorStop(0, pal.body2); grd.addColorStop(0.55, pal.body); grd.addColorStop(1, pal.dark);
  g.fillStyle = grd; g.fill();
  g.lineWidth = 0.7; g.strokeStyle = pal.dark; g.stroke();
  roundRect(g, -r * 0.72, -r * 0.62, r * 0.9, r * 0.5, r * 0.2);
  g.fillStyle = 'rgba(255,255,255,.3)'; g.fill();
  if(id === 'carrot'){
    g.beginPath(); g.arc(0, 0, r * 0.34, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,225,180,.75)'; g.fill();
  } else if(id === 'potato'){
    g.beginPath(); g.ellipse(r * 0.22, r * 0.12, r * 0.2, r * 0.14, 0.4, 0, Math.PI * 2);
    g.fillStyle = 'rgba(90,60,20,.55)'; g.fill();
  } else if(id === 'eggplant'){
    g.fillStyle = 'rgba(255,245,220,.8)';
    for(let i = 0; i < 3; i++){
      g.beginPath(); g.ellipse(-r * 0.3 + i * r * 0.35, r * 0.16, r * 0.1, r * 0.16, 0, 0, Math.PI * 2); g.fill();
    }
  } else if(id === 'tomato'){
    g.beginPath(); g.ellipse(0, 0, r * 0.42, r * 0.3, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,220,190,.75)'; g.fill();
  } else if(id === 'cabbage'){
    g.strokeStyle = 'rgba(246,255,228,.8)'; g.lineWidth = Math.max(0.4, r * 0.13);
    for(const t of [-0.45, 0, 0.45]){
      g.beginPath(); g.moveTo(t * r * 0.7, r * 0.52);
      g.quadraticCurveTo(t * r * 1.1, 0, t * r * 0.6, -r * 0.5); g.stroke();
    }
  } else if(id === 'corn'){
    g.fillStyle = pal.body2;
    for(let i = 0; i < 3; i++){
      for(let j = 0; j < 2; j++){
        g.beginPath();
        g.arc((j - 0.5) * r * 0.52 + (i % 2 ? r * 0.2 : 0), (i - 1) * r * 0.46, r * 0.14, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if(id === 'strawberry'){
    g.fillStyle = 'rgba(255,246,205,.9)';
    for(let i = 0; i < 3; i++){
      for(let j = -1; j <= 1; j++){
        g.beginPath();
        g.ellipse(j * r * 0.42 + (i % 2 ? r * 0.16 : 0), (i - 1) * r * 0.42, r * 0.1, r * 0.13, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}
function kChunkWedge(g, r, pal){
  g.beginPath();
  g.moveTo(-r, -r * 0.55);
  g.quadraticCurveTo(r * 0.2, -r * 1.15, r, -r * 0.15);
  g.quadraticCurveTo(r * 0.2, r * 0.95, -r, r * 0.55);
  g.quadraticCurveTo(-r * 1.25, 0, -r, -r * 0.55);
  g.closePath();
  const grd = g.createLinearGradient(-r, -r, r, r);
  grd.addColorStop(0, pal.body2); grd.addColorStop(1, pal.body);
  g.fillStyle = grd; g.fill();
  g.lineWidth = 0.8; g.strokeStyle = pal.dark; g.stroke();
  g.beginPath(); g.ellipse(r * 0.15, 0, r * 0.5, r * 0.32, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,235,200,.8)'; g.fill();
  g.fillStyle = pal.dark;
  for(const p of [[-0.1, -0.2], [0.42, 0.26], [0.52, -0.16]]){
    g.beginPath(); g.ellipse(r * p[0], r * p[1], r * 0.1, r * 0.14, 0.3, 0, Math.PI * 2); g.fill();
  }
}
function kChunkGrain(g, r, pal){
  g.beginPath(); g.ellipse(0, 0, r * 0.62, r * 1.02, 0.2, 0, Math.PI * 2);
  const grd = g.createLinearGradient(-r, -r, r, r);
  grd.addColorStop(0, '#fff6d8'); grd.addColorStop(0.5, pal.body2); grd.addColorStop(1, pal.dark);
  g.fillStyle = grd; g.fill();
  g.lineWidth = 0.7; g.strokeStyle = pal.dark; g.stroke();
}
function kChunkShape(g, id, x, y, r, rot, pal){
  pal = pal || K_VEGGIE_PALETTE[id] || K_VEGGIE_FALLBACK;
  g.save(); g.translate(x, y); g.rotate(rot || 0);
  if(id === 'tomato' || id === 'chili') kChunkWedge(g, r, pal);
  else if(id === 'rice' || id === 'wheat') kChunkGrain(g, r, pal);
  else kChunkCube(g, r, pal, id);
  g.restore();
}
function kPieceIcon(g, id){
  const pal = K_VEGGIE_PALETTE[id] || K_VEGGIE_FALLBACK;
  const spots = [[-5, 3.4, -0.3], [4.4, -3, 0.26], [3.4, 6.4, 0.1]];
  for(const sp of spots) kChunkShape(g, id, sp[0], sp[1], 6.2, sp[2], pal);
}

/* ---------- 菜品：面包 / 一锅菜 + 品质滤镜 ---------- */
function kSparkle(g, x, y, r){
  g.save(); g.translate(x, y);
  g.fillStyle = 'rgba(255,246,190,.95)';
  g.beginPath();
  g.moveTo(0, -r);
  g.quadraticCurveTo(r * 0.18, -r * 0.18, r, 0);
  g.quadraticCurveTo(r * 0.18, r * 0.18, 0, r);
  g.quadraticCurveTo(-r * 0.18, r * 0.18, -r, 0);
  g.quadraticCurveTo(-r * 0.18, -r * 0.18, 0, -r);
  g.closePath(); g.fill();
  g.restore();
}
/* 品质滤镜：精品＝暖亮+星光；焦糊＝暗褐+烟；正常＝无 */
function kQualityFX(g, quality){
  if(quality === 'perfect'){
    g.save();
    g.globalCompositeOperation = 'lighter';
    const gl = g.createRadialGradient(0, 1, 2, 0, 1, 18);
    gl.addColorStop(0, 'rgba(255,214,120,.42)'); gl.addColorStop(1, 'rgba(255,214,120,0)');
    g.fillStyle = gl;
    g.beginPath(); g.arc(0, 1, 18, 0, Math.PI * 2); g.fill();
    g.restore();
    kSparkle(g, -9, -9, 3.2); kSparkle(g, 10, -5, 2.4); kSparkle(g, 5, 9, 2);
  } else if(quality === 'burnt'){
    g.save();
    g.beginPath(); g.ellipse(0, 1, 14, 8, 0, 0, Math.PI * 2); g.clip();
    g.fillStyle = 'rgba(40,24,14,.6)'; g.fillRect(-20, -20, 40, 40);
    g.restore();
    g.save();
    g.fillStyle = 'rgba(120,118,112,.45)';
    for(const p of [[-5, -12, 2.8], [1, -14.5, 3.4], [6, -11, 2.2]]){
      g.beginPath(); g.arc(p[0], p[1], p[2], 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(80,76,70,.35)';
    for(const p of [[-2, -14.5, 2.4], [4, -15, 2]]){
      g.beginPath(); g.arc(p[0], p[1], p[2], 0, Math.PI * 2); g.fill();
    }
    g.restore();
    g.fillStyle = 'rgba(30,18,10,.7)';
    for(const p of [[-6, 2], [4, 5], [0, -1]]){
      g.beginPath(); g.arc(p[0], p[1], 1.1, 0, Math.PI * 2); g.fill();
    }
  }
}
function kDishBreadIcon(g){
  const grd = g.createLinearGradient(0, -12, 0, 12);
  grd.addColorStop(0, '#f2c079'); grd.addColorStop(0.5, '#d99a4a'); grd.addColorStop(1, '#a86a28');
  g.beginPath();
  g.moveTo(-13, 8);
  g.quadraticCurveTo(-15, -4, -6, -9);
  g.quadraticCurveTo(0, -12.5, 6, -9);
  g.quadraticCurveTo(15, -4, 13, 8);
  g.quadraticCurveTo(0, 11, -13, 8);
  g.closePath();
  g.fillStyle = grd; g.fill();
  g.lineWidth = 1; g.strokeStyle = '#7a4a18'; g.stroke();
  g.strokeStyle = 'rgba(255,240,210,.75)'; g.lineWidth = 1.4;
  for(let i = -1; i <= 1; i++){
    g.beginPath(); g.moveTo(i * 6 - 2.6, -7); g.lineTo(i * 6 + 2.6, 2); g.stroke();
  }
  g.fillStyle = 'rgba(255,252,240,.85)';
  for(const p of [[-7, 4], [3, 6], [8, 2]]){
    g.beginPath(); g.arc(p[0], p[1], 0.85, 0, Math.PI * 2); g.fill();
  }
}
function kBowlIcon(g, info){
  const pieces = info.pieces || [];
  g.beginPath();
  g.moveTo(-14, 1);
  g.quadraticCurveTo(-12, 13, 0, 14);
  g.quadraticCurveTo(12, 13, 14, 1);
  g.closePath();
  const bg = g.createLinearGradient(0, 0, 0, 14);
  bg.addColorStop(0, '#f0e6d2'); bg.addColorStop(1, '#9a8f7a');
  g.fillStyle = bg; g.fill();
  g.lineWidth = 1; g.strokeStyle = 'rgba(60,50,35,.6)'; g.stroke();
  g.beginPath(); g.ellipse(0, 1, 14, 4.2, 0, 0, Math.PI * 2);
  const sg = g.createLinearGradient(0, -3, 0, 5);
  sg.addColorStop(0, '#cf9440'); sg.addColorStop(1, '#7a4a18');
  g.fillStyle = sg; g.fill();
  const ps = pieces.slice(0, 6), n = ps.length;
  for(let i = 0; i < n; i++){
    const t = n === 1 ? 0 : (i / (n - 1) - 0.5);
    const px = t * 19, py = 1 - Math.abs(t) * 2.2 + (i % 2 ? -1.6 : 0.6);
    kChunkShape(g, ps[i], px, py, 4.2, t * 0.6, K_VEGGIE_PALETTE[ps[i]] || K_VEGGIE_FALLBACK);
  }
  if(info.quality !== 'burnt'){
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1.1;
    for(const sx of [-4.5, 2.5]){
      g.beginPath(); g.moveTo(sx, -3);
      g.quadraticCurveTo(sx + 2.4, -7, sx, -11); g.stroke();
    }
  }
}
/* 从 key（id|quality|piece,piece）或 state.dishes 里还原菜品信息 */
function kDishInfo(dishKey){
  const bits = String(dishKey == null ? '' : dishKey).split('|');
  let id = bits[0] || 'mix';
  let quality = bits[1] || 'normal';
  let pieces = bits[2] ? bits[2].split(',').filter(Boolean) : null;
  let name = '', emoji = '';
  const rec = (typeof state !== 'undefined' && state && state.dishes) ? state.dishes[dishKey] : null;
  if(rec){
    id = rec.id || id;
    quality = rec.quality || quality;
    if(rec.pieces && rec.pieces.length) pieces = rec.pieces.slice();
    name = rec.name || ''; emoji = rec.emoji || '';
  }
  if(!pieces){
    if(id === 'bread') pieces = ['flour'];
    else {
      const combo = (typeof POT_COMBOS !== 'undefined') ? POT_COMBOS.find(c => c.id === id) : null;
      if(combo){
        pieces = [];
        for(const k in combo.need) for(let i = 0; i < combo.need[k]; i++) pieces.push(k);
      } else if(typeof DISHES !== 'undefined' && DISHES[id] && DISHES[id].pieces){
        pieces = DISHES[id].pieces.slice();
      } else {
        pieces = ['potato', 'carrot'];
      }
    }
  }
  if(!name){
    const combo = (typeof POT_COMBOS !== 'undefined') ? POT_COMBOS.find(c => c.id === id) : null;
    name = combo ? combo.name
      : (typeof DISHES !== 'undefined' && DISHES[id] ? DISHES[id].name
      : (typeof POT_FALLBACK !== 'undefined' ? POT_FALLBACK.name : id));
  }
  if(!emoji){
    const combo = (typeof POT_COMBOS !== 'undefined') ? POT_COMBOS.find(c => c.id === id) : null;
    emoji = combo ? combo.emoji
      : (typeof DISHES !== 'undefined' && DISHES[id] ? DISHES[id].emoji
      : (typeof POT_FALLBACK !== 'undefined' ? POT_FALLBACK.emoji : '🍲'));
  }
  return { id, quality: (typeof QUALITY !== 'undefined' && QUALITY[quality]) ? quality : 'normal', pieces, name, emoji };
}
/* ---------- 统一入口 ---------- */
function drawItemIcon(g, key, cx, cy, size){
  if(!g || key == null) return;
  size = size || 32;
  const raw = String(key);
  const i = raw.indexOf(':');
  const kind = i < 0 ? 'crop' : raw.slice(0, i);
  const rest = i < 0 ? raw : raw.slice(i + 1);
  g.save();
  g.translate(cx, cy);
  g.scale(size / 32, size / 32);
  if(kind === 'crop' || kind === 'produce')       kProduceIcon(g, rest);
  else if(kind === 'piece' || kind === 'chunk')   kPieceIcon(g, rest);
  else if(kind === 'prep')                        (rest === 'flour' ? kFlourIcon(g) : kProduceIcon(g, rest));
  else if(kind === 'dish' || kind === 'plate')    kDishEntry(g, rest);
  else if(CROPS[raw])                             kProduceIcon(g, raw);
  else                                            kCrateIcon(g);
  g.restore();
}
function kDishEntry(g, dishKey){
  const info = kDishInfo(dishKey);
  if(info.id === 'bread') kDishBreadIcon(g);
  else if(info.id === 'roast' && info.pieces && info.pieces.length) kPieceIcon(g, info.pieces[0]);  /* 烤菜：就用被烤的那块的形状 */
  else kBowlIcon(g, info);
  kQualityFX(g, info.quality);   /* 精品=金光+星点，正常=熟色，焦糊=黑棕+烟 */
}
