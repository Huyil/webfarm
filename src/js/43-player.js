/* ============ 小人：移动 + 工具动作 ============
 * 玩法判定是即时的，走路与挥动只是表现层。
 * applyToolAt 会设置 p.tx/ty（目标格）与 p.actionType；距离远时动作排队到走到后再播。
 */
const PLAYER_SPEED = 0.016;       // 格 / 毫秒（≈16 格/秒，队列作业时跑起来不拖沓）
const ACTION_MS = 380;            // 单次工具动作时长

/* ---------- 工作队列：拖拽/框选产生的一串待办，小人依次走过去做 ---------- */
function playerQueue(){ const p = state.player; if(!p.queue) p.queue = []; return p.queue; }
function jobActive(){
  const p = state.player;
  return (p.queue && p.queue.length > 0) || !!p.pendingOp || !!state.jobBox;
}
function playerEnqueue(gx, gy, tool){
  const q = playerQueue();
  if(state.jobBox && q.length === 0 && !state.player.pendingOp){ /* 新作业接着排 */ }
  const last = q[q.length - 1];
  const use = tool || state.tool;
  if(last && last.gx === gx && last.gy === gy && last.tool === use) return false;
  if(state.player.tx === gx && state.player.ty === gy && !state.player.pendingOp && (state.player.pendingOp || {}).tool === use) return false;
  q.push({ gx, gy, tool: use });
  return true;
}
function playerClearQueue(){
  const p = state.player;
  p.queue = []; p.pendingOp = null; state.jobBox = null; state.box = null;
}
/* 贪心最近邻：让小人按一条顺路走完框选区域（简易路径规划） */
function planPath(list, from){
  const rest = list.slice(), out = [];
  let cur = from;
  while(rest.length){
    let bi = 0, bd = Infinity;
    for(let i = 0; i < rest.length; i++){
      const d = Math.abs(rest[i].gx - cur.gx) + Math.abs(rest[i].gy - cur.gy);
      if(d < bd){ bd = d; bi = i; }
    }
    const t = rest.splice(bi, 1)[0];
    out.push(t); cur = t;
  }
  return out;
}

/* 队列跑到一半资源不够了 → 自动停手并说明原因（而不是一格一格弹错误 / 空走）
 * 提示做节流：拖拽时每一格都会触发一次检查，不能一格弹一次 */
let lastStopToastAt = 0;
function toastStop(msg){
  const now = Date.now();
  if(now - lastStopToastAt < 1500) return;
  lastStopToastAt = now;
  toast(msg);
}
function queueStopMsg(tool){
  if(tool === 'seed'){
    const def = CROPS[state.selectedSeed];
    if(!def) return '没有选种子';
    if(state.coins < def.seedCost) return `金币不够买 ${def.name} 种子了，已停止播种（还差 ${def.seedCost - state.coins} 金）`;
  } else if(tool === 'fert'){
    if(state.fertilizer <= 0) return '普通肥料用完了，已停止施肥';
  } else if(tool === 'premium'){
    if(state.premium <= 0) return '高级肥料用完了，已停止催熟';
  } else if(tool === 'decor'){
    if(!state.selectedDecor) return '没有选中装饰';
    if((state.decorBag[state.selectedDecor] || 0) <= 0) return '装饰仓库里这件用完了，已停止摆放';
  }
  return null;
}

