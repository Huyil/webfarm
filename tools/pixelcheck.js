#!/usr/bin/env node
/* 画面像素校验（当前模型看不了图，用统计量代替肉眼）：
 *   1) 画面不是空白（颜色数 / 亮度分布）
 *   2) 有草地绿、耕地褐、成熟金黄三种主色
 *   3) 夜晚明显比白天暗；雨天与晴天像素分布显著不同
 *   4) 特效（彩带 / 爆闪）确实改变了画面
 * 用法：node tools/pixelcheck.js [html]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const FILE = process.argv[2] || path.join(__dirname, '..', 'farm.html');

function req(name) {
  const cands = [name, path.join('/home/loli/deepseek-harness/node_modules', name)];
  const pnpm = '/home/loli/deepseek-harness/node_modules/.pnpm';
  try {
    const flat = name.replace('/', '+');
    for (const d of fs.readdirSync(pnpm)) if (d.startsWith(flat + '@')) cands.push(path.join(pnpm, d, 'node_modules', name));
  } catch (e) {}
  for (const t of cands) { try { return require(t); } catch (e) {} }
  console.error('✗ 缺少依赖 ' + name); process.exit(2);
}
const napi = req('@napi-rs/canvas');

let pass = 0, fail = 0;
const fails = [];
const section = t => console.log('  \x1b[2m── ' + t + '\x1b[0m');
const ok = (c, label, extra) => {
  if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + label); }
  else { fail++; fails.push(label + (extra ? ' → ' + extra : '')); console.log('  \x1b[31m✗\x1b[0m ' + label + (extra ? '  \x1b[2m' + extra + '\x1b[0m' : '')); }
};

const tmp = f => path.join(os.tmpdir(), f);
function shot(name, extra) {
  const out = tmp('px-' + name + '.png');
  const args = [path.join(__dirname, 'render.js'), FILE, out, '--frames=14', ...extra];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (r.status !== 0) { console.error('渲染失败 ' + name + '\n' + (r.stdout || '') + (r.stderr || '')); process.exit(1); }
  return out;
}
async function stats(file) {
  const img = await napi.loadImage(fs.readFileSync(file));
  const c = napi.createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  let lum = 0, n = 0, green = 0, brown = 0, gold = 0;
  const colors = new Set();
  const step = 4 * 3;                        // 每 3 像素采样一次
  for (let i = 0; i < d.length; i += step) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    const L = 0.299 * r + 0.587 * gg + 0.114 * b;
    lum += L; n++;
    if (n % 7 === 0) colors.add((r >> 3) + ',' + (gg >> 3) + ',' + (b >> 3));
    if (gg > r + 18 && gg > b + 30) green++;
    if (r > gg + 12 && gg > b + 8 && r > 70) brown++;
    if (r > 190 && gg > 150 && b < 150) gold++;
  }
  return { w: img.width, h: img.height, lum: lum / n, colors: colors.size, green, brown, gold, bytes: d };
}
function diff(a, b) {
  const n = Math.min(a.bytes.length, b.bytes.length);
  let acc = 0, cnt = 0;
  for (let i = 0; i < n; i += 12) { acc += Math.abs(a.bytes[i] - b.bytes[i]); cnt++; }
  return acc / cnt;
}

/* 瓦片内部明暗检测：旧的「逐格白→黑对角渐变 + 黑色描边」会让每块瓦片的左上明显亮于右下，
   整片地面看起来就是规则的白/黑折线叠加层。修好后同一块瓦片内两侧亮度应当接近。 */
function patchLum(st, cx, cy, r) {
  let sum = 0, n = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const i = (y * st.w + x) * 4;
      if (i < 0 || i + 3 >= st.bytes.length) continue;
      sum += 0.299 * st.bytes[i] + 0.587 * st.bytes[i + 1] + 0.114 * st.bytes[i + 2];
      n++;
    }
  }
  return n ? sum / n : 0;
}

