# NEXUS

家庭服务器仪表盘：一个单容器 Web 面板，聚合 NAS 上的 Emby / qBittorrent / Transmission / MoviePilot / 代理 / 存储 / 观影历程等服务状态与数据。

- 前端 `dashboard.html`（单文件，设计令牌驱动）
- 后端 `api.py`（**纯 Python 标准库**，无第三方依赖，无 pip install）
- 数据全部落在 `/data` 卷内（`config.json`、会话、收藏、播放历史）

## 快速开始

```bash
docker pull bonanzalee/nexus:2.1.0

docker run -d --name nexus \
  -p 28081:28080 \
  -v ./data:/data \
  --restart unless-stopped \
  bonanzalee/nexus:2.1.0
```

浏览器打开 `http://<host>:28081/`。

## 首次登录

首次启动**不会**生成 `config.json`：配置先在内存里用默认值跑起来，同时在日志里打印一个随机初始口令（用户名 `admin`，**只打印这一次**）：

```bash
docker logs nexus 2>&1 | grep 初始口令
```

登录后请立刻改密码，并在「设置」页保存一次。**保存之前重启容器会重新生成口令**，之前那个就失效了；保存之后配置落到 `/data/config.json`，重启沿用。

服务连接、代理、TMDB Key 等都在「设置」页配置；服务地址也可以用环境变量预置（见下表），容器里没有内置任何个人配置。

## 环境变量

优先级：**环境变量 > `/data/config.json`（设置页里填的值）**。全部可留空，留空就在设置页里配。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DASH_API_PORT` | `28080` | 容器内监听端口 |
| `DASH_DATA_DIR` | `/data` | 配置与数据目录（建议挂卷持久化） |
| `DASH_EMBY_HOST` | 空 | Emby 地址，如 `http://emby:8096` |
| `DASH_EMBY_API_KEY` | 空 | Emby API Key |
| `DASH_EMBY_USER_ID` | 空 | Emby 用户 ID（观影历程用） |
| `DASH_QB_HOST` | 空 | qBittorrent Web API 地址 |
| `DASH_QB_USER` / `DASH_QB_PASS` | 空 | qB 用户名 / 密码 |
| `DASH_QB_API_KEY` | 空 | qB API Key（新版本 qB 可用它代替账号密码） |
| `DASH_SA_HOST` / `DASH_DS_HOST` | `127.0.0.1` / 空 | 主机地址，用于服务分组与探测 |
| `DASH_MP_DB` | 空 | MoviePilot `user.db` 路径（挂载后启用订阅查询） |
| `DASH_MP_SUB_SCRIPT` | 空 | 向 MoviePilot 添加订阅的写库脚本路径 |
| `DASH_PROXY_URL` | 空 | 出站代理（TMDB、海报图片走它） |
| `DASH_TMDB_API_KEY` | 空 | TMDB Key，也可在设置页填 |
| `DASH_SCRIPTS_DIR` | 空 | 脚本目录，挂载后启用「脚本」页 |
| `DASH_TLS_CERT` / `DASH_TLS_KEY` | 空 | 证书与私钥路径。**设了就自己上 HTTPS**（TLS1.2+），不必再套反代；也可写进 `config.json` 的 `tls.cert/key`。加载失败会打 `[CRITICAL]` 并回退 HTTP |
| `DASH_WRITE_ALLOW_CIDRS` | 内网 | 允许写站点库 / CookieCloud 推送的来源网段，逗号分隔，`*` 全放行。默认 `127/8,10/8,172.16/12,192.168/16,100.64/10,fc00::/7,fe80::/10`；也可写 `config.json` 的 `security.write_allow_cidrs` |
| `TZ` | 容器默认 | 时区，建议 `Asia/Shanghai` |

## 挂载说明

只有 `/data` 是必需的。其余挂载（媒体目录 `/m1~m8`、`/mp-config`、`/qb`、`/tr` 等）都取决于你要接入哪些服务，见 `docker-compose.example.yml` 里的注释示例。**不要**直接照搬别人的整套挂载表。

## 站点搜索（PT）

搜索在 NAS 侧完成，浏览器只负责展示。要点：

