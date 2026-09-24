# 部署到 mcu.huyil.cn

## 诊断结论（2026-09-23 从本工作区实测）

| 检查项 | 结果 |
|---|---|
| `www.huyil.cn` / `mcu.huyil.cn` DNS | 都是 **8.138.87.175**（同一台机器） |
| 80 / 443 | 开放，`server: openresty`、HTTP/2 |
| 22 | **Connection refused**（不是 SSH 端口） |
| **2233** | **开放**，SSH 握手成功：`Permission denied (publickey,gssapi-keyex,gssapi-with-mic)` |
| 本环境私钥 | **没有**：无 `~/.ssh` 目录；`/mnt/c/Users/` 下只有 `huyil`（含 `.aws/.azure/.docker`，**无 `.ssh`**）；所有挂载盘都搜不到 `huyilwindow` 目录；深度 6 内唯一匹配的是 `/home/loli/.ollama/id_ed25519`（Ollama 自己的，不是你的） |
| 站点现状 | `mcu.huyil.cn` 是 openresty 静态站，`/` 返回 3896B 的「MCU 工具集」index.html |

**所以：网络路径没问题，只差一把能登录 `root@www.huyil.cn:2233` 的私钥。** 有了钥匙就是一条命令的事。

## 方案 A：把私钥给我，我直接部署（你要的 URL 是 `https://mcu.huyil.cn/farm/`）

```bash
# 你把私钥放到工作区（二选一）
#   1) 复制文件： cp /path/to/id_ed25519 /home/loli/web/deploy/id_deploy
#   2) 直接粘贴内容到 /home/loli/web/deploy/id_deploy
chmod 600 /home/loli/web/deploy/id_deploy
```

然后我执行：

```bash
GIT_SSH_COMMAND= SSH_OPTS="-i /home/loli/web/deploy/id_deploy -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new" \
  ./deploy/deploy.sh push auto
```

脚本会：自动从 nginx 配置里定位 `mcu.huyil.cn` 的 docroot → `mkdir -p <docroot>/farm` → 上传 `farm.html` 为 `farm/index.html` → `chmod 644` + 属主对齐 → `curl -I https://mcu.huyil.cn/farm/` 验证 200 与 `content-type`。

> 安全提醒：私钥落在会话文件系统里就等同于交给这个会话，建议**用一把专用的部署密钥**（可以只给它这台机器的权限），部署完成后删掉 `deploy/id_deploy`，必要时在服务器 `~/.ssh/authorized_keys` 里移除对应公钥。

## 方案 B：你自己跑（不给密钥，最安全）★ 你选了这个

一条命令（脚本默认 `root@www.huyil.cn` + 端口 **2233**，会自动找 docroot）：

```bash
./deploy/deploy.sh push auto          # → https://mcu.huyil.cn/farm/
```

### 从 Windows 跑（你的密钥在 Windows 用户目录 → 推荐这条）

PowerShell 里逐条执行（把用户目录换成实际名字）：

```powershell
ssh -p 2233 root@www.huyil.cn "nginx -T 2>/dev/null | grep -B3 -A12 'server_name .*mcu.huyil.cn'"
ssh -p 2233 root@www.huyil.cn "mkdir -p /www/wwwroot/mcu.huyil.cn/farm"
scp -P 2233 .\farm.html root@www.huyil.cn:/www/wwwroot/mcu.huyil.cn/farm/index.html
curl.exe -I https://mcu.huyil.cn/farm/
```

> 第 1 条的输出里找 `root /xxx;`，那个 `/xxx` 就是 docroot；务必用真实 docroot 替换第 2、3 条里的 `/www/wwwroot/mcu.huyil.cn`（宝塔机器通常是 `/www/wwwroot/<域名>`，也可能在 `/var/www/` 或自定义目录）。

### 从 WSL 跑

密钥在 Windows 侧时，**不要直接 `ssh -i /mnt/c/Users/...`**：`/mnt/c` 权限是 0777，OpenSSH 会以 `UNPROTECTED PRIVATE KEY FILE` 拒绝加载。先复制进 WSL 并收权限：

```bash
mkdir -p ~/.ssh && cp /mnt/c/Users/<Windows用户名>/.ssh/id_ed25519 ~/.ssh/ && chmod 600 ~/.ssh/id_ed25519
cd /home/loli/web && ./deploy/deploy.sh push auto
```

### 如果 `push auto` 没自动找到 docroot

```bash
./deploy/deploy.sh discover                    # 打印该 server 块的 root/listen/server_name
./deploy/deploy.sh push /www/wwwroot/mcu.huyil.cn   # 用上一步看到的确切路径
```

### 部署成功的判据

脚本最后会打印 `https://mcu.huyil.cn/farm/ → HTTP 200  content-type: text/html; charset=utf-8`。
如果 200 但页面是 404 内容，说明 docroot 选错了（放到了别的站点根目录）。

## 方案 C：面板 / FTP 上传

云控制台或宝塔面板的「文件管理」→ 进 `mcu.huyil.cn` 的网站目录 → 新建 `farm/` → 把 `farm.html` 传进去并重命名为 `index.html`。

## 注意事项

