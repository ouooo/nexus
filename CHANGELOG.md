# Changelog

## 2.2.11 证书热重载：续期后自动加载新证书，不再需要人工 restart — 2026-11-09
### 症状 / 需求
证书改成挂载 derper 目录（2.2.9）之后，「文件能读到新的」这半截解决了，但 `api.py` 只在启动时 `load_cert_chain` 一次 —— acme 续期后进程仍在用旧证书，表现为「续期成功、浏览器还报旧证书」，必须人工 `docker restart nexus-test`。

用户提出的关键要求：**这个能力要长在 NEXUS 里，而不是外挂一个 acme hook —— 谁部署只要把证书路径挂进容器就自动读新的。**

### 改法（`api.py`）
- 启用原生 HTTPS 后起一个 `cert-watch` 守护线程，按 `(inode, mtime_ns, size)` 三元组比对证书与私钥；
- 变化即 `os.execv` 重启自身进程重建 SSLContext（与既有 `/api/restart` 同一套做法：PID 不变，容器状态与 `--restart` 策略都不受影响）；
- 之所以盯着 **inode**：acme 续期是「写临时文件 → rename」，rename 必换 inode，这正是单文件 bind mount 永远读旧证书的根因；
- `DASH_TLS_HOT_RELOAD=0` 可关闭；`DASH_TLS_HOT_RELOAD_INTERVAL` 调轮询间隔（默认 60s，验证时用 5s）。

### 验收（实测，临时容器 + 自签证书模拟 acme rename）
- 初始 `https://127.0.0.1:18100/` → **200**，证书指纹 `2ba7e1f58fe18189`；
- `mv` 换证书后 inode `168178 → 168185`；
- 5s 轮询命中，日志：`证书已更新（inode/mtime/size 变化），2 秒后重启进程加载新证书`；
- 重启后指纹 **`92e8284ac161f979`**（新证书已生效），`/proc/1/comm` 仍为 `python3`（PID 1 保持，容器没重启）；
- 日志连续两次出现 `NEXUS API 服务启动` + `已启用原生 HTTPS`，证明是进程真的重新加载了证书。

### 为什么不做 acme hook
钩子必须挂在部署方（acme 容器 hook 或 NAS 定时任务），换个部署方式就得重新配一遍；而且 hook 只知道「证书文件变了」，不知道「NEXUS 到底用不用这份证书」。做在进程里则相反：只要 `DASH_TLS_CERT` 指向的文件被替换就自动生效，与谁签发、怎么续期无关。

## 2.2.10 私有 JSON 搜索接口 + 健康检查自适应 + 插件入仓 — 2026-11-08

### 症状 / 需求
- **馒头（M-Team）这类私有 JSON API 站搜不出结果**：站点定义里已经写了 `method: POST`、`contentType: application/json`、`body: {pageNumber:1,pageSize:100}`，但服务端 `_build_request()` 不管 `contentType` 一律 `urlencode`，实际发出的是 `k=v&k=v`，对端解析不到 JSON 就返回空。
- **容器一开原生 TLS，健康检查就永远失败**：镜像里 `HEALTHCHECK` 写死探 `http://127.0.0.1:28080/`，于是容器显示 `unhealthy` 而服务其实正常，每次 pull 重建都得手工补一句 `--health-cmd` 才能绕过。
- **浏览器插件只有散落的裸文件，没有进任何仓库**。

### 改法
- `search_engine.py::_build_request()`：`contentType` 含 `json` 时改用 `json.dumps(..., ensure_ascii=False)`；`body` 里非字符串值（`pageNumber`/`pageSize`）原样保留类型，只对字符串做 `{keyword}` 替换。旧实现的 GET、表单 POST 路径一字不动。
- `Dockerfile`：`HEALTHCHECK` 按 `DASH_TLS_CERT` 是否存在自动选 `https` / `http`（https 用不校验证书的 context，避免内网/自签场景误报）；`LABEL version` 升到 `2.2.10`。
- 新增 `extension/`：浏览器插件 1.2.10 入仓（站点定义小表 `SITE_DEFS` + 不覆盖已有配置 + 出厂不带任何具体地址）；`.gitignore` 为 `extension/**/*.png` 开例外，其余 `*.png` 仍然不入库。

### 验收
- `_verify_build_request.py` 13/13 ALL PASS：馒头 URL、`POST`、`Content-Type: application/json`、body 内 `keyword` 命中、`pageNumber` 仍为数字、回退候选路径；NexusPHP GET 与表单 POST 回归不变。
- `_verify_sitedefs.mjs` 23 项 ALL PASS（表命中 / 相似域名不误命中 / 深拷贝隔离 / 空 cookie 不带字段 / 旧默认升级 / 手调定义不动 / 重测不带定义）。
- 真实 Chromium 加载插件：`_verify_ext_popup.py` **0 FAIL**（缓存重开、实时跑码、日志区固定高度）。

### 已知遗留
- 插件默认地址已改为空（首次必须自己填），协议填反了会双向自愈（https ↔ http）。
- 原生 HTTPS 实例要用**域名**访问：证书 SAN 只覆盖域名，用 IP 会 `certificate verify failed: IP address mismatch`。

## 2.2.9 搜索筛选条：从结果集动态提取标签 chip（hc19）— 2026-11-08

### 症状 / 需求
- `#dynamicFilterRow.search-filter-chips` 只有静态条件（PT 是 做种≥100 / 4K / 1080p / BluRay；网盘是 有/无提取码；在线是 低端影视 / 域名直连），结果里明明带着归类信息却要用户自己翻。
- 口径（用户原话「就这么做」，并强调「注意不是要你瞎取啊」）：**只取结果里本来就有的稳定字段**，不解析标题猜 HDR / 国语这种。
  - PT → `category`（站内栏目：电影 / 剧集 / 纪录片…）
  - 网盘 → `type` 经 `PAN_TYPE` 映射成中文网盘名（阿里云盘 / 夸克网盘 / 磁力…）
  - 在线 → `source`（低端影视 / 域名直连）

