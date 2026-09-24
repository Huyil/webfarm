#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""小田园排行榜服务（零依赖，Python 3.6+ 标准库）

  GET  /health                  → {"ok":true}
  GET  /leaderboard?limit=50    → {"ok":true,"count":n,"updatedAt":ts,"entries":[...]}
  POST /leaderboard             → 按 id upsert 一条成绩，返回最新榜单

存储：/var/lib/farm-leaderboard/board.json（原子写 + 保留一份 .bak）
对外：只监听 127.0.0.1:8095，由 openresty 反向代理到 https://mcu.huyil.cn/farm/api/
"""
import json
import os
import re
import socketserver
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = '127.0.0.1'
PORT = int(os.environ.get('FARM_LB_PORT', '8095'))
DATA_DIR = os.environ.get('FARM_LB_DIR', '/var/lib/farm-leaderboard')
DATA_FILE = os.path.join(DATA_DIR, 'board.json')
MAX_ENTRIES = 500                # 榜单最多保留多少条
MAX_BODY = 4096                  # 请求体上限
RATE_GAP = 1.0                   # 同一 IP 两次提交的最小间隔（秒）
ID_RE = re.compile(r'^[A-Za-z0-9_-]{6,40}$')

# 字段 → 上限（服务器侧再夹一层，防手改请求塞进天文数字）
LIMITS = {
    'coins':   10 ** 12,
    'harvest': 10 ** 7,
    'farmW':   64,
    'farmH':   64,
    'ach':     200,
    'tasks':   10 ** 7,
}
LOCK = threading.Lock()
LAST_POST = {}                   # ip → 上次提交时间


def load():
    try:
        with open(DATA_FILE, 'r') as f:
            d = json.load(f)
        ents = d.get('entries')
        return ents if isinstance(ents, list) else []
    except Exception:
        return []


def save(entries):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = DATA_FILE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump({'updatedAt': int(time.time()), 'entries': entries}, f, ensure_ascii=False)
    if os.path.exists(DATA_FILE):
        try:
            os.replace(DATA_FILE, DATA_FILE + '.bak')
        except Exception:
            pass
    os.replace(tmp, DATA_FILE)


def clean_name(raw):
    if not isinstance(raw, str):
        return ''
    s = ''.join(ch for ch in raw if ch >= ' ' and ch != '\x7f')   # 去掉控制字符
    for ch in '<>&"\'`()\\/':                                # 名字里不留可能用于注入的字符
        s = s.replace(ch, '')
    s = s.strip()[:12]
    return s


def as_int(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v == v and abs(v) != float('inf'):
        return int(v)
    if isinstance(v, str) and v.strip().lstrip('-').isdigit():
        return int(v.strip())
    return None


def normalize(payload):
    """返回 (entry, None) 或 (None, 错误信息)"""
    if not isinstance(payload, dict):
        return None, 'body must be a json object'
    pid = payload.get('id')
    if not isinstance(pid, str) or not ID_RE.match(pid):
        return None, 'bad id'
    name = clean_name(payload.get('name'))
    if not name:
        return None, 'empty name'
    ent = {'id': pid, 'name': name, 'ts': int(time.time())}
    for k, cap in LIMITS.items():
        v = as_int(payload.get(k, 0))
        if v is None:
            return None, 'bad field: ' + k
        if v < 0:
            v = 0
        if v > cap:
            v = cap
        ent[k] = v
    return ent, None


def sorted_entries(entries):
    out = sorted(entries, key=lambda e: (-e.get('coins', 0), -e.get('harvest', 0), e.get('name', '')))
    return out


def upsert(entries, ent):
    for i, e in enumerate(entries):
        if e.get('id') == ent['id']:
            # 同一个人重复提交：取「各项的较大值」，避免手滑丢成绩
            merged = dict(e)
            merged['name'] = ent['name']
            merged['ts'] = ent['ts']
            for k in LIMITS:
                merged[k] = max(int(e.get(k, 0)), ent[k])
            entries[i] = merged
            return merged
    entries.append(ent)
    if len(entries) > MAX_ENTRIES:
        entries.sort(key=lambda e: e.get('ts', 0))          # 太老的先淘汰
        del entries[:len(entries) - MAX_ENTRIES]
    return ent


class Handler(BaseHTTPRequestHandler):
    server_version = 'farm-leaderboard/1.0'
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):                      # 日志走 syslog 太吵，写一行足够
        sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))

    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        path = self.path.split('?')[0].rstrip('/') or '/'
        if path == '/health':
            return self._send(200, {'ok': True, 'ts': int(time.time())})
        if path == '/leaderboard':
            with LOCK:
                entries = load()
            return self._send(200, {
                'ok': True,
                'count': len(entries),
                'updatedAt': int(time.time()),
                'entries': sorted_entries(entries),
            })
        return self._send(404, {'ok': False, 'error': 'not found'})

    def do_POST(self):
        path = self.path.split('?')[0].rstrip('/') or '/'
        if path != '/leaderboard':
            return self._send(404, {'ok': False, 'error': 'not found'})
        ip = self.client_address[0]
        now = time.time()
        if now - LAST_POST.get(ip, 0) < RATE_GAP:
            return self._send(429, {'ok': False, 'error': '太快了，歇一下'})
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            n = 0
        if n <= 0 or n > MAX_BODY:
            return self._send(413, {'ok': False, 'error': 'bad length'})
        raw = self.rfile.read(n)
        try:
            payload = json.loads(raw.decode('utf-8'))
        except Exception:
            return self._send(400, {'ok': False, 'error': 'bad json'})
        ent, err = normalize(payload)
        if err:
            return self._send(400, {'ok': False, 'error': err})
        LAST_POST[ip] = now
        if len(LAST_POST) > 4096:                            # 简单清理，防止字典无限长
            for k in [k for k, t in list(LAST_POST.items()) if now - t > 3600]:
                LAST_POST.pop(k, None)
        with LOCK:
            entries = load()
            merged = upsert(entries, ent)
            entries = sorted_entries(entries)
            save(entries)
        rank = next((i + 1 for i, e in enumerate(entries) if e.get('id') == ent['id']), None)
        return self._send(200, {'ok': True, 'me': merged, 'rank': rank, 'count': len(entries), 'entries': entries})


class ThreadedHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    srv = ThreadedHTTPServer((HOST, PORT), Handler)
    sys.stderr.write('farm-leaderboard listening on %s:%d, data=%s\n' % (HOST, PORT, DATA_FILE))
    srv.serve_forever()


if __name__ == '__main__':
    main()
