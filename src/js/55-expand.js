/* ============ 扩建 ============
 * 模型：整块岛 = 耕地。开局 3×3，买一个面就是 4×3，再买另一个面就是 4×4。
 * 规则：
 *   - 四个方向都能买，每次买「相邻的 1 排」（1 列/1 行），岛与耕地一起长。
 *   - 单价 20 起，指数递增（×1.5），封顶 1000。
 *   - 左上/右上各有限制：最多再扩 UP_PLANT_LIMIT 排可耕地；超过后每次买的是
 *     STONE_ROWS 排「石头地面」——不增加可种植地块，但可以布设装饰。
 *   - 右下/左下没有可耕上限，可以一直把耕地铺开。
 * 交互：开启扩建模式后，地图上会出现 4 条发光长条（带价格），点哪条就买哪条；
 *       小人不会走过去（扩建位置本来就不在当前岛内）。Esc 或再点一次按钮退出。
 */
const EXPAND_DIRS = [
  { id:'xn', label:'左上', hint:'往左上长一排' },
  { id:'yn', label:'右上', hint:'往右上长一排' },
  { id:'xp', label:'右下', hint:'往右下长一排' },
  { id:'yp', label:'左下', hint:'往左下长一排' },
];
/* 每个方向单独计数、单独定价：都是 10 起、各自 ×1.5 递增、各自封顶 1000 */
function expandCountOf(dir){
  const c = state.expandCount;
  if(!c || typeof c !== 'object') return 0;
  return c[dir] | 0;
}
function expandPrice(dir){
  if(dir === undefined) return EXPAND_BASE;
  return Math.min(EXPAND_CAP, Math.round(EXPAND_BASE * Math.pow(EXPAND_RATE, expandCountOf(dir))));
}
function expandKind(dir){
  const f = state.farm;
  if(dir === 'xn' || dir === 'yn'){
    return ((state.upExpand && state.upExpand[dir]) || 0) >= UP_PLANT_LIMIT ? 'stone' : 'farm';
  }
  /* 右下/左下（画面上「下方」两向）：**没有上限，一直扩草地** ——
     每次都真的多一排可开垦的草地，不会再在 14 排处被换成石头地。
     价格仍按每方向独立 ×1.5 递增、1000 封顶，所以经济上自己会收敛。 */
  return 'farm';
}
/* 这一笔买下去会新增的区域 */
function expandStrip(dir, kind){
  const f = state.farm, m = state.map;
  if(kind === 'farm'){
    if(dir === 'xn') return { x0:f.x0 - 1,   y0:f.y0,       w:1,   h:f.h };
    if(dir === 'xp') return { x0:f.x0 + f.w, y0:f.y0,       w:1,   h:f.h };
    if(dir === 'yn') return { x0:f.x0,       y0:f.y0 - 1,   w:f.w, h:1   };
    return                  { x0:f.x0,       y0:f.y0 + f.h, w:f.w, h:1   };
  }
  if(dir === 'xn') return { x0:m.x0 - STONE_ROWS, y0:m.y0,       w:STONE_ROWS, h:m.h };
  if(dir === 'xp') return { x0:m.x0 + m.w,        y0:m.y0,       w:STONE_ROWS, h:m.h };
  if(dir === 'yn') return { x0:m.x0,              y0:m.y0 - STONE_ROWS, w:m.w, h:STONE_ROWS };
  return                  { x0:m.x0,              y0:m.y0 + m.h, w:m.w, h:STONE_ROWS };
}
function expandInfo(dir){
  const d = EXPAND_DIRS.find(x => x.id === dir);
  if(!d) return null;
  const kind = expandKind(dir);
  return { dir, kind, price: expandPrice(dir), strip: expandStrip(dir, kind), label: d.label, hint: d.hint };
}
function rectInside(inner, outer){
  return inner.x0 >= outer.x0 && inner.y0 >= outer.y0 &&
         inner.x0 + inner.w <= outer.x0 + outer.w && inner.y0 + inner.h <= outer.y0 + outer.h;
}
/* ============ v9.5 迁移：老存档「下方意外石头地」还原 ============
 * v9.4 及以前：右下/左下买满 14 排后，再买只给石头地面（不能种、只能摆装饰）。
 * v9.5 起改规则：下方两向一直给可开垦的草地，石头只出现在左上/右上（玩家故意扩出来的装饰区）。
 * 所以老存档里「贴在农场右侧/下方的石头列/行」要还原成**草地 + 杂物**并入农场 ——
 * 那本来就是玩家花过钱的地；有装饰物的格子保留石头地（那是自己摆的展示区，别拆）。 */