### 改法（`dashboard.html`，紧跟 `_flipLabelOf` 的三个函数 + 四处接线 + 浮层）
- 三个函数：
  - `_tagValueOf(r, source)`：按来源取字段。网盘那条**内置兜底映射表**（`window._PAN_TYPE` 缺失时自建 aliyun→阿里云盘 等 15 项）——主搜索页的 `PAN_TYPE` 是 `renderGenericResults` 的局部 const，不写 window，不兜底就会显示英文 key `aliyun`（验首轮就栽在这）。
  - `collectResultTags(results, source, minCount=2)`：计数 → 只留出现 ≥2 次 → 次数降序 + 同次数按 `localeCompare(...,'zh-Hans-CN')` 升序。
  - `renderResultTagChips(source, results)`：清掉上一轮 `[data-tag]` → 与静态 chip 同名去重（在线 `source`=「低端影视」与静态条件同名，不去重会重复一行）→ 上次选中的标签在新结果集里消失则自动清空 `window._tagFilter`。
- 接线：
  - `setupFilterBar(source)` 末尾重置 `window._tagFilter = ''`（标签属于上一轮结果集，新搜索必须清）；
  - `applySearchFilterSort(results, source, filter, sort, sortDir, tag)` 加第 6 参，先按 `String(_tagValueOf(r, source)) === String(tag)` 精确过滤，再走原有静态筛选与排序；
  - `renderGenericResults()` 开头渲染标签 chip，并把 `_tagFilter` 传给筛选；
  - 通用点击监听新增 `data-tag` 分支（toggle 高亮 / 赋值 / `updateFilterBadge()`）；静态 `data-filter === 'all'` 时把标签维度一并清掉；徽标计数改为「静态 1 + 标签 1」。
- 浮层（`#flipSearchBody` 里的工具栏）：
  - `_flipState` 增 `tag:''`；`window.flipPickTag(el)`（再点取消）；`flipPickFilter` 在 `filter==='all'` 时清 `st.tag` **并把 `#flipTagChips` 高亮切回「全部」**（第一版只清数据没同步高亮，验收 FAIL 后补的）；`renderFlipResults` 把 `st.tag` 传给筛选、底部「已筛选」条件也算上它。
  - 新增「标签」行，仅 `tagItems.length > 1 && source !== 'pansou' && source !== 'online'` 时出现：浮层的「站点」行对网盘就是网盘类型中文名，再给一行标签是同一维度重复；在线只有 `source` 一维且与静态同名。
- 视觉：动态 chip 加 `.pt-tag-chip`（`gap:5px`）+ 计数 `.tag-n`（opacity .5 / 11px），与静态 chip 同款但计数弱化；不带空格拼接后计数不再被挤在一起。

### 验收（生产 hc19，两套脚本，合计 FAIL 0）
- `_verify_tagchips.py`（主搜索页，15 项 OK）：PT 注入 13 条 → 标签 `电影6 / 剧集4 / 纪录片2`（空 `category` 与仅 1 次的「纪录片」边界样本按规则不生成第三条以外的项）；点「电影」→6 条 + 高亮 + 徽标 1；再点静态 4K → 3 条 + 徽标 2；点「全部」→13 条且标签清空、徽标 0；点「剧集」→4 条；再点一次→13 条。网盘 9 条 → `阿里云盘5 / 夸克网盘3`（只有 1 条的「百度网盘」不出现），点「阿里云盘」→5 条。在线 6 条 → 因与静态条件同名而不重复生成标签行。
- `_verify_flip_tag.py`（浮层，`pg.route('**/search/pt*')` 喂 12 条 JSON 走真实 `flipSearch` → `flipSearchGo('pt')`，6 项 OK）：标签行 `全部 / 电影6 / 剧集4 / 纪录片2`、12 条；点「电影」→6 条 + 高亮；点静态「全部」→12 条且标签回「全部」。
- 截图：`_preview/v229v_tags_pt.png`、`v229v_tags_pt_filtered.png`、`v229v_tags_pansou.png`、`v229v_flip_tags.png`。
- 现场限制：PT 站点大面积 cookie 失效（本轮 38 站用了 17 站，PTSKit / 吐鲁番 登录态失效、UBits challenge、audiences.me 被挡、Rousi pending），`/api/search/pt` 真实返回 0 条；网盘 / 在线也几乎空。所以标签聚合的真实样本只能靠注入与网络拦截构造，**等 cookie 恢复后才有真实标签可点**。

### 上线
- `nexus:2.2.9-hc19` = `808c7a549597`（源 `nexus:2.2.9-build22` 同 ID），容器 `nexus-test` = `8b6a388409a3`，`28081→28080`，`healthy`，17 挂载 / 15 个 `DASH_*` 与原样一致；备份目录 `_backup_20261108_229v`。
- 本轮共 5 次构建（每次 `--dry-run` 先行 + 停旧容器改名回滚点），最终回滚点保留 `nexus-test-pre-229v-1794119846`（hc18 / `577b659fd490` / 容器 `48d60d512937`）；中间 4 个临时回滚点与对应悬空镜像已删。
- `dashboard.html` 现值 sha256 `3f384ebfd0db487d…`（NAS `/tmp/nexus-build/dashboard.html` 与容器内 `/app/dashboard.html` 逐字节一致）。
- 未做：本轮改动**未 commit / 未 push**，ghcr `2.2.9`/`latest` 仍是 hc14 时期源码。

## 2.2.9 详情页右侧评分卡低屏适配（hc17 → hc18）— 2026-11-08

### 影视详情页右侧评分/元信息卡：高度固定 + 卡内滚动 + 底部 24px 间距
- 症状：右侧卡高度随 `metaRows` 行数增长（同片 15 行时实测恒 600px），1440x900 时底部越出屏幕 13px、1280x700 越界 213px、1024x640 越界 273px，低屏看不到「文件路径」等末尾字段。
- 改法（与左侧简介滚动区同口径）：
  - 右列容器 `.detail-side` 加 `min-height:0; overflow:hidden;`（高度由内容区 flex 撑满）；
  - 卡加 `class="detail-side-card"` → CSS `height:100%; box-sizing:border-box; overflow-y:auto; overscroll-behavior:contain;`（超出在卡内滚）；
  - 内容区 flex 的父级本就 `min-height:0`，所以卡高 = 内容区高 − 上下内边距，卡底始终距屏幕底 24px（容器 `padding:16px 24px 24px 0`）。
