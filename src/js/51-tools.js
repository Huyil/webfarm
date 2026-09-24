/* ============ 工具应用 ============
 * 所有操作都走「小人走过去 → 到位才动手」：
 *   单击     → 清掉手上的批量作业，只做这一格
 *   拖拽刷地 → 逐格排进工作队列（不瞬移），小人依次走过去做
 *   框选     → 用最近邻排出一条顺路，小人一路做完；中途点别处可取消
 */
/* 石头地面上所有工具的统一提示 */
const STONE_ONLY_DECOR = '这里只能放置装饰（侧栏 🏡 装饰）';

function applyToolAt(gx, gy, silent){
  const t = getTile(gx, gy);
  if(!t){ if(!silent) toast('超出农场范围'); return; }
  const tool = state.tool;
  if(tool === 'pan') return;
  if(silent){
    /* 拖拽：排队，等小人走到再动手（绝不瞬移） */
    const stop = queueStopMsg(tool);       /* 钱/肥料用光时不再继续排队空走 */
    if(stop){ playerClearQueue(); toastStop(stop); return; }
    playerEnqueue(gx, gy, tool);
    return;
  }
  /* 单击：取消未完成的批量作业，改做这一格 */
  if(jobActive()) playerClearQueue();
  playerGoto(gx, gy, tool, { gx, gy, silent: false, tool });
}

function runTool(gx, gy, silent, toolOverride){
  const t = getTile(gx, gy);
  if(!t){ if(!silent) toast('超出农场范围'); return; }
  /* 批量作业会带上「开单时的工具」：中途切工具不会把剩下的活干成别的 */
  const tool = toolOverride || state.tool;
  const sp = worldToScreen(t);

  /* 石头地面：除了「装饰」工具，其它工具一律拒绝，提示统一 */
  if(t.stone && tool !== 'decor' && tool !== 'pan' && tool !== 'hoe'){
    if(!silent){ toast(STONE_ONLY_DECOR); SFX.play('error'); }
    return;
  }

  if(tool === 'hoe'){
    /* ① 有装饰物：先敲掉它（杂草 1 下 / 石头 2 下 / 其他 3 下），敲光后才轮到开垦 */
    if(decorAt(gx, gy)){
      const hit = hitDecorationAt(gx, gy);
      SFX.play('till');
      spawnParticles(sp.x, sp.y - 4, 'till', 4);
      if(hit && hit.removed){
        toast(`敲掉了 ${DECOR_META[hit.type].name}，收进装饰仓库（再锄一下就能开垦）`);
        renderDecorBag();
      } else if(!silent){
        toast(`${DECOR_META[hit.type].name} 还需要 ${hit.left} 下`);
      }
      save();
      return;
    }
    /* ② 石头地面：只能摆装饰（提示统一成一句话，别再各说各的） */
    if(t.stone){ if(!silent){ toast(STONE_ONLY_DECOR); SFX.play('error'); } return; }
    /* ③ 没装饰：农场内把荒地开垦成耕地 */
    if(!inFarm(gx, gy)){
      if(!silent){ toast('农场外的地要先扩建（侧栏 💰 扩建）'); SFX.play('error'); }
      return;
    }
    if(t.state === 'wild'){
      t.state = 'tilled'; t.terrain = 'tilled';
      trackAction('till');
      SFX.play('till');
      spawnParticles(sp.x, sp.y, 'till');
      renderHUD(); save();
    } else if(t.state === 'tilled'){
      /* ③ 还原成草地：**只有单击才允许**；拖拽/框选批量操作不会把耕地抹掉 */
      if(silent) return;
      t.state = 'wild'; t.terrain = 'grass';
      t.crop = null; t.growth = 0; t.watered = false; t.fertile = false;
      SFX.play('till');
      spawnParticles(sp.x, sp.y, 'till');
      toast('已还原为草地');
      save();
    } else {
      if(!silent){ toast('地里有作物'); SFX.play('error'); }
    }
    return;
  }

  if(tool === 'seed'){
    const sid = state.selectedSeed;
    if(!sid){ openSheet('seed'); return; }
    const r = plantSeed(t, sid);
    if(!r.ok){ if(!silent){ toast(r.msg); SFX.play('error'); } return; }
    SFX.play('plant'); renderHUD(); save();
    return;
  }

  if(tool === 'water'){
    const r = waterTile(t);
    if(!r.ok){ if(!silent){ toast(r.msg); SFX.play('error'); } return; }
    SFX.play('water');
    spawnParticles(sp.x, sp.y - 10, 'water');
    if(!silent) toast(r.msg);
    save();
    return;
  }

  if(tool === 'fert' || tool === 'premium'){
    const r = fertilizeTile(t, tool === 'premium');
    if(!r.ok){ if(!silent){ toast(r.msg); SFX.play('error'); } return; }
    if(tool === 'premium'){
      SFX.play('achieve');
      spawnParticles(sp.x, sp.y - 14, 'sparkle');
      fxFlash(sp.x, sp.y - 14, '#fff3b0', 96);
      fxToastBig('✨ 催熟！');
      checkAchievements();
    } else {
      SFX.play('fert');
      spawnParticles(sp.x, sp.y - 6, 'sparkle', 6);
    }
    renderHUD();
    if(!silent) toast(r.msg);
    save();
    return;
  }

  if(tool === 'sickle'){
    const r = harvestTile(t);
    if(!r.ok){ if(!silent){ toast(r.msg); SFX.play('error'); } return; }
    const def = CROPS[r.cropId];
    if(state.warehouseEnabled){
      flyToStore(t, def.emoji);
      if(!silent) floatPlus(t, 1);
      if(!silent) toast(`收获 ${def.emoji} ${def.produce}${r.multi ? '（还会继续长）' : ''}`);
    } else {
      trackAction('coins', r.gain);
      floatPlusText(t, '+' + r.gain + '💰');
      fxCoinBurst(sp.x, sp.y - 12, r.gain);
      if(!silent) toast(`卖出 +${r.gain} 金`);
    }
    SFX.play('harvest');
    spawnParticles(sp.x, sp.y - 15, 'harvest');
    renderHUD(); save();
    return;
  }

  if(tool === 'decor'){
    /* 已经有小路 → 点它是「换连接面」，不是再摆一块 */
    const exist = decorAt(gx, gy, decorLayer(state.selectedDecor));
    if(exist && DECOR_META[exist.type] && DECOR_META[exist.type].connect){
      const mode = cyclePathConn(gx, gy);
      SFX.play('click');
      if(!silent && mode) toast(`小路连接：${mode.name}（再点一下换下一种）`);
      save();
      return;
    }
    const r = placeDecor(gx, gy, state.selectedDecor);
    if(!r.ok){ if(!silent){ toast(r.msg); SFX.play('error'); } return; }
    SFX.play('plant');
    spawnParticles(sp.x, sp.y - 6, 'sparkle', 4);
    renderDecorBag(); save();
    return;
  }
}

