/* ============ 全屏特效 ============
 * 契约：以下函数由其他模块调用；实现方只填空函数体，不要改名/改签名。
 *   fxFlash(x, y, color, size)   某点爆闪（高级肥料催熟、出锅成功）
 *   fxCelebrate(title, sub)      全屏庆祝（成就解锁）
 *   fxCoinBurst(x, y, n)         金币迸射
 *   fxToastBig(text)             屏幕中央大字
 *   updateEffects(dt)            每帧推进
 *   drawEffects(g)               render() 末尾绘制（屏幕坐标）
 * 全部特效都是「数组 + dt 驱动 + 寿命回收」，数组带上限，不会无限增长。
 * state.effectsEnabled 为 false 时：入口不新增、updateEffects 清场、drawEffects 不画。
 */
const FX_MAX = 300;            /* 通用特效粒子上限（彩带 / 星屑） */
const FX_FLASH_MAX = 20;       /* 爆闪上限 */
const FX_COIN_MAX = 64;        /* 金币上限 */
const FX_SHAKE_SEC = 0.2;      /* 屏幕震动时长 */
const fxParts = [];
const fxFlashes = [];
const fxCoins = [];
let fxBanner = null;           /* 庆祝横幅 { title, sub, life, max } */
let fxBig = null;              /* 中央大字 { text, life, max } */
let fxShakeT = 0, fxShakeMag = 0;