function normalizeOldLowerStone(target){
  /* target 可选：读档时传进来的是「还没挂到全局 state 上的新档对象」 */
  const S = target || state;
  const f = S.farm, m = S.map;
  if(!f || !m || !S.tiles) return 0;
  const hasDecor = (gx, gy) => S.decorations.some(d => d.gx === gx && d.gy === gy);
  const at = (gx, gy) => S.tiles.find(t => t.gx === gx && t.gy === gy);
  let newW = f.w, newH = f.h;
  /* 只沿「农场自身那一带」扫，避免把左上/右上那条通高石头带误判成下方多出来的地 */
  for(let gx = f.x0 + f.w; gx < m.x0 + m.w; gx++){
    let any = false;
    for(let gy = f.y0; gy < f.y0 + f.h; gy++){ const t = at(gx, gy); if(t && t.stone){ any = true; break; } }
    if(any) newW = gx + 1 - f.x0; else break;
  }
  for(let gy = f.y0 + f.h; gy < m.y0 + m.h; gy++){
    let any = false;
    for(let gx = f.x0; gx < f.x0 + f.w; gx++){ const t = at(gx, gy); if(t && t.stone){ any = true; break; } }
    if(any) newH = gy + 1 - f.y0; else break;
  }
  if(newW === f.w && newH === f.h) return 0;
  const fresh = [];
  for(const t of S.tiles){
    if(!t.stone) continue;
    if(t.gx < f.x0 || t.gy < f.y0) continue;                  /* 顶部两向的石头地：设计的一部分 */
    if(t.gx >= f.x0 + newW || t.gy >= f.y0 + newH) continue;   /* 不在这次并入的范围里 */
    if(hasDecor(t.gx, t.gy)) continue;                        /* 有装饰 → 保留石头地 */
    t.stone = false; t.state = 'wild'; t.terrain = 'grass';
    t.crop = null; t.growth = 0; t.watered = false; t.fertile = false; t.harvestsLeft = 0;
    fresh.push(t);
  }
  f.w = newW; f.h = newH;                                     /* 这块地当初就买过，直接并进农场 */
  if(fresh.length) scatterWeeds(fresh, 0.5, S);               /* 长满杂草/石头/花/树，清完才能开垦 */
  return fresh.length;
}

/* ============ v9.10 迁移：补齐上方石头带里漏成草地的格子 ============
 * 左上 / 右上两向：前 3 排是可耕地，之后每次买到的就是 **3 排石头地面**（只能摆装饰）。
 * v9.8 之前，扩建只把「全新的一整块矩形」刷成石头：之后再从别的方向扩地时，
 * 穿过石头带的新那一列/行会是草地 —— 石头带里就夹了草。新版会继承石头属性，
 * 但**老存档里已有的洞**要补一次。
 * 只处理「从农场边界往外、那一列/行确实含石头」的列/行，
 * 所以不会误伤开局那片普通草原，也不会碰玩家自己摆的东西。 */
function normalizeTopStone(target){
  const S = target || state;
  const f = S.farm, m = S.map;
  if(!f || !m || !S.tiles) return 0;
  const colHasStone = gx => S.tiles.some(t => t.gx === gx && t.stone);
  const rowHasStone = gy => S.tiles.some(t => t.gy === gy && t.stone);
  const fresh = [];
  const toStone = t => {
    if(t.stone) return;
    t.stone = true; t.terrain = 'stone'; t.state = 'wild';
    t.crop = null; t.growth = 0; t.watered = false; t.fertile = false; t.harvestsLeft = 0;
    fresh.push(t);
  };
  /* 左：从农场左边界往外，只要这一列里有石头就继续（左上方向每次补 3 列） */
  for(let gx = f.x0 - 1; gx >= m.x0; gx--){
    if(!colHasStone(gx)) break;
    for(const t of S.tiles) if(t.gx === gx) toStone(t);
  }
  /* 上：同理（右上方向每次补 3 行） */
  for(let gy = f.y0 - 1; gy >= m.y0; gy--){
    if(!rowHasStone(gy)) break;
    for(const t of S.tiles) if(t.gy === gy) toStone(t);
  }
  /* 兜底：农场范围内的**空置**石头格是历史遗留（玩家自己造不出石头，也没法种），还原成草地；
     上面摆了装饰的保留石头（那是玩家的展示区，跟 v9.5 的规矩一致）。 */
  const hasDecor = (gx, gy) => S.decorations.some(d => d.gx === gx && d.gy === gy);
  for(const t of S.tiles){
    if(!t.stone) continue;
    if(t.gx < f.x0 || t.gy < f.y0) continue;
    if(t.gx >= f.x0 + f.w || t.gy >= f.y0 + f.h) continue;
    if(hasDecor(t.gx, t.gy)) continue;
    t.stone = false; t.terrain = 'grass'; t.state = 'wild';
  }
  if(fresh.length) scatterWeeds(fresh, 0.28, S);   /* 跟平时买石头地一样的杂草概率 */
  return fresh.length;
}

