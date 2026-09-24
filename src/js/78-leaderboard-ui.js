/* ============ 排行榜：界面 ============
 * 第一次点开要求起个名字；之后显示榜单：
 *   顶部五个带图标的项目（💰 金币 / 🌾 收获 / 🗺️ 田块 / 🏆 成就 / ✅ 任务），点一下就换排序；
 *   下面是排名表，自己那行高亮。离线/服务器不通时降级成「本地战绩 + 重试」。
 */
let lbBusy = false;                 /* 正在请求，避免连点 */
function lbEsc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function lbEntryRow(e, i, metric, myId){
  const v = metric.fmt(metric.of(e), e);
  const me = e.id === myId;
  return `<div class="lb-row${me ? ' me' : ''}">
    <span class="lb-rank${i < 3 ? ' top' + (i + 1) : ''}">${i + 1}</span>
    <span class="lb-name">${lbEsc(e.name)}${me ? ' <b>（我）</b>' : ''}</span>
    <span class="lb-val">${metric.icon} ${lbEsc(v)}</span>
  </div>`;
}
function lbNamePromptHTML(msg){
  return `<div class="lb-name-box">
    <div class="lb-prompt-title">🏅 先给自己起个名字</div>
    <div class="lb-prompt-sub">排行榜靠这个名字认人（1~${LB_NAME_MAX} 个字，随时可改）</div>
    <div class="lb-prompt-row">
      <input id="lbNameInput" class="lb-input" type="text" maxlength="${LB_NAME_MAX}" placeholder="例如：种田大户" autocomplete="off">
      <button class="mini primary" id="lbNameSave">就用这个名字</button>
    </div>
    <div class="lb-err">${lbEsc(msg || '')}</div>
  </div>`;
}
function lbChipsHTML(cur){
  return `<div class="lb-chips">${LB_METRICS.map(m =>
    `<button class="lb-chip${m.id === cur ? ' on' : ''}" data-lb-metric="${m.id}" title="按${m.name}排序">${m.icon} ${m.name}</button>`
  ).join('')}</div>`;
}
function lbMySummaryHTML(){
  const s = lbMyStats();
  const list = LB_METRICS.map(m => `<span class="lb-mine"><i>${m.icon}</i>${lbEsc(m.fmt(m.of(Object.assign({}, s, { farmW:s.farmW, farmH:s.farmH })), s))}</span>`).join('');
  return `<div class="lb-mine-wrap">我的战绩：${list}</div>`;
}
function lbOnlineHintHTML(extra){
  return `<div class="lb-offline">📡 连不上排行榜服务器${extra ? '（' + lbEsc(extra) + '）' : ''} —— 游戏不受影响，可以稍后再点「重试」。</div>`;
}

function renderLeaderboard(){
  const el = document.getElementById('lbBody');
  if(!el) return;
  if(!state.playerName){
    el.innerHTML = lbNamePromptHTML('');
    const inp = document.getElementById('lbNameInput');
    if(inp){
      inp.addEventListener('keydown', e => { if(e.key === 'Enter') lbSaveName(); });
      setTimeout(() => { try { inp.focus(); } catch(e){} }, 30);
    }
    const b = document.getElementById('lbNameSave');
    if(b) b.onclick = lbSaveName;
    return;
  }
  const metric = lbMetric(state.lbSort || 'coins');
  const mine = lbMyStats();
  if(lbBusy){
    el.innerHTML = `<div class="lb-loading">⏳ 正在读取榜单…</div>` + lbMySummaryHTML();
    return;
  }
  const list = lbSortEntries(state.lbCache || [], metric.id);
  const online = state.lbOnline !== false;
  let head = `${lbChipsHTML(metric.id)}
    <div class="lb-toolbar">
      <span class="lb-count">${online ? `共 ${state.lbCount || list.length} 人 · 按${metric.name}排序` : '离线'}</span>
      <span class="lb-actions">
        <button class="mini" id="lbRefresh">刷新 / 上报</button>
        <button class="mini" id="lbRename">改名</button>
      </span>
    </div>`;
  let body;
  if(!online){
    body = lbOnlineHintHTML(state.lbError) + lbMySummaryHTML();
  } else if(!list.length){
    body = `<div class="lb-empty">榜上还没有人 —— 你就是第一名 🥇</div>` + lbMySummaryHTML();
  } else {
    const myRank = lbMyRank(list);
    body = `<div class="lb-table">${list.slice(0, LB_TABLE_MAX).map((e, i) => lbEntryRow(e, i, metric, state.playerId)).join('')}</div>`;
    if(myRank) body += `<div class="lb-myrank">我的名次：第 <b>${myRank}</b> 名</div>`;
    body += lbMySummaryHTML();
  }
  el.innerHTML = head + body;

  el.querySelectorAll('[data-lb-metric]').forEach(b => {
    b.onclick = () => {
      state.lbSort = b.dataset.lbMetric;
      SFX.play('click'); save(); renderLeaderboard();
    };
  });
  const rf = document.getElementById('lbRefresh');
  if(rf) rf.onclick = () => {
    SFX.play('click');
    toast('正在上报并刷新…');
    lbRefresh(true);
  };
  const rn = document.getElementById('lbRename');
  if(rn) rn.onclick = () => {
    el.innerHTML = lbNamePromptHTML('');
    const inp = document.getElementById('lbNameInput');
    if(inp){
      inp.value = state.playerName || '';
      inp.addEventListener('keydown', e => { if(e.key === 'Enter') lbSaveName(); });
      setTimeout(() => { try { inp.focus(); inp.select(); } catch(e){} }, 30);
    }
    const b = document.getElementById('lbNameSave');
    if(b) b.onclick = lbSaveName;
  };
}
function lbSaveName(){
  const inp = document.getElementById('lbNameInput');
  const r = lbSetName(inp ? inp.value : '');
  if(!r.ok){
    const box = document.querySelector('#lbBody .lb-err');
    if(box) box.textContent = r.msg;
    SFX.play('error');
    return;
  }
  SFX.play('achieve');
  toast(`好，就叫「${r.name}」`);
  renderHUD();
  lbRefresh(true);
}
/* 打开排行榜：先上报自己的成绩，再拉最新榜单 */
function lbOpen(){
  try {
    renderLeaderboard();
    if(state.playerName) lbRefresh(false);
  } catch(e){
    const el = document.getElementById('lbBody');
    if(el) el.innerHTML = '<div class="lb-offline">排行榜打开出错：' + lbEsc(e && e.message) + '</div>';
  }
}
function lbRefresh(force){
  if(lbBusy) return Promise.resolve();
  lbBusy = true;
  renderLeaderboard();
  return lbSubmit(force)
    .then(() => lbLoad())
    .then(list => {
      lbBusy = false;
      if(list){
        state.lbCache = list;
        state.lbCount = list.length;
        state.lbRank = lbMyRank(lbSortEntries(list, state.lbSort || 'coins'));
      }
      renderLeaderboard();
      return list;
    })
    .catch(() => {
      lbBusy = false;
      state.lbOnline = false;
      renderLeaderboard();
      return null;
    });
}