- hc18 追加：滚动容器底部 `padding` 在滚到底时会被裁掉 15px，末尾 `::after` 补 12px 占位（卡内 padding 改 `16px 20px 12px`），保证滚到底最后一行完整可见。
- 验收（生产 hc18，`_verify_229t_detailcard.py`，三视口 1440x900 / 1280x700 / 1024x640，FAIL 0）：
  - 卡底不越屏 ✔；底间距恒为 24px ✔；卡高 = 左侧滚动区高 − 40（16+24）✔；
  - 低屏 `scrollH 606 > clientH 291/231` 可内滚 ✔；滚到底最后一行（单集时长）完整可见 ✔。
  - 改前基线对照：同一脚本在 hc16 上 FAIL 13 项（底间距 −13 / −213 / −273px，卡高恒 600px）。
- 上线：`hc17` = `nexus:2.2.9-hc17`/`adefbf856b98`（容器 `6f3d8f73a519`，备份 `_backup_20261108_229t`）→ `hc18` = `nexus:2.2.9-hc18`/`577b659fd490`（容器 `48d60d512937`，备份 `_backup_20261108_229u`）。
- `dashboard.html` 现值 1018107 B / sha16 `903783cbc9eced86`；NAS `/tmp/nexus-build/` 已同步（旧档留 `dashboard.html.bak.hc16`）。
- 未做：本轮改动**未 commit / 未 push**，ghcr `2.2.9`/`latest` 仍是 hc14 时期源码。

## 2.2.9 站点排序三档（hc15 → hc16）— 2026-11-08

### 站点搜索「排序」chip 增加第三档「正常优先」
- 原只有两档：`异常优先`（rank ok=3/off=2/warn=1/cool=0 升序，正常站垫底）与 `按名称排序`。
- 新增 `正常优先`（`fast`）：正常站（`state=ok`）全部排前，组内按后端 `health_snapshot()` 的 `last_ms`（上次实测延迟）升序；没有延迟记录的站排在正常组末尾，再按名称；非正常站之间按名称。
- `toggleSiteSort()` 改三档循环 `risk → name → fast → risk`；chip 文案走 `SORT_LABEL = {risk:'异常优先', name:'按名称排序', fast:'正常优先'}`。
- hc16 追加：`fast` 档下每行尾巴显示 `上次 N ms`（`_siteSub` 内按 `window._ptSortBy === 'fast' && s.state === 'ok'` 加），排序依据肉眼可核对；其余两档文案不变。
- 验收（生产 hc16，实跑）：`异常优先` 正常站全在末尾 ✔；`按名称排序` 名称严格升序（用页面自身 localeCompare 判）✔；`正常优先` 正常组 15 站全在前、延迟序列 `303 → 544 → 645 → 723 → 804 → 946 → 1345 → 1453 → 1822 → 2627 → 2764 → 3140 …` 非降、无延迟的排组末 ✔；三次点击循环回 `异常优先` ✔；FAIL 0。
- 上线：`hc15` = `nexus:2.2.9-hc15`/`faad0c48bb77`（容器 `ace9497b48fd`）→ `hc16` = `nexus:2.2.9-hc16`/`fcee45ecc203`（容器 `194cdc74317b`），回滚点 `nexus-test-pre-229r` / `-pre-229s`。
- 注意：这两轮的 `dashboard.html`（1017330 B，sha16 `b362617fcb56a8ec`）**尚未 commit / push**，ghcr 上的 `2.2.9`/`latest` 仍是旧 dashboard。

## 2.2.9 — 2026-11-07

### 镜像发布上线：ghcr.io/ouooo/nexus（Actions 云端构建）
- 出口结论：NAS 与 Windows 都到不了 `registry-1.docker.io`（TLS 被掐），Docker Hub 这条路走不通；ghcr 反而直连可用（NAS 实测 `GET /v2/` 401、0.6s）。
- 凭据结论：现有 `GH_TOKEN` 是 GitHub CLI 的 `gho_…`，`x-oauth-scopes: repo`——只有 repo。ghcr 的 `POST /v2/ouooo/nexus/blobs/uploads/` 实测 `403 permission_denied`（能读不能写）；且带 workflow 文件的提交被 GitHub 拒绝（`without 'workflow' scope`）。**两条路都堵在这个 token 上**。
- 落地：改走 GitHub Actions，用仓库自带的 `GITHUB_TOKEN` + `permissions: packages: write`，不依赖 NAS 出口、不需要 PAT。`.github/workflows/docker-publish.yml`：`workflow_dispatch`（可选 tag 输入）+ `push: tags: v*`；`docker/login-action` 登录 ghcr；`build-push-action` 打 `:<version>` + `:latest`、gha 缓存、写入 `GIT_REVISION`/`BUILD_DATE` 与 source/revision label。
- 首跑：run `42446858637`，9 个步骤全绿，`conclusion=success`。
- 验收（真拉真起）：NAS `docker pull ghcr.io/ouooo/nexus:2.2.9` 成功（Digest `sha256:4333c1fe…`，本地镜像 `df8a035e6fe7`，51.2MB）；新建**空数据目录**起容器，首次启动即 `healthy`、`restarts=0`、`GET / → 200`、`/api/config → 401`（首装生成随机初始口令、默认开认证，属预期）。
- 一致性命中：镜像内 `api.py` / `dashboard.html` / `search_engine.py` 三个 sha256 与线上 hc14 容器**逐字节一致**。
- 顺手修掉一个会让云端构建必失败的坑：`.dockerignore` 白名单漏了 `search_engine.py`（`COPY search_engine.py` 会 `not found`），已补 `!search_engine.py`（commit `8402d0c`）。

### 站名清洗静默失效的根因（hc14）
- 症状：hc13 里 `_site_display_name` 明明存在、调用点也在，插件推上来的标签页标题却照样入库（8 条 `BTSCHOOL :: 查看主题 …`）。
- 根因：`api.py` 只 `import urllib.parse`，没导入 `urlsplit`；`_site_display_name` 里 `urlsplit(...)` 抛 `NameError` 被自己的 `except` 吞掉 → `host` 恒为空 → `bad` 分支只能退回原串，等于**永远不清洗**。这也解释了为什么「清洗脚本跑完 0 残留、过一会又变回标题」。
- 修：改用 `urllib.parse.urlsplit`；`bad` 且取不到 host 时，先从标题里抠域名（`1PTBA.COM :: 首页 …` → `1ptba.com`），再退到分隔符前的短片段（`BTSCHOOL :: 查看主题 …` → `BTSCHOOL`）。
- 读取端 `pt_sites_health()` 也对 `name` 过一遍清洗，库里残留旧值不会先显示成标题。
- 验收：43 站全量提交（只带 id，服务端重算站名）后磁盘与接口「可疑 0 条」；再故意推 `ZZ :: 首页 …` 类标题名，接口当场返回 `pt.btschool.club`。

