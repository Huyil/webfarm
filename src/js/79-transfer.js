/* ============ 存档迁移 · 第 1 批（纯离线，不依赖任何服务器） ============
 *
 * 三种载体，都不需要后端：
 *   ① `.farm` 文件     —— 大小无上限，走微信「文件传输助手」/ AirDrop / 网盘
 *   ② 存档串           —— 一段文本（FT1:…），微信/短信直接粘贴
 *   ③ 自包含链接       —— https://…/farm/#s=<存档串>
 *                          URL 的 fragment **不会发给服务器**，页面自己读 location.hash，
 *                          所以"发链接就能导入"这件事本身也不需要后端。
 *
 * 信封：{ v, alg, it, salt, iv, ct }
 *   密码（4 位数字）→ PBKDF2(salt, TF_ITER) → AES-GCM 加密明文。
 *   **密码不放进文件**（放进去等于没密码），文件里只有 salt / iv / 密文；明文就是现有
 *   存档格式，所以 unpackState 照样能读、老版本照样自动迁移。
 *
 * 安全边界（写在代码里免得以后忘）：
 *   · 离线载体没有"错 5 次作废"这种东西 —— 拿到文件的人可以离线爆破 1 万种组合。
 *     TF_ITER 拉高到 60 万次就是为了把这件事拖慢；真正的第二道锁是"文件本身在谁手里"。
 *   · 导入的数据一律当**不可信输入**：先 tfSanitize() 白名单体检，再 unpackState()。
 */
const TF_VER = 1;
const TF_ITER = 600000;              /* PBKDF2 迭代次数 */
const TF_TAG = 'FT1:';               /* 老前缀：JSON 信封（v9.21 那一版，还能读） */
const TF_TAG2 = 'FT2:';              /* 新前缀：紧凑二进制信封（同一个档小 ~27%） */
const TF_PIN_LEN = 4;
const TF_MAX_TILES = 20000;          /* 导入体检：地块数上限 */
const TF_MAX_DECOR = 5000;
const TF_COORD_MAX = 100000;
const TF_CAP = { coins: 1e12, fertilizer: 1e6, premium: 1e6, ovenSlots: 6 };
/* PBKDF2 迭代档位：信封里只存下标（2 字节），别把 600000 写进去占地方 */
const TF_ITER_STEPS = [100000, 300000, 600000, 1000000];
const TF_ITER_IDX = 2;               /* 默认 60 万次 */

