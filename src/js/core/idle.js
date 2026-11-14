/* ============ 挂机收益 ============
 * 0.3 金/分起步，每解锁 1 个成就 +0.06 金/分（30 个成就 ≈ 2.1 金/分），离线封顶 2 小时。
 * 用墙钟时间结算：切后台、rAF 被浏览器冻结、乃至彻底关掉页面（离线结算）都会补上。
 */
function idleRate(){ return IDLE_BASE_PER_MIN + IDLE_PER_ACH * unlockedAchCount(); }

function idleGain(ms){
  return ms / 60000 * idleRate();
}
/* 把零钱攒进 state.idle.frac，整数部分入账 */
function creditIdle(amount){
  if(!(amount > 0)) return 0;
  state.idle.frac = (state.idle.frac || 0) + amount;
  const whole = Math.floor(state.idle.frac);
  if(whole <= 0) return 0;
  state.idle.frac -= whole;
  state.coins += whole;
  state.idle.total = (state.idle.total || 0) + whole;
  state.stats.total.idle = (state.stats.total.idle || 0) + whole;
  state.stats.total.coins += whole;
  return whole;
}
/* 主循环每帧调用：按真实流逝时间结算（不依赖 dt 上限） */
function idleTick(nowMs){
  const now = (typeof nowMs === 'number') ? nowMs : Date.now();
  const last = state.idle.lastAt || now;
  state.idle.lastAt = now;
  const dt = now - last;
  if(dt < 500) return 0;
  const got = creditIdle(idleGain(dt));
  if(got > 0){
    renderHUD();
    if(got >= 10) toast(`💤 挂机收益 +${got} 金`);
  }
  return got;
}
/* 离线结算（在 applyOffline 里调用） */
function idleOffline(st, offlineMs){
  const ms = Math.min(offlineMs, IDLE_OFFLINE_CAP);
  const amount = ms / 60000 * (IDLE_BASE_PER_MIN + IDLE_PER_ACH * Object.keys(st.achievements||{}).length);
  st.idle.frac = (st.idle.frac || 0) + amount;
  const whole = Math.floor(st.idle.frac);
  st.idle.frac -= whole;
  st.idle.total = (st.idle.total || 0) + whole;
  st.coins += whole;
  st.stats.total.idle = (st.stats.total.idle || 0) + whole;
  st.stats.total.coins += whole;
  st.idle.lastAt = Date.now();
  return whole;
}