- **流控**：单站默认 3 秒最小间隔（站点可配 `requestDelay`，设 0 关闭），全局限速令牌桶；遇到 `429` 按 `Retry-After` 给该站冷却，连续失败指数退避（3 秒起、最长 5 分钟）。被流控**主动跳过**的轮次不计入站点健康度，避免"因为自己慢就把站点判死"。
- **可补救的诊断**：结果上方有站点状态条，每站给出「人话原因 + 证据（状态码 / 最终 URL / 响应片段）+ 一个可执行动作」，并可「重测这站」。诊断码：`dns` `tls` `timeout` `auth` `ratelimit` `challenge` `http` `parse` `api` `throttle-skip` `busy` `disabled` `unknown`。`403` 会先判是不是反爬挑战页、再判是不是登录页——两者补救动作完全不同。
- **站点管理**：在「设置 → 服务与连接 → 🔍 站点搜索」卡片里，作为「站点搜索」这个搜索源自身的配置（与「服务分类名称」「常用服务」同级）。可启停、看状态与「原因 → 动作」、单站重测、编辑（引擎族/搜索路径/关键词参数/该站最小间隔/该站超时/是否允许自签名证书/Cookie）、删除。站点副标题会标出「跳过证书校验」「Xs 超时」。搜索结果上方的状态条只报「本轮结果」，点它的「管理站点 ›」跳到该卡片；保存后引擎即时生效，无需重启容器；清单默认折叠 12 行，筛选或编辑时自动全展开。
- **加站两条通路**：① 浏览器插件（见下）；② CookieCloud（`POST /cookiecloud/sync`，同一份数据既刷新 MoviePilot 站点表，也刷新本服务的站点 cookie）。
- **cookie 怎么存**：`/data/sites.json` 里的 cookie 加密落盘（`v1:<base64>`），密钥单独存 `/data/.vault_key`（32 字节、权限 600），两个文件都收到 600。构造是 HMAC-SHA256 计数器流加密 + encrypt-then-MAC（标准库没有 AES-GCM）。换机器只拷 `sites.json` 不拷 `.vault_key` 会解不开——每个站按「没有 cookie」处理，重新登录即可，不会崩。
- **接口**：`GET /api/search/pt?q=`（响应含 `results` 与 `diag`）、`GET /api/search/pt/sites`（每站 `state/reason/diag/has_cookie/search`）、`POST /api/search/pt/sites`（增改/局部更新/`remove`/`replace`，默认增改不删）、`POST /api/search/pt/sites/test`（单站实测）、`POST /api/sites/import`（插件导入，**默认增改不删**，清空需显式 `replace`；只接受内网来源）。

### 浏览器插件（`nexus-extension/`）

服务端拿不到"已登录浏览器里的 cookie"，也过不了 Cloudflare 挑战。插件补齐这一环：读当前浏览器 cookie → 在真实浏览器里实测一次该站搜索 → 一键推送到 NEXUS（`/api/sites/import`），之后每 30 分钟自动保活（cookie 变了就重推）。

插件是**私有分发**（Chrome/Edge 加载已解压扩展），不进商店：`cookies` 权限上商店会被审核卡住，也更容易被误认为在收集凭据。安装与权限说明见 `nexus-extension/README.md`。

## 构建与发布

```bash
# 唯一构建定义，基础镜像已用 digest 锁定
docker build \
  --build-arg GIT_REVISION=$(git rev-parse --short HEAD) \
  --build-arg BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  -t nexus:2.2.5 .

# 打发布 tag 并推送
docker tag nexus:2.2.5 bonanzalee/nexus:2.2.5
docker tag nexus:2.2.5 bonanzalee/nexus:latest
docker push bonanzalee/nexus:2.2.5
docker push bonanzalee/nexus:latest
```

`latest` 只跟随最新稳定版本，不跟每次提交。

## 版本

当前 `2.2.5`。变更记录见 `CHANGELOG.md`；页脚、镜像 label 与本文件版本号保持同一口径。

## 安全说明

- 容器当前以 root 运行（保持与既有 NAS 部署的 `/data` 属主兼容）。若在自有环境运行，建议改为非 root 并 `chown` 卷目录。
- `config.json` 内含服务凭据，请勿提交到仓库，也不要放进构建上下文（`.dockerignore` 已拦截 `.env`）。
- 仓库与镜像内**不含任何作者的个人环境信息**：内网 IP、设备型号、真实 API Key、个人目录路径均已清除或改为通用占位。
- 观影历程「抽卡」默认**每天一次**（`journey.daily_limit = true`）。把它关掉可连续抽卡，这是给调试/演示用的开关，默认值为开。
- **明文 HTTP 下密码与会话令牌可被同网段嗅探**：局域网里合规的做法是设 `DASH_TLS_CERT` / `DASH_TLS_KEY`（内置 HTTPS）。容器内生成自签证书：`openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=nexus" -keyout /data/tls/key.pem -out /data/tls/cert.pem`，然后把两个变量指过去，首次访问在浏览器里信任该证书即可。
- **会话**：网页登录令牌 30 天、插件令牌（登录时带 `X-Nexus-Client: extension`）7 天，都按使用滑动续期。设置 → 鉴权 →「🔑 已授权客户端」能看到每个客户端的类型/最近使用/到期，并单条撤销；列表只给会话 id（令牌 sha256 前 12 位），不回显令牌本身。
- **写端点来源**：`/api/sites/import` 与 `/cookiecloud/sync` 默认只接受内网来源（本机 / RFC1918 / Tailscale `100.64/10` / IPv6 ULA），公网来源直接 403。要放到公网并让外部推送，得显式改 `DASH_WRITE_ALLOW_CIDRS`——但那也意味着要先解决传输层加密。
- **CORS**：响应只给同源与浏览器扩展来源，不再是 `*`。

## 许可证

MIT，见 `LICENSE`。
