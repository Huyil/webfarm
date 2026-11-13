/* ============ 工具链配置（路径宏） ============
 *
 * 源码里不允许再出现本机用户目录、Windows 盘符这类机器路径。
 * 所有"这台机器上在哪"的信息集中在 farm.config.json，用 ${VAR} 宏引用环境变量：
 *
 *   ${PROJECT_ROOT}        本仓库根目录
 *   ${HOME}                当前用户主目录
 *   ${DSH_CHECKOUT}        DeepSeek Harness 检出目录（自动探测，也可显式设置）
 *   ${VAR}                 任意环境变量
 *   ${VAR:-默认值}         环境变量为空时用默认值
 *
 * 依赖查找顺序：本地 node_modules → 配置里的 extraModulePaths → DSH 检出目录 →
 * NODE_PATH → pnpm store（自动扫描），所以换一台机器通常不用改任何东西。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'farm.config.json');
const HOME = os.homedir();
const ENV = Object.assign({}, process.env, { PROJECT_ROOT: ROOT, HOME, USERPROFILE: process.env.USERPROFILE || HOME });

function expandMacros(value, ctx, depth){
  depth = depth || 0;
  if(depth > 6 || typeof value !== 'string') return value;
  let changed = false;
  const out = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^${}]*))?\}/g, (_, name, dflt) => {
    changed = true;
    const v = ctx[name];
    if(v != null && v !== '') return v;
    return dflt != null ? dflt : '';
  });
  return changed ? expandMacros(out, ctx, depth + 1) : out;
}
function expandDeep(v, ctx){
  if(typeof v === 'string') return expandMacros(v, ctx);
  if(Array.isArray(v)) return v.map(x => expandDeep(x, ctx));
  if(v && typeof v === 'object'){
    const o = {};
    for(const k in v) o[k] = expandDeep(v[k], ctx);
    return o;
  }
  return v;
}
function existsDir(p){
  try{ return !!p && fs.statSync(p).isDirectory(); }catch(e){ return false; }
}
/* 自动找 DSH 检出目录：环境变量 → 主目录 → 仓库的兄弟目录/祖先的兄弟目录。
 * 不写死任何用户名或盘符。 */