- **存档按来源隔离**：`https://mcu.huyil.cn/farm/` 是全新 origin，线上是独立存档；你本地 `file://` 的老档不会自动跟过去（要搬档我可以加导出/导入）。
- 可选缓存策略（不加也能跑）：`location = /farm/index.html { add_header Cache-Control "no-cache"; }`
- 脚本**只新增文件**：不改 nginx 配置、不动 mcu 首页 `index.html`；重复部署会先 `cp -a` 备份同名文件。
- `mcu.huyil.cn` 首页是「MCU 工具集」列表页，要不要加游戏入口卡片由你定；要加我给你一段不破坏现有布局的片段。
- 22 关闭、2233 开放，说明 SSH 已经挪过端口；安全组不必对全网开放，保持现状即可。


---

## 实测补充（2026-09-24）：mcu.huyil.cn 已上线

**结论：这台服务器用的是 1Panel + openresty(Docker)，不是裸 nginx。** `discover` 早期找不到 docroot 就是这个原因（`nginx` 不在 PATH、配置在容器里）。现已把 1Panel 路径加进 `push auto` 的候选，一条命令即可：

```bash
SSH_OPTS="-i /path/to/key -o BatchMode=yes" MIN=1 ./deploy/deploy.sh push auto
# → 上传 farm.min.html 到 <docroot>/farm/index.html 并验证 https://mcu.huyil.cn/farm/
```

| 项 | 值 |
|---|---|
| 主机 | `root@www.huyil.cn` 端口 **2233**（22 关闭）；登录成功的那把钥匙是 `id_rsa`（`id_ed25519` 被拒） |
| 站点目录（宿主） | `/opt/1panel/apps/openresty/openresty/www/sites/mcu.huyil.cn/index` |
| 站点目录（容器内） | `/www/sites/mcu.huyil.cn/index` → 所以 URL 是 `/farm/` |
| 容器 | `1Panel-openresty-wDxk`（另有 1Panel、emqx、mysql、frps、mcu-material 等） |
| 本地服务器 | `node tools/serve.js 8123`（`/` 构建版、`/dev` 源码版、`/farm.min.html` 压缩版） |

部署后自检：

```bash
curl -sSI https://mcu.huyil.cn/farm/ | head -3            # 期望 HTTP/2 200 + content-type: text/html
curl -sS https://mcu.huyil.cn/farm/ -o /tmp/live.html && md5sum /tmp/live.html farm.min.html   # 应完全一致
```

> 密钥别放在 drvfs 上直接给 ssh 用（`/mnt/c` 权限固定 0777，OpenSSH 会拒绝）；先 `cp` 进 Linux 家目录再 `chmod 600`。
> 部署用的临时钥匙（`deploy/keys/*`）发布完即删，要用再拷：
> ```bash
> cp /mnt/c/Users/huyil/.ssh/id_rsa deploy/keys/ && chmod 600 deploy/keys/id_rsa
> ```

### 首页入口（已完成）

`https://mcu.huyil.cn/` 首页是**手写静态页**（内联 CSS，无构建、无 git 仓库，服务器上只有这一份），
已加一张「🌾 小田园 → /farm/」卡片，位置在「MCU GPIO 配置工具」之后、「局域网管理环境」之前：

| | |
|---|---|
| 线上文件 | `/opt/1panel/apps/openresty/openresty/www/sites/mcu.huyil.cn/index/index.html` |
| 本仓库留档 | `deploy/mcu-index.html`（改动后的完整首页，便于比对/回滚） |
| 备份 | 服务器同目录 `index.html.bak-<时间戳>`（改动前 3896B 那份） |

重新应用/改位置：

```bash
# 拉下来改
scp -P 2233 root@www.huyil.cn:/opt/1panel/.../index/index.html /tmp/index.html
# 上传前先备份
ssh -p 2233 root@www.huyil.cn "cp -a <index.html> <index.html>.bak-$(date +%Y%m%d%H%M%S)"
scp -P 2233 /tmp/index.html root@www.huyil.cn:/opt/1panel/.../index/index.html
```

回滚到改动前：

```bash
ssh -p 2233 root@www.huyil.cn "cp -a <dir>/index.html.bak-<时间戳> <dir>/index.html"
```

---

## 排行榜服务（v9.7，已上线）

游戏本体仍是**单文件静态页**，只有排行榜需要服务端。架构：

```
浏览器 /farm/  ──POST /farm/api/leaderboard──▶  openresty（host 网络）
                                              location /farm/api/ → proxy_pass 127.0.0.1:8095
                                              └▶ python3 零依赖服务（systemd: farm-leaderboard）
                                                 数据：/var/lib/farm-leaderboard/board.json
```

| 项 | 值 |
|---|---|
| 服务代码（服务器） | `/opt/farm-leaderboard/server.py`（仓库里同源：`deploy/leaderboard/server.py`） |
| systemd 单元 | `/etc/systemd/system/farm-leaderboard.service`（`Restart=always`，实测 `kill -9` 后 2.5 秒自动拉起） |
| 监听 | `127.0.0.1:8095`（只对本机，公网只能走 `/farm/api/`） |
| 数据 | `/var/lib/farm-leaderboard/board.json`（原子写，另存 `board.json.bak`） |
| API | `GET /farm/api/health`、`GET /farm/api/leaderboard?limit=N`、`POST /farm/api/leaderboard` |
| nginx | `…/conf/conf.d/mcu.huyil.cn.conf` 里新增 `location /farm/api/ { proxy_pass http://127.0.0.1:8095/; }`（改动前已备份 `*.bak-farmapi-*`） |

