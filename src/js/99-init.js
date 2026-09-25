/* ============ 初始化 ============ */
/* 复位不持久化的运行时状态（读档 / 新档 / 切槽位时都要做） */
function resetRuntime(){
  ATMOS.clockMs = (typeof state.clockMs === 'number') ? state.clockMs : DAY_MS * 0.16;
  ATMOS.hour = hourFromClock(ATMOS.clockMs);
  ATMOS.weather = 'clear'; ATMOS.weatherLeftMs = 45000; ATMOS.flash = 0;
  rainDone = false;
  KITCHEN.mill.busy = false; KITCHEN.mill.t = 0;
  KITCHEN.oven.busy = false; KITCHEN.oven.ready = false; KITCHEN.oven.t = 0;
  KITCHEN.oven.items = []; KITCHEN.oven.item = null;
  KITCHEN.board.busy = false; KITCHEN.board.t = 0; KITCHEN.board.src = null;
  KITCHEN.pot.pieces = []; KITCHEN.pot.t = 0; KITCHEN.pot.done = false;
  /* 恢复厨房勾选（住在 state 里才能跨刷新生效） */
  const ka = state.kitchenAuto || { oven:false, pot:false };
  KITCHEN.oven.auto = !!ka.oven;
  KITCHEN.pot.auto = !!ka.pot;

  if(!state.autoUntil) state.autoUntil = { donkey:0, chopper:0 };
  if(!state.autoAcc) state.autoAcc = { donkey:0, chopper:0 };
  if(!state.autoCount) state.autoCount = { donkey:0, chopper:0 };
  particles.length = 0;
  state.idle.lastAt = Date.now();
  hudMoneyShown = state.coins;
  hudIdleShown = idleRate();
  if(!state.player) state.player = newState().player;
  state.player.x = state.player.gx; state.player.y = state.player.gy;
  state.player.tx = state.player.gx; state.player.ty = state.player.gy;
  state.player.moving = false; state.player.actionType = null; state.player.queuedAction = null;
  state.player.pendingOp = null;
  state.player.queue = [];
  state.hover = null; state.box = null; state.jobBox = null; state.expandPreview = null;
  state.expandMode = false;
  buildDrawOrder();
}
function renderAll(){
  renderHUD(); renderClock(); renderToolbar(); renderGridBtn();
  renderSettings(); renderWarehouseToggle(); updateNoticeDot(); updateHudDots();
  renderDecorBag(); renderExpandHint(); renderZoomBtn();
}
function centerOnFarm(){
  const f = state.farm;
  /* 卷轴式：倍率大到一屏装不下时，镜头跟着小人走（并夹在地图范围内），
     否则维持"整块农场居中"的老行为 */
  if(typeof viewOverflows === 'function' && viewOverflows() && state.player){
    centerOn(state.player.gx, state.player.gy);
    if(typeof clampCamera === 'function') clampCamera();
    return;
  }
  centerOn(f.x0 + (f.w - 1) / 2, f.y0 + (f.h - 1) / 2);
}
/* 读档 → 结算离线 → 刷新界面 */
function applyLoaded(loaded, announce){
  state = loaded.state;
  resetRuntime();
  const off = applyOffline(state, loaded.offlineMs || 0);
  SFX.enabled = state.soundEnabled;
  if(!loaded.offlineMs || (state.camera.x === 0 && state.camera.y === 0)) centerOnFarm();
  renderAll();
  if(announce && loaded.offlineMs >= 60000){
    const mins = Math.floor(loaded.offlineMs / 60000);
    const parts = [];
    if(off.grown) parts.push(`${off.grown} 块生长`);
    if(off.ripened) parts.push(`${off.ripened} 块成熟`);
    if(off.idle) parts.push(`挂机 +${off.idle} 金`);
    if(parts.length) setTimeout(() => toast(`离开 ${mins} 分钟：${parts.join('，')}`), 500);
  }
  save();
  return off;
}
/* 调试/测试用：把一份存档载荷**真正应用**到当前会话（unpackState 只是返回新对象，不会改全局） */
function applyPayload(d){
  const st2 = unpackState(d);
  if(!st2) return false;
  applyLoaded({ state: st2, offlineMs: 0 }, false);
  return true;
}
function init(){
  resize(); applyUIScale();
  const migrated = migrateLegacy();

  let slot = currentSlot();
  let loaded = slot ? loadFromSlot(slot) : null;
  if(!loaded){
    let best = 0, bestT = 0;
    for(let n = 1; n <= SLOT_COUNT; n++){
      const m = slotMeta(n);
      if(m.exists && m.savedAt > bestT){ bestT = m.savedAt; best = n; }
    }
    if(best){ setCurrentSlot(best); loaded = loadFromSlot(best); }
  }
  if(loaded){
    applyLoaded(loaded, true);
    if(migrated) setTimeout(() => toast('旧版存档已迁移到槽位 1'), 900);
  } else {
    setCurrentSlot(1);
    state = initDecorations(newState());
    resetRuntime();
    centerOnFarm();
    renderAll();
    checkTasks();
    save();
  }

  SFX.enabled = state.soundEnabled;
  SFX.init();
  bindAll();
  renderAll();
  window.addEventListener('beforeunload', save);
  document.addEventListener('visibilitychange', () => { if(document.hidden) save(); });
  const unlockAudio = () => { SFX.resume(); document.removeEventListener('pointerdown', unlockAudio); };
  document.addEventListener('pointerdown', unlockAudio);

  requestAnimationFrame(placeSidePanel);
  lastTick = performance.now(); saveTimer = lastTick;
  requestAnimationFrame(loop);
  if(typeof tfBoot === 'function') tfBoot();       /* 申请持久化存储 + 认 #s= 迁移链接 */
}

