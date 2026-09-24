#!/usr/bin/env node
/* 把 drawItemIcon 画成一张图标表，方便人眼/图像核对（食材、菜块、烤菜三档品质） */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
function req(n){const c=[n,path.join('/home/loli/deepseek-harness/node_modules',n)];const p='/home/loli/deepseek-harness/node_modules/.pnpm';try{const f=n.replace('/','+');for(const d of fs.readdirSync(p))if(d.startsWith(f+'@'))c.push(path.join(p,d,'node_modules',n));}catch(e){}for(const t of c){try{return require(t);}catch(e){}}console.error('缺少 '+n);process.exit(2);}
const { JSDOM } = req('jsdom');
const napi = req('@napi-rs/canvas');
const FILE = process.argv[2] || 'farm.html';
const OUT = process.argv[3] || '/tmp/icons.png';

const dom = new JSDOM(fs.readFileSync(FILE,'utf8'), { runScripts:'dangerously', pretendToBeVisual:true, url:'http://localhost/',
  virtualConsole:new (req('jsdom').VirtualConsole)(),
  beforeParse(w){ w.HTMLCanvasElement.prototype.getContext = () => null; },
});
const W = dom.window;
setTimeout(async () => {
  const api = W.FarmDebug && W.FarmDebug.api;
  if(!api){ console.error('没有 FarmDebug'); process.exit(1); }
  /* 作物图标从 CROPS 自动生成，加新作物后不用再改这里 */
  const KEYS = Object.keys(api.CROPS).map(id => 'crop:' + id).concat([
    'piece:carrot','piece:cabbage','piece:corn','prep:flour','dish:bread|normal|flour',
    'dish:roast|perfect|potato','dish:roast|normal|chili','dish:roast|burnt|tomato','dish:roast|perfect|carrot',
  ]);
  const COLS = 8, CELL = 46, ROWS = Math.ceil(KEYS.length / COLS);
  const c = napi.createCanvas(COLS*CELL, ROWS*CELL);
  const g = c.getContext('2d');
  g.fillStyle = '#2a3129'; g.fillRect(0,0,c.width,c.height);
  KEYS.forEach((k,i) => {
    const cx = (i%COLS)*CELL + CELL/2, cy = Math.floor(i/COLS)*CELL + CELL/2;
    g.strokeStyle = 'rgba(255,255,255,.12)';
    g.strokeRect((i%COLS)*CELL+1, Math.floor(i/COLS)*CELL+1, CELL-2, CELL-2);
    try { api.drawItemIcon(g, k, cx, cy, 36); } catch(e){ console.error('draw fail', k, e.message); }
  });
  fs.writeFileSync(OUT, c.toBuffer('image/png'));
  console.log('✓ 图标表 →', OUT, `(${COLS}×${ROWS})`);
  process.exit(0);
}, 300);