function doExpand(dir){
  const info = expandInfo(dir);
  if(!info) return { ok:false, msg:'方向不对' };
  if(state.coins < info.price) return { ok:false, msg:`金币不够（需要 ${info.price} 金）` };
  const s = info.strip, m = state.map;

  if(info.kind === 'farm'){
    /* 岛要跟着长大：这一排在岛外就先外扩 1 格（旧的 14×14 存档里可能已经在岛内） */
    if(!rectInside(s, m)){
      let newMap;
      if(dir === 'xn')      newMap = { x0:m.x0 - 1, y0:m.y0,     w:m.w + 1, h:m.h };
      else if(dir === 'xp') newMap = { x0:m.x0,     y0:m.y0,     w:m.w + 1, h:m.h };
      else if(dir === 'yn') newMap = { x0:m.x0,     y0:m.y0 - 1, w:m.w,     h:m.h + 1 };
      else                  newMap = { x0:m.x0,     y0:m.y0,     w:m.w,     h:m.h + 1 };
      rebuildMapTiles(newMap, null);
    }
    const fresh = [];
    for(let y = s.y0; y < s.y0 + s.h; y++){
      for(let x = s.x0; x < s.x0 + s.w; x++){
        const t = getTile(x, y);
        if(!t) continue;
        t.stone = false; t.state = 'wild'; t.terrain = 'grass';   /* 新买的地是草地，要自己开垦 */
        t.crop = null; t.growth = 0; t.watered = false; t.fertile = false;
        fresh.push(t);
      }
    }
    const weeds = scatterWeeds(fresh, 0.5);                       /* 新地杂草丛生 */
    if(dir === 'xn'){ state.farm.x0 -= 1; state.farm.w += 1; }
    else if(dir === 'xp'){ state.farm.w += 1; }
    else if(dir === 'yn'){ state.farm.y0 -= 1; state.farm.h += 1; }
    else { state.farm.h += 1; }
    if(dir === 'xn' || dir === 'yn'){
      state.upExpand = state.upExpand || { xn:0, yn:0 };
      state.upExpand[dir] = (state.upExpand[dir] || 0) + 1;
    }
    state.coins -= info.price;
    state.expandCount[dir] = expandCountOf(dir) + 1;
    trackAction('expand');
    save(); renderHUD(); renderExpandHint();
    return { ok:true, kind:'farm',
      msg:`扩建成功：${info.label} 新增 1 排草地（杂草 ${weeds} 处，需自己清理开垦），现在 ${state.farm.w}×${state.farm.h}` };
  }

  /* 石头地面：岛外扩 STONE_ROWS，耕地不变 */
  let newMap;
  if(dir === 'xn')      newMap = { x0:m.x0 - STONE_ROWS, y0:m.y0, w:m.w + STONE_ROWS, h:m.h };
  else if(dir === 'xp') newMap = { x0:m.x0, y0:m.y0, w:m.w + STONE_ROWS, h:m.h };
  else if(dir === 'yn') newMap = { x0:m.x0, y0:m.y0 - STONE_ROWS, w:m.w, h:m.h + STONE_ROWS };
  else                  newMap = { x0:m.x0, y0:m.y0, w:m.w, h:m.h + STONE_ROWS };
  rebuildMapTiles(newMap, s);
  const stoneFresh = [];
  for(let y = s.y0; y < s.y0 + s.h; y++) for(let x = s.x0; x < s.x0 + s.w; x++){
    const t = getTile(x, y); if(t && t.stone) stoneFresh.push(t);
  }
  scatterWeeds(stoneFresh, 0.28);
  state.coins -= info.price;
  state.expandCount[dir] = expandCountOf(dir) + 1;
  trackAction('expand');
  save(); renderHUD(); renderExpandHint();
  return { ok:true, kind:'stone', msg:`${info.label} 可耕已到上限：新增 ${STONE_ROWS} 排石头地面（可布设装饰）` };
}
function buyExpand(dir){
  const r = doExpand(dir);
  SFX.play(r.ok ? 'buy' : 'error');
  toast(r.msg);
  if(r.ok) spawnParticles(W / 2, H / 2, r.kind === 'stone' ? 'till' : 'sparkle', 10);
  return r;
}

