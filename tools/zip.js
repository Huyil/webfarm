#!/usr/bin/env node
/* 零依赖 zip 打包器（这个环境里没有 zip 命令，所以自己写一份）
 *   node tools/zip.js <目录> <输出.zip>
 * 标准 PKZIP：deflate（zlib）或 store（压缩后更大时）、CRC32、中央目录 + EOCD，
 * 文件名带 UTF-8 标志位（bit 11），Windows 资源管理器「全部解压缩」/ unzip / Python zipfile 都能解。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ---------- DOS 时间 ---------- */
function dosTime(d) {
  const t = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const dt = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { t, dt };
}

/* ---------- 收集文件（目录条目也写进去，解压出来结构与源目录一致） ---------- */
function walk(dir, base, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) {
      out.push({ name: rel + '/', dir: true, mtime: fs.statSync(full).mtime, data: Buffer.alloc(0) });
      walk(full, rel, out);
    } else if (e.isFile()) {
      out.push({ name: rel, dir: false, mtime: fs.statSync(full).mtime, data: fs.readFileSync(full) });
    }
  }
}

function zipDir(srcDir, outZip, opts) {
  const o = opts || {};
  const topName = o.topName || path.basename(path.resolve(srcDir));
  const files = [];
  /* 顶层目录条目：让解压出来就有这一层 */
  files.push({ name: topName + '/', dir: true, mtime: fs.statSync(srcDir).mtime, data: Buffer.alloc(0) });
  walk(srcDir, topName, files);

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    let method = 0, body = f.data;
    if (!f.dir && f.data.length) {
      const def = zlib.deflateRawSync(f.data, { level: 9 });
      if (def.length < f.data.length) { method = 8; body = def; }
    }
    const crc = f.dir ? 0 : crc32(f.data);
    const { t, dt } = dosTime(f.mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            /* version needed */
    local.writeUInt16LE(0x0800, 6);        /* flags: UTF-8 文件名 */
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(t, 10);
    local.writeUInt16LE(dt, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);            /* extra len */
    chunks.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);              /* version made by */
    cen.writeUInt16LE(20, 6);              /* version needed */
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(t, 12);
    cen.writeUInt16LE(dt, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(f.data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);              /* extra */
    cen.writeUInt16LE(0, 32);              /* comment */
    cen.writeUInt16LE(0, 34);              /* disk */
    cen.writeUInt16LE(0, 36);              /* internal attrs */
    cen.writeUInt32LE(f.dir ? 0x10 : 0, 38); /* external attrs: dir 标志 */
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const cenBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(outZip, Buffer.concat(chunks.concat([cenBuf, eocd])));
  return { files: files.filter(f => !f.dir).length, bytes: fs.statSync(outZip).size };
}

module.exports = { zipDir, crc32 };

if (require.main === module) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('用法: node tools/zip.js <目录> <输出.zip>'); process.exit(1); }
  const r = zipDir(src, out);
  console.log(`✓ ${out}  (${r.files} 个文件, ${(r.bytes / 1024).toFixed(1)} KB)`);
}
