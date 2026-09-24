#!/usr/bin/env node
/* 小田园 · 构建脚本
 *   node build.js                 构建 farm.html（普通拼接）+ farm.min.html（压缩）
 *   node build.js --only=normal   只出普通版
 *   node build.js --only=min      只出压缩版
 *   node build.js --smoke         构建后跑无头冒烟测试
 *   node build.js --fallback      强制使用内置压缩器（测试无 esbuild 的环境）
 *   node build.js --no-check      跳过 node --check 语法校验
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'build.manifest.json'), 'utf8'));

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const arg = (k, d) => { const a = argv.find(x => x.startsWith(k + '=')); return a ? a.slice(k.length + 1) : d; };
const ONLY = arg('--only', 'both');
const DO_CHECK = !has('--no-check');
const FORCE_FALLBACK = has('--fallback');

const c = { red: s => `\x1b[31m${s}\x1b[0m`, grn: s => `\x1b[32m${s}\x1b[0m`, yel: s => `\x1b[33m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m` };
const kb = n => (n / 1024).toFixed(1) + ' KB';

/* ============================================================
 * 1. 校验清单
 * ============================================================ */
const missing = [];
for (const f of MANIFEST.css) if (!fs.existsSync(path.join(SRC, 'css', f))) missing.push('src/css/' + f);
for (const f of MANIFEST.js) if (!fs.existsSync(path.join(SRC, 'js', f))) missing.push('src/js/' + f);
if (missing.length) {
  console.error(c.red('✗ 清单里的文件不存在：\n  ' + missing.join('\n  ')));
  process.exit(1);
}
const listed = new Set([...MANIFEST.css.map(f => 'css/' + f), ...MANIFEST.js.map(f => 'js/' + f)]);
const orphans = [];
for (const dir of ['css', 'js']) {
  for (const f of fs.readdirSync(path.join(SRC, dir))) {
    if (!listed.has(dir + '/' + f)) orphans.push(`src/${dir}/${f}`);
  }
}
const read = (dir, f) => fs.readFileSync(path.join(SRC, dir, f), 'utf8');

/* ============================================================
 * 2. 压缩器
 * ============================================================ */
function findEsbuild() {
  if (FORCE_FALLBACK) return null;
  const cands = [];
  if (process.env.ESBUILD_BIN) cands.push(process.env.ESBUILD_BIN);
  const pnpm = '/home/loli/deepseek-harness/node_modules/.pnpm';
  try {
    for (const d of fs.readdirSync(pnpm)) {
      if (/^@esbuild\+linux-x64@/.test(d)) cands.push(path.join(pnpm, d, 'node_modules/@esbuild/linux-x64/bin/esbuild'));
    }
  } catch (e) {}
  cands.push('esbuild');
  for (const bin of cands) {
    try {
      const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15000 });
      if (r.status === 0) return bin;
    } catch (e) {}
  }
  return null;
}
const ESBUILD = findEsbuild();

function esbuildMinify(code, loader, bin) {
  const r = spawnSync(bin, ['--minify', `--loader=${loader}`, '--charset=utf8'], {
    input: code, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error('esbuild 压缩失败: ' + (r.stderr || r.error));
  return r.stdout;
}

/* --- 兜底 JS 压缩：状态机扫描（字符串/模板/正则/注释），只做安全变换 --- */
const MERGE = new Set(['+', '-', '<', '>', '=', '&', '|', '*', '/', '?', '!', '.']);
const isIdChar = ch => /[A-Za-z0-9_$]/.test(ch);
const KEYWORD_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'do', 'else', 'yield', 'await', 'case', 'throw']);
const REGEX_PREV_CHAR = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '^', '~', '<', '>']);