/* ---------- 基础工具 ---------- */
function tfHasCrypto(){
  return !!(typeof window !== 'undefined' && window.crypto && window.crypto.subtle && window.crypto.getRandomValues);
}
function tfRandomBytes(n){
  const a = new Uint8Array(n);
  window.crypto.getRandomValues(a);
  return a;
}
function tfBytesToB64(buf){
  let s = '';
  const b = new Uint8Array(buf);
  for(let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function tfB64ToBytes(str){
  let s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  while(s.length % 4) s += '=';
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for(let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function tfUtf8(str){ return new TextEncoder().encode(str); }
function tfFromUtf8(buf){ return new TextDecoder().decode(buf); }
/* gzip：能用 CompressionStream 就压（典型档 1~3KB），不能就原样带个 r1: 标记 */
async function tfReadAllStream(readable){
  const reader = readable.getReader();
  const chunks = [];
  let total = 0;
  for(;;){
    const r = await reader.read();
    if(r.done) break;
    if(r.value){ chunks.push(r.value); total += r.value.length; }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for(const c of chunks){ out.set(c, off); off += c.length; }
  return out;
}
/* 用 CompressionStream 压（gzip）；取不到就原样带个 r=1 标记。
 * 注意别用 new Response(...) —— 那玩意 jsdom 没有，会让测试和部分老浏览器悄悄退化成不压缩。 */
async function tfDeflate(text){
  if(typeof CompressionStream === 'function'){
    try{
      const cs = new CompressionStream('gzip');
      const w = cs.writable.getWriter();
      w.write(tfUtf8(text)); w.close();
      return { r:0, b: await tfReadAllStream(cs.readable) };
    }catch(e){}
  }
  return { r:1, b:tfUtf8(text) };
}
async function tfInflate(bytes, raw){
  if(raw) return tfFromUtf8(bytes);
  if(typeof DecompressionStream === 'function'){
    const ds = new DecompressionStream('gzip');
    const w = ds.writable.getWriter();
    w.write(bytes); w.close();
    return tfFromUtf8(await tfReadAllStream(ds.readable));
  }
  throw new Error('这台设备不支持 gzip 解压');
}
async function tfKey(pin, salt, iter){
  const base = await window.crypto.subtle.importKey('raw', tfUtf8('farm:' + pin), 'PBKDF2', false, ['deriveKey']);
  return window.crypto.subtle.deriveKey(
    { name:'PBKDF2', salt, iterations:iter || TF_ITER, hash:'SHA-256' },
    base, { name:'AES-GCM', length:256 }, false, ['encrypt', 'decrypt']);
}

/* ---------- 编码 / 解码 ---------- */
/* 返回 'FT1:<base64url(信封)>' */
async function tfEncodeData(payload, pin){
  if(!tfHasCrypto()) return { ok:false, msg:'这台设备的浏览器不支持加密（无法导出）' };
  if(!/^\d{4}$/.test(String(pin || ''))) return { ok:false, msg:`密码要 ${TF_PIN_LEN} 位数字` };
  const text = JSON.stringify(payload);
  const z = await tfDeflate(text);
  const salt = tfRandomBytes(16), iv = tfRandomBytes(12);
  const key = await tfKey(pin, salt);
  const ct = new Uint8Array(await window.crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, z.b));
  /* 紧凑信封（单次 base64，省掉 JSON + 再 base64 那一圈）：
   *   0x46 0x54 | ver(1) | flags(1: bit0=gzip) | iterIdx(2,大端) | salt(16) | iv(12) | ct(余下) */
  const body = new Uint8Array(2 + 1 + 1 + 2 + 16 + 12 + ct.length);
  body[0] = 0x46; body[1] = 0x54;      /* 'FT' */
  body[2] = TF_VER;
  body[3] = z.r ? 1 : 0;
  body[4] = (TF_ITER_IDX >> 8) & 255; body[5] = TF_ITER_IDX & 255;
  body.set(salt, 6); body.set(iv, 22); body.set(ct, 34);
  return { ok:true, text: TF_TAG2 + tfBytesToB64(body) };
}
/* 解出存档对象（**不做**结构体检；体检交给 tfSanitize） */
/* 认两种信封：FT2（紧凑，新）和 FT1（JSON，v9.21 导出的老串照样能导入） */
function tfParseEnvelope(raw){
  if(raw.indexOf(TF_TAG2) === 0){
    let body;
    try { body = tfB64ToBytes(raw.slice(TF_TAG2.length)); }
    catch(e){ return { err:'存档串损坏了（base64 读不出来）' }; }
    if(body.length < 40 || body[0] !== 0x46 || body[1] !== 0x54) return { err:'存档串损坏了（信封头不对）' };
    const ver = body[2];
    if(ver > TF_VER) return { err:'存档来自更新的版本，请先更新游戏' };
    const idx = (body[4] << 8) | body[5];
    return { env:{ v:ver, r:(body[3] & 1) ? 1 : 0, it:TF_ITER_STEPS[idx] || TF_ITER,
                   salt:body.slice(6, 22), iv:body.slice(22, 34), ct:body.slice(34) } };
  }
  if(raw.indexOf(TF_TAG) === 0){
    let env;
    try { env = JSON.parse(tfFromUtf8(tfB64ToBytes(raw.slice(TF_TAG.length)))); }
    catch(e){ return { err:'存档串损坏了（读不出信封）' }; }
    if(!env || env.v > TF_VER) return { err:'存档来自更新的版本，请先更新游戏' };
    try{
      return { env:{ v:env.v, r:env.r ? 1 : 0, it:env.it || TF_ITER,
                     salt:tfB64ToBytes(env.salt), iv:tfB64ToBytes(env.iv), ct:tfB64ToBytes(env.ct) } };
    }catch(e){ return { err:'存档串损坏了（信封字段不对）' }; }
  }
  return { err:'这不像是本游戏的存档串（应以 ' + TF_TAG2 + ' 开头）' };
}
async function tfDecodeData(text, pin){
  const raw = String(text || '').trim().replace(/\s+/g, '');
  if(!raw) return { ok:false, msg:'没有内容' };
  const p = tfParseEnvelope(raw);
  if(p.err) return { ok:false, msg:p.err };
  const env = p.env;
  if(!/^\d{4}$/.test(String(pin || ''))) return { ok:false, msg:`请输入 ${TF_PIN_LEN} 位数字密码` };
  try {
    const key = await tfKey(pin, env.salt, env.it);
    const buf = await window.crypto.subtle.decrypt({ name:'AES-GCM', iv:env.iv }, key, env.ct);
    const text2 = await tfInflate(new Uint8Array(buf), !!env.r);
    return { ok:true, data: JSON.parse(text2) };
  } catch(e){
    return { ok:false, msg:'密码不对，或者存档串不完整' };
  }
}

/* ---------- 导入体检：把外来存档当不可信输入 ---------- */
function tfIsPlainObject(o){ return !!o && typeof o === 'object' && !Array.isArray(o); }
function tfNum(o, k, cap){
  const v = o[k];
  if(typeof v !== 'number' || !isFinite(v)) return 0;
  let n = Math.floor(v);
  if(n < 0) n = 0;
  if(cap != null && n > cap) n = cap;
  return n;
}
function tfCountMap(o, allowed){
  const out = {};
  if(!tfIsPlainObject(o)) return out;
  for(const k in o){
    if(allowed && allowed.indexOf(k) < 0) continue;
    const v = o[k];
    if(typeof v === 'number' && isFinite(v) && v > 0) out[k] = Math.min(Math.floor(v), 1e9);
    else if(tfIsPlainObject(v) && typeof v.n === 'number') out[k] = v;   /* dishes 是对象 */
  }
  return out;
}
/* 通过 = { ok:true, data }；不通过 = { ok:false, msg } */
function tfSanitize(d){
  if(!tfIsPlainObject(d)) return { ok:false, msg:'存档内容不是一个对象' };
  if(typeof d.v === 'number' && d.v > SAVE_VER) return { ok:false, msg:`存档版本 ${d.v} 比当前游戏（${SAVE_VER}）新` };
  if(!Array.isArray(d.tiles)) return { ok:false, msg:'存档里没有地块数据' };
  if(d.tiles.length > TF_MAX_TILES) return { ok:false, msg:`地块太多（${d.tiles.length} > ${TF_MAX_TILES}），拒绝导入` };
  const clean = Object.assign({}, d);
  clean.coins = tfNum(d, 'coins', TF_CAP.coins);
  clean.fertilizer = tfNum(d, 'fertilizer', TF_CAP.fertilizer);
  clean.premium = tfNum(d, 'premium', TF_CAP.premium);
  clean.ovenSlots = Math.max(1, Math.min(OVEN_SLOT_MAX, tfNum(d, 'ovenSlots', TF_CAP.ovenSlots) || 1));
  clean.bag = tfCountMap(d.bag, CROP_IDS);
  clean.pieces = tfCountMap(d.pieces, CROP_IDS);
  clean.prep = tfCountMap(d.prep, ['flour']);
  clean.decorBag = tfCountMap(d.decorBag, null);
  clean.dishes = tfCountMap(d.dishes, null);
  clean.achievements = tfIsPlainObject(d.achievements) ? d.achievements : {};
  clean.achClaimed = tfIsPlainObject(d.achClaimed) ? d.achClaimed : {};
  clean.fav = tfIsPlainObject(d.fav) ? d.fav : {};
  clean.stats = tfIsPlainObject(d.stats) ? d.stats : {};
  clean.tasks = tfIsPlainObject(d.tasks) ? d.tasks : {};
  if(tfIsPlainObject(d.decorations) && Object.keys(d.decorations).length > TF_MAX_DECOR){
    return { ok:false, msg:`装饰物太多（${Object.keys(d.decorations).length}），拒绝导入` };
  }
  if(d.playerName != null) clean.playerName = lbCleanName(String(d.playerName));
  if(d.playerId != null && !/^[A-Za-z0-9_-]{6,40}$/.test(String(d.playerId))) delete clean.playerId;
  if(d.ownerId != null && !/^[A-Za-z0-9_-]{6,40}$/.test(String(d.ownerId))) delete clean.ownerId;
  /* 地块逐块体检：坐标必须是有限整数，作物/地形/状态必须在白名单里 */
  const TER = { grass:1, tilled:1, water:1, stone:1 };
  const STA = { wild:1, tilled:1, growing:1, ready:1, dead:1 };
  const tiles = [];
  for(let i = 0; i < d.tiles.length; i++){
    const t = d.tiles[i];
    if(!t || typeof t !== 'object') continue;
    const gx = t.gx, gy = t.gy;
    if(!Number.isInteger(gx) || !Number.isInteger(gy)) continue;
    if(Math.abs(gx) > TF_COORD_MAX || Math.abs(gy) > TF_COORD_MAX) continue;
    const crop = (typeof t.crop === 'string' && CROPS[t.crop]) ? t.crop : null;
    const terrain = (typeof t.terrain === 'string' && TER[t.terrain]) ? t.terrain : 'grass';
    let st = (typeof t.state === 'string' && STA[t.state]) ? t.state : 'wild';
    if(!crop && st === 'growing') st = 'tilled';
    tiles.push({
      gx, gy, terrain, state: st, crop,
      growth: tfNum(t, 'growth', 1e9), watered: !!t.watered, fertile: !!t.fertile,
      harvestsLeft: tfNum(t, 'harvestsLeft', 99), fertLeft: tfNum(t, 'fertLeft', 99),
      stone: !!t.stone,
    });
  }
  if(!tiles.length) return { ok:false, msg:'存档里的地块一块都不合法' };
  clean.tiles = tiles;
  if(tfIsPlainObject(d.map) && Number.isInteger(d.map.w) && Number.isInteger(d.map.h) &&
     d.map.w > 0 && d.map.h > 0 && d.map.w * d.map.h <= TF_MAX_TILES){
    clean.map = { x0:d.map.x0 | 0, y0:d.map.y0 | 0, w:d.map.w | 0, h:d.map.h | 0 };
  } else {
    const xs = tiles.map(t => t.gx), ys = tiles.map(t => t.gy);
    clean.map = { x0:Math.min.apply(null, xs), y0:Math.min.apply(null, ys),
                  w:Math.max.apply(null, xs) - Math.min.apply(null, xs) + 1,
                  h:Math.max.apply(null, ys) - Math.min.apply(null, ys) + 1 };
  }
  if(tfIsPlainObject(d.farm) && d.farm.w > 0 && d.farm.h > 0) clean.farm = d.farm;
  else clean.farm = { x0:clean.map.x0, y0:clean.map.y0, w:Math.min(3, clean.map.w), h:Math.min(3, clean.map.h) };
  return { ok:true, data: clean };
}

/* ---------- 存档 ⇄ 文本 ---------- */
/* 导出某个槽位（当前槽取内存里的最新状态，别的槽直接取存储里的原样载荷） */
function tfPayloadOf(slot){
  const n = slot || currentSlot() || 1;
  if(n === currentSlot() && state) return serialize(state);
  const d = readSlot(n);
  return d || null;
}
async function tfExportSlot(slot, pin){
  const payload = tfPayloadOf(slot);
  if(!payload) return { ok:false, msg:'槽位 ' + (slot || 1) + ' 是空的，没东西可导出' };
  const r = await tfEncodeData(payload, pin);
  if(!r.ok) return r;
  return { ok:true, text:r.text, slot:(slot || currentSlot() || 1), payload };
}
/* 解文本 → 体检 → 交给调用方预览/写入；**不写盘** */
async function tfReadText(text, pin){
  const r = await tfDecodeData(text, pin);
  if(!r.ok) return r;
  const c = tfSanitize(r.data);
  if(!c.ok) return { ok:false, msg:'存档体检没过：' + c.msg };
  const st2 = unpackState(c.data);
  if(!st2) return { ok:false, msg:'存档结构不对，读不出来' };
  return { ok:true, data:c.data, state:st2 };
}
/* 真正写盘：先给目标槽备份一份 .bak，再写 */
function tfWriteSlot(slot, data){
  const n = Math.max(1, Math.min(SLOT_COUNT, slot | 0));
  const prev = lsGet(slotKey(n));
  if(prev) lsSet(slotKey(n) + '.bak', prev);
  /* savedAt 归到现在：otherwise 一导入就会弹「离开 30 天」的离线结算提示 */
  const out = Object.assign({}, data, { savedAt: Date.now() });
  const okWrite = lsSet(slotKey(n), JSON.stringify(out));
  return { ok:okWrite, slot:n, backedUp:!!prev,
           msg: okWrite ? ('已导入到槽位 ' + n + (prev ? '（原内容已备份）' : ''))
                        : '导入失败：这台设备没能写入本地存储（可能是空间不够或无痕模式）' };
}

/* 二维码可行性：QR byte 模式上限 2953 字节（v40-L），而手机上对着屏幕扫，
   超过 ~1.2KB 就会变成密密麻麻的点阵、很难扫。所以这里如实告诉用户。 */
const TF_QR_MAX = 2900, TF_QR_COMFY = 1200;
function tfQrFit(text){
  const n = String(text || '').length;
  if(n <= TF_QR_COMFY) return { ok:true, level:'comfortable', bytes:n };
  if(n <= TF_QR_MAX) return { ok:true, level:'dense', bytes:n };
  return { ok:false, bytes:n };
}

/* ---------- 载体：文件 / 存档串 / 自包含链接 ---------- */
function tfLinkFor(text){
  const base = (typeof location !== 'undefined')
    ? (location.origin + location.pathname)
    : 'https://mcu.huyil.cn/farm/';
  return base + '#s=' + encodeURIComponent(text);
}
function tfDownload(name, text){
  try{
    const blob = new Blob([text], { type:'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { try{ URL.revokeObjectURL(url); }catch(e){} a.remove(); }, 400);
    return true;
  }catch(e){ return false; }
}
function tfStamp(){
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
function tfCopyText(text){
  return new Promise(res => {
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(() => res(true), () => res(tfCopyFallback(text)));
        return;
      }
    }catch(e){}
    res(tfCopyFallback(text));
  });
}
function tfCopyFallback(text){
  try{
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    ta.remove();
    return !!ok;
  }catch(e){ return false; }
}
/* 从 #s=<存档串> 里取出来（fragment 不会发给服务器，纯本地） */
function tfParamPayload(){
  try{
    const h = String(location.hash || '');
    if(h.indexOf('#s=') === 0) return decodeURIComponent(h.slice(3));
  }catch(e){}
  return '';
}
function tfClearParam(){
  try{
    if(location.hash && location.hash.indexOf('#s=') === 0 && history.replaceState){
      history.replaceState(null, '', location.pathname + location.search);
    }
  }catch(e){}
}

/* ---------- 启动：申请持久化 + 认链接 + iOS 提醒 ---------- */
function tfPersistStorage(){
  try{
    if(navigator.storage && navigator.storage.persist){
      navigator.storage.persist().then(granted => { tfPersistState = granted ? 'yes' : 'no'; },
                                      () => { tfPersistState = 'no'; });
    }
  }catch(e){}
}
let tfPersistState = 'unknown';
/* 这台设备是不是"随时可能被清档"（iOS Safari 7 天规则 / 无痕 / 拒绝持久化） */
function tfStorageRisk(){
  if(tfPersistState === 'yes') return false;
  const ua = String(navigator.userAgent || '');
  const ios = /iPad|iPhone|iPod/.test(ua);
  return ios || tfPersistState === 'no';
}
function tfBoot(){
  tfPersistStorage();
  const payload = tfParamPayload();
  if(payload){
    openSheet('transfer');
    tfStartImport(payload);
    tfClearParam();
  }
}

window.TransferDebug = {
  qrFit: tfQrFit,
  QR_MAX: TF_QR_MAX,
  encode: (st, pin) => tfEncodeData(serialize(st), pin),
  decode: (text, pin) => tfDecodeData(text, pin),
  sanitize: d => tfSanitize(d),
  readText: (text, pin) => tfReadText(text, pin),
  exportSlot: (slot, pin) => tfExportSlot(slot, pin),
  writeSlot: (slot, data) => tfWriteSlot(slot, data),
  linkFor: tfLinkFor,
  paramPayload: tfParamPayload,
  persistState: () => tfPersistState,
  storageRisk: () => tfStorageRisk(),
  hasCrypto: tfHasCrypto,
  ITER: TF_ITER,
  TAG: TF_TAG,
};
