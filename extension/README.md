# NEXUS 站点管家（浏览器插件）

> 私有分发，不上商店。解决三件事：**加站快**、**登录态不失效**、**故障现场能说清原因**。

## 为什么是插件，而不是把搜索搬进插件

PT 站的风控只认「真实浏览器上下文」。插件能做的、服务端做不到的只有三件：

1. 读你**已登录**浏览器里的 cookie（服务端只能等你把 cookie 推过来）；
2. 用真实浏览器过 Cloudflare 之类的挑战（`curl` 永远过不去）；
3. 在故障现场**实测一次该站搜索**，直接分辨「网络不通 / 证书 / 登录失效 / 429 / 挑战页 / 结构失配」。

搜索本身仍然由 NAS 上的 NEXUS 做：一套解析代码、一份结果、一处风控暴露面。
插件只当「凭据 + 站点元数据 + 连通性实测」的供给端。

## 安装（Chrome / Edge 均可）

1. 打开 `chrome://extensions`（Edge 是 `edge://extensions`），开启「开发者模式」；
2. 点「加载已解压的扩展程序」，选本目录 `nexus-extension`；
3. 点插件图标 → 右下「设置」→ 填 NEXUS 地址 + 账号密码 → 保存并登录。

> **地址怎么写**：填你自己的 NEXUS 入口，比如 `https://nexus.example.com`（只开 HTTP 的实例则写 `http://192.168.1.10:8080`）。插件出厂不预置任何具体地址 —— 默认是空的，第一次必须自己填。协议写错也不用自己猜：会拿同一个地址换另一种协议再试一次（https ↔ http），能通就自动改掉输入框并在状态行说明。
>
> 两条踩过的坑：① 开了原生 HTTPS 的实例**用域名访问**，别用 IP —— 公信证书的 SAN 通常只覆盖域名，用 IP 访问浏览器/插件会报证书不匹配；② HTTPS 端口和 HTTP 端口往往不是同一个，升级后记得把端口一起改。

> 权限说明：`cookies` 意味着能读所有站点 cookie，这也是 Chromium 商店大概率会卡、用户也会怀疑的原因，所以本项目**只做私有分发**。插件不会把 cookie 发给除你配置的 NEXUS 地址以外的任何地方。

## 出厂不带地址（1.2.10）

插件默认地址是**空的**。上一版预置了某个私有域名，等于把作者的内网写进了分发物里 —— 换个人装上就是连不上的黑洞地址，还很难意识到是默认值的问题。现在第一次使用必须自己填。

同一版还顺带修了协议自愈的方向：原来只会 `https → http` 降级，现在两个方向都试（`https ↔ http`），填反了也能自己接上。

验证时踩到一条值得记住的：原生 HTTPS 的实例要用**域名**访问。证书 SAN 只覆盖域名，用 IP 打会 `certificate verify failed: IP address mismatch` —— 浏览器能点「继续访问」，插件用的是严格校验，会直接失败。

## 三个按钮

| 按钮 | 做什么 |
|---|---|
| 导入当前站点并推送 | 读当前站 cookie → 实测一次 `torrents.php?search=test` → 把站点定义 + 诊断推到 NEXUS `/api/sites/import` |
| 全部重测（本地） | 逐站实测（站间 1.2s 间隔），失败原因就地列出 |
| 立即保活一次 | 重读所有已登记站的 cookie，有变化就重推；失败的站角标标红 |
| 查看 NEXUS 站点健康度 | 拉 `/api/search/pt/sites`，看服务端视角的红黄绿与诊断 |

后台 `alarms` 默认每 30 分钟跑一次保活（可在设置里改，0 关闭）。

## 扫描进度与记录缓存（1.2.7）

- 「扫描已打开的站点并同步」不再是一句话等到底：后台每处理一站就回推一行，面板里逐行跑码，看得见「哪些站读到了 cookie、哪些进了门禁、哪些登记为新站、NEXUS/MP 各更新了几个」。
  一轮扫描最多几十行纯文本追加（超过 200 行丢最老的），对性能无可感影响。
- 这一轮的行与上一轮的结论同时写进 `chrome.storage.local`（`scanLog` / `scanRunning` / `lastScanSummary`）。
  - **面板中途关掉**：后台继续跑到结束；下次打开按钮直接是「扫描中…」，进度行接上已有的。
  - **已经扫完**：打开就看到上次的时间、耗时、明细与结论，**不用重扫**。
  - 重扫才会清掉这一轮的跑码（上一轮结论仍保留到下次扫描结束）。
