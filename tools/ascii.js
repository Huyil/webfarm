#!/usr/bin/env node
/* 把渲染结果转成 ASCII 图，方便在没有图像输入能力时"看"画面。
 *   node tools/ascii.js <png> [--cx=640] [--cy=400] [--w=260] [--h=140] [--step=2] [--mode=lum|hue]
 * mode=lum  亮度字符： .:-=+*#%@
 * mode=hue  色相分类：B=褐/土 G=绿 Y=黄灰 K=暗 W=亮灰 R=红蓝等
 */
'use strict';
const fs = require('fs');
const path = require('path');

function req(name){
  const cands = [name, path.join('/home/loli/deepseek-harness/node_modules', name)];
  const pnpm = '/home/loli/deepseek-harness/node_modules/.pnpm';
  try { const flat = name.replace('/', '+'); for (const d of fs.readdirSync(pnpm)) if (d.startsWith(flat + '@')) cands.push(path.join(pnpm, d, 'node_modules', name)); } catch(e){}
  for (const t of cands) { try { return require(t); } catch(e){} }
  console.error('✗ 缺少依赖 ' + name); process.exit(2);
}
const napi = req('@napi-rs/canvas');

const argv = process.argv.slice(2);
const FILE = argv.find(a => !a.startsWith('--'));
const opt = (k, d) => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const MODE = opt('mode', 'hue');
const STEP = parseInt(opt('step', '2'), 10);

(async () => {
  const img = await napi.loadImage(fs.readFileSync(FILE));
  const c = napi.createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, img.width, img.height).data;
  const CX = parseInt(opt('cx', String(Math.floor(img.width / 2))), 10);
  const CY = parseInt(opt('cy', String(Math.floor(img.height / 2))), 10);
  const HW = parseInt(opt('w', '260'), 10) >> 1;
  const HH = parseInt(opt('h', '140'), 10) >> 1;

  const LUM = ' .:-=+*#%@';
  const lines = [];
  for (let y = CY - HH; y <= CY + HH; y += STEP) {
    let row = '';
    for (let x = CX - HW; x <= CX + HW; x += STEP) {
      let r = 0, gg = 0, b = 0, n = 0;
      for (let dy = 0; dy < STEP; dy++) for (let dx = 0; dx < STEP; dx++) {
        const px = x + dx, py = y + dy;
        if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
        const i = (py * img.width + px) * 4;
        r += data[i]; gg += data[i + 1]; b += data[i + 2]; n++;
      }
      if (!n) { row += ' '; continue; }
      r /= n; gg /= n; b /= n;
      const L = 0.299 * r + 0.587 * gg + 0.114 * b;
      if (MODE === 'lum') {
        row += LUM[Math.max(0, Math.min(9, Math.round(L / 255 * 9)))];
      } else {
        /* 色相分类：先按亮度分暗/亮，再按通道关系分褐/绿/黄/蓝 */
        if (L < 46) row += 'K';
        else if (L > 205) row += 'W';
        else if (gg > r + 10 && gg > b + 18) row += 'G';
        else if (r > gg + 22 && gg > b + 14) row += 'B';
        else if (r > 150 && gg > 140 && b < 150) row += 'Y';
        else if (b > r + 12 && b > gg + 6) row += 'C';
        else row += '.';
      }
    }
    lines.push(row);
  }
  console.log(`# ${path.basename(FILE)} ${MODE} 中心(${CX},${CY}) 窗口 ${HW*2}×${HH*2} step=${STEP}`);
  console.log(lines.join('\n'));
})();
