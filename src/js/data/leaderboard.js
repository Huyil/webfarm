/* ============ 排行榜：数据与 API ============
 * 服务端是 mcu.huyil.cn 上的一支小服务（python3 标准库，见 deploy/leaderboard/），
 * 由 openresty 反代到 /farm/api/。离线（本地打开 / 服务器挂了）时一切功能降级为本地展示，
 * 游戏本体不受影响。
 */
const LB_API_BASE = (typeof window !== 'undefined' && window.FARM_LB_API) ? window.FARM_LB_API : '/farm/api';
const LB_TIMEOUT_MS = 8000;
const LB_SUBMIT_GAP_MS = 30000;          /* 两次上报的最小间隔，别刷服务器 */
const LB_NAME_MAX = 12;
const LB_TABLE_MAX = 50;                 /* 榜单最多显示多少行 */

/* 五个榜单项目：图标 + 取值方式。点一下表头/图标就切换排序。 */
const LB_METRICS = [
  { id:'coins',   icon:'💰', name:'金币', short:'金币',   of: e => e.coins | 0,        fmt: v => v.toLocaleString('en-US') },
  { id:'harvest', icon:'🌾', name:'收获', short:'收获数', of: e => e.harvest | 0,      fmt: v => v + ' 株' },
  { id:'area',    icon:'🗺️', name:'田块', short:'田块尺寸', of: e => (e.farmW | 0) * (e.farmH | 0), fmt: (v, e) => (e.farmW | 0) + '×' + (e.farmH | 0) },
  { id:'ach',     icon:'🏆', name:'成就', short:'成就数', of: e => e.ach | 0,          fmt: v => v + ' / 30' },
  { id:'tasks',   icon:'✅', name:'任务', short:'完成任务', of: e => e.tasks | 0,      fmt: v => v + ' 个' },
];
function lbMetric(id){ return LB_METRICS.find(m => m.id === id) || LB_METRICS[0]; }

/* 玩家自己的统计（上报用） */
function lbMyStats(){
  return {
    coins:   Math.max(0, Math.floor(state.coins || 0)),
    harvest: Math.max(0, Math.floor((state.stats && state.stats.total && state.stats.total.harvest) || 0)),
    farmW:   Math.max(0, Math.floor((state.farm && state.farm.w) || 0)),
    farmH:   Math.max(0, Math.floor((state.farm && state.farm.h) || 0)),
    ach:     Object.keys(state.achievements || {}).length,
    tasks:   Math.max(0, Math.floor((state.stats && state.stats.total && state.stats.total.tasksDone) || 0)),
  };
}
/* 玩家标识：一个本地生成的随机 id（换名字不会丢成绩） */
function lbPlayerId(){
  if(!state.playerId){
    state.playerId = 'p-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    save();
  }
  return state.playerId;
}
/* 名字清洗：和服务端同一套规则（服务端还会再洗一遍） */
function lbCleanName(raw){
  let s = String(raw == null ? '' : raw);
  s = s.split('').filter(ch => ch >= ' ' && ch !== '\x7f').join('');
  for(const ch of ['<', '>', '&', '"', "'", '`', '(', ')', '\\', '/']) s = s.split(ch).join('');
  return s.trim().slice(0, LB_NAME_MAX);
}
function lbName(raw){ return state.playerName || ''; }
function lbSetName(raw){
  const s = lbCleanName(raw);
  if(!s) return { ok:false, msg:'名字不能为空' };
  state.playerName = s;
  state.lbLastSubmit = 0;               /* 改名后立刻允许重新上报 */
  save();
  return { ok:true, name:s };
}

/* ---------- HTTP ---------- */
function lbFetchJSON(path, opts){
  const o = Object.assign({ cache:'no-store' }, opts || {});
  /* fetch 不存在（老浏览器 / 无头测试）也不能把游戏带崩：一律转成 rejected promise */
  if(typeof fetch !== 'function') return Promise.reject(new Error('no fetch'));
  try {
    if(typeof AbortController === 'function'){
      const ac = new AbortController();
      o.signal = ac.signal;
      setTimeout(() => { try { ac.abort(); } catch(e){} }, LB_TIMEOUT_MS);
    }
    return Promise.resolve(fetch(LB_API_BASE + path, o)).then(r => Promise.resolve(r.json()).then(j => {
      if(!r.ok || !j || j.ok === false) throw new Error((j && j.error) || ('HTTP ' + r.status));
      return j;
    }));
  } catch(e){
    return Promise.reject(e);
  }
}
/* 拉榜单 */
function lbLoad(){
  return lbFetchJSON('/leaderboard?limit=' + LB_TABLE_MAX).then(d => {
    const list = Array.isArray(d.entries) ? d.entries : [];
    state.lbOnline = true;
    state.lbUpdatedAt = d.updatedAt || 0;
    state.lbCache = list;                    /* 拉到就顺手缓存，渲染只认缓存 */
    state.lbCount = list.length;
    return list;
  }).catch(e => {
    state.lbOnline = false;
    state.lbError = String(e && e.message || e);
    return null;
  });
}
/* 上报成绩（节流；离线时报错不打扰玩家） */
function lbSubmit(force){
  if(!state.playerName) return Promise.resolve(null);
  const now = Date.now();
  if(!force && now - (state.lbLastSubmit || 0) < LB_SUBMIT_GAP_MS) return Promise.resolve(null);
  const body = Object.assign({ id: lbPlayerId(), name: state.playerName }, lbMyStats());
  state.lbLastSubmit = now;
  return lbFetchJSON('/leaderboard', {
    method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body),
  }).then(d => {
    state.lbOnline = true;
    state.lbRank = d.rank || null;
    state.lbUpdatedAt = d.updatedAt || Date.now() / 1000 | 0;
    state.lbCount = d.count || (d.entries ? d.entries.length : 0);
    save();
    return d;
  }).catch(e => {
    state.lbOnline = false;
    state.lbError = String(e && e.message || e);
    state.lbLastSubmit = 0;              /* 失败不算次数，下次可以重试 */
    return null;
  });
}
/* 排序：按当前项目降序，同分用金币兜底，保证名次稳定 */
function lbSortEntries(list, metricId){
  const m = lbMetric(metricId);
  return list.slice().sort((a, b) => {
    const d = m.of(b) - m.of(a);
    if(d) return d;
    const dh = (b.harvest | 0) - (a.harvest | 0);      /* 同分先比收获 */
    if(dh) return dh;
    const dc = (b.coins | 0) - (a.coins | 0);          /* 再比金币 */
    if(dc) return dc;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}
/* 名次（找不到自己就是 null） */
function lbMyRank(list){
  const id = state.playerId;
  const i = list.findIndex(e => e.id === id);
  return i < 0 ? null : i + 1;
}