- 缓存只存扫描的行文本与摘要（`lastScanSummary` 里最多 200 条 items），不含 cookie 内容。

## 登录态判定改成「浏览器说了算」（1.2.8）

1.2.7 之前读 cookie 是**按 host 精确匹配**（`chrome.cookies.getAll({domain: host})`）再手工拼 `Cookie` 头。这和浏览器的真实行为不等价，会造出两类假故障：

- cookie 写在父域（`.m-team.cc`），站点开在子域（`kp.m-team.cc`）→ 子域永远取不回父域的登录态；
- 站点把 cookie 限制在某个 path（`/forum/`），只问 `/` 的请求语义就拿不到。

1.2.8 的改法：

- 读取改成 **URL 语义**（`getAll({url})`，等价于「浏览器给这个请求会带哪些 cookie」），https/http 两套协议、`/`、`/torrents.php`、`/index.php` 三个入口各查一次，仍为空再按父域逐级兜底；同名 cookie 取 path 更长（更具体）的那条。
- **读不到 cookie 值不再直接判「没登录」**：站点库里的站一律交给浏览器发一次真实请求（`fetch(..., {credentials:'include'})`，Chromium 自己按 URL 带凭据），只看响应。这是 PT-depiler 的做法——它从不先查 cookie 存在与否。
- 判定补强：被 302 到登录页（`/login`、`login.php`、`takelogin`）= 未登录，比「页面里有没有 username 输入框」更可靠。
- 措辞按事实分层：`已登录（N 条可抓）` / `已登录（搜索 test 无结果）` / `已登录（浏览器直连可用；本地读不到 cookie 值，NEXUS 端仍缺）` / `不像 PT 站（…）`。原来一律印「0 条可抓」「探针判定不是 PT 站」容易把人带偏。
- 读不到值时**不拿空串覆盖** NEXUS 里已有的 cookie（`cookieData[host]` 只在非空时才写）。

自检：`node _verify_cookiesfor.mjs` 用真实 `background.js` 的函数体 + 按 Chrome 文档实现的 `getAll` mock，验证父域 cookie、path 择优、无 cookie 站点不误报，9 项断言 FAIL 0。

## 与 CookieCloud 的关系

NEXUS 已经内置 CookieCloud 兼容端点 `POST /cookiecloud/sync`（密码恒定时间比对，未配置密码一律拒绝）。所以：

- 你现有 CookieCloud 客户端照常能推，NEXUS 收到后会**同时**更新 MoviePilot 的 site 表和自己 `/data/sites.json` 的 cookie；
- 本插件走的是 `/api/sites/import`（用 NEXUS 会话令牌鉴权），好处是能顺带推**站点元数据与实测诊断**，这是 CookieCloud 协议装不下的。

两条通道都落到同一份 `sites.json`，谁先到用谁。

## 明确的边界

- **「保活」≠「续命」**。cookie 过期了必须有真人重新登录一次，插件做不到无人值守永久有效；它做的是「一过期就能立刻发现、你登录完一键补上」。
- 挑战页（Cloudflare 5 秒盾 / Turnstile）需要人过一次；插件可以把「该站被挑战」这件事准确报出来并指向正确动作，但不能替你破解。
- 首次导入按「站点定义表」提交：表里没有的站一律按 NexusPHP 族（`/torrents.php?search=`），馒头这类私有 JSON API 站由表里单独声明（见下一节）。站点是 Unit3D / Gazelle / Discuz 时，在 NEXUS 站点页把引擎族与搜索路径改一下即可，规则不用改代码；**改过之后插件不会再把它们冲回默认值**。

## 诊断码对照

与 NEXUS 服务端 `DIAG_CATALOG` 一一对应：`dns / tls / timeout / auth / ratelimit / challenge / http / parse / api / throttle-skip / busy / disabled / unknown`。每条都带「人话原因 + 证据 + 一个能点的动作」。

## 样式：与 NEXUS 共用同一套设计令牌

`theme.css` 里的令牌取值镜像 `nexus/dashboard.html` 的 `:root`（`--c-accent / --c-success / --c-danger / --glass-* / --border-* / --radius-* / --field-bg / --font-mono`），`popup.html` 与 `options.html` 只引用这些令牌和 `.nx-*` / `.dot` 组件类，没有自造色值。

改视觉只动 `theme.css` 与两个 HTML 的类名；dashboard 改令牌时这里要一起改，两边保持同一视觉语言。

