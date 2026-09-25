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

  // 1. 地块
  for(const idx of drawOrder){
    const t = state.tiles[idx];
    const { sx, sy } = iso(t.gx, t.gy);
    const px = cx + sx*SCALE, py = cy + sy*SCALE;
    if(px < -w || px > W+w || py < -h-D || py > H+h+D) continue;
    drawTileBlock(px, py, t);
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