function fallbackMinifyJS(src) {
  let out = '';
  let i = 0;
  let prev = '';        // 上一个有意义的字符（仅代码）
  let word = '';        // 上一个标识符
  const n = src.length;

  // 判断待输出的空白是否必须保留
  function sep(a, b) {
    if (a === '' || b === '') return '';
    if (isIdChar(a) && isIdChar(b)) return ' ';
    if (a === '/' && (b === '/' || b === '*')) return ' ';
    if (a === '`' && b === '`') return ' ';
    if (/[0-9]/.test(a) && b === '.') return ' ';
    if (MERGE.has(a) && MERGE.has(b)) return ' ';
    if (/[0-9]/.test(b) && a === '.') return ' ';
    return '';
  }
  function emit(text, isCode) {
    if (isCode) {
      for (let k = 0; k < text.length; k++) {
        const ch = text[k];
        if (isIdChar(ch)) word += ch; else word = '';
        if (!/\s/.test(ch)) prev = ch;
      }
    }
    out += text;
  }
  let pending = '';
  while (i < n) {
    const ch = src[i], nx = src[i + 1];
    // 注释
    if (ch === '/' && nx === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      const hadNl = end !== -1;
      i = stop + (hadNl ? 1 : 0);
      if (hadNl) pending = pending.includes('\n') ? pending : pending + '\n';
      continue;
    }
    if (ch === '/' && nx === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      const span = src.slice(i, stop);
      i = stop;
      if (span.includes('\n')) pending = '\n';
      continue;
    }
    // 字符串
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n) { if (src[j] === '\\') j += 2; else if (src[j] === ch) { j++; break; } else j++; }
      const lit = src.slice(i, j);
      if (pending) { out += sep(prev, lit[0]); pending = ''; }
      emit(lit, true);
      i = j;
      continue;
    }
    // 模板字符串（整体原样保留，内部 ${} 递归查找嵌套反引号）
    if (ch === '`') {
      let j = i + 1, depth = 0;
      while (j < n) {
        const cj = src[j];
        if (cj === '\\') { j += 2; continue; }
        if (depth === 0 && cj === '`') { j++; break; }
        if (cj === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
        if (depth > 0 && cj === '}') { depth--; j++; continue; }
        if (depth > 0 && cj === '`') { // ${} 里的嵌套模板，跳到它结束
          let k = j + 1;
          while (k < n) { if (src[k] === '\\') k += 2; else if (src[k] === '`') { k++; break; } else k++; }
          j = k; continue;
        }
        j++;
      }
      const lit = src.slice(i, j);
      if (pending) { out += sep(prev, lit[0]); pending = ''; }
      emit(lit, true);
      i = j;
      continue;
    }
    // 正则字面量
    if (ch === '/' && (REGEX_PREV_CHAR.has(prev) || KEYWORD_BEFORE_REGEX.has(word))) {
      let j = i + 1, inClass = false, ok = false;
      while (j < n) {
        const cj = src[j];
        if (cj === '\\') { j += 2; continue; }
        if (cj === '\n') break;
        if (cj === '[') inClass = true;
        else if (cj === ']') inClass = false;
        else if (cj === '/' && !inClass) { ok = true; j++; break; }
        j++;
      }
      if (ok) {
        while (j < n && /[a-z]/.test(src[j])) j++;   // flags
        const lit = src.slice(i, j);
        if (pending) { out += sep(prev, lit[0]); pending = ''; }
        emit(lit, true);
        i = j;
        continue;
      }
    }
    // 空白
    if (/\s/.test(ch)) {
      pending = pending.includes('\n') ? pending : (ch === '\n' ? '\n' : ' ');
      i++;
      continue;
    }
    // 普通代码字符
    if (pending) { out += sep(prev, ch); pending = ''; }
    emit(ch, true);
    i++;
  }
  return out.trim() + '\n';
}

function fallbackMinifyCSS(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};:,>~])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/^\s+|\s+$/g, '') + '\n';
}
function fallbackMinifyHTML(html) {
  return html.split('\n').map(l => l.trim()).filter(Boolean).join('\n') + '\n';
}

function minify(code, loader) {
  if (ESBUILD) return esbuildMinify(code, loader, ESBUILD);
  if (loader === 'js') return fallbackMinifyJS(code);
  if (loader === 'css') return fallbackMinifyCSS(code);
  return fallbackMinifyHTML(code);
}

/* ============================================================
 * 3. 组装
 * ============================================================ */
function banner(f, kind) {
  const width = 74;
  const label = ` ${kind}/${f} `;
  const pad = Math.max(0, width - label.length - 4);
  const left = Math.floor(pad / 2);
  return `/* ${'='.repeat(left)}${label}${'='.repeat(pad - left)} */`;
}

const cssRaw = MANIFEST.css.map(f => banner(f, 'css') + '\n' + read('css', f).replace(/\s+$/, '') + '\n').join('\n');
/* 全部 js 拼进**一个 IIFE**：源码文件本身不再自带括号（否则 src/index.html 直接开
   （45 个 <script> 分开加载）会因为「半个 IIFE」而语法错误）。括号在这里补上。 */