注意：`options.js` 登录成功只提示「令牌已保存到本机扩展存储」，**不把令牌打印到界面上**。

## 登录失败怎么读（尤其 502）

`/api/login` 的状态码决定了问题在哪一层，插件按状态码给结论，不再只甩一个数字：

| 你看到 | 含义 | 怎么做 |
|---|---|---|
| `HTTP 502/503/504`：请求没打到 NEXUS（中间有反代/代理/隧道在报错） | 502 **不是 NEXUS 自己发的**（NEXUS 的错误都是 JSON 401/403），一定来自中间层：Clash/mihomo 之类的系统代理、反代、隧道 | 用浏览器直接打开面板地址看能不能出来；系统代理开着就把这个地址设成直连，或换成没被代理接管的那个地址 |
| `账号或密码不对（HTTP 401）` | 打到了 NEXUS，是票据不对 | 用网页登录一次核对账号密码 |
| `被 NEXUS 拒绝（HTTP 403）` | 有响应但被拦 | 该账号缺权限（导入站点需要 `settings:manage`），或来源被 NEXUS 的网段限制挡住 |
| `路径不存在（HTTP 404）` | 打到了别的服务 | 检查端口（生产 16187 HTTPS、开发 28081，容器内都是 28080） |
| `连不上 http://…（DNS/端口/网段/代理之一）` | 请求根本没发出去 | 先确认地址在浏览器能打开，再检查是否同一网段 |
| `… 超过 15 秒没响应` | 连上了但不回 | 看 NAS 上容器是否 healthy |

设置页有「测试连接」按钮：只探地址通不通（GET `/`），不校验账号，能在填错地址时就分辨出是「网络层」还是「票据层」。

## 交互反馈

- 所有按钮点击即进入载入态：转圈 + 文案换成「登录中… / 导入中… / 实测中…」，同时禁用防重复提交，结束后一定还原（`finally` 保证）。
- 状态提示是一行固定位置的消息（绿点=成功、红点=失败、蓝点脉冲=进行中），不跳版、不弹窗。
- 改进动机：此前「保存并登录」点下去界面毫无变化，失败也只给一句 `HTTP 502`，看不出该查哪里。


## 站点定义：哪些站不是 NexusPHP 族（1.2.9）

NEXUS 后台的 `search_engine.py` 本来就支持按站点声明请求：`path` / `paths`（404 时依次回退，最多 3 个）/ `method`（GET 或 POST）/ `keywordParam` / `params` / `body` / `contentType` / `advance`（`imdb|`、`douban|`、`tmdb|`）；引擎族有 `nexusphp` / `unit3d` / `gazelle` / `discuz` / `json_api` / `generic` 六种。

但 1.2.8 及以前，插件对**每条新站都写死** `engine: nexusphp` + `GET /torrents.php?keywordParam=search` —— 馒头（M-Team）是 NexusPHP 魔改站，网页端只能浏览，真正的搜索走私有 JSON API，于是它必然搜不到（回执里表现为「站点返回异常状态」）。

1.2.9 改成「小表 + 不覆盖」：

| 行为 | 说明 |
|---|---|
| 定义表命中 | 按表里的 `engine` + `search` 推给 NEXUS。目前只登记了馒头：`json_api` + `POST /api/torrent/search` + `application/json` + `body: {pageNumber:1, pageSize:100}` + `keywordParam: keyword`，另带 `/api/v2/torrent/search` 作为 404 回退候选 |
| 定义表未命中 | 仍然 `nexusphp` + `GET /torrents.php?search=`（绝大多数站成立，不改就是最小风险） |
| 已在库里的站 | **不重推站点定义**，只刷新 cookie 与实测结论 —— 你在 NEXUS 站点页手调过的 `path`/`method` 不会被插件冲掉 |
| 唯一的例外 | 库里存的还是「旧版写死的默认值」（`nexusphp` + `GET` + `/torrents.php` + `search`），且定义表说这站不一样 → 视为「从没被调过」，升级成表里的正确定义，并在扫描日志里打一行 `~ 定义升级：json_api POST /api/torrent/search` |
| 探针 | `json_api` 站的浏览页没有 NexusPHP 的 `details.php?id=` 行结构，0 条不再判为「解析失败」，只判登录态通不通 |

维护方式：真碰到新的非 NexusPHP 站，在 `background.js` 的 `SITE_DEFS` 里加一条 `{ test: /域名正则/, engine, search }` 即可，不用改 NEXUS 后台。表的判据是「`/torrents.php?search=` 搜不出来」——能搜出来的站不要往表里加。
