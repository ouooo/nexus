# Changelog

## 2.2.1 — 2026-11-07

站点搜索加固：**流控防封号 + 可理解可补救的故障诊断 + 插件化加站/保活**。

### 新增
- **站点流控**（`search_engine.py`）：单站最小请求间隔（默认 3s，站点可用 `requestDelay` 覆盖）、全局出站令牌桶、`429 / Retry-After` 识别后自动站点冷却（不消耗熔断次数）、连续失败指数退避 3→6→…→300s。因间隔/配额主动跳过的轮次不计入站点健康度。
- **结构化诊断**：新增 `DIAG_CATALOG`（dns / tls / timeout / auth / ratelimit / challenge / http / parse / api / throttle-skip / busy / disabled / unknown），每条含「人话原因 + 证据 + 一个可执行动作」。关键区分：`403` 到底是 cookie 失效（响应体是登录表单）还是被风控（响应体是挑战页/429）——判错会引导用户做错事。证据只留状态码、最终 URL（去 query）、响应前 90 字，长十六进制串打码，**绝不落 cookie**。
- **前端站点状态条**：搜索结果上方显示「本轮 N 站正常 / X 站需处理 / Y 站因流控跳过」，展开可按站看原因、动作与证据，并可「重测这站」（`POST /api/search/pt/sites/test`）。
- **`/api/sites/import`**：浏览器插件一键导入端点（`settings:manage`），同时接收站点定义与插件实测探针，落 `sites.json` 与健康度。
- **CookieCloud 双写**：`POST /cookiecloud/sync` 除更新 MoviePilot `site` 表外，现同步刷新 `/data/sites.json` 的 cookie（按域名精确 + 主域/子域双向匹配），搜索立刻用上新登录态；响应新增 `sites_updated`。
- **浏览器插件 `nexus-extension/`**（私有分发，不上商店）：读真实浏览器 cookie → 实测一次该站搜索 → 推送到 NEXUS；支持一键导入当前站、全部重测、立即保活、查看 NEXUS 健康度；后台每 30 分钟保活。

### 变更
- `search_all` 支持 `with_stats=True`，返回每站 `{code,label,reason,action,evidence,ms,count}`；`/api/search/pt` 响应新增 `diag` 字段（旧字段 `results` 不变）。
- 缓存结构扩为 `(时间, 结果, 统计)`，`_merge_pending_into_cache` 同步合并统计；后台补齐的站点不再误报「还在后台补齐」。

### 修复
- `parse` 误报：关键词确实无资源时不再被判成「解析规则对不上」，改用详情链接密度（≥20 条却提取不出结构）判定真实改版。
- 全局令牌桶 burst 由 14 调到 48：一次全站搜索（40 站级）不会因自家配额被误跳过。

## 2.1.0 — 2026-11-07

首个可镜像化发布版本。以 28081 线上运行态为唯一基线归一源码，结束"源码目录落后约一周、靠 docker cp 覆盖运行"的历史。

### 新增
- **服务分类名称可在设置页配置**：设置 →「服务与连接」→「🏷️ 服务分类名称」，可把 `SA` / `DS` 这类设备分组标题改成「主力 NAS」「备份机」这类易读名；留空回落默认 `SA 服务` / `DS 服务`。仅影响显示，不改设备识别与端口配置。
- 后端配置项 `device_titles`（键最长 40、值最长 60，空白值不落盘），已接入默认配置、`load_config`、`/api/config` 的 GET 与 POST 白名单，保存后即时生效、重启后保持。

### 修复
- 服务页按设备分组：非 `SA/DS` 的设备此前不会渲染分组，现按"已知设备优先 + 其余兜底追加"显示。
- 观影历程抽卡背面、`journey` 主按钮、`jw-act` 三处硬编码 `border-radius:10px` 改为 `var(--radius-xs)`，设计令牌门禁"10px 残留为 0"成立。

### 隐私
- 清除源码中的个人环境信息：内网 IP（设备识别兜底 `match`）、硬件型号字样（变量名同步为 `DS_HOST`）、真实 TMDB API Key 形式的占位示例、个人目录路径（群晖卷路径 → 容器 `/data` 路径）。
- 图片代理绕过逻辑由"硬编码本机 IP"改为"私有网段通用判断"（RFC1918 + CGNAT `100.64/10`），他人部署不需要改代码即可走代理。
- 新增 `LICENSE`（MIT）。

### 工程
- 统一版本号口径：页脚、镜像 label 统一为 `2.1.0`（此前页脚 `v2.0.0`、镜像 label `1.0`、评估报告 `v3.0` 三处互相矛盾）。
- 合并历史上分叉的两份 Dockerfile 为单一构建定义，基础镜像改为 `python:3.12-alpine@sha256:4c4712…` digest 锁定。
- 新增 `.dockerignore`（白名单式），把 `.env`、备份文件、截图与 `_walk` 全部挡在构建上下文外。
- 新增 `docker-compose.example.yml`（最小可运行，仅 `/data` 必需），替代与站点强耦合的 17 挂载版本。
- 镜像内容与运行态一致性校验：以镜像启动容器后逐个校验 `/app/{api.py,dashboard.html,index.html}` 的 md5 与线上运行文件一致。
