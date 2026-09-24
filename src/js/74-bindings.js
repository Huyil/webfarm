/* ============ 按钮绑定 ============ */
function renderGridBtn(){
  const b = document.getElementById('btnGrid');
  if(!b) return;
  b.classList.toggle('active', !!state.showGrid);
  b.setAttribute('aria-pressed', state.showGrid ? 'true' : 'false');
  /* 直接把开关状态写在按钮上，避免「高亮 = 开还是关」看不出来 */
  const st = document.getElementById('gridState');
  if(st){
    st.textContent = state.showGrid ? '开' : '关';
    st.classList.toggle('on', !!state.showGrid);
  }
}
function onViewportChange(){
  resize(); applyUIScale();
  requestAnimationFrame(placeSidePanel);
}
const SIDE_SHEETS = {
  btnShop:'shop', btnStore:'store', btnKitchen:'kitchen',
  btnDecor:'decor', btnSettings:'settings', btnLeaderboard:'leaderboard',
};
function bindAll(){
  const tb = document.getElementById('toolbar');
  if(tb) tb.addEventListener('click', e => {
    const btn = e.target.closest('button[data-tool]');
    if(!btn) return;
    const tool = btn.dataset.tool;
    SFX.play('click');
    /* 种子 / 肥料：点一下先弹「小凸起」，不再直接开大窗口 */
    if(tool === 'seed'){ state.tool = 'seed'; renderToolbar(); toggleToolPop('seed'); return; }
    if(tool === 'fert'){ state.tool = 'fert'; renderToolbar(); toggleToolPop('fert'); return; }
    state.tool = tool; renderToolbar(); closeToolPops();
  });
  /* 小凸起里的选项：肥料/高级肥料 切换、常用种子、更多种子 */
  ['fertPop', 'seedPop'].forEach(id => {
    const pop = document.getElementById(id);
    if(!pop) return;
    pop.addEventListener('click', e => {
      const tb = e.target.closest('[data-tool-pick]');
      if(tb){
        state.tool = tb.dataset.toolPick;
        SFX.play('click'); renderToolbar(); closeToolPops();
        toast('已切换：' + (TOOL_META[state.tool] ? TOOL_META[state.tool].name : state.tool));
        return;
      }
      const sb = e.target.closest('[data-seed]');
      if(sb){
        const id2 = sb.dataset.seed, def = CROPS[id2];
        if(!def) return;
        if(state.coins < def.seedCost){ toast('金币不够'); SFX.play('error'); return; }
        state.selectedSeed = id2; state.tool = 'seed';
        pushRecentSeed(id2);
        SFX.play('click'); renderToolbar(); closeToolPops(); save();
        toast('已选 ' + def.name);
        return;
      }
      if(e.target.closest('[data-act="seed-more"]')){
        SFX.play('click'); closeToolPops(); openSheet('seed');
      }
    });
  });
  /* 点别处收起来 */
  document.addEventListener('pointerdown', ev => {
    if(ev.target.closest && (ev.target.closest('.tool-pop') || ev.target.closest('#toolbar'))) return;
    closeToolPops();
  }, true);

  bindSideDrawer();                       /* 手机顶栏里的抽屉把手 */
  /* 👆 长按框选开关：长按到底进框选，还是当普通点击（手机上两者很容易打架） */
  const lpBtn = document.getElementById('btnLongPress');
  if(lpBtn) lpBtn.onclick = () => {
    state.longPressBox = state.longPressBox === false;
    SFX.play('click');
    toast(state.longPressBox
      ? '👆 长按 = 框选（批量作业）；轻点还是让小人走过去'
      : '👆 长按框选已关闭：长按只会让小人走过去，不会划范围');
    renderHUD(); save();
  };
  /* 手机顶栏把 🏆 收进「⋯」里了，这里给弹层那一行接上 */
  const achRowM = document.getElementById('achRowM');
  if(achRowM) achRowM.onclick = () => {
    SFX.play('click');
    const p = document.getElementById('hudMore'); if(p) p.classList.remove('show');
    openSheet('achievements');
  };
  const pan = document.getElementById('btnPan');
  if(pan) pan.onclick = () => {
    state.tool = (state.tool === 'pan') ? 'hoe' : 'pan';
    SFX.play('click'); renderToolbar();
  };
  const grid = document.getElementById('btnGrid');
  if(grid) grid.onclick = () => {
    state.showGrid = !state.showGrid;
    SFX.play('click'); renderGridBtn(); save();
  };
  for(const id in SIDE_SHEETS){
    const el = document.getElementById(id);
    if(el) el.onclick = () => {
      SFX.play('click');
      openSheet(SIDE_SHEETS[id]);
      /* v9.20：点菜单里的内容**不再自动收抽屉**（只有点空白处 / Esc 才收），
         否则想连着点两项就得每次重新打开 */
    };
  }
  /* 侧栏里不弹层的按钮（扩建 / 网格 / 平移 / 缩放）：点完也收抽屉 */
  /* 这几个不弹层的按钮也一样：点完不收抽屉 */
  /* ⋯ 展开/收起次要信息（挂机速率、时间、农场尺寸） */
  const moreBtn = document.getElementById('moreBtn');
  const morePanel = document.getElementById('hudMore');
  if(moreBtn && morePanel){
    moreBtn.onclick = e => {
      e.stopPropagation();
      SFX.play('click');
      morePanel.classList.toggle('show');
    };
    document.addEventListener('pointerdown', ev => {
      if(!morePanel.classList.contains('show')) return;
      if(ev.target.closest('#hudMore') || ev.target.closest('#moreBtn')) return;
      morePanel.classList.remove('show');
    });
  }

  /* 🔍 缩放：自动 → 1x → 2x 循环（存档功能已挪进设置面板） */
  const zoomBtn = document.getElementById('btnZoom');
  if(zoomBtn) zoomBtn.onclick = () => { SFX.play('click'); cycleZoom(); };
  /* 💰 扩建 = 进入「在地图上选长条」的模式，不再是弹窗 */
  const expandBtn = document.getElementById('btnExpand');
  if(expandBtn) expandBtn.onclick = () => { SFX.play('click'); closeSheet(); toggleExpandMode(); };

  const tabAch = document.getElementById('tabAch');
  const tabTask = document.getElementById('tabTask');
  if(tabAch) tabAch.onclick = () => {
    SFX.play('click');
    tabAch.classList.add('active'); tabTask.classList.remove('active');
    document.getElementById('achList').style.display = '';
    document.getElementById('taskList').style.display = 'none';
    renderAchievements(); syncClaimBtns();
  };
  if(tabTask) tabTask.onclick = () => {
    SFX.play('click');
    state.taskRead = true; updateHudDots();
    tabTask.classList.add('active'); tabAch.classList.remove('active');
    document.getElementById('taskList').style.display = '';
    document.getElementById('achList').style.display = 'none';
    renderTaskList(); syncClaimBtns();
  };
  const claimAll = document.getElementById('claimAllBtn');
  if(claimAll) claimAll.onclick = () => { SFX.play('click'); claimAllTasks(); };
  const claimAllAch = document.getElementById('claimAllAchBtn');
  if(claimAllAch) claimAllAch.onclick = () => { SFX.play('click'); claimAllAchievements(); };
  const syncClaimBtns = () => {
    const achTab = document.getElementById('tabAch');
    const onAch = achTab ? achTab.classList.contains('active') : true;
    const b1 = document.getElementById('claimAllAchBtn');
    const b2 = document.getElementById('claimAllBtn');
    if(b1) b1.style.display = (onAch && claimableAchCount() > 0) ? '' : 'none';
    if(b2) b2.style.display = (!onAch && state.tasks.list.some(t => {
      const def = TASK_POOL.find(x => x.id === t.id);
      return def && !t.claimed && getTaskProgress(t.id) >= def.target;
    })) ? '' : 'none';
  };

  const achBtn = document.getElementById('achBtn');
  if(achBtn) achBtn.onclick = () => {
    SFX.play('click');
    state.achRead = true; updateHudDots(); save();
    openSheet('achievement');
    if(tabAch && tabTask){
      tabAch.classList.add('active'); tabTask.classList.remove('active');
      document.getElementById('achList').style.display = '';
      document.getElementById('taskList').style.display = 'none';
    }
    renderAchievements();
  };
  const lbBtn = document.getElementById('lbBtn');
  if(lbBtn) lbBtn.onclick = () => { SFX.play('click'); openSheet('leaderboard'); };
  const noticeBtn = document.getElementById('noticeBtn');
  if(noticeBtn) noticeBtn.onclick = () => {
    SFX.play('click');
    openSheet('notice');
    renderChangelog();
    CHANGELOG.forEach(l => state.noticeRead[l.version] = true);
    updateNoticeDot(); save();
  };

  bindSettings();
  bindSheetEvents();
  bindWarehouseToggle();
  bindSidePanelDrag();

  /* 键盘快捷键 */
  const keyMap = { '1':'hoe', '2':'seed', '3':'water', '4':'fert', '5':'sickle' };   /* 催熟并进「肥料」小凸起 */
  window.addEventListener('keydown', e => {
    if(e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if(keyMap[k]){ state.tool = keyMap[k]; renderToolbar(); SFX.play('click'); closeToolPops(); if(state.tool === 'seed') toggleToolPop('seed'); return; }
    if(k === 'g' || k === 'G'){ state.showGrid = !state.showGrid; renderGridBtn(); return; }
    if(k === 'p' || k === 'P'){ state.tool = state.tool === 'pan' ? 'hoe' : 'pan'; renderToolbar(); return; }
    if(k === 'k' || k === 'K'){ openSheet('kitchen'); return; }
    if(k === 'b' || k === 'B'){ openSheet('store'); return; }
    if(k === 'e' || k === 'E'){ toggleExpandMode(); return; }
    if(k === 'z' || k === 'Z'){ cycleZoom(); return; }
    if(k === 'Escape'){ if(state.expandMode) toggleExpandMode(false); closeSheet(); return; }
  });

  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', () => setTimeout(onViewportChange, 120));
}