### 插件图标：透明底 + 加饱和（1.2.4）
- 用户第三次强调：图标要像左侧导航栏顶部 logo，透明底，不要白底瓦片。
- `_icons_transparent.py`：从 `dashboard.html` 的 favicon base64 取星形 → 裁 alpha bbox → 6% 内边距 → 保 alpha 重上色（`#1452F6 → #009E9E` 品牌蓝→青，仅 22% 向白提亮）→ 16/32/48/128/256。
- 透明像素 62.9%（16px）/ 75.2%（32px）/ 79.8%（48px）/ 81.8%（128px），四角 alpha 全 0；白底亮度差 128.7、深底 98.1、浅灰 98.9，三种底色上都看得见。
- 插件 `manifest.json` 版本 1.2.4，zip 61264 B / 13 条目 / sha16 `4b2c408f1c25c7ff`。

### 站点卡：长站名/长诊断不再顶出卡片（hc13）
- 症状（用户截图复诉）：诊断长句越到卡右缘之外、「测试」按钮悬在卡外；媒体库统计块 1310px 宽下仍 2+1 换行；站点名被写成标签页标题。
- `#ptSitesCard .pt-main` 补 `overflow:hidden`，`.pt-line` 补 `overflow:hidden`；`.pt-name` 由 `flex:none` 改 `flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis`（超长站名截断而不是把整行顶宽）；`.pt-reason` 补 `overflow-wrap:anywhere; word-break:break-word`。
- 验收：1310 / 1440 / 1024 三个宽度、43 行实测 **越界行 0、按钮出界 0**。

### 媒体库统计块：固定三列（hc4 之后第三次复诉的收口）
- `.lib-stats` 主规则 `repeat(auto-fit, minmax(108px,1fr))` 会被 `auto-fit` 在 1310px 算成 2+1；改为 `grid-template-columns:repeat(3, minmax(0,1fr))`，768 / 480 两档断点同步改成 `repeat(3, minmax(0,1fr))`。
- 新增 `@media (max-width:400px)`：`num` 17px、`cat` 10.5px、`padding 10px`，保证手机上三项仍并排。
- 验收：1310px 下 `1,270 / 957 / 1,326` 三项同一行、同一 top。

### 站名清洗：标签页标题一律不是站名（服务端 + 插件 1.2.3）
- 服务端 `_site_display_name(name, base_url)`：长度 >20、含 `::` / ` | ` / ` - `、含「首页 / 查看主题 / 众筹 / 活动结束 / 论坛 / 登录」→ 一律退回注册域（去 `www.`）。`pt_save_sites()` 合并段统一走它，任何来源推上来的标题都进不了站点库。
- 插件 1.2.3：新增 `looksLikeTabTitle()` / `sanitizeName(name, baseUrl)` / `sanitizeLocalSites()`；`upsertLocalSite()` 写入前清洗、`pushSites()` 推送前逐条清洗、`onInstalled` 时把本地已存的旧站名就地清洗一次。
- 生产站点库 8 条历史标题式站名经产品接口清洗为域名（备份 `sites.json.bak.names2-20261107_204319`），回读 0 条残留。
- 单测 `_test_sanitize_name.js`：9 组样例（含 `1PTBA.COM :: 首页 …`、`首页 :: DIC Music`、`Arctic Global Seed Vault :: PM (…)`）全部得到域名，`百川 / 聆听 / UBits` 这类真站名原样保留。

### 服务配置地址不再编造网段（hc7）
- `config.json` 的 `svc_ports` 13 项仍是 `{"host": "", "port": N}`，而后端取 `ov.get('host', s['host'])`：键在、值为空串 → 不回落，拼出 `http://:16880`；前端 `url.split(':')[0] || '192.168.1.1'` 又把空 host 兜底成假地址，于是全站地址变成 `192.168.x.x`。
- 后端改 `_h = str(ov.get('host') or '').strip() or s['host']`（空串也回落），前端兜底改 `location.hostname`，保存侧改 `host ? {...} : { port, proto }`（不再把空字符串写回配置）。
- 验收：13 条全部 `10.31.0.88:PORT`，面板 `127.0.0.1:28080`。

### 站点测试失败后的补救入口（hc8–hc12，四轮才真绿）
- 症状：诊断说「给它标记 insecure / 改成直连」，但界面上无处可点。
- 新增 `_siteFixOps(s)` 按 `diag.code` 出按钮（`tls` → 跳过证书校验 + 自动换出口；`blocked` → 超时 10s + 自动换出口；`timeout` → 超时 10s + 自动换出口）、`fixSiteAndRetest()`、`retestAutoOutlet()`，`.pt-btn.fix` 琥珀样式。
- **必须导出到 `window`**：整个文件包在 IIFE 里，内联 `onclick` 取不到未导出函数（hc8 因此全不生效）。
- 归因重做：`greatposterwall / pt.keepfrds / pt.soulvoice` 的 `_ssl.c:993 handshake operation timed out` 是**出口把 TLS 握手掐断或太慢**，勾 insecure 救不回来（NAS 上 `curl -x 127.0.0.1:16001` 打聆音 302 但耗时 3.7s，3.5s 超时才是主因）。新增 `DIAG_CATALOG['blocked']`（文案：TLS 握手没完成（多半是太慢或被出口掐断），并明说「勾跳过证书校验没有用」），异常分流：`certificate/cert verify` → `tls`；`handshake / ssl+timeout / sslerror / unexpected_eof` → `blocked`；其余 timeout → `timeout`。
- `_diag()` 填 `{status}` 占位符（原先 404 会把 `HTTP {status}` 原样甩给用户）。
- 换出口：`search_site(..., no_throttle=False)` + `search_one(..., force_proxy=None)`，`api.pt_site_test(site_id, query='', auto_outlet=False)` 会把实际通的那条写回站点库（`proxy`），前端 toast 显示「换成走代理/直连后通了」或「两条出口都不通（直连timeout / 走代理timeout）」。
- **单站间隔会静默吃掉第二条出口**：`_site_too_soon` 把重试挡成 `throttle-skip`，因此 `force_proxy is not None` 时放开单站间隔与全局配额。
- 验收：接口 9 项全绿（归因 / 写回 / 两路 tried / 无占位符）、前端 6 项全绿（按钮集合 / 点击后真出 toast 且按钮复活）。