function playerGrid(){ const p = state.player; return { x: p.x != null ? p.x : p.gx, y: p.y != null ? p.y : p.gy }; }
function playerScreen(cx, cy){
  const { x, y } = playerGrid();
  const { sx, sy } = iso(x, y);
  return { x: cx + sx * SCALE, y: cy + sy * SCALE };
}
function playerActionT(){
  const p = state.player;
  if(!p.actionType) return -1;
  const dur = Math.max(1, p.actionUntil - p.actionStart);
  const t = (Date.now() - p.actionStart) / dur;
  if(t < 0) return -1;
  return t > 1 ? -1 : t;
}
/* 拖拽刷地时用：直接把人贴到该格（跟手），不做走路动画 */
function playerSnap(gx, gy, actionType){
  const p = state.player;
  p.x = gx; p.y = gy; p.tx = gx; p.ty = gy; p.gx = gx; p.gy = gy;
  p.moving = false; p.bob = 0; p.pendingOp = null; p.queuedAction = null;
  p.actionType = actionType;
  p.actionStart = Date.now(); p.actionUntil = Date.now() + ACTION_MS;
}
/* 让小人走向某格，并在到位后执行动作（可带一个待执行操作） */
function playerGoto(gx, gy, actionType, op){
  const p = state.player;
  const dist = Math.hypot(gx - p.x, gy - p.y);
  p.tx = gx; p.ty = gy;
  p.pendingOp = op || null;
  if(dist < 0.6){
    p.actionType = actionType; p.actionStart = Date.now(); p.actionUntil = Date.now() + ACTION_MS;
    p.queuedAction = null;
    if(p.pendingOp){ const o = p.pendingOp; p.pendingOp = null; runTool(o.gx, o.gy, o.silent, o.tool); }
  } else {
    p.queuedAction = actionType;
  }
}
function updatePlayer(dt){
  const p = state.player;
  if(p.x == null){ p.x = p.gx; p.y = p.gy; }
  if(!p.queue) p.queue = [];
  const arrive = () => {
    p.x = p.tx; p.y = p.ty;
    p.moving = false; p.bob = 0;
    p.gx = Math.round(p.x); p.gy = Math.round(p.y);
    if(p.queuedAction){
      p.actionType = p.queuedAction; p.actionStart = Date.now(); p.actionUntil = Date.now() + ACTION_MS;
      p.queuedAction = null;
    }
    /* 走到位才真正干活：锄地/播种/浇水等效果与动画对齐 */
    if(p.pendingOp){
      const op = p.pendingOp; p.pendingOp = null;
      runTool(op.gx, op.gy, !!op.silent, op.tool);
    }
  };
  /* 队列里还有活、人又闲着 → 领下一个目标 */
  if(!p.moving && !p.pendingOp && p.queue.length){
    const head = p.queue[0];
    const jobTool = (head && head.tool) || state.tool;     /* 用作业自己的工具，中途切工具也不影响 */
    const stop = queueStopMsg(jobTool);
    if(stop){
      /* 钱/肥料/装饰用光：整条队列就地停手（剩下的格子不再空走） */
      playerClearQueue();
      toastStop(stop);
      renderHUD(); save();
    } else {
      const next = p.queue.shift();
      playerGoto(next.gx, next.gy, jobTool, { gx: next.gx, gy: next.gy, silent: true, tool: jobTool });
    }
  }
  const dx = p.tx - p.x, dy = p.ty - p.y;
  const dist = Math.hypot(dx, dy);
  if(dist > 0.02){
    const step = Math.min(dist, PLAYER_SPEED * dt);
    p.x += dx / dist * step;
    p.y += dy / dist * step;
    p.moving = true;
    p.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    p.bob += dt * 0.014;
    if(step >= dist - 1e-6) arrive();      // 本帧正好抵达：立即结算，不用等下一帧
  } else if(p.moving || p.x !== p.tx || p.y !== p.ty){
    arrive();
  }
  if(p.actionType && Date.now() > p.actionUntil) p.actionType = null;
  /* 队列干完了 → 撤掉框选高亮 */
  if(state.jobBox && !p.moving && !p.pendingOp && p.queue.length === 0){
    state.jobBox = null;
    if(!(typeof boxMode !== 'undefined' && boxMode)) state.box = null;
    toast('框选作业完成');
    save();
  }
}

