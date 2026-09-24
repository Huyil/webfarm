/* ============ 音效 ============ */
const SFX = {
  ctx: null, enabled: true,
  init(){
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){}
  },
  resume(){
    if(this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, type, vol, slideTo){
    if(!this.enabled || !this.ctx) return;
    this.resume();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if(slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.start(t); osc.stop(t + dur);
  },
  play(type){
    if(!this.enabled) return;
    switch(type){
      case 'till':   this.tone(220, 0.08, 'square', 0.08, 180); break;
      case 'plant':  this.tone(520, 0.10, 'sine', 0.12, 660); break;
      case 'water':  this.tone(880, 0.15, 'sine', 0.10, 400); break;
      case 'fert':   this.tone(400, 0.12, 'triangle', 0.10, 600); break;
      case 'premium':
        [784, 988, 1318, 1568].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'triangle', 0.10), i * 55));
        break;
      case 'mill':
        this.tone(150, 0.18, 'sawtooth', 0.05, 110);
        setTimeout(() => this.tone(140, 0.18, 'sawtooth', 0.05, 100), 200);
        break;
      case 'chop':
        this.tone(300, 0.05, 'square', 0.09, 180);
        setTimeout(() => this.tone(260, 0.05, 'square', 0.07, 150), 90);
        break;
      case 'cook':
        this.tone(500, 0.20, 'triangle', 0.07, 700);
        setTimeout(() => this.tone(620, 0.22, 'triangle', 0.06, 840), 180);
        break;
      case 'ding':
        this.tone(1320, 0.10, 'sine', 0.10);
        setTimeout(() => this.tone(1760, 0.18, 'sine', 0.09), 70);
        break;
      case 'burn':
        this.tone(320, 0.22, 'sawtooth', 0.09, 90);
        break;
      case 'harvest':
        this.tone(660, 0.08, 'sine', 0.14);
        setTimeout(()=>this.tone(880, 0.12, 'sine', 0.12), 60);
        break;
      case 'coin':
        this.tone(1200, 0.06, 'square', 0.08);
        setTimeout(()=>this.tone(1600, 0.08, 'square', 0.07), 50);
        break;
      case 'buy':    this.tone(700, 0.08, 'square', 0.10); break;
      case 'error':  this.tone(200, 0.12, 'sawtooth', 0.10); break;
      case 'click':  this.tone(600, 0.03, 'sine', 0.06); break;
      case 'achieve':
        [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.4, 'sine', 0.12), i * 80));
        break;
    }
  }
};