### 插件图标：透明底四角星（1.2.2，替换白底瓦片）
- 旧 `icon128` 全透明像素仅 3.0%，中心近白 `(176,240,239,255)`，即上文的「白底圆角瓦片 + 星标」；用户两次否决白底，要求与左侧导航栏 logo 同口径。
- `_favicon_extract.py` 从 `dashboard.html` 第 7 行 base64 解出网页真正在用的 favicon（96×96、alpha bbox `(18,16,78,82)`、蓝→青渐变四角星、90.8% 透明）；`_icons_v3.py` 裁 alpha bbox → 8% 边距 → 512 主图 → 输出 `icon16/32/48/128` + `icon256`。
- 前文 1.2.0 条目里的「白底圆角瓦片」为历史口径，现以透明底四角星为准。

### 设置页「站点搜索」卡宽度（布局错乱修复）
- 根因：`.settings-grid { display:block; max-width:840px; }` 把整列卡片锁死 840px，宽屏下右侧「测试」按钮列落在卡外、`.pt-reason` 长句右溢到卡缘外。
- 改为 `.settings-grid { display:block; width:100%; max-width:min(1180px,100%); }`：卡片随窗口放宽到 1180（上限）并在窄屏自动收缩。
- 生产实测：1440 视口 grid/卡片 = 1172；1920 = 1180；1100 = 816；三档均无横向滚动条。

### 插件扫描同步在 NEXUS 端也有回执（`last_cookie_sync`）
- `POST /api/sites/cookie-sync` 结束时报一次回执：新增 `_record_cookie_sync_receipt()` 把 `{at, client, by, domains, mp_updated, sites_updated, matched[:12]}` 写进 `config.json` 的 `last_cookie_sync`（`_atomic_write` + 重载 `CONFIG`）。
- 与 `last_site_import` 分开记：只投喂登录态时不会走 `/api/sites/import`，但网页端同样要看得到「刚才同步了几站」。
- GET `/api/config` 增出 `last_cookie_sync`。
- 前端 `paintPtImportReceipt()` 改为取两条回执里更新的那条：`插件扫描 · 同步 n 站登录态 · 站点库更新 n · MP 更新 n · MM-DD HH:MM · 命中 …`，5 分钟内补一条 toast。**双端反馈至此闭环：插件 popup/角标/options 卡 + NEXUS 设置页回执行。**

### 插件站名不再取标签页标题（1.2.1）
- 删除 `nameFromTab()`（它只按 `- | · —` 前缀截断，`::` 分隔的标题整段留下，于是出现 `1PTBA.COM :: 首页 1PTBA,…` / `首页 :: DIC Music` / `BTSCHOOL :: 查看主题 "…"`）。
- 新增 `labelFromHost(host)`（去 `www.` 返回裸域名）与 `nameForHost(host, knownNames)`（优先 NEXUS 站点库已登记名 → 域名后缀互匹 → 回落裸域名）；`scanOpenSites()` 拉完 `pullHealth()` 后建 `knownHosts` / `knownNames`，5 处调用全部替换。
- 生产 `sites.json` 8 条历史标题式站名就地清洗为裸域名（备份 `sites.json.bak.names-20261107`）。
- 插件回执：`scanOpenSites()` 写 `lastScanSummary{at,ptSynced,ptNew,douban,hosts,sitesUpdated,mpUpdated,error}`；`cfg()` 补读该键；`options.html` 新增「上次扫描回执」卡 + `options.js renderLastScan()`；有同步且无错误时工具栏绿角标显示站数，10 秒后回落。
- `manifest.json` `1.2.0 → 1.2.1`。

### 首页「媒体库」统计按容器宽度自适应（不再固定 2 列换行）
- `.lib-stats` 由 `repeat(2, 1fr)`（写死 2 列，三项必然 2+1 两行）改为 `repeat(auto-fit, minmax(108px, 1fr))`；≤768px 断点 `minmax(96px, 1fr)`、≤480px 断点 `minmax(88px, 1fr)`，两处旧的 `repeat(2, 1fr)` 覆盖已删除。
- `.lib-stat .cat`（部电影/张专辑/部剧集）加 `white-space:nowrap + ellipsis`，与 `.num` 同口径，不再出现半截换行。
- 口径：容器宽 ≥348px 时三项并排一行；更窄才回落到 2 列 / 1 列。生产实测 1440（卡片 413px）1 行、1024（卡片 323px）2 行、390（332px）1 行。

### 插件导入：双端都有回执（NEXUS 端）
- `pt_import_sites()` 结束时报一次回执：新增 `_record_import_receipt()` 把 `{at, client, added, updated, saved, probe_ok, probe_bad, names}` 写进 `config.json` 的 `last_site_import`（`_atomic_write` 后重载 `CONFIG`）。
- `pt_save_sites()` 返回值拆成 `{saved, added, updated, added_or_updated, kept}`，前端能分清「新增」与「更新」。
- GET `/api/config` 输出 `last_site_import`（与 `trend_sources` 同级）。
- 设置 → 服务与连接 → 站点搜索卡顶部新增一行 `.pt-import` 回执：`插件导入 · 新增 n 站 / 无新增 · 更新 n 站 · MM-DD HH:MM · n 站实测正常`，红点表示有站点实测失败；5 分钟内且本页未弹过时再补一条 toast。
- 前端读的是 `/api/config`（`window._ptImportCfg` 缓存），不是页面里的 `CONFIG` 常量 —— `CONFIG` 里没有这个字段，首版因此一直隐藏。

### 新增端点 `POST /api/sites/cookie-sync`（插件专用通道）
- 入参 `{cookie_data:{domain:[...]}, client}`，走 bearer 令牌 + `settings:manage` 权限，**绕开 `/cookiecloud/sync` 在 CookieCloud 密码为空时必然 401 的死结**。
- 逐域清洗（`len>=10`、剥 `www.`、截 120 字符）后合并进本站 `cookies.json`，同时 `update_mp_sites_from_cookies()` 写 MoviePilot 的 `site.cookie`，再 `search_engine.sync_cookies()` 刷站点库。
- 返回 `{ok, domains, mp_updated, sites_updated, matched[:12]}`，插件据此显示「NEXUS 站点库更新 n 个 / MP 更新 n 个」。
- `PATH_PERM` 补一条 `'/api/sites/cookie-sync': 'settings:manage'`。

