#!/usr/bin/env bash
# 一次把当前提交推到两个远端（分支名不同：Gitee=master，GitHub=main）
#   ./deploy/push-all.sh
# 认证：Windows 侧 /mnt/c/Users/huyil/.ssh/id_rsa（Gitee: huyil233 / GitHub: Huyil 都能用），拷到 /tmp 用完即删。
set -euo pipefail
KEY_SRC="${KEY_SRC:-/mnt/c/Users/huyil/.ssh/id_rsa}"
KEY_TMP="$(mktemp -t pushkey.XXXXXX)"
trap 'rm -f "$KEY_TMP"' EXIT
[ -f "$KEY_SRC" ] || { echo "✗ 找不到私钥 $KEY_SRC" >&2; exit 1; }
cp "$KEY_SRC" "$KEY_TMP"; chmod 600 "$KEY_TMP"
export GIT_SSH_COMMAND="ssh -i $KEY_TMP -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20"
cd "$(dirname "$0")/.."
BR="$(git rev-parse --abbrev-ref HEAD)"
[ "$BR" = "master" ] || { echo "✗ 当前分支是 $BR，脚本按 master 写死（先切回 master）" >&2; exit 1; }
echo "▶ Gitee  master"
git push origin master
echo "▶ GitHub main（GitHub 默认分支叫 main）"
git push github master:main
echo "✓ 两边都推完了"