**首次安装**（换服务器时照做）：

```bash
ssh -p 2233 root@www.huyil.cn "mkdir -p /opt/farm-leaderboard /var/lib/farm-leaderboard"
scp -P 2233 deploy/leaderboard/server.py root@www.huyil.cn:/opt/farm-leaderboard/
scp -P 2233 deploy/leaderboard/farm-leaderboard.service root@www.huyil.cn:/etc/systemd/system/
ssh -p 2233 root@www.huyil.cn "systemctl daemon-reload && systemctl enable --now farm-leaderboard && curl -s 127.0.0.1:8095/health"
```
再把 `location /farm/api/` 加进站点 conf（备份 → `docker exec 1Panel-openresty-wDxk openresty -t` → `-s reload`）。

**日常运维**：

```bash
systemctl status farm-leaderboard            # 状态
journalctl -u farm-leaderboard -n 50         # 日志（每次请求一行）
systemctl restart farm-leaderboard           # 重启
rm -f /var/lib/farm-leaderboard/board.json*  # 清空榜单（下次写入自动重建）
ss -lntp | grep 8095                         # 确认在听
```

**接口自检**：

```bash
curl -s https://mcu.huyil.cn/farm/api/health
curl -s -XPOST https://mcu.huyil.cn/farm/api/leaderboard -H 'Content-Type: application/json' \
  -d '{"id":"check-000001","name":"自检","coins":42,"harvest":3,"farmW":4,"farmH":4,"ach":1,"tasks":0}'
curl -s "https://mcu.huyil.cn/farm/api/leaderboard" | head -c 200
```

**排错**：`/farm/api/` 报 **502** = openresty 通了但后端没起 → `systemctl restart farm-leaderboard`；报 **404** = 站点 conf 里那条 location 丢了（重新加 + reload）。服务端防线：同 IP 1 秒 1 次限流、字段夹紧、名字清洗、body ≤4KB、同 id 取各项较大值、最多 500 条。

---

## 推送到 GitHub（镜像）

GitHub 的 SSH 认证**已经可用**（用 `id_rsa`，账号 **`Huyil`**；`id_ed25519` 没注册过）。
但 SSH 只能推代码、**不能建仓库**，所以先要有那个仓库（二选一）：

**A. 你建一个空仓库（30 秒）**：GitHub → New repository → 名字 `webfarm` → **不要**勾 Add README / .gitignore / license → 建完回一句，我跑：

```bash
./deploy/push-github.sh            # 认证 → 建/校正 remote → 推送 → 校验
./deploy/push-github.sh --force    # 如果你不小心勾了 README：以本地为准覆盖
GH_REPO=别的账号/名字 ./deploy/push-github.sh
```

**B. 全自动（给我一个 token）**：classic token 勾 `repo`，或 fine-grained 给 Contents + Administration 读写；
我可以用 `POST https://api.github.com/user/repos` 直接把仓库建出来再推。token 只用于这一步，用完即删，建议事后撤销。

## 历史的整理（git-filter-repo，2026-09-24）

推 GitHub 前用 [`git-filter-repo`](https://github.com/newren/git-filter-repo) 过了一遍（环境里没有 pip，直接下的单文件脚本）：

```bash
python3 git-filter-repo --force --invert-paths \
  --path farm.html --path farm.min.html --path src/dev-bundle.js --path src/dev-bundle.css \
  --name-callback  "return name.replace(b'huyil233', b'Huyil')" \
  --email-callback "return email.replace(b'huyil233@users.noreply.gitee.com', b'Huyil@users.noreply.github.com')" \
  --message-callback "return message.replace(<旧的构建产物说明>, <新的>)"
```

- **剔除 4 个生成物**（`farm.html` / `farm.min.html` / `src/dev-bundle.js` / `src/dev-bundle.css`）→ 已写进 `.gitignore`，跑 `node build.js` 生成
- **作者/邮箱**改成 GitHub 身份 `Huyil <Huyil@users.noreply.github.com>`（原来提交是 Gitee 的 noreply）
- 仓库从 **2.9 MB → 516 KB**，仍是 3 个提交（v9.13 / v9.14 / v9.15）
- ⚠️ filter-repo 会把工作区里那 4 个文件也删掉（重写后 checkout），所以**整理完必须重跑 `node build.js`**
- 备份：`dist/gitbak/web-farm-before-filter.bundle`（整理前，592K）与 `...-after-filter.bundle`（整理后，308K）；恢复用
  `git clone dist/gitbak/web-farm-before-filter.bundle /tmp/restore`
- 整理后 **Gitee 已 force push 同步**（`c4972f5...01913ee`）；如果之前克隆过 Gitee 那份，需要重新 clone