const jsBody = MANIFEST.js.map(f => banner(f, 'js') + '\n' + read('js', f).replace(/\s+$/, '') + '\n').join('\n');
const jsRaw = '(function(){\n' + jsBody + '})();\n';
const tpl = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

const built = new Date();
const info = `v${MANIFEST.version} · ${built.toISOString().replace('T', ' ').slice(0, 16)}`;

/* 顺带生成源码版产物（src/dev-bundle.{css,js}），这样不构建也能直接打开 src/index.html */
function writeDevBundle() {
  try {
    require('./tools/devbundle.js').write();
  } catch (e) {
    console.warn('（源码版产物生成失败：' + e.message + '）');
  }
}

/* src/index.html 同时是「模板」和「可直接打开的 dev 页面」：
   <!--@DEV_*_BEGIN@-->…<!--@DEV_*_END@--> 之间是开发用的外链，构建时整块删掉换成内联。 */
function stripDevBlocks(html) {
  return html
    .replace(/[ \t]*<!--@DEV_CSS_BEGIN@-->[\s\S]*?<!--@DEV_CSS_END@-->[ \t]*\n?/, '')
    .replace(/[ \t]*<!--@DEV_JS_BEGIN@-->[\s\S]*?<!--@DEV_JS_END@-->[ \t]*\n?/, '');
}
function assemble(variant) {
  const min = variant === 'min';
  const css = min ? minify(cssRaw, 'css') : cssRaw;
  const js = min ? minify(jsRaw, 'js') : jsRaw;
  let html = stripDevBlocks(tpl)
    .replace('/*@INJECT_CSS@*/', () => css)
    .replace('/*@INJECT_JS@*/', () => js)
    .replace(/@VERSION@/g, MANIFEST.version)
    .replace(/@BUILD_INFO@/g, `${variant} · ${info}${ESBUILD ? ' · esbuild' : ' · 内置压缩器'}`)
    .replace(/@BUILD@/g, info);
  if (min) html = fallbackMinifyHTML(html);
  return { html, js, css };
}

function checkSyntax(js, name) {
  const tmp = path.join(os.tmpdir(), `farm-check-${process.pid}.js`);
  fs.writeFileSync(tmp, js);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  fs.unlinkSync(tmp);
  if (r.status !== 0) {
    console.error(c.red(`✗ ${name} 语法校验失败：\n`) + (r.stderr || ''));
    process.exit(1);
  }
}

/* ============================================================
 * 4. 执行
 * ============================================================ */
const outputs = [];
const DRY = has('--dry');
const dest = name => DRY ? path.join(os.tmpdir(), `farm-dry-${process.pid}-${name}`) : path.join(ROOT, name);
if (ONLY === 'both' || ONLY === 'normal') {
  const a = assemble('normal');
  if (DO_CHECK) checkSyntax(a.js, 'farm.html');
  fs.writeFileSync(dest('farm.html'), a.html);
  outputs.push([dest('farm.html'), a.html.length, a.html.split('\n').length]);
}
if (ONLY === 'both' || ONLY === 'min') {
  const b = assemble('min');
  if (DO_CHECK) checkSyntax(b.js, 'farm.min.html');
  fs.writeFileSync(dest('farm.min.html'), b.html);
  outputs.push([dest('farm.min.html'), b.html.length, b.html.split('\n').length]);
}

console.log(`${c.grn('✓ 构建完成')}${DRY ? c.yel(' [dry-run]') : ''}  ${c.dim('压缩器: ' + (ESBUILD ? 'esbuild (' + ESBUILD + ')' : '内置兜底压缩器'))}`);
for (const [f, size, lines] of outputs) console.log(`  ${f.padEnd(DRY ? 42 : 14)} ${kb(size).padStart(9)}  ${String(lines).padStart(5)} 行`);
if (outputs.length === 2) {
  const ratio = (outputs[1][1] / outputs[0][1] * 100).toFixed(1);
  console.log(`  ${c.dim('压缩率: ' + ratio + '%')}`);
  writeDevBundle();
}
if (orphans.length) console.log(c.yel('  ⚠ 未纳入清单（会被忽略）: ' + orphans.join(', ')));

if (has('--smoke')) {
  let bad = 0;
  for (const [file] of outputs) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'smoke.js'), file], { stdio: 'inherit' });
    if (r.status !== 0) bad++;
  }
  if (bad) process.exit(1);
}
if (has('--pixel')) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'pixelcheck.js'), outputs[0][0]], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(1);
}
