/* ============ 地表层离屏缓存（v9.25） ============
 * 「地块那一层」（每格 3 个面 + 砂粒/噪点/垄痕）是每帧最贵的部分，但它**只在
 * 相机 / 缩放 / 地块外观变化时才需要重画** —— 看作物长、小人干活、框选作业在跑的时候
 * 画面都是静的。这里把它画进一张离屏 canvas，命中就只 drawImage 一次。
 *
 * 命中判断用哈希（相机 + 缩放 + 视口 + 逐格外观码），而不是"脏标记"：
 * 漏掉任何一处地块改动都会留下肉眼可见的错画面（比如开垦完还显示草地），
 * 而哈希只是几千次整数运算（微秒级）—— 宁可多算一点也不画错。
 * 外观相关的字段全在 tileColors() 里：stone / state / (growing && harvestsLeft>0) / watered / fertile|fertLeft。
 */
let groundCache = null;
function tileGroundCode(t){
  let c = 0;
  if(t.stone) c |= 1;
  if(t.state === 'ready') c |= 2;
  else if(t.state === 'wild') c |= 4;
  else if(t.state === 'growing') c |= 8;
  if(t.state === 'growing' && t.harvestsLeft > 0) c |= 16;
  if(t.watered) c |= 32;
  if(t.fertile || (t.fertLeft || 0) > 0) c |= 64;
  return c;
}
function groundSig(cx, cy, W0, H0){
  let h = 2166136261;
  const mix = v => { h = Math.imul(h ^ (v | 0), 16777619); };
  mix(cx * 4); mix(cy * 4); mix(viewZoom() * 1000); mix(W0); mix(H0);
  for(let i = 0; i < drawOrder.length; i++){
    const t = state.tiles[drawOrder[i]];
    if(!t) continue;
    mix(tileGroundCode(t) + t.gx * 31 + t.gy);
  }
  return h | 0;
}
/* 拿缓存画布（尺寸变了就重建；建不出来就返回 null，自动退回直接画） */
function groundCacheFor(W0, H0){
  const cw = Math.max(1, Math.round(W0 * DPR)), ch = Math.max(1, Math.round(H0 * DPR));
  if(groundCache && groundCache.canvas.width === cw && groundCache.canvas.height === ch) return groundCache;
  try{
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const g = cv.getContext('2d');
    if(!g) return null;
    groundCache = { canvas: cv, g, sig: 0 };
    return groundCache;
  }catch(e){ return null; }
}
/* 把地块那层画到目标 ctx 上（主画布或缓存画布） */
function drawTilePass(cx, cy){
  const w = TILE_W*SCALE, h = TILE_H*SCALE, D = THICKNESS*SCALE;
  for(const idx of drawOrder){
    const t = state.tiles[idx];
    const { sx, sy } = iso(t.gx, t.gy);
    const px = cx + sx*SCALE, py = cy + sy*SCALE;
    if(px < -w || px > W+w || py < -h-D || py > H+h+D) continue;
    drawTileBlock(px, py, t);
  }
}
function blitGround(W0, H0, cv){
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.drawImage(cv, 0, 0, W0, H0);
  ctx.restore();
}
function render(){
  ctx.clearRect(0, 0, W, H);
  drawAtmosphereBack(ctx);                       /* 天空铺满整屏，不参与缩放 */

  const W0 = W, H0 = H;
  const zoom = viewZoom();
  renderZoom = zoom;               /* 地块细节分级用（见 40-tiles.js tileLOD） */
  const w = TILE_W*SCALE, h = TILE_H*SCALE, D = THICKNESS*SCALE;

  /* 世界层整体缩放。坐标换算（设备坐标 d ↔ 未缩放坐标 u）：
   *   d = W0/2 + zoom*(u - W0/2)            （以画布中心为锚点缩放）
   * 内部裁剪用的是「原点在 0、尺寸 W×H」的约定，所以缩放时把绘制坐标系换成
   *   p = u - W0/2 + W/2   (W = W0/zoom)
   * 这样 p 的可见范围正好是 [0, W]，相机在原坐标系里的偏移等价于 p 系里的 W/2+camera，
   * 画布变换则用 translate(W0/2) → scale(zoom) → translate(-W/2)。
   * 之前只改了 W/H 没换原点，导致放大后边缘地块被误裁剪（"缩放会隐藏地块"）。 */
  ctx.save();
  let cx, cy;
  if(Math.abs(zoom - 1) > 0.001){
    W = W0 / zoom; H = H0 / zoom;
    ctx.translate(W0/2, H0/2);
    ctx.scale(zoom, zoom);
    ctx.translate(-W/2, -H/2);
    cx = W/2 + state.camera.x;
    cy = H/2 + state.camera.y;
  } else {
    cx = W0/2 + state.camera.x;
    cy = H0/2 + state.camera.y;
  }

  // 1. 地块（命中缓存就只 blit 一次）
  {
    const gc = (state.tiles.length && !state.expandMode) ? groundCacheFor(W0, H0) : null;
    if(gc){
      const sig = groundSig(cx, cy, W0, H0);
      if(gc.sig === sig){
        blitGround(W0, H0, gc.canvas);
      } else {
        gc.sig = sig;
        const g = gc.g;
        g.setTransform(DPR, 0, 0, DPR, 0, 0);
        g.clearRect(0, 0, W0, H0);
        g.save();
        if(Math.abs(zoom - 1) > 0.001){
          g.translate(W0/2, H0/2); g.scale(zoom, zoom); g.translate(-W/2, -H/2);
        }
        withCtx(g, () => drawTilePass(cx, cy));
        g.restore();
        blitGround(W0, H0, gc.canvas);
      }
    } else {
      drawTilePass(cx, cy);
    }
  }

  // 1b. 地面细节层（犁沟图案之外的土粒/苔藓/水塘等）
  drawGroundLayer(ctx, cx, cy);

  // 2. 网格 / 地形边界
  if(state.showGrid){
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1;
    for(const idx of drawOrder){
      const t = state.tiles[idx];
      const { sx, sy } = iso(t.gx, t.gy);
      const px = cx + sx*SCALE, py = cy + sy*SCALE;
      if(px < -w || px > W+w || py < -h || py > H+h) continue;
      drawTileEdges(px, py, w, h);
    }
  } else drawTerrainBoundaries(cx, cy);

  // 2b. 动态阴影
  drawShadows(ctx, cx, cy);

  // 2c. 扩建候选长条（扩建模式下常显）
  if(typeof drawExpandGhost === 'function') drawExpandGhost(ctx, cx, cy);

  // 3. 作物
  for(const idx of drawOrder){
    const t = state.tiles[idx];
    if(!t.crop) continue;
    const { sx, sy } = iso(t.gx, t.gy);
    const px = cx + sx*SCALE, py = cy + sy*SCALE;
    if(px < -w || px > W+w || py < -h*2 || py > H+h*2) continue;
    drawCrop(px, py, t);
  }

  // 4. 装饰 + 小人（按深度排序，画在作物上方）
  const sprites = [];
  for(const d of state.decorations){
    /* 同格时地面层（地砖/水塘）压在下、立体装饰在上：depth 加一个小偏移 */
    const ground = (typeof decorLayer === 'function') && decorLayer(d.type) === 'ground';
    sprites.push({ type:'deco', d, depth: d.gx + d.gy + (ground ? -0.001 : 0) });
  }
  const pp = state.player;
  sprites.push({ type:'player', p: pp, depth: (pp.x != null ? pp.x : pp.gx) + (pp.y != null ? pp.y : pp.gy) });
  sprites.sort((a, b) => a.depth - b.depth);

  for(const s of sprites){
    if(s.type === 'deco'){
      const { sx, sy } = iso(s.d.gx, s.d.gy);
      const px = cx + sx*SCALE, py = cy + sy*SCALE;
      if(px < -80 || px > W+80 || py < -160 || py > H+80) continue;
      drawDecoration(ctx, px, py, s.d);
    } else {
      drawPlayer(ctx, cx, cy);
    }
  }

  // 5. 交互指示（悬停格 / 框选范围）也在世界层里，跟着一起缩放
  if(typeof drawInteractionUI === 'function') drawInteractionUI(ctx, cx, cy);

  W = W0; H = H0;
  ctx.restore();

  // 6. 粒子 + 特效 + 大气（设备坐标）
  drawParticles();
  drawEffects(ctx);
  drawAtmosphereFront(ctx);
}

/* ============ 屏幕 ↔ 网格（都要带上缩放） ============ */
function screenToGrid(clientX, clientY){
  const rect = canvas.getBoundingClientRect();
  const z = viewZoom();
  const sx = ((clientX - rect.left - W/2) / z - state.camera.x) / SCALE;
  const sy = ((clientY - rect.top  - H/2) / z - state.camera.y) / SCALE;
  const { wx, wy } = unIso(sx, sy);
  return { gx: Math.round(wx), gy: Math.round(wy) };
}
function gridToScreen(gx, gy){
  const { sx, sy } = iso(gx, gy);
  const z = viewZoom();
  return {
    x: W/2 + (state.camera.x + sx*SCALE) * z,
    y: H/2 + (state.camera.y + sy*SCALE) * z,
  };
}
function worldToScreen(t){ return gridToScreen(t.gx, t.gy); }
