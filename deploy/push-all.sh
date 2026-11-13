#!/usr/bin/env bash
# 一次把当前提交推到两个远端（分支名不同：Gitee=master，GitHub=main）
#   ./deploy/push-all.sh
# 认证：用 KEY_SRC 指定私钥（默认 $HOME/.ssh/id_ed25519）；拷到临时文件、用完即删。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_KEY="$(cd "$ROOT" && node tools/config.js deployKey 2>/dev/null || true)"
KEY_SRC="${KEY_SRC:-${DEPLOY_KEY:-${CONFIG_KEY:-$HOME/.ssh/id_ed25519}}}"
KEY_TMP="$(mktemp -t pushkey.XXXXXX)"
trap 'rm -f "$KEY_TMP"' EXIT
[ -f "$KEY_SRC" ] || { echo "✗ 找不到私钥 $KEY_SRC" >&2; exit 1; }
cp "$KEY_SRC" "$KEY_TMP"; chmod 600 "$KEY_TMP"
export GIT_SSH_COMMAND="ssh -i $KEY_TMP -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20"
cd "$ROOT"
BR="$(git rev-parse --abbrev-ref HEAD)"
[ "$BR" = "master" ] || { echo "✗ 当前分支是 $BR，脚本按 master 写死（先切回 master）" >&2; exit 1; }
echo "▶ Gitee  master"
git push origin master
echo "▶ GitHub main（GitHub 默认分支叫 main）"
git push github master:main
echo "✓ 两边都推完了"