/* ---------- 扩建模式 ---------- */
function toggleExpandMode(force){
  const on = (force === undefined) ? !state.expandMode : !!force;
  state.expandMode = on;
  state.expandPreview = null;
  renderExpandHint();
  renderToolbar();
  if(on) toast('扩建模式：点击地图上发光的长条购买（Esc 退出）');
  return on;
}
function expandDirAt(gx, gy){
  for(const d of EXPAND_DIRS){
    const info = expandInfo(d.id);
    if(info && inRect(info.strip, gx, gy)) return d.id;
  }
  return null;
}
function renderExpandHint(){
  const el = document.getElementById('expandBar');
  const btn = document.getElementById('btnExpand');
  if(btn) btn.classList.toggle('active', !!state.expandMode);
  if(!el) return;
  if(!state.expandMode){ el.classList.remove('show'); return; }
  el.classList.add('show');
  const f = state.farm, m = state.map, price = expandPrice('xp');
  const rows = EXPAND_DIRS.map(d => {
    const info = expandInfo(d.id);
    const kind = info.kind === 'farm' ? '耕地' : '石头';
    const poor = state.coins < info.price ? ' poor' : '';
    return `<span class="eb-item${poor}">${d.label} <b>${info.price}</b> ${kind}</span>`;
  }).join('');
  el.innerHTML = `
    <div class="eb-row"><span class="eb-title">💰 扩建</span>${rows}</div>
    <div class="eb-row eb-sub">耕地 ${f.w}×${f.h} · 岛 ${m.w}×${m.h} · 每个方向 <b>${EXPAND_BASE}</b> 起各自 ×${EXPAND_RATE}（封顶 ${EXPAND_CAP}）· 新买的地是草地 · 点击发光长条购买 · 点击同一处可连买 · Esc 退出</div>`;
}

/* ---------- 画布：4 条候选长条（扩建模式下常显，悬停高亮） ---------- */
function drawExpandGhost(g, cx, cy){
  if(!state.expandMode) return;
  const w = TILE_W * SCALE, h = TILE_H * SCALE;
  for(const d of EXPAND_DIRS){
    const info = expandInfo(d.id);
    if(!info) continue;
    const s = info.strip;
    const farm = info.kind === 'farm';
    const hot = state.expandPreview === d.id;
    const afford = state.coins >= info.price;
    g.save();
    g.globalAlpha = hot ? 0.62 : 0.34;
    for(let y = s.y0; y < s.y0 + s.h; y++){
      for(let x = s.x0; x < s.x0 + s.w; x++){
        const { sx, sy } = iso(x, y);
        const px = cx + sx * SCALE, py = cy + sy * SCALE;
        g.beginPath();
        g.moveTo(px, py - h / 2); g.lineTo(px + w / 2, py);
        g.lineTo(px, py + h / 2); g.lineTo(px - w / 2, py);
        g.closePath();
        g.fillStyle = !afford ? 'rgba(200,120,120,.30)'
                    : farm ? 'rgba(120,220,120,.34)' : 'rgba(190,190,205,.32)';
        g.fill();
        g.strokeStyle = !afford ? 'rgba(255,150,150,.85)'
                      : farm ? 'rgba(180,255,170,.9)' : 'rgba(230,230,240,.85)';
        g.lineWidth = hot ? 2.6 : 1.6;
        g.stroke();
      }
    }
    g.restore();
    /* 价格标签 */
    const { sx, sy } = iso(s.x0 + (s.w - 1) / 2, s.y0 + (s.h - 1) / 2);
    const px = cx + sx * SCALE, py = cy + sy * SCALE - 26;
    g.save();
    g.font = 'bold 13px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    g.textAlign = 'center';
    const text = `${d.label} ${farm ? '耕地' : '石头'} ${info.price}`;
    const tw = g.measureText(text).width + 16;
    g.fillStyle = afford ? 'rgba(18,24,18,.86)' : 'rgba(60,20,20,.86)';
    roundRect(g, px - tw / 2, py - 13, tw, 20, 10); g.fill();
    g.fillStyle = afford ? (farm ? '#c8f7c5' : '#e6e6f0') : '#ffbdbd';
    g.fillText(text, px, py + 1);
    g.restore();
  }
}