### 浏览器插件 1.2.0：对标 PTD 的全量识别 + 双端反馈
- `manifest.json` 版本 `1.1.1 → 1.2.0`，描述加上「已打开站点批量识别 / NEXUS / CookieCloud / MP」。
- `background.js` 新增 `scanOpenSites()`：枚举浏览器所有标签页 → 按域名去重 → 拿 NEXUS 站点库当已知域名白名单 → 逐站读 cookie → 豆瓣单独归 `douban` 只投喂 cookie → **未知域名打一次 `probeSite(base,{query:'test'})`，真出结果才算 PT 站**（不硬编码站点规则，与 PTD 同思路）→ `SCAN_MAX`/`SCAN_GAP` 限流 → `pushCookieData()` 推新端点 + 新站 `pushSites()` → 汇总 `summary` 并 `saveCfg({lastScan})`。
- `background.js` 新增 `pushCookieData()`（打 `/api/sites/cookie-sync`，带 `X-Nexus-Client: extension`）；`pushSites()` 同样带上 client 标识。
- `popup.html` 新增结论条 `#banner` 与按钮「扫描已打开的站点并同步」。
- `popup.js` 重写：每个按钮都有载入态、成功/失败结论条与日志，推送后显示「NEXUS 已收到：新增 n 站 / 更新 n 站」。
- 四档图标（16/32/48/128）与 `icon256.png` 统一重绘为「白底圆角瓦片 + 站内 favicon 四角星」，不再出现灰底白「N」方块。

### 搜索浮层：加筛选与排序（与主搜索页同一套口径）
- 翻转卡「搜索」三选浮层（网盘搜索 / 在线观影 / 站点搜索）出结果后，结果区上方新增筛选与排序两行 chip。
- **与主搜索页 `#ptFilterBar` 共用同一份配置与同一份实现**：`SEARCH_FILTER_CONFIG` 提供筛选项与排序项，`applySearchFilterSort()` 提供筛选/排序逻辑，浮层与主搜索页不再各写一套。
- 筛选 chip 单选：点谁谁的只保留一项高亮，点「全部」复位；站点行（来源 ≥2 时才出现）同样是单选。
- 排序 chip 每个维度只一个：`做种 / 大小 / 时间`（网盘另带「默认」），点已选中的 = 翻转方向（`↓` ↔ `↑`），不会出现「体积↓」「体积↑」两个并列项。
- 默认排序与主搜索页一致：PT 默认 `做种↓`，网盘 / 在线默认「默认」；筛选与排序只重绘列表，不重新发请求。
- 底部计数改为「共 n 条结果（已筛选，原始 m 条）」，筛到空集时给「点『全部』恢复」的空态提示。

### 修复：主搜索页排序方向反了
- `renderGenericResults` 原先用 `dir = asc ? 1 : -1` 乘 `(b - a)`，结果「大小↓」实际按升序排。抽出共用实现时按「降序 = 1」校正，主搜索页与浮层现在都是真降序。

### 站点库：折叠入口右对齐
- 「还有 N 站 · 展开全部」与「收起」由左下角改为右下角（`grid-column:1/-1` + `justify-self:end`），与卡片右下角操作区的视觉落点一致。

### 底色改中性深灰（去掉蓝紫）
- 新增令牌 `--c-bg:#1C1C1E`（另配 `--c-bg-mid` / `--c-bg-lift` 做极轻微过渡），`body` 背景由原 `#1a1a2e` 改为 `var(--c-bg)`。
- `.bg-layer` 无轮播图时的占位渐变由蓝紫 `rgba(20,24,42) → rgba(10,12,20)` 换成同族中性深灰，并去掉占位态的 `brightness(0.92)` 压暗，底色即本色（本地渲染右下角实测 `rgb(28,28,30)`，与插件设置页一致）。
- `.bg-overlay` 由偏蓝 `rgba(12,14,20,.40)` 改纯黑 `rgba(0,0,0,.40)`，且**默认不显示**：只有 `applyHeroPoster()` 真给 `bg1/bg2` 设上图片后才加 `body.has-backdrop` 放出来 —— 无图时不再压暗底色，有图时仍保玻璃卡可读。
- 影响面：仅背景层与 `body` 底色，卡片玻璃、文字与控件配色未动（`--c-accent2` 那类靛紫只留在既有控件里）。

## 2.2.8 — 2026-11-07

### 修复：设置 → 「权限与安全」改了不生效（尤其 RBAC）
- **根因**：`toggleRbacEdit()` / `toggleAuthEdit()` 点「✓ 完成」时**只切显隐、从不调用 `saveConfig()`**；而 `saveConfig()` 也**不检查响应状态**，`await fetch(...)` 之后无条件 `toast('配置已保存','success')`。所以即使 POST 被拒（403/401），界面照样显示「已保存」，用户看到的就是「改了没反应」。线上 `config.json` 里确实一直没有 `rbac` 键，印证 RBAC 从未落盘。
- 两个 toggle 在退出编辑态时调用 `saveConfig()`；新增 `scheduleSaveConfig()`（600ms 防抖），给 `#rbacEnabled`、`#cfgAuthEnabled` 挂 `onchange`，开关点一下就落库。
- `saveConfig()` 改为检查 `resp.ok`：401 → 「登录已失效」+ 回登录页；403 → 「没有保存权限（需要「设置」权限）」；其它 → 「保存失败（HTTP xxx）」并带服务端 `error`。失败不再假报成功。

### 权限与安全 · 排版
- **`🔑 已授权客户端` 限高可滚**：`#sessionsArea` 加 `max-height:320px; overflow-y:auto` + 6px 细滚动条，会话再多也只占一屏，卡片不再被条数无限拉长。
- **顺序改「配置在前、运维收尾」**：卡片顺序变为 安全与登录 → 权限与角色(RBAC) → 已授权客户端，「已授权客户端」挪到本 tab 最后。
- 两块 `card-hint` 收短（RBAC：`角色勾选可用功能 + 绑定 Emby 用户限定媒体范围；账号继承角色权限。无「设置」权限的账号看不到本页。`；sessions：`网页令牌 30 天、插件令牌 7 天，用一次续一次；撤销后立刻失效需重新登录。`）。

