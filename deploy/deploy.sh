#!/usr/bin/env bash
# 小田园 → mcu.huyil.cn 部署脚本（在「能 ssh 到服务器」的机器上运行）
#
#   ./deploy/deploy.sh discover                    # 只读侦察：找 mcu.huyil.cn 的 docroot
#   ./deploy/deploy.sh push auto                   # 自动定位 docroot 并上传为 <docroot>/farm/index.html
#   ./deploy/deploy.sh push <docroot>              # 手动指定 docroot
#   ./deploy/deploy.sh push auto --flat            # 上传为 <docroot>/farm.html
#   SSH_PORT=22 HOST=root@1.2.3.4 SITE=other.cn ./deploy/deploy.sh discover
#   MIN=1 ./deploy/deploy.sh push <docroot>        # 用 farm.min.html 当入口
#
# 只新增文件：不改 nginx 配置、不动 mcu 首页；重复部署会先备份同名文件。
set -euo pipefail

HOST="${HOST:-root@www.huyil.cn}"
SITE="${SITE:-mcu.huyil.cn}"
SSH_PORT="${SSH_PORT:-2233}"          # 实测：22 关闭，SSH 在 2233
SSH_OPTS="${SSH_OPTS:--o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# MIN=1 时用压缩产物当入口（体积小一半，行为一致；两个都过了同一套断言）
SRC="$ROOT/farm.html"
[ -n "${MIN:-}" ] && SRC="$ROOT/farm.min.html"
[ -f "$SRC" ] || { echo "✗ 找不到 $SRC（先跑 node build.js）" >&2; exit 1; }

MODE="${1:-discover}"
remote() { ssh -p "$SSH_PORT" $SSH_OPTS "$HOST" "$@"; }

# 在服务器上推断站点 docroot：先读 nginx 配置里该 server_name 的 root，再退回常见目录
resolve_docroot() {
  remote "SITE='$SITE' bash -s" <<'EOS'
set -u
CFG=""
command -v nginx >/dev/null 2>&1 && CFG="$(nginx -T 2>/dev/null || true)"
[ -z "$CFG" ] && CFG="$(cat /etc/nginx/nginx.conf /etc/nginx/conf.d/*.conf /usr/local/openresty/nginx/conf/nginx.conf 2>/dev/null || true)"
DR="$(printf '%s\n' "$CFG" | awk -v s="$SITE" '
  $0 ~ /server_name/ && index($0, s) { f=1 }
  f && /^[ \t]*root[ \t]/ { gsub(/;/,""); print $2; exit }
  f && /^[ \t]*}/ { f=0 }')"
if [ -z "$DR" ]; then
  # 常见路径 + 1Panel（openresty 跑在 docker 里，宿主目录是下面这个，2026-09 实测 mcu.huyil.cn 用的就是它）
  for d in /www/wwwroot/"$SITE" /var/www/"$SITE" \
           /opt/1panel/apps/openresty/openresty/www/sites/"$SITE"/index \
           /opt/1panel/www/sites/"$SITE"/index \
           /usr/share/nginx/html /usr/local/openresty/nginx/html; do
    [ -d "$d" ] && { DR="$d"; break; }
  done
fi
printf '%s' "$DR"
EOS
}

case "$MODE" in

discover)
  echo "▶ 侦察 $HOST（只读，不改任何东西）"
  remote "SITE='$SITE' bash -s" <<'EOS'
set -u
echo "── 主机 ──"; hostname 2>/dev/null; uname -srm
echo "── web 服务 ──"
for b in openresty nginx; do command -v "$b" >/dev/null 2>&1 && "$b" -v 2>&1 | head -1; done
echo "── 配置文件里包含 $SITE 的文件 ──"
grep -rl "$SITE" /etc/nginx /usr/local/openresty/nginx/conf /www/server/panel/vhost 2>/dev/null | head -10 || echo "(无)"
echo "── 该站点的 server 块（root / listen / server_name） ──"
CFG=""
command -v nginx >/dev/null 2>&1 && CFG="$(nginx -T 2>/dev/null || true)"
if [ -z "$CFG" ]; then
  CFG="$(cat /etc/nginx/nginx.conf /etc/nginx/conf.d/*.conf /usr/local/openresty/nginx/conf/nginx.conf 2>/dev/null || true)"
fi
printf '%s\n' "$CFG" | grep -nE "server_name|listen |root |alias |index " | head -40
echo "── 直接猜 docroot 是否存在 ──"
for d in /www/wwwroot/"$SITE" /var/www/"$SITE" /usr/share/nginx/html /usr/local/openresty/nginx/html /www/wwwroot/huyil.cn; do
  [ -d "$d" ] && { printf '%-40s ' "$d"; ls -ld "$d" | awk '{print $1, $3":"$4}'; }
done
echo "── 磁盘 ──"; df -h / | tail -1
EOS
  echo
  echo "▶ 下一步（把 <docroot> 换成上面 mcu.huyil.cn 那个 root 路径）："
  echo "   ./deploy/deploy.sh push <docroot>"
  ;;

push)
  DOCROOT="${2:-}"
  FLAT="${3:-}"
  if [ -z "$DOCROOT" ] || [ "$DOCROOT" = "auto" ]; then
    echo "▶ 自动定位 $SITE 的 docroot…"
    DOCROOT="$(resolve_docroot)"
    [ -n "$DOCROOT" ] || { echo "✗ 自动定位失败：先跑 ./deploy/deploy.sh discover，再手动传 docroot" >&2; exit 1; }
    echo "   docroot = $DOCROOT"
  fi
  if [ "$FLAT" = "--flat" ]; then
    TARGET="$DOCROOT/farm.html"; CHOWN="$TARGET"; URL="https://$SITE/farm.html"
  else
    TARGET="$DOCROOT/farm/index.html"; CHOWN="$DOCROOT/farm"; URL="https://$SITE/farm/"
  fi
  echo "▶ 目标：$HOST:$TARGET（端口 $SSH_PORT）"
  remote "test -d '$DOCROOT'" || { echo "✗ 远端目录不存在：$DOCROOT" >&2; exit 1; }
  # 时间戳要在本地算：放进远端单引号里 $(date) 不会被展开（会生成字面量文件名）
  TS="$(date +%Y%m%d%H%M%S)"
  remote "if [ -f '$TARGET' ]; then cp -a '$TARGET' '$TARGET.bak.$TS' && echo '✓ 已备份同名旧文件 → $TARGET.bak.$TS'; fi"
  [ "$FLAT" = "--flat" ] || remote "mkdir -p '$DOCROOT/farm'"
  echo "▶ 上传 $(du -h "$SRC" | cut -f1)…"
  scp -P "$SSH_PORT" $SSH_OPTS "$SRC" "$HOST:$TARGET"
  remote "chmod 644 '$TARGET'; chown -R \$(stat -c '%U:%G' '$DOCROOT') '$CHOWN' 2>/dev/null || true; ls -l '$TARGET'"
  echo "▶ 验证 HTTPS"
  code="$(curl -sS -o /dev/null -w '%{http_code}' -m 15 "$URL" || echo 000)"
  ctype="$(curl -sSI -m 15 "$URL" 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')"
  echo "   $URL → HTTP $code  content-type: ${ctype:-?}"
  if [ "$code" = "200" ]; then echo "✓ 部署完成：$URL"; else echo "✗ 状态码非 200：确认 docroot 真的是该站点的 root（或看 nginx error_log）" >&2; exit 1; fi
  ;;

*)
  sed -n '2,10p' "$0"; exit 1; ;;

esac
