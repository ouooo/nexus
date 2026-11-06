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
| `TZ` | 容器默认 | 时区，建议 `Asia/Shanghai` |

## 挂载说明

只有 `/data` 是必需的。其余挂载（媒体目录 `/m1~m8`、`/mp-config`、`/qb`、`/tr` 等）都取决于你要接入哪些服务，见 `docker-compose.example.yml` 里的注释示例。**不要**直接照搬别人的整套挂载表。

## 构建与发布

```bash
# 唯一构建定义，基础镜像已用 digest 锁定
docker build \
  --build-arg GIT_REVISION=$(git rev-parse --short HEAD) \
  --build-arg BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  -t nexus:2.1.0 .

# 打发布 tag 并推送
docker tag nexus:2.1.0 bonanzalee/nexus:2.1.0
docker tag nexus:2.1.0 bonanzalee/nexus:latest
docker push bonanzalee/nexus:2.1.0
docker push bonanzalee/nexus:latest
```

`latest` 只跟随最新稳定版本，不跟每次提交。

## 版本

当前 `2.1.0`。变更记录见 `CHANGELOG.md`；页脚、镜像 label 与本文件版本号保持同一口径。

## 安全说明

- 容器当前以 root 运行（保持与既有 NAS 部署的 `/data` 属主兼容）。若在自有环境运行，建议改为非 root 并 `chown` 卷目录。
- `config.json` 内含服务凭据，请勿提交到仓库，也不要放进构建上下文（`.dockerignore` 已拦截 `.env`）。
- 仓库与镜像内**不含任何作者的个人环境信息**：内网 IP、设备型号、真实 API Key、个人目录路径均已清除或改为通用占位。
- 观影历程「抽卡」默认**每天一次**（`journey.daily_limit = true`）。把它关掉可连续抽卡，这是给调试/演示用的开关，默认值为开。

## 许可证

MIT，见 `LICENSE`。