### 设置 → 站点搜索卡：交互按「非编辑 / 编辑」两态拆开
- 卡头三按钮：`⚡ 测试全部`、`✏️ 编辑`、`＋ 添加站点`。原来那条超长 `card-hint` 从卡面撤掉，内容并进 `HELP_DB.ptSites`，点标题旁问号才展开。
- **非编辑态**：每行只显示「测试」；不显示启用开关，也不显示编辑/删除 —— 避免误改。
- **编辑态**（点 `✏️ 编辑` → 按钮变 `✓ 完成`）：每行出现 `启用` **复选框**（勾选=启用，与设置页其它地方一致，不再是左侧 Switch）+「测试 / 编辑 / 删除」。
- `⚡ 测试全部`：对 `enabled !== false` 的站在用项顺序实测，站间 900ms，按钮显示「测 i/n」，结束提示「测试完成：x 站可用，y 站异常」并刷新状态。
- 添加/编辑站点表单新增 `启用` 复选框，**默认勾选**；`saveSiteForm()` 一并提交 `enabled`（后端 `pt_save_sites` 是局部合并，可直接写入）。

### 设置 → 站点搜索卡：信息密度
- `pt-sub` 不再另起一行：行内结构改为 `pt-line` = `pt-name`（站名，不收缩）+ `pt-sub`（`host · 引擎 · 间隔 · cookie`，过长单行省略）。
- 副标题与解释文案统一收短；长说明只留在问号弹层里。

### 全局：开关单行列表的 hover / 焦点高亮
- 21 处「一行一个开关」的 `<label>` 统一换 `class="sw-row"`：`padding:8px 10px` + `border-radius`，`:hover` 用 `var(--glass-hover)` 填充高光，`:focus-within` 额外描一圈 1px 蓝边（键盘 Tab 也能看出当前行），移动/选中不再需要反复比对左右对齐。

### 其他
- 全局暴露补 `window.scheduleSaveConfig` / `window.togglePtSiteEdit` / `window.testAllSites`（内联 `onchange` / `onclick` 走全局作用域，漏加只报 `is not defined`，语法检查查不出）。

## 2.2.7 — 2026-11-07

### 站点搜索体验（用户现场 4 条）
- **结果徽标显示站点缩写/别名**：PT 结果右下角的 `src-badge` 原来取 `r.source`，PT 结果没有这个字段，兜底成 `source.toUpperCase()`，于是每条都显示同一个绿色「PT」。现在优先取服务端带回的站点名（`r.site`，即站点库里配置的缩写别名），只有拿不到时才退回通用来源词；徽标补 `max-width` + 省略号，长站名不会撑破卡片。
- **站点状态条与结果行贴在一起**：`#ptSiteDiagBar` 只有 `margin-top:12px`，而 `.torrent-list` 的 `gap` 只管条目之间、首条不带外边距，于是状态条下边框直接压住第一条结果。改为上下各 12px（`margin:12px 0`）。
- **种子图标底色**：`.torrent-icon` 从 `rgba(239,68,68,0.15)`（红）改为 `rgb(68 141 239 / 15%)`（蓝，用户指定值）。
- **PT 站点状态上总览，可勾选、可跳转**：总览页新增「🛰️ PT 站点」状态条，每站一枚 chip —— 状态点（连通/近期失败/冷却/停用）+ 站点别名 + 最近一轮延迟（`last_ms`，无数据显 `—`），点 chip 直接在新标签页打开该站；「设置 → 基础 → 首页展示」多出「🛰️ PT 站点」一组逐站勾选框，机制与系统状态卡片/集成服务一致，未勾选的 key 存进 `config.ui_pt_hidden`。站点库里已停用的站点不进总览（停用等于不参与搜索），站点库为空时整组不显示。三组「首页展示」勾选都改成**点一下即时生效 + 600ms 防抖落库**（原来要等别处的保存动作才写入，容易被误认为没反应），只提交被改动的那一组，不会把没渲染出来的组写成空数组。

### 其他
- **有 logo 的影片详情，文字片名降到 40% 不透明**：详情页在服务端返回 logo 艺术字（`d.logo`）时会把片名文字并排显示，原来 `opacity:0.7` 抢视觉，改为 `0.4`，让 logo 当主标题、文字退成辅助读名。

## 2.2.6 — 2026-11-07

### 修复
- **首页图片全空（轮播、卡片海报、详情背景都白）**：`imgProxy()` 不幂等。服务端在 R-02 那次改造后，`emby_poster()` 之类返回的已经是代理地址 `/api/img?url=<编码后的 Emby 图>`，前端又拿它套了一层 `imgProxy()`，请求变成 `/api/img?url=%2Fapi%2Fimg%3Furl%3D...` —— 服务端解析出的 `url` 是 `/api/img?...`，scheme 校验不过，一律 400。现在 `imgProxy()` 先判断「已经是 `/api/img?` 代理地址」就直接返回，不再二次包装。生产实测从 12 条 400 变 0，Emby 海报与轮播背景恢复。
- **「🗄️ 数据缓存」卡片位置**：原在「🏠 首页展示」后面、「🎴 观影卡片池来源」前面，把一张「清理」类动作卡片插在配置组中间。按就近原则移到「基础」选项卡末位（「🗄️ 存储卷配置」之后）：配置类在前、维护清理类收尾。

## 2.2.5 — 2026-11-07

安全加固 + 两处排版修正。

