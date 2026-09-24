#!/usr/bin/env node
/* 装饰总览图：把每种装饰按真实绘制函数画进一张格子图，方便人眼核对（新装饰/小路连接档）。
 *   node tools/decorshot.js [farm.html] [out.png]
 */
'use strict';
const fs = require('fs'), path = require('path');
function req(n){const c=[n,path.join('/home/loli/deepseek-harness/node_modules',n)];const pn='/home/loli/deepseek-harness/node_modules/.pnpm';try{const f=n.replace('/','+');for(const d of fs.readdirSync(pn))if(d.startsWith(f+'@'))c.push(path.join(pn,d,'node_modules',n));}catch(e){}for(const t of c){try{return require(t);}catch(e){}}console.error('缺少 '+n);process.exit(2);}
const { JSDOM, VirtualConsole } = req('jsdom');
const napi = req('@napi-rs/canvas');
const FILE = process.argv[2] || 'farm.html';
const OUT = process.argv[3] || '/tmp/decors.png';
function ctxStub(){const grad={addColorStop(){}};const base={canvas:{width:800,height:600},createLinearGradient:()=>grad,createRadialGradient:()=>grad,createPattern:()=>({}),measureText:()=>({width:10}),getImageData:()=>({data:new Uint8ClampedArray(4)}),getLineDash:()=>[]};
const noop=function(){};return new Proxy(base,{get(t,k){if(k in t)return t[k];if(k==='then'||typeof k==='symbol')return undefined;return noop;},set(t,k,v){t[k]=v;return true;},has(){return true;}});}
const vc = new VirtualConsole(); vc.on('jsdomError', ()=>{});
const dom = new JSDOM(fs.readFileSync(FILE,'utf8'), { runScripts:'dangerously', pretendToBeVisual:true, url:'http://localhost/', virtualConsole:vc, beforeParse(w){ w.HTMLCanvasElement.prototype.getContext = () => ctxStub(); } });
setTimeout(() => {
  const api = dom.window.FarmDebug.api;
  const ids = Object.keys(api.DECOR_META);
  const pathMasks = [15, 10, 5, 0];
  const fenceMasks = [15, 255, 170, 5];
  const cells = ids.map(id => ({ kind:'decor', id }))
    .concat(pathMasks.map(m => ({ kind:'path', mask:m, id:'path#' + m })))
    .concat(fenceMasks.map(m => ({ kind:'fence', mask:m, id:'fence#' + m })));
  const CELL = parseInt(process.env.CELL || '96', 10);
  const COLS = parseInt(process.env.COLS || '6', 10), ROWS = Math.ceil(cells.length / COLS);
  const c = napi.createCanvas(COLS * CELL, ROWS * CELL + 22);
  const g = c.getContext('2d');
  g.fillStyle = '#3d5a34'; g.fillRect(0, 0, c.width, c.height);      /* 草地底 */
  cells.forEach((cell, i) => {
    const cx = (i % COLS) * CELL + CELL / 2, cy = Math.floor(i / COLS) * CELL + CELL / 2;
    g.strokeStyle = 'rgba(255,255,255,.12)';
    g.strokeRect((i % COLS) * CELL + 1, Math.floor(i / COLS) * CELL + 1, CELL - 2, CELL - 2);
    if (cell.kind === 'path') api.drawPath(g, cx, cy, i, cell.mask);
    else if (cell.kind === 'fence') api.drawFence(g, cx, cy, i, cell.mask);
    else api.drawDecoration(g, cx, cy, { type: cell.id, gx: 0, gy: 0, seed: i * 3, hp: api.decorMaxHp(cell.id), ox: 0, oy: 0, wild: false });
    g.fillStyle = '#fff'; g.font = '11px sans-serif'; g.textAlign = 'center';
    g.fillText(cell.id, cx, Math.floor(i / COLS) * CELL + CELL - 3);
  });
  fs.writeFileSync(OUT, c.toBuffer('image/png'));
  console.log('✓ 装饰总览 → ' + OUT + '  (' + COLS + '×' + ROWS + ')');
  process.exit(0);
}, 400);