/* ============ 调试/测试接口 ============ */
window.FarmDebug = {
  get state(){ return state; },
  version: GAME_VERSION,
  api: {
    /* 田间 */
    applyToolAt, getTile, plantSeed, waterTile, fertilizeTile, harvestTile, growthSpeed,
    step: ms => advanceGrowth(ms),
    /* 小人 */
    updatePlayer, playerGoto, playerActionT, PLAYER_SPEED, ACTION_MS,
    CROPS, cropReadyMs, cropTotalMs, cropProfit, cropRate,
    applyRainWatering, rollWeather, updateAtmosphere, hourFromClock, DAY_PHASES,
    /* 厨房 */
    cook: { mill, ovenPut, ovenTake, boardPut, potAdd, potTake, sellDish, addDish },
    canBoard, canOvenPut, canMill, FERT_KEEP, PREMIUM_KEEP, pushRecentSeed,
    kitchenTick: ms => { kitchenLogicTick(ms); },
    KITCHEN, potRecipe, applyQuality, kitchenShelf, dishTotal, drawItemIcon,
    OVEN_MS, OVEN_PERFECT_MS, OVEN_BURN_MS, POT_MS, POT_PERFECT_MS, POT_BURN_MS, QUALITY,
    AUTO_DEVICES, AUTO_IDS, autoBuy, autoActive, autoLeftMs, autoTick, autoLoopFeed,
    autoSlotOf, autoSlotRefill, AUTO_SLOT_MAX, autoPickCrop,
    ovenCap, ovenSlotPrice, ovenCanUpgrade, ovenUpgrade, ovenRoundSize, ovenQueue, ovenStartRound,
    OVEN_SLOT_PRICE0, OVEN_SLOT_MAX, QUALITY,
    millStock, millBatch, MILL_BATCH_MAX, autoCountOf, autoPrice, AUTO_MAX,
    /* 装饰 */
    decorAt, decorLayer, decorGroundAt, decorPropAt, canPlaceDecorAt, placeDecor, collectDecorationAt, hitDecorationAt, scatterWeeds, sellDecor, DECOR_PRICE, DECOR_SELL, DECOR_HP, decorMaxHp, decorIsFree, DECOR_FREE, decorOffsetFor, decorIsNatural, decorIsWild, DECOR_NATURAL, drawDecoration, drawPath, drawFence, pathConnMask, pathRawMask, fenceConnMask, connMaskOf, connDirs, connModesOf, DIAG_SIDES, cyclePathConn, PATH_CONN_MODES, CONN8_MODES,
    /* 挂机 */
    idleRate, idleTick, creditIdle, idleOffline, IDLE_BASE_PER_MIN, IDLE_PER_ACH, IDLE_OFFLINE_CAP, OFFLINE_CAP,
    idleAdvance: ms => { state.idle.lastAt = Date.now() - ms; return idleTick(Date.now()); },
    /* 存档 */
    saveToSlot, loadSlot: n => loadFromSlot(n), slotKey, slotMeta, deleteSlot, applyPayload,
    currentSlot, setCurrentSlot, useSlot, newGameInSlot,
    unpackState, migrateLegacy, serialize, readSlot,
    /* 其它 */
    sellCrop, sellDishUI, save, renderAll, renderHUD, applyOffline, newState,
    claimTask, claimAllTasks, renderTaskList, renderStore, renderSlots, renderExpandHint, renderShop, renderDecorBag, renderToolbar,
    CHANGELOG, ACHIEVEMENTS, DECOR_META, claimAchievement, claimAllAchievements, claimableAchCount, achClaimed, achRewardText,
    TASK_POOL, checkTasks, taskUnlocked, decorOffset, EXTRA_ITEMS, DISHES, START_COINS,
    renderAchievements, renderKitchen, renderSeedList,
    /* 排行榜 */
    SFX, kKitchenOpen, LB_METRICS, lbMyStats, lbSetName, lbLoad, lbSubmit, lbSortEntries, lbMetric, lbCleanName, lbOpen, lbRefresh, renderLeaderboard, lbPlayerId,
    openSheet, closeSheet, trackAction, checkAchievements,
    /* 扩建 */
    normalizeTopStone, expandInfo, expandPrice, doExpand, buyExpand, rebuildMapTiles, inFarm, inMap,
    expandKind, expandStrip, expandDirAt, toggleExpandMode, renderExpandHint, UP_PLANT_LIMIT,
    expandCountOf,
    /* 视角 */
    viewZoom, autoZoom, cycleZoom, setZoom, renderZoomBtn, centerOnFarm,
    isNarrowView, viewOverflows, clampCamera, ZOOM_FILL_MAX, ZOOM_AUTO_MAX,
    tfEncodeData, tfDecodeData, tfSanitize, tfReadText, tfWriteSlot, tfExportSlot, tfLinkFor, tfParamPayload, tfStorageRisk,
    tfBoot, openTransfer, renderTransfer, TF_ITER, TF_TAG, TF_TAG2, TF_MAX_TILES, tfQrFit, TF_QR_MAX, TF_QR_COMFY,
    atmSunTrack, atmMoonTrack, atmOrbit, ATM_CLOUDS, ATM_ORBIT,
    /* 交互 */
    applyToolToRect, runTool, boxTool, setHover, gridToScreen, screenToGrid, hash2,
    cancelJob, jobActive, playerEnqueue, playerQueue, planPath, playerClearQueue,
    grant: (k, n) => { state[k] = (state[k] || 0) + n; },
    setTool: t => { state.tool = t; },
    /* 视觉验证用 */
    ATMOS, DAY_MS,
    fx: { fxFlash, fxCelebrate, fxCoinBurst, fxToastBig },
    spawnParticles, particles,
    forceRender: () => render(),
    setAtmos: (hour, weather) => {
      if(typeof hour === 'number'){ ATMOS.clockMs = clockFromHour(hour); ATMOS.hour = hourFromClock(ATMOS.clockMs); }
      if(weather){ const old = ATMOS.weather; ATMOS.weather = weather; ATMOS.weatherLeftMs = 999999; if(weather === 'rain' && old !== 'rain') onRainStart(); }
      state.clockMs = ATMOS.clockMs;
    },
  },
};

init();
