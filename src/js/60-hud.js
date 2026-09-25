/* ============ HUD ============ */
let hudMoneyShown = START_COINS;
let hudIdleShown = 0;
function bump(el){
  if(!el) return;
  el.classList.remove('bump');
  void el.offsetWidth;                       // 重启动画
  el.classList.add('bump');
  setTimeout(() => el.classList.remove('bump'), 220);
}
/* 数字滚动：金币与挂机速率平滑逼近真实值（每帧由主循环调用） */
function updateHudAnim(dt){
  const $ = id => document.getElementById(id);
  const target = state.coins;
  if(Math.abs(hudMoneyShown - target) < 0.6) hudMoneyShown = target;
  else hudMoneyShown += (target - hudMoneyShown) * Math.min(1, dt / 110);
  const m = $('hudMoney');
  if(m){
    const v = String(Math.round(hudMoneyShown));
    if(m.textContent !== v) m.textContent = v;
  }
  const rate = idleRate();
  if(Math.abs(hudIdleShown - rate) > 0.01){
    hudIdleShown = rate;
    const i = $('hudIdle');
    if(i){ i.textContent = rate.toFixed(1); if(i.parentElement) bump(i.parentElement); }
    /* 手机顶栏把挂机速率并到金币旁边（+x.x/分） */
    const im = $('hudIdleM');
    if(im) im.textContent = '+' + rate.toFixed(1) + '/分';
  }
}
function renderHUD(){
  const $ = id => document.getElementById(id);
  const f = $('hudFert'); if(f) f.textContent = state.fertilizer;
  const p = $('hudPremium'); if(p) p.textContent = state.premium;
  const fm = $('hudFarmM'); if(fm) fm.textContent = state.farm.w + '×' + state.farm.h;
  const lp = $('longPressState'); if(lp) lp.textContent = state.longPressBox === false ? '关' : '开';
  const afS = $('autoFarmState'); if(afS) afS.textContent = (state.autoFarm && state.autoFarm.on) ? '开' : '关';
  const ci = $('hudIdleM');
  if(ci && !ci.textContent) ci.textContent = '+' + idleRate().toFixed(1) + '/分';
  const total = CROP_IDS.reduce((a, id) => a + (state.bag[id] || 0), 0)
    + Object.values(state.pieces).reduce((a, b) => a + b, 0)
    + (state.prep.flour || 0);
  const badge = $('storeBadge');
  if(badge){
    if(total > 0){ badge.style.display = 'grid'; badge.textContent = total > 99 ? '99+' : total; }
    else badge.style.display = 'none';
  }
  const kb = $('kitchenBadge');
  if(kb){
    const dishes = dishTotal();
    if(dishes > 0){ kb.style.display = 'grid'; kb.textContent = dishes > 99 ? '99+' : dishes; }
    else kb.style.display = 'none';
  }
  renderToolbar();
}
function renderClock(){
  const c = document.getElementById('hudClock');
  const w = document.getElementById('hudWeather');
  const h = Math.floor(ATMOS.hour), m = Math.floor((ATMOS.hour - h) * 60);
  const clockText = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  const weatherIcon = ATMOS.weather === 'rain' ? '🌧️' : ATMOS.weather === 'cloudy' ? '⛅' : (atmosIsNight() ? '🌙' : '☀️');
  if(c) c.textContent = clockText;
  if(w) w.textContent = weatherIcon;
  const cm = document.getElementById('hudClockM');
  const wm = document.getElementById('hudWeatherM');
  if(cm) cm.textContent = clockText;
  if(wm) wm.textContent = weatherIcon;
  const fm = document.getElementById('hudFarmM');
  if(fm) fm.textContent = state.farm.w + '×' + state.farm.h;
}
function renderToolbar(){
  document.querySelectorAll('#toolbar button').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === state.tool);
  });
  if(typeof renderToolPops === 'function' && (document.getElementById('fertPop') || document.getElementById('seedPop'))){
    renderToolPops();     /* 小凸起里的数量/已选状态跟着刷新 */
  }
  const panBtn = document.getElementById('btnPan');
  if(panBtn) panBtn.classList.toggle('active', state.tool === 'pan');
  if(document.body) document.body.classList.toggle('pan-mode', state.tool === 'pan');
  const t = TOOL_META[state.tool];
  const hint = document.getElementById('toolHint');
  if(hint && t){
    const p = state.player || {};
    const left = (p.queue ? p.queue.length : 0) + (p.pendingOp ? 1 : 0);
    hint.textContent = left > 0
      ? `${t.name} · 作业中：还剩 ${left} 格（点地图取消）`
      : t.name + ' · ' + t.desc;
  }
}