/* 框选批量：排出一条顺路，交给小人依次完成（不瞬移、不隔空改地） */

/* ---------- 框选时「哪一格值得走过去」 ----------
 * 播种：只认开垦过、空着、没石头的地 —— 地里已经有作物的**直接跳过**（不浪费种子也不弹错）
 * 浇水：只认生长中且还没浇的；收获：只认成熟的；肥料：只认还没施肥的
 * 所以一框下去，小人只会走向真正要处理的地块，剩下的原地不动 */
function toolTileWanted(tool, t){
  if(!t) return false;
  const hasDecor = !!decorAt(t.gx, t.gy);
  if(tool === 'hoe')       return hasDecor || (inFarm(t.gx, t.gy) && !t.stone && t.state === 'wild');
  if(tool === 'seed')      return inFarm(t.gx, t.gy) && !t.stone && !hasDecor && t.state === 'tilled' && !t.crop;
  if(tool === 'water')     return t.state === 'growing' && !t.watered;
  if(tool === 'fert' || tool === 'premium') return t.state === 'growing' && !t.fertile;
  if(tool === 'sickle')    return t.state === 'ready';
  if(tool === 'decor'){
    /* 按当前选中的装饰筛：这一格放不下就不排进队列 */
    const sel = state.selectedDecor;
    if(!sel) return false;
    return canPlaceDecorAt(t.gx, t.gy, sel).ok || !!decorAt(t.gx, t.gy, decorLayer(sel));
  }
  return true;
}
/* 框选范围里一格都不合适时的提示 */
const TOOL_EMPTY_HINT = {
  hoe:   '框选范围里没有可开垦的荒地（也没有装饰物要敲）',
  seed:  '框选范围里没有可播种的空地 —— 要先用锄头开垦',
  water: '框选范围里没有需要浇水的作物（生长中的才要浇）',
  fert:  '框选范围里没有需要施肥的作物',
  premium:'框选范围里没有需要催熟的作物',
  sickle:'框选范围里没有成熟的作物',
  decor: '框选范围里没有能放下这件装饰的地方',
};
/* 框选用的工具 = 当前工具（种子也照常播种，不再强制改成锄头） */
function boxTool(){
  const t = state.tool;
  return (t === 'pan') ? null : t;
}
function applyToolToRect(x0, y0, x1, y1){
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1), by = Math.max(y0, y1);
  const tool = boxTool();
  if(!tool) return 0;
  if(tool === 'seed' && !state.selectedSeed){ openSheet('seed'); return 0; }
  state.tool = tool;                       /* 让批量作业用同一个工具 */
  renderToolbar();
  const list = [];
  let total = 0, skipped = 0;
  for(let y = ay; y <= by; y++){
    for(let x = ax; x <= bx; x++){
      const t = getTile(x, y);
      if(!t) continue;
      total++;
      if(toolTileWanted(tool, t)) list.push({ gx:x, gy:y }); else skipped++;
    }
  }
  const meta = TOOL_META[tool];
  const label = meta ? meta.name : tool;
  if(!list.length){
    toast(TOOL_EMPTY_HINT[tool] || `${label}：框选范围里没有可作业的地块`);
    return 0;
  }
  /* 锁住选区（作业期间一直高亮），清空旧队列 */
  state.box = { x0:ax, y0:ay, x1:bx, y1:by };
  state.jobBox = { x0:ax, y0:ay, x1:bx, y1:by };
  const p = state.player;
  p.queue = planPath(list, { gx: Math.round(p.x), gy: Math.round(p.y) }).map(q => Object.assign({ tool }, q));
  p.pendingOp = null;
  toast(`${label}：框选 ${bx-ax+1}×${by-ay+1} → ${list.length} 格要处理` +
        (skipped ? `，跳过 ${skipped} 格` : '') + '（点别处取消）');
  renderHUD(); save();
  return list.length;
}
/* 取消框选/批量作业 */
function cancelJob(){
  if(!jobActive()) return false;
  playerClearQueue();
  state.hover = null;
  toast('已取消框选');
  return true;
}