### 安全
- **站点 cookie 落盘加密**：`sites.json` 里的 cookie 不再明文。落盘形态 `v1:<base64>`，构造为「HMAC-SHA256 计数器流加密 + encrypt-then-MAC」（标准库没有 AES-GCM，所以用标准原语自己拼 AEAD 语义：每条记录 16B 随机 nonce，先加密再对 `nonce||密文` 算 MAC，校验用 `compare_digest`）。主密钥单独存 `.vault_key`（32B、chmod 600），不进 `sites.json`；`sites.json` 也收到 600。密钥被替换或密文被改动时解密失败，该站按「没有 cookie」处理（宁可当成未登录，也不带病请求站点）。
- **插件令牌短时效 + 可撤销**：登录时带 `X-Nexus-Client: extension` 的外部客户端只拿 **7 天**令牌（网页仍是 30 天），仍按使用滑动续期。新增 `GET /api/sessions`、`POST /api/sessions/revoke`，设置 → 鉴权 多了「🔑 已授权客户端」卡片，能看每个客户端的类型/最近使用/到期时间并单条撤销；列表只给会话 id（token 的 sha256 前 12 位），从不回显令牌本身。
- **写端点来源网段校验**：`/api/sites/import` 与 `/cookiecloud/sync` 只接受内网来源（本机、RFC1918、Tailscale `100.64/10`、IPv6 ULA）；来源不在白名单直接 403 并说清怎么放行。白名单可用 `DASH_WRITE_ALLOW_CIDRS` 环境变量或 `config.json` 的 `security.write_allow_cidrs` 覆盖（`*` = 全放行）。反代场景下 `_get_client_ip` 会认 `X-Forwarded-For` 第一跳（仅当直连方是本机时）。
- **原生 HTTPS**：设 `DASH_TLS_CERT` / `DASH_TLS_KEY`（或 `config.json` 的 `tls.cert/key`）即由服务自己终止 TLS（TLS1.2+），不必再在容器外挂一层反代。证书缺失/加载失败会打 `[CRITICAL]` 并回退 HTTP，不会起不来。
- **CORS 收紧**：响应头不再硬写 `Access-Control-Allow-Origin: *`，只回同源与浏览器扩展来源（`chrome-extension://` / `moz-extension://`），避免任意网页借用户已登录的会话读数据。

### 界面
- **页面标题回到 Title 1**：`.top-title h1` 17px → 28px。原来它比分组标题 `h3`(18px) 还小，层级是反的（平板断点里的 `h1{28px}` 反而一直生效，只有桌面小）。顶部图标同步 17→24px。
- **模块间距统一到 28px 节奏**：`.top-row` 底边距 16px → 28px（它原来是唯一一档 16px 的“顶栏专用”间距，与其它模块不一致）；宽屏单列布局里 `.overview-grid .hero-media` 22px → 28px、`.overview-grid .section-title` 12px → 16px。现在「顶栏 → 轮播 → 分组标题 → 卡片」是 28 / 28 / 16，分组标题与它下方内容的 16px 属于标题内部间距，不参与模块节奏。

## 2.2.4 — 2026-11-07

### 修复
- **轮播图在触屏上滑不动**：原实现只挂了 `pointerdown/move/up`，卡片没设 `touch-action`，浏览器把横向手势当成自己的、随后发 `pointercancel`，拖动被吞掉 —— 平板上左右滑永远不切换。现在 `.hero-media` 设 `touch-action: pan-y`（横向归轮播、纵向仍归页面滚动），手势改为 Pointer Events 统一处理，补 `setPointerCapture` 与 `pointercancel` 兜底（用最后坐标补判定），并按位移+速度双阈值识别，快速轻扫也能翻页。鼠标拖拽、触控笔、手指三种输入走同一条路径。

## 2.2.3 — 2026-11-07

站点管理卡片的可用性收尾：单站可救的配置项补齐、保存不再冲掉站点规则、界面回到设计令牌。

### 新增
- 编辑表单新增两项：**该站超时**（秒，0 = 跟随全局 3.5s）与 **允许自签名证书**（跳过证书校验）。此前诊断会说「给该站标记 insecure」「给该站单独调大 timeout」，但界面上没有入口；现在证书过期/自签的老站、响应慢的站都能就地自救，不必改全局。
- 站点副标题显示「跳过证书校验」「Xs 超时」，`health_snapshot` 输出 `timeout` / `insecure` 供表单回填。

### 变更
- 站点清单默认只渲染 12 行 + 末尾「还有 N 站 · 展开全部」，筛选时或正在编辑某站时自动全展开：41 站的卡片不再把设置页拉成一条长棍。
- 「刷新状态」改为 chip 自身可点，去掉内嵌的小按钮。
- 站点搜索卡片内的颜色全部走 `var(--c-*)` 设计令牌（状态色、危险按钮、下拉箭头与项目既有写法一致），不再出现自成一套的色值。

### 修复
- 编辑表单保存不再固定提交 `search.method='GET'`：只提交用户真正改过的键，POST 站的 `method` / `body` / `params` 规则不会再被一次保存冲掉。

## 2.2.2 — 2026-11-07

站点管理界面落地（按项目层级规范）+ 站点库保存语义修复。

### 新增
- **设置 → 服务与连接 →「🔍 站点搜索」卡片**：站点库的启用/停用、状态与「原因 → 动作」、单站重测、编辑、删除都在这里。它属于「站点搜索」这个搜索源自身的配置，与「服务分类名称」「常用服务」同级，不另起独立页面或独立区块。
- 汇总 chips（总数 / 正常 / 不稳定 / 冷却中 / 已停用 / 无 cookie）、按名称或域名筛选、异常优先↔按名称排序切换、右上「＋ 添加站点」。
- 编辑表单字段：名称 / 站点地址 / 引擎族 / 搜索路径 / 关键词参数 / 该站最小请求间隔 / Cookie（新站可选，老站留空保持原值）。
- `HELP_DB.ptSites` 说明：站点库归属、停用只影响 NEXUS 搜索、各诊断码对应的补救方向。

### 变更
- 搜索结果上方状态条退回纯「本轮结果」职责，只保留一个「管理站点 ›」跳转到上述卡片，不再就地展开第二套清单。
- `health_snapshot` 每站新增 `search{path,method,keywordParam}`，前端编辑表单可正确回填（cookie 仍只输出布尔 `has_cookie`）。

### 修复
- `pt_save_sites` 保存成功后立即 `reload_sites`：运行中的引擎立刻看到新库，不必重启容器。
- 允许「已有站点只带 id 的局部更新」（此前只传 `{id, enabled}` 会被静默丢弃，启用开关点了不生效）；`search` 字段改为局部合并，改 path / keywordParam 不会冲掉该站已有的 `paths` / `params` / `advance` / `body`。
- 空载荷（`{}`、既无 id 又无 base_url）真正按空处理、不写盘；`replace` 路径补上「拒绝把站点库写成空」守卫（此前 `replace` + 空 sites 会直接清空站点库）。

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