console.log(`\n\x1b[1m像素校验\x1b[0m ${path.basename(FILE)}`);
(async () => {
const day = await stats(shot('day', ['--hour=11', '--weather=clear']));
const night = await stats(shot('night', ['--hour=23', '--weather=clear']));
const rain = await stats(shot('rain', ['--hour=13', '--weather=rain']));
const fx = await stats(shot('fx', ['--hour=13', '--weather=clear',
  '--setup=D.api.fx.fxCelebrate("测试成就","画面特效校验"); D.api.fx.fxFlash(640,400,"#fff3b0",220); D.api.fx.fxCoinBurst(600,400,40);']));
/* 扩建模式（岛=耕地，长条+价格）+ 悬停高亮 + 框选范围 都要真的画出来 */
const ui = await stats(shot('ui', ['--hour=13', '--weather=clear',
  '--setup=D.state.coins=99999; for(let i=0;i<7;i++) D.api.doExpand("xn"); D.api.doExpand("xp"); D.api.doExpand("yp"); D.api.toggleExpandMode(true); D.api.setHover(1,1); D.state.expandPreview="yn"; D.state.box={x0:-1,y0:0,x1:1,y1:2};']));

/* 各缩放档位：地块不能被裁剪掉（曾经放大后边缘地块被误裁，画面只剩天空） */
const zoomShot = async (z) => stats(shot('z' + z, ['--hour=13', '--weather=clear',
  `--setup=D.api.toggleExpandMode(false); D.state.cameraAuto=true; D.api.centerOnFarm(); D.api.setZoom(${z});`]));

/* 纯净地面（全部未开垦、无作物）：用来验瓦片内部不应有明暗折线叠加层 */
const flat = await stats(shot('flat', ['--hour=13', '--weather=clear',
  '--setup=D.api.toggleExpandMode(false); D.state.tiles.forEach(t=>{ t.state="wild"; t.terrain="grass"; t.crop=null; t.growth=0; t.watered=false; t.fertile=false; t.stone=false; });']));
/* 镜头对着农场中心，中心格正好在画布正中 (512,384)：取它左上 / 右下各一小块比亮度 */
const cxm = Math.floor(flat.w / 2), cym = Math.floor(flat.h / 2);
/* 渐变沿瓦片对角轴走：取同一 y 上的左顶点侧 / 右顶点侧两块才测得出 */
const lumTL = patchLum(flat, cxm - 17, cym, 3);
const lumBR = patchLum(flat, cxm + 17, cym, 3);
const tileShade = Math.abs(lumTL - lumBR);

console.log('  \x1b[2m白天 亮度=' + day.lum.toFixed(1) + ' 颜色数=' + day.colors +
  ' | 夜晚 亮度=' + night.lum.toFixed(1) +
  ' | 雨天 亮度=' + rain.lum.toFixed(1) +
  ' | 特效帧 亮度=' + fx.lum.toFixed(1) +
  ' | 交互帧 亮度=' + ui.lum.toFixed(1) + '\x1b[0m');

ok(day.w > 200 && day.h > 200, '渲染尺寸正常', `${day.w}×${day.h}`);
ok(day.colors > 120, '画面不是空白（颜色数 > 120）', '颜色数 ' + day.colors);
ok(day.green > 500, '存在草地绿像素', 'green=' + day.green);
ok(day.brown > 300, '存在耕地褐像素', 'brown=' + day.brown);
ok(day.gold > 60, '存在成熟作物金黄像素', 'gold=' + day.gold);
ok(night.lum < day.lum - 6, '夜晚明显比白天暗', `day=${day.lum.toFixed(1)} night=${night.lum.toFixed(1)}`);
ok(diff(day, rain) > 2.5, '雨天画面与晴天显著不同', 'diff=' + diff(day, rain).toFixed(2));
ok(diff(day, fx) > 1.5, '全屏特效改变了画面', 'diff=' + diff(day, fx).toFixed(2));
ok(diff(day, ui) > 1.0, '扩建幽灵/悬停高亮/框选都能画出来', 'diff=' + diff(day, ui).toFixed(2));
for (const z of [2, 5, 10]) {
  const zs = await zoomShot(z);
  ok(zs.green > 400 && zs.brown > 150, `${z}x 缩放下地块没有被裁剪掉（画面里仍有耕地与草地）`,
    `green=${zs.green} brown=${zs.brown} 颜色数=${zs.colors}`);
}
ok(ui.colors >= day.colors * 0.8, '扩建出石头地面后画面依然丰富', `base=${day.colors} ui=${ui.colors}`);
/* 上面这个 ΔL 只能反映「整体明暗」，抓不住 1px 描边与 ±6 亮度的渐变，所以真正的回归保护放在下面：
   直接检查产物里还有没有「逐格明暗渐变」的签名（这才是白/黑折线叠加层的来源）。 */

section('源码级回归：瓦片不应再有逐格明暗叠加层');
{
  const src = fs.readFileSync(FILE, 'utf8').replace(/\s+/g, '');
  ok(!src.includes("addColorStop(1,'rgba(0,0,0,.12)')"),
    '瓦片绘制里没有「白→透明→黑」的逐格对角渐变（白/黑折线叠加层的来源）');
  ok(!src.includes("strokeStyle='rgba(0,0,0,.15)';ctx.lineWidth=1;ctx.stroke()"),
    '瓦片顶面没有再描一圈黑边');
  /* 批量 ellipse() 不 moveTo 会让每个椭圆与上一个连成直线，填充后就是跨格的大三角色块 */
  /* 压缩产物里局部标识符被重命名，按标识符文本的守卫必然失效 —— 这两项只在未压缩产物上跑，
     语义层面由 smoke.js（两个产物都跑 458 项断言）覆盖。 */
  const MINIFIED = /\.min\.html$/i.test(FILE);
  if (MINIFIED) {
    console.log('  \x1b[2m·\x1b[0m 压缩产物：跳过 2 项「按标识符文本」的源码守卫（语义由 smoke 覆盖）');
  } else {
    ok(src.includes('shAddEllipse'), '地面细节用安全助手画批量椭圆（逐个 moveTo 起点）');
  }
  ok(!src.includes('g.ellipse(shSX,shSY,hw*0.66'),
    '湿土反光通道没有「不 moveTo 的批量 ellipse」');
  ok(!src.includes('g.ellipse(shSX+u*hw,shSY+v*hh,5+r1*5'),
    '苔藓通道没有「不 moveTo 的批量 ellipse」');
  ok(!src.includes('g.ellipse(shSX+u*hw,shSY+v*hh,1.6+r1*1.6'),
    '碎石通道没有「不 moveTo 的批量 ellipse」');
  /* 曾经给纹理做过「屏幕恒定尺寸」的反向补偿，导致放大后瓦片巨大而小草只有 1px —— 禁止再加回来 */
  ok(!src.includes('1/Math.max(0.25,viewZoom())'),
    '纹理没有做「反缩放」补偿（放大时纹理要跟着世界一起放大）');
  if (!MINIFIED) {
    ok(src.includes('ZOOM_AUTO_MAX'),
      '自动倍率有上限（避免小农场被放大到几倍而显得糊）');
  }
  /* 位图 pattern 被缩放时会重采样：既模糊、缩放过程中还会抖 → 地面纹理必须用矢量 */
  ok(!src.includes('createPattern('),
    '地面纹理没有用位图 pattern（缩放会模糊+抖动），改用矢量颗粒');
}

console.log(`\n  ${fail === 0 ? '\x1b[32m像素校验通过\x1b[0m' : '\x1b[31m失败 ' + fail + ' 项\x1b[0m'}  (${pass} 项)`);
if (fails.length) fails.forEach(f => console.log('  - ' + f));
process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('像素校验崩溃', e); process.exit(1); });