/* 统一的入队 + 上限裁剪（超出丢最旧的） */
function fxPush(list, item, max){
  list.push(item);
  const over = list.length - max;
  if(over > 0) list.splice(0, over);
}
function fxRgba(hex, a){
  if(typeof hex !== 'string' || hex.charAt(0) !== '#') return hex;
  let h = hex.slice(1);
  if(h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
  if(h.length !== 6) return 'rgba(255,255,255,' + a.toFixed(3) + ')';
  const n = parseInt(h, 16);
  if(isNaN(n)) return 'rgba(255,255,255,' + a.toFixed(3) + ')';
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a.toFixed(3) + ')';
}

/* ============================================================
 * 入口
 * ============================================================ */
function fxFlash(x, y, color, size){
  if(!state.effectsEnabled) return;
  fxPush(fxFlashes, {
    x: x, y: y, color: color || '#fff3b0', size: size || 80,
    life: FX_SHAKE_SEC, max: FX_SHAKE_SEC,
  }, FX_FLASH_MAX);
  fxShakeT = FX_SHAKE_SEC;
  fxShakeMag = Math.min(6, 2.2 + (size || 80) * 0.03);
}
function fxCelebrate(title, sub){
  if(!state.effectsEnabled) return;
  fxBanner = { title: title || '', sub: sub || '', life: 2.2, max: 2.2 };
  /* 顶部飘落的彩带 */
  for(let i = 0; i < 70; i++){
    fxPush(fxParts, {
      kind: 'confetti',
      x: Math.random() * W,
      y: -24 - Math.random() * H * 0.4,
      vx: (Math.random() - 0.5) * 1.8,
      vy: 1.6 + Math.random() * 2.4,
      g: 0.012, rot: Math.random() * 6.2832, spin: (Math.random() - 0.5) * 0.22,
      w: 4 + Math.random() * 7, h: 3 + Math.random() * 4,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      life: 2.2, max: 2.2,
    }, FX_MAX);
  }
  /* 中央星屑迸射 */
  const cx = W / 2, cy = H * 0.42;
  for(let i = 0; i < 42; i++){
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5.2;
    fxPush(fxParts, {
      kind: 'spark',
      x: cx, y: cy,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2,
      g: 0.06, rot: a, spin: 0,
      w: 3 + Math.random() * 4, h: 3,
      color: '#fff3b0',
      life: 1.0, max: 1.0,
    }, FX_MAX);
  }
}
function fxCoinBurst(x, y, n){
  if(!state.effectsEnabled) return;
  const cnt = Math.max(1, Math.min(18, n || 3));
  for(let i = 0; i < cnt; i++){
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const sp = 2.2 + Math.random() * 3.4;
    fxPush(fxCoins, {
      x: x, y: y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      rot: Math.random() * 6.2832, spin: (Math.random() - 0.5) * 0.34,
      life: 1.05, max: 1.05,
    }, FX_COIN_MAX);
  }
}
function fxToastBig(text){
  if(!state.effectsEnabled) return;
  fxBig = { text: text || '', life: 1.3, max: 1.3 };
}

/* ============================================================
 * 推进
 * ============================================================ */
function fxStepParts(list, dt, s){
  for(let i = list.length - 1; i >= 0; i--){
    const p = list[i];
    p.life -= dt / 1000;
    if(p.life <= 0){ list.splice(i, 1); continue; }
    p.x += p.vx * s;
    p.y += p.vy * s;
    p.vy += p.g * s;
    p.vx += (ATMOS.windSway - 0.5) * 0.05 * s;      /* 跟着风轻轻飘 */
    p.rot += p.spin * s;
  }
}
function fxStepCoins(dt, s){
  for(let i = fxCoins.length - 1; i >= 0; i--){
    const c = fxCoins[i];
    c.life -= dt / 1000;
    if(c.life <= 0 || c.y > H + 60){ fxCoins.splice(i, 1); continue; }
    c.x += c.vx * s;
    c.y += c.vy * s;
    c.vy += 0.34 * s;                                /* 金币下落 */
    c.vx *= 1 - 0.02 * s;
    c.rot += c.spin * s;
  }
}
function fxApplyShake(){
  if(typeof canvas === 'undefined' || !canvas || !canvas.style) return;
  const k = Math.max(0, fxShakeT / FX_SHAKE_SEC);
  const m = fxShakeMag * k * k;
  const ox = (Math.random() - 0.5) * 2 * m;
  const oy = (Math.random() - 0.5) * 2 * m;
  canvas.style.transform = 'translate(' + ox.toFixed(2) + 'px,' + oy.toFixed(2) + 'px)';
}
function fxClearShake(){
  if(typeof canvas === 'undefined' || !canvas || !canvas.style) return;
  if(canvas.style.transform) canvas.style.transform = '';
}
function updateEffects(dt){
  /* 关掉特效时清场，避免开关来回切留下残留 */
  if(!state.effectsEnabled){
    if(fxParts.length) fxParts.length = 0;
    if(fxFlashes.length) fxFlashes.length = 0;
    if(fxCoins.length) fxCoins.length = 0;
    fxBanner = null; fxBig = null;
    fxShakeT = 0; fxShakeMag = 0; fxClearShake();
    return;
  }
  const s = Math.min(3, dt / 16.666);
  fxStepParts(fxParts, dt, s);
  fxStepCoins(dt, s);
  for(let i = fxFlashes.length - 1; i >= 0; i--){
    const f = fxFlashes[i];
    f.life -= dt / 1000;
    if(f.life <= 0) fxFlashes.splice(i, 1);
  }
  if(fxBanner){ fxBanner.life -= dt / 1000; if(fxBanner.life <= 0) fxBanner = null; }
  if(fxBig){ fxBig.life -= dt / 1000; if(fxBig.life <= 0) fxBig = null; }
  if(fxShakeT > 0){
    fxShakeT -= dt / 1000;
    if(fxShakeT <= 0){ fxShakeT = 0; fxShakeMag = 0; fxClearShake(); }
    else fxApplyShake();
  }
}

/* ============================================================
 * 绘制（屏幕坐标，render() 末尾调用）
 * ============================================================ */
function fxDrawFlash(g, f){
  const k = 1 - f.life / f.max;                     /* 0→1 扩散 */
  const a = f.life / f.max;
  const r = f.size * (0.35 + k * 0.95);
  const grd = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
  grd.addColorStop(0, fxRgba(f.color, 0.85 * a));
  grd.addColorStop(0.42, fxRgba(f.color, 0.30 * a));
  grd.addColorStop(1, fxRgba(f.color, 0));
  g.fillStyle = grd;
  g.beginPath(); g.arc(f.x, f.y, r, 0, Math.PI * 2); g.fill();
  g.globalAlpha = a * 0.9;
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(f.x, f.y, f.size * 0.09 * a, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
}
function fxDrawCoin(g, c){
  const a = Math.min(1, c.life / c.max * 1.6);
  const sq = Math.abs(Math.cos(c.rot));             /* 转起来时宽度收窄 */
  const rx = 5 * (0.3 + 0.7 * sq), ry = 5;
  g.globalAlpha = a;
  g.beginPath(); g.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = '#ffd24a'; g.fill();
  g.lineWidth = 1.2; g.strokeStyle = '#c98a12'; g.stroke();
  if(rx > 2.4){
    g.beginPath(); g.ellipse(c.x, c.y, rx * 0.48, ry * 0.48, 0, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(255,255,255,.65)'; g.lineWidth = 1; g.stroke();
  }
  g.globalAlpha = 1;
}
function fxDrawPart(g, p){
  const a = Math.min(1, p.life / p.max * 1.8);
  g.globalAlpha = a;
  if(p.kind === 'confetti'){
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    g.fillStyle = p.color;
    g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * (0.45 + 0.55 * Math.abs(Math.cos(p.rot))));
    g.restore();
  } else {
    /* 星屑：两笔画出的四角星 */
    const r = p.w;
    g.strokeStyle = p.color;
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(p.x - r, p.y); g.lineTo(p.x + r, p.y);
    g.moveTo(p.x, p.y - r); g.lineTo(p.x, p.y + r);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.beginPath(); g.arc(p.x, p.y, r * 0.32, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}
function fxDrawBig(g, b){
  const k = 1 - b.life / b.max;
  const appear = Math.min(1, k / 0.14);
  const fade = Math.min(1, (1 - k) / 0.34);
  const a = Math.min(appear, fade);
  const sc = 0.72 + appear * 0.5 - k * 0.1;
  g.save();
  g.globalAlpha = Math.max(0, a);
  g.translate(W / 2, H * 0.42);
  g.scale(sc, sc);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 46px system-ui,-apple-system,"PingFang SC",sans-serif';
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(28,20,6,.85)';
  g.strokeText(b.text, 0, 0);
  g.fillStyle = '#fff3b0';
  g.fillText(b.text, 0, 0);
  g.restore();
  g.globalAlpha = 1;
}
function fxDrawBanner(g, b){
  const k = 1 - b.life / b.max;
  const inT = Math.min(1, k / 0.16);
  const outT = Math.min(1, (1 - k) / 0.2);
  const a = Math.max(0, Math.min(inT, outT));
  const bw = Math.min(W * 0.8, 560), bh = 86;
  const bx = (W - bw) / 2, by = 40 + (1 - inT) * -30;
  g.save();
  g.globalAlpha = a;
  /* 横幅底 */
  const grd = g.createLinearGradient(bx, by, bx + bw, by + bh);
  grd.addColorStop(0, 'rgba(47,107,58,.95)');
  grd.addColorStop(1, 'rgba(22,48,30,.95)');
  g.fillStyle = grd;
  roundRect(g, bx, by, bw, bh, 15); g.fill();
  g.strokeStyle = 'rgba(160,232,150,.85)'; g.lineWidth = 2; g.stroke();
  /* 两侧星芒装饰（一条路径一起描边） */
  g.beginPath();
  for(const side of [-1, 1]){
    const sx = W / 2 + side * (bw / 2 - 34);
    g.moveTo(sx - 8, by + bh / 2); g.lineTo(sx + 8, by + bh / 2);
    g.moveTo(sx, by + bh / 2 - 9); g.lineTo(sx, by + bh / 2 + 9);
  }
  g.lineWidth = 2.4;
  g.strokeStyle = 'rgba(255,243,176,.9)';
  g.stroke();
  /* 文案 */
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = 'bold 25px system-ui,-apple-system,"PingFang SC",sans-serif';
  g.fillStyle = '#eaffea';
  g.fillText(b.title, W / 2, by + 37);
  g.font = '14px system-ui,-apple-system,"PingFang SC",sans-serif';
  g.fillStyle = 'rgba(190,240,190,.92)';
  g.fillText(b.sub, W / 2, by + 63);
  g.restore();
  g.globalAlpha = 1;
}
function drawEffects(g){
  if(!state.effectsEnabled) return;
  for(const f of fxFlashes) fxDrawFlash(g, f);
  for(const c of fxCoins) fxDrawCoin(g, c);
  for(const p of fxParts) fxDrawPart(g, p);
  if(fxBig) fxDrawBig(g, fxBig);
  if(fxBanner) fxDrawBanner(g, fxBanner);
  g.globalAlpha = 1;
}
