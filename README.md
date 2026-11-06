# NEXUS

家庭服务器仪表盘：一个单容器 Web 面板，聚合 NAS 上的 Emby / qBittorrent / Transmission / MoviePilot / 代理 / 存储 / 观影历程等服务状态与数据。

- 前端 `dashboard.html`（单文件，设计令牌驱动）
- 后端 `api.py`（**纯 Python 标准库**，无第三方依赖，无 pip install）
- 数据全部落在 `/data` 卷内（`config.json`、会话、收藏、播放历史）

## 快速开始

```bash
docker run -d --name nexus \
  -p 28081:28080 \
  -v ./data:/data \
  --restart unless-stopped \
  nexus:2.1.0
```

浏览器打开 `http://<host>:28081/`。首次启动会生成 `config.json`，服务连接、代理、TMDB Key 等均在「设置」页配置。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DASH_API_PORT` | `28080` | 容器内监听端口 |
| `DASH_DATA_DIR` | `/data` | 配置与数据目录（建议挂卷持久化） |
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

# 打发布 tag（Docker Hub + 阿里云 ACR 双推）
docker tag nexus:2.1.0 <dockerhub-user>/nexus:2.1.0
docker tag nexus:2.1.0 <dockerhub-user>/nexus:latest
docker tag nexus:2.1.0 registry.cn-hangzhou.aliyuncs.com/<acr-namespace>/nexus:2.1.0
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
