/* ============ 设置面板 ============ */
const SETTING_TOGGLES = [
  { id:'toggleSound',     field:'soundEnabled',    label:'音效' },
  { id:'toggleParticles', field:'particlesEnabled',label:'粒子特效' },
  { id:'toggleEffects',   field:'effectsEnabled',  label:'全屏特效' },
  { id:'toggleWarehouse', field:'warehouseEnabled',label:'仓储模式' },
  { id:'toggleMiniGame',  field:'miniGameEnabled', label:'厨房火候小游戏' },
  { id:'toggleCropBars',  field:'showCropBars',    label:'作物进度条', hint:'关掉后地里不再画生长进度条，大地图更顺' },
];
function renderSettings(){
  for(const t of SETTING_TOGGLES){
    const el = document.getElementById(t.id);
    if(el) el.classList.toggle('on', !!state[t.field]);
  }
  const v = document.getElementById('settingsVersion');
  if(v) v.textContent = 'v' + GAME_VERSION;
}
function bindSettings(){
  for(const t of SETTING_TOGGLES){
    const el = document.getElementById(t.id);
    if(!el) continue;
    el.onclick = () => {
      state[t.field] = !state[t.field];
      SFX.enabled = state.soundEnabled;
      SFX.play('click');
      renderSettings();
      if(t.field === 'particlesEnabled' && !state.particlesEnabled) particles.length = 0;
      save();
      toast(`${t.label}：${state[t.field] ? '开' : '关'}`);
    };
  }
  const slots = document.getElementById('btnOpenSlots');
  if(slots) slots.onclick = () => { SFX.play('click'); closeSheet(); openSheet('slots'); };
}
