/* ============ 粒子 ============ */
const particles = [];
const PARTICLE_CFG = {
  water:    { count: 8,  color:'#5bc8ff', spread: 2,   gravity: 0.15,  life: 0.7, size:[2,4] },
  harvest:  { count: 14, color:'#ffd76e', spread: 2.5, gravity: 0.1,   life: 0.9, size:[2,5] },
  coin:     { count: 6,  color:'#ffd76e', spread: 1.5, gravity:-0.05,  life: 1.0, size:[2,3] },
  till:     { count: 6,  color:'#8a6248', spread: 2,   gravity: 0.2,   life: 0.6, size:[2,3] },
  sparkle:  { count: 16, color:'#fff3b0', spread: 3.2, gravity:-0.04,  life: 1.1, size:[2,5] },
  steam:    { count: 8,  color:'#e9e9ef', spread: 1.2, gravity:-0.08,  life: 1.0, size:[3,6] },
  flour:    { count: 10, color:'#f3ead6', spread: 2.0, gravity: 0.08,  life: 0.9, size:[2,4] },
  burnt:    { count: 10, color:'#5a4a42', spread: 1.8, gravity:-0.02,  life: 1.1, size:[2,6] },
  splash:   { count: 10, color:'#9fdcff', spread: 3.0, gravity: 0.25,  life: 0.8, size:[2,4] },
  confetti: { count: 26, color:'#ff8fb1', spread: 5.0, gravity: 0.06,  life: 1.6, size:[2,5] },
};
const CONFETTI_COLORS = ['#ff8fb1','#ffd76e','#8fe3a1','#7fb6e8','#c79bff','#ffb066'];

function spawnParticles(x, y, type, count){
  if(!state.particlesEnabled) return;
  const cfg = PARTICLE_CFG[type];
  if(!cfg) return;
  const n = count || cfg.count;
  for(let i = 0; i < n; i++){
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * cfg.spread,
      vy: -Math.random() * cfg.spread - 1,
      gravity: cfg.gravity,
      life: cfg.life, maxLife: cfg.life,
      color: type === 'confetti' ? CONFETTI_COLORS[i % CONFETTI_COLORS.length] : cfg.color,
      size: cfg.size[0] + Math.random() * (cfg.size[1] - cfg.size[0]),
      spin: (Math.random() - 0.5) * 0.3,
      rot: Math.random() * Math.PI,
    });
  }
}
function updateParticles(dt){
  for(let i = particles.length - 1; i >= 0; i--){
    const p = particles[i];
    p.life -= dt / 1000;
    if(p.life <= 0){ particles.splice(i, 1); continue; }
    p.x += p.vx * (dt / 16);
    p.y += p.vy * (dt / 16);
    p.vy += p.gravity;
    p.rot += p.spin * (dt / 16);
  }
}
function drawParticles(){
  if(!state.particlesEnabled) return;
  for(const p of particles){
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    if(p.spin){
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillRect(-p.size * alpha / 2, -p.size * alpha / 2, p.size * alpha, p.size * alpha * 0.6);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