/* ---------- 绘制 ---------- */
function roundRect(g, x, y, w, h, r){
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
/* 工具：hx,hy 是手的位置；angle 为挥动角 */
function drawTool(g, hx, hy, type, angle, facing){
  g.save();
  g.translate(hx, hy);
  g.rotate(angle);
  const flip = facing === 'left' ? -1 : 1;
  g.scale(flip, 1);
  switch(type){
    case 'hoe': {
      g.lineCap = 'round';
      g.strokeStyle = '#8a5a2b'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(22, 2); g.stroke();
      g.fillStyle = '#b9c2cc';
      g.beginPath(); g.moveTo(20, 0); g.lineTo(30, -3); g.lineTo(31, 7); g.lineTo(21, 6); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.stroke();
      break;
    }
    case 'water': {
      g.fillStyle = '#7fb6e8';
      roundRect(g, -2, -6, 14, 12, 3); g.fill();
      g.strokeStyle = '#4d84b8'; g.lineWidth = 1.4; g.stroke();
      g.beginPath(); g.moveTo(12, -3); g.lineTo(20, -7); g.lineTo(20, 1); g.closePath(); g.fill();
      g.fillStyle = '#3f6ecb';
      roundRect(g, 2, -8, 8, 4, 2); g.fill();
      break;
    }
    case 'sickle': {
      g.strokeStyle = '#d8dde3'; g.lineWidth = 3.4; g.lineCap = 'round';
      g.beginPath(); g.arc(4, 0, 12, -1.9, 0.35); g.stroke();
      g.strokeStyle = '#7a4a22'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(2, 2); g.lineTo(-6, 8); g.stroke();
      break;
    }
    case 'seed': {
      g.fillStyle = '#c9a26a';
      roundRect(g, -3, -5, 12, 10, 3); g.fill();
      g.fillStyle = '#8a6a3a';
      g.beginPath(); g.arc(4, -6, 3.2, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'fert': case 'premium': {
      g.fillStyle = type === 'premium' ? '#ffd76e' : '#9fd67a';
      roundRect(g, -2, -7, 10, 14, 3); g.fill();
      g.fillStyle = '#5a5a66';
      roundRect(g, 0, -10, 6, 4, 1.5); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1; g.stroke();
      break;
    }
    case 'decor': {
      g.fillStyle = '#8fbf6a';
      g.beginPath(); g.arc(2, -2, 5.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#6a9a44';
      g.beginPath(); g.arc(6, 2, 3.6, 0, Math.PI * 2); g.fill();
      break;
    }
    default: {
      g.fillStyle = '#e8c9a0';
      g.beginPath(); g.arc(2, 0, 3.4, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
}
/* 不同工具的动作曲线：返回 {armAngle, bodyLean, toolAngle} */
function actionPose(type, t){
  const e = t < 0 ? 0 : t;
  switch(type){
    case 'hoe': {
      const sw = e < 0.45 ? -1.1 + e / 0.45 * 2.0 : 1.0 - (e - 0.45) / 0.55 * 1.2;
      return { tool: sw, lean: Math.sin(e * Math.PI) * 0.12, y: 0 };
    }
    case 'sickle': {
      const sw = e < 0.4 ? -0.6 - e / 0.4 * 0.9 : -1.5 + (e - 0.4) / 0.6 * 1.6;
      return { tool: sw, lean: Math.sin(e * Math.PI) * 0.08, y: 0 };
    }
    case 'water':  return { tool: -0.5 - Math.sin(e * Math.PI) * 0.6, lean: Math.sin(e * Math.PI) * 0.05, y: 0 };
    case 'seed':   return { tool: -0.2, lean: 0, y: Math.sin(e * Math.PI) * 3 };
    case 'fert': case 'premium':
      return { tool: -0.7 - Math.sin(e * Math.PI * 2) * 0.35, lean: 0, y: 0 };
    case 'decor':  return { tool: -0.4, lean: 0, y: -Math.sin(e * Math.PI) * 2 };
    default:       return { tool: -0.35, lean: 0, y: 0 };
  }
}
function drawPlayer(g, cx, cy){
  const p = state.player;
  if(p.x == null){ p.x = p.gx; p.y = p.gy; if(p.tx == null){ p.tx = p.gx; p.ty = p.gy; } }
  const { x, y } = playerScreen(cx, cy);
  const t = playerActionT();
  const pose = actionPose(p.actionType, t);
  const walking = p.moving;
  const swing = walking ? Math.sin(p.bob) : 0;
  const bob = (walking ? Math.abs(Math.sin(p.bob)) * 1.8 : 0) + (p.actionType ? -pose.y * 0.4 : 0);
  const face = p.facing;
  const scale = 1 - (pose.lean || 0);
  const S = 1;

  g.save();
  g.translate(x, y - bob);

  // 影子
  g.globalAlpha = 0.26; g.fillStyle = '#000';
  g.beginPath(); g.ellipse(0, 2, 11, 5, 0, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;

  g.save();
  g.scale(1, scale);

  // 腿
  g.strokeStyle = '#2f3b57'; g.lineWidth = 4; g.lineCap = 'round';
  const legSwing = walking ? swing * 4 : 0;
  g.beginPath(); g.moveTo(-3, -7); g.lineTo(-3 - legSwing, 0); g.stroke();
  g.beginPath(); g.moveTo(3, -7); g.lineTo(3 + legSwing, 0); g.stroke();

  // 身体
  const bodyGrad = g.createLinearGradient(-7, -22, 7, -6);
  bodyGrad.addColorStop(0, '#5b8ce0'); bodyGrad.addColorStop(1, '#31549c');
  g.fillStyle = bodyGrad;
  roundRect(g, -8, -22, 16, 16, 5); g.fill();
  // 背带
  g.strokeStyle = '#e8e2d0'; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(-3, -22); g.lineTo(-2, -8); g.stroke();
  g.beginPath(); g.moveTo(3, -22); g.lineTo(2, -8); g.stroke();

  // 手臂
  const armA = pose.tool;
  g.strokeStyle = '#f2c9a0'; g.lineWidth = 3.6; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-7, -18); g.lineTo(-11 - (face === 'left' ? -3 : 3), -13 + Math.sin(armA) * 3); g.stroke();
  g.beginPath(); g.moveTo(7, -18); g.lineTo(11, -12 - (walking ? swing * 2 : 0)); g.stroke();

  // 头
  const headY = -30;
  g.fillStyle = '#ffd9b0';
  g.beginPath(); g.arc(0, headY, 8.4, 0, Math.PI * 2); g.fill();
  // 头发
  g.fillStyle = '#241d1a';
  g.beginPath(); g.arc(0, headY - 1.5, 8.6, Math.PI * 1.06, Math.PI * 1.94); g.fill();
  if(face !== 'up'){
    g.beginPath();
    g.ellipse(0, headY - 5.4, 8.8, 5.4, 0, Math.PI, Math.PI * 2); g.fill();
  }
  // 眼睛
  if(face !== 'up'){
    g.fillStyle = '#2a2320';
    const ex = face === 'left' ? -2.6 : face === 'right' ? 2.6 : 0;
    g.beginPath(); g.arc(ex - 2.6, headY + 1.4, 1.15, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(ex + 2.6, headY + 1.4, 1.15, 0, Math.PI * 2); g.fill();
    if(face === 'down'){
      g.strokeStyle = '#c8705a'; g.lineWidth = 1.1;
      g.beginPath(); g.arc(0, headY + 3.6, 2.4, 0.25, Math.PI - 0.25); g.stroke();
    }
  }
  // 草帽
  g.fillStyle = '#e6c471';
  g.beginPath(); g.ellipse(0, headY - 6.2, 8.2, 5.2, 0, Math.PI, Math.PI * 2); g.fill();
  g.fillStyle = '#d8b055';
  g.beginPath(); g.ellipse(0, headY - 6.0, 14, 4.2, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#c39a45';
  g.beginPath(); g.ellipse(0, headY - 6.0, 14, 4.2, 0, 0, Math.PI); g.fill();
  g.fillStyle = '#8a5a2b';
  g.beginPath(); g.ellipse(0, headY - 8.2, 8.4, 1.6, 0, 0, Math.PI * 2); g.fill();
  // 帽带
  g.strokeStyle = '#b8452f'; g.lineWidth = 1.6;
  g.beginPath(); g.ellipse(0, headY - 6.2, 8.3, 5.3, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();

  g.restore();

  // 手上的工具
  const handX = (face === 'left' ? -12 : 12), handY = -14;
  const tool = p.actionType || (walking ? null : 'hoe');
  if(tool) drawTool(g, handX, handY, tool, pose.tool, face);

  // 挥击瞬间的尘土
  if(t >= 0.42 && t <= 0.58 && (p.actionType === 'hoe' || p.actionType === 'sickle')){
    g.globalAlpha = 1 - Math.abs(t - 0.5) / 0.08;
    g.fillStyle = 'rgba(140,105,70,.55)';
    for(let i = 0; i < 4; i++){
      const a = -0.2 - i * 0.5;
      g.beginPath(); g.arc(Math.cos(a) * 14 + (face === 'left' ? -6 : 6), Math.sin(a) * 8 + 2, 2.2, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }
  g.restore();
}
