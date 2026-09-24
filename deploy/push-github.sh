#!/usr/bin/env bash
# 把当前仓库推送到 GitHub（默认 GH_REPO=Huyil/webfarm）
#
#   ./deploy/push-github.sh              # 普通推送（远端必须是空仓库，或已包含我们的提交）
#   ./deploy/push-github.sh --force      # 远端有 README 等无关提交时：强制以本地为准覆盖
#   GH_REPO=别的账号/仓库名 ./deploy/push-github.sh
#
# 认证：GitHub 的 key 在 Windows 侧（/mnt/c/Users/huyil/.ssh/id_rsa，账号 Huyil）。
# 脚本会把它拷到 /tmp 并 chmod 600（/mnt/c 权限是 0777，OpenSSH 会拒绝直接用），用完删掉。
set -euo pipefail

GH_REPO="${GH_REPO:-Huyil/webfarm}"
KEY_SRC="${KEY_SRC:-/mnt/c/Users/huyil/.ssh/id_rsa}"
KEY_TMP="$(mktemp -t ghkey.XXXXXX)"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

cleanup() { rm -f "$KEY_TMP"; }
trap cleanup EXIT

if [ ! -f "$KEY_SRC" ]; then
  echo "✗ 找不到私钥 $KEY_SRC" >&2
  echo "  在 Windows 里跑的话，先确认 WSL 能读到它：ls /mnt/c/Users/huyil/.ssh/" >&2
  exit 1
fi
if [ ! -d .git ]; then
  echo "✗ 当前目录不是 git 仓库（先 git init / 或在项目根目录跑）" >&2
  exit 1
fi

cp "$KEY_SRC" "$KEY_TMP"
chmod 600 "$KEY_TMP"
export GIT_SSH_COMMAND="ssh -i $KEY_TMP -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"

echo "▶ 认证检查（git@github.com）"
# 注意：ssh -T git@github.com 认证成功也返回 1（不给 shell），所以先取输出再匹配，
# 不能直接 `ssh | grep -q`（pipefail 下会把成功的认证判成失败）
AUTH_OUT="$(ssh -i "$KEY_TMP" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 || true)"
if ! printf '%s' "$AUTH_OUT" | grep -q "successfully authenticated"; then
  echo "✗ SSH 认证失败：这把 key 没在 GitHub 账号里注册" >&2
  echo "  GitHub 的回复：$(printf '%s' "$AUTH_OUT" | head -1)" >&2
  exit 1
fi
echo "  ✓ $(printf '%s' "$AUTH_OUT" | head -1)"

echo "▶ 远端：$GH_REPO"
if git remote | grep -qx github; then
  git remote set-url github "git@github.com:$GH_REPO.git"
else
  git remote add github "git@github.com:$GH_REPO.git"
fi

if ! git ls-remote --heads github >/dev/null 2>&1; then
  echo "✗ 远端仓库不存在或无权访问：https://github.com/$GH_REPO" >&2
  echo "  → 先去 GitHub 建一个**空仓库**（不要勾 Add README / .gitignore / license），再重跑本脚本。" >&2
  echo "  → 或者给我一个有 repo 权限的 token，我可以用 API 直接建：POST https://api.github.com/user/repos" >&2
  exit 1
fi

REMOTE_HEADS="$(git ls-remote --heads github | wc -l | tr -d ' ')"
if [ "$REMOTE_HEADS" != "0" ] && [ "$FORCE" != "1" ]; then
  if git ls-remote --heads github | grep -q "$(git rev-parse HEAD)"; then
    echo "✓ 远端已经包含当前提交，无需推送"
    exit 0
  fi
  echo "⚠ 远端已有 $REMOTE_HEADS 个分支（可能建仓库时勾了 README）" >&2
  echo "  想以本地为准覆盖，就加 --force 重跑：./deploy/push-github.sh --force" >&2
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "▶ 推送 $BRANCH（$(git rev-list --count HEAD) 个提交）"
if [ "$FORCE" = "1" ]; then
  git push --force github "$BRANCH:$BRANCH"
else
  git push -u github "$BRANCH"
fi

echo "▶ 校验"
code="$(curl -sS -o /dev/null -w '%{http_code}' -m 20 "https://api.github.com/repos/$GH_REPO" || echo 000)"
echo "  https://github.com/$GH_REPO → API HTTP $code（404 = 私有仓库，正常）"
echo "✓ 完成：https://github.com/$GH_REPO"
