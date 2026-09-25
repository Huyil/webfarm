/* ============ 主循环 ============ */
let lastTick = 0, saveTimer = 0;
function loop(now){
  const rawDt = now - lastTick;
  const dt = Math.min(rawDt, 2000);
  lastTick = now;
  /* 切后台/掉帧：多出来的时间按离线速率补上，作物不会因为离开页面而停摆 */
  if(rawDt > 2000){
    const extra = Math.min(rawDt - 2000, OFFLINE_CAP);
    if(extra > 3000) advanceGrowth(extra, OFFLINE_RATE);
  }
  advanceGrowth(dt);
  updateAtmosphere(dt);
  applyRainWatering();
  updatePlayer(dt);
  updateKitchen(dt);
  if(typeof afTick === 'function') afTick(dt);      /* 自动农活：队列空了就排下一趟 */
  updateParticles(dt);
  updateEffects(dt);
  /* 没动过镜头就始终把农场摆在正中（平移或缩放后不再自动跟随） */
  if(state.cameraAuto) centerOnFarm();
  render();
  idleTick();
  updateHudAnim(dt);
  const absNow = performance.timeOrigin + now;
  if(absNow - saveTimer > 4000){ saveTimer = absNow; save(); }
  requestAnimationFrame(loop);
}