function detectDshCheckout(){
  const seeds = [];
  if(process.env.DSH_CHECKOUT) seeds.push(process.env.DSH_CHECKOUT);
  seeds.push(path.join(HOME, 'deepseek-harness'));
  let dir = ROOT;
  for(let i = 0; i < 5; i++){
    const parent = path.dirname(dir);
    seeds.push(path.join(parent, 'deepseek-harness'));
    seeds.push(path.join(parent, 'dsh'));
    dir = parent;
  }
  for(const s of seeds){
    if(existsDir(s)) return s;
  }
  return '';
}
let CONFIG = null;
let CONFIG_CTX = null;
function loadConfig(force){
  if(CONFIG && !force) return CONFIG;
  let raw = {};
  try{ raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch(e){ if(fs.existsSync(CONFIG_FILE)) console.warn('⚠ farm.config.json 解析失败，改用默认值: ' + e.message); raw = {}; }
  if(raw.$schema) delete raw.$schema;
  /* 第一遍：DSH_CHECKOUT 可能还没定，先允许它为空 */
  const ctx = Object.assign({}, ENV, { DSH_CHECKOUT: process.env.DSH_CHECKOUT || '' });
  let cfg = expandDeep(raw, ctx);
  const dsh = cfg.dshCheckout || detectDshCheckout();
  if(dsh) ctx.DSH_CHECKOUT = dsh;
  cfg = expandDeep(raw, ctx);
  cfg.dshCheckout = dsh || '';
  CONFIG_CTX = ctx;
  CONFIG = cfg;
  return CONFIG;
}
function moduleSearchPaths(){
  const cfg = loadConfig();
  const paths = [];
  if(Array.isArray(cfg.extraModulePaths)) paths.push(...cfg.extraModulePaths);
  if(cfg.dshCheckout) paths.push(path.join(cfg.dshCheckout, 'node_modules'));
  paths.push(path.join(ROOT, 'node_modules'));
  if(process.env.NODE_PATH) paths.push(...process.env.NODE_PATH.split(path.delimiter));
  return paths.filter(Boolean);
}
function pnpmDir(){
  const cfg = loadConfig();
  /* 只返回真实存在的目录：DSH 没装时 ${DSH_CHECKOUT} 会展开成空串，
   * 拼出来的 "/node_modules/.pnpm" 会让错误提示里出现一堆无意义的路径。 */
  if(cfg.pnpmDir && existsDir(cfg.pnpmDir)) return cfg.pnpmDir;
  if(cfg.dshCheckout){
    const p = path.join(cfg.dshCheckout, 'node_modules', '.pnpm');
    if(existsDir(p)) return p;
  }
  return '';
}
const depCache = new Map();
function requireDep(name, opts){
  if(depCache.has(name)) return depCache.get(name);
  const tried = [];
  /* 1. 本地/常规 require 解析 */
  try { const m = require(name); depCache.set(name, m); return m; } catch(e){ tried.push(name); }
  /* 2. 配置的搜索路径（JS 包与 @scope/pkg 都直接拼） */
  for(const base of moduleSearchPaths()){
    const p = path.join(base, name);
    try { const m = require(p); depCache.set(name, m); return m; } catch(e){ tried.push(p); }
  }
  /* 3. pnpm store：node_modules/.pnpm/<flat>@<ver>/node_modules/<pkg> */
  const pn = pnpmDir();
  if(pn){
    const flat = name.replace('/', '+');
    try{
      const dirs = fs.readdirSync(pn);
      for(const d of dirs){
        if(!d.startsWith(flat + '@')) continue;
        const p = path.join(pn, d, 'node_modules', name);
        try { const m = require(p); depCache.set(name, m); return m; } catch(e){ tried.push(p); }
      }
    }catch(e){}
  }
  const hint = opts && opts.hint ? '\n  ' + opts.hint : '';
  throw new Error('缺少依赖 ' + name + '\n  试过:\n    ' + tried.slice(0, 12).join('\n    ') +
    '\n  解决：在 farm.config.json 的 extraModulePaths / pnpmDir 里配置，或设置 DSH_CHECKOUT。' + hint);
}
function findEsbuild(){
  const cfg = loadConfig();
  const cands = [];
  if(process.env.ESBUILD_BIN) cands.push(process.env.ESBUILD_BIN);
  if(cfg.esbuild) cands.push(cfg.esbuild);
  cands.push(path.join(ROOT, 'node_modules', '.bin', 'esbuild'));
  for(const base of moduleSearchPaths()) cands.push(path.join(base, '.bin', 'esbuild'));
  /* pnpm store 里的 @esbuild/<platform> 二进制 */
  const pn = pnpmDir();
  if(pn){
    try{
      for(const d of fs.readdirSync(pn)){
        if(/^@esbuild\+/.test(d)){
          cands.push(path.join(pn, d, 'node_modules', '@esbuild', d.split('+')[1].replace(/@.*$/, ''), 'bin', 'esbuild'));
        }
      }
    }catch(e){}
  }
  cands.push('esbuild');
  const { spawnSync } = require('child_process');
  for(const bin of cands){
    if(!bin) continue;
    try{
      const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 15000 });
      if(r.status === 0) return bin;
    }catch(e){}
  }
  return null;
}
module.exports = {
  ROOT, HOME, CONFIG_FILE,
  loadConfig, expandMacros, moduleSearchPaths, pnpmDir,
  requireDep, findEsbuild, detectDshCheckout,
};
/* CLI：node tools/config.js [key]
 *   无参数 → 打印展开后的配置（排查路径用）
 *   有参数 → 只打印该键（给 deploy/*.sh 取 deployKey） */
if(require.main === module){
  try{
    const cfg = loadConfig();
    const k = process.argv[2];
    if(k){
      const v = cfg[k];
      process.stdout.write(v == null ? '' : (typeof v === 'string' ? v : JSON.stringify(v)));
    } else {
      process.stdout.write(JSON.stringify(cfg, null, 2) + '\n');
    }
  }catch(e){ process.stderr.write(String(e && e.message || e) + '\n'); process.exit(1); }
}
