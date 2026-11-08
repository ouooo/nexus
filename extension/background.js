// NEXUS 站点管家 — background service worker
// 职责：登录 NEXUS、读取站点 cookie、现场实测、把站点定义+诊断推给 NEXUS、定期保活
// 设计边界：搜索始终由 NEXUS 服务端做（不在插件里跑第二套解析，避免双份风控暴露与结果不一致）

const DIAG = {
  ok:        { label: '正常', reason: '', action: '' },
  dns:       { label: '域名解析失败', reason: '浏览器打不开这个域名，通常是站点换域名或本机 DNS 有问题。', action: '确认新域名后重新导入；多个站同时这样，先查本地 DNS/代理。' },
  tls:       { label: '证书或 TLS 失败', reason: '证书不受信或协议不兼容，浏览器会拦这个站。', action: '先手动打开站点确认是否证书告警；必要时给该站单独放行。' },
  timeout:   { label: '请求超时', reason: '站点在这次探测的超时时间内没响应。', action: '稍后重试；长期超时说明站点慢或代理节点差。' },
  auth:      { label: '登录态失效', reason: '拿到的是登录页，说明这个站的 cookie 已经过期。', action: '在这个站重新登录一次，然后点「一键导入」重新推送。' },
  ratelimit: { label: '被站点限流', reason: '站点回了 429，说明请求太快。', action: '等 1–2 分钟再试；不要连续重测。' },
  challenge: { label: '被反爬挑战拦住', reason: '页面是 Cloudflare 之类的验证页，脚本拿不到列表。', action: '在浏览器里打开该站过一次验证，再重新导入。' },
  http:      { label: '站点返回异常状态', reason: '站点返回了 4xx/5xx，可能是路径变了或站点维护。', action: '先确认站点能正常浏览；再检查搜索路径是否还有效。' },
  parse:     { label: '页面解析不出条目', reason: '页面像列表页，但没识别到种子行，通常是站点改版。', action: '把这条反馈给 NEXUS，用采样更新规则；或在站点页换引擎族。' },
  unknown:   { label: '未知错误', reason: '探测失败但无法归类。', action: '看证据里的状态码与片段，必要时手动打开站点核对。' },
  disabled:  { label: '已禁用', reason: '这个站在 NEXUS 里被关掉了。', action: '在 NEXUS 站点页重新启用。' }
};

function diag(code, extra = {}) {
  const base = DIAG[code] || DIAG.unknown;
  return Object.assign({ code, label: base.label, reason: base.reason, action: base.action }, extra);
}

async function cfg() {
  const d = await chrome.storage.local.get(['nexusUrl', 'token', 'username', 'password', 'sites', 'autoMin', 'lastScanSummary', 'gateOff']);
  return {
    // 不预置任何具体地址：这是要发给别人/多实例的插件，默认值里不该有某个人的内网域名。
    // 首次使用必须在设置页填自己的 NEXUS 地址（支持 https 与 http，协议填错会自动换一种再试）。
    nexusUrl: normUrl(d.nexusUrl || ''),
    token: d.token || '',
    username: d.username || '',
    password: d.password || '',
    sites: d.sites || [],
    autoMin: d.autoMin === undefined ? 30 : d.autoMin,
    lastScanSummary: d.lastScanSummary || null,
    // 门禁分两层：
    //   gateItems  = 最近一次「初筛」的结论（host → verdict），决定每一项的默认勾选状态
    //   gateChoice = 用户显式选择（host → true/false），优先于默认值
    // 这样默认值来自事实（在库 / 探针确认是 PT / 不像 PT / 豆瓣），最终仍然由人拍板。
    gateItems: Array.isArray(d.gateItems) ? d.gateItems : [],
    gateChoice: d.gateChoice || {}
  };
}

async function saveCfg(patch) {
  await chrome.storage.local.set(patch);
}

// —— 地址与网络请求：统一在这里做规范化、超时、以及「错在哪一层」的判读 ——
const NX_TIMEOUT = 15000;

function normUrl(raw) {
  let u = String(raw || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'http://' + u;   // 只填 IP:端口 也认
  return u;
}

// 把一次失败的请求翻译成「用户能懂、能照着做」的一句话
function whyFailed(err, url, status, bodyText) {
  const s = status || 0;
  let root = url;
  try { root = new URL(url).origin; } catch (e) { /* 保持原样 */ }
  if (s === 502 || s === 503 || s === 504) {
    return 'HTTP ' + s + '：请求没打到 NEXUS（中间有反代/代理/隧道在报错）。'
      + '先在浏览器直接打开 ' + root + ' 确认 NEXUS 页面能出来；系统代理开着的话，把这个地址设成直连。';
  }
  if (s === 401) return '账号或密码不对（HTTP 401）。';
  if (s === 403) return '被 NEXUS 拒绝（HTTP 403）：可能是该账号没有这个权限，或来源被拦。';
  if (s === 404) return '路径不存在（HTTP 404）：检查地址是否少了端口，或指到了别的服务。';
  if (s >= 500) return '服务端异常（HTTP ' + s + '）。看 NAS 上 nexus-test 容器日志。';
  const m = String((err && err.message) || err || '');
  if (/ERR_SSL|SSL_PROTOCOL|certificate|CERT_|ERR_BAD_SSL|SSL/i.test(m)) {
    return root + ' 的 TLS 握不上：这个端口不是 HTTPS（可能只开 HTTP）。插件会自动换另一种协议再试一次，'
      + '仍不通就说明该端口上没有服务在监听。';
  }
  if (/Failed to fetch|NetworkError|network error/i.test(m)) {
    return '连不上 ' + root + '（DNS/端口/网段/代理之一）。先在浏览器打开这个地址确认它能访问。';
  }
  // AbortSignal.timeout() 抛的是 DOMException，message 就是 "signal timed out"
  if (/TimeoutError|timeout|timed out|aborted|abort/i.test(m)) {
    return root + ' 在 ' + (NX_TIMEOUT / 1000) + ' 秒内没响应。依次查：① 地址和端口对不对（HTTPS 端口与 HTTP 端口通常不是同一个）；'
      + '② NAS 上 nexus-test 容器是否在跑；③ 系统代理有没有把这个地址也带走（设成直连）；④ 反代/隧道是否可达。';
  }
  return String((err && err.message) || err || bodyText || '请求失败');
}

// 协议填错时换另一种再试：有人部署的是 HTTPS，有人只开 HTTP —— 试一次就能救回来，不用用户自己猜。
function altProto(base) {
  const h = /^https:\/\/(.+)$/i.exec(base);
  if (h) return 'http://' + h[1];
  const p = /^http:\/\/(.+)$/i.exec(base);
  if (p) return 'https://' + p[1];
  return '';
}

async function nxFetch(path, opt = {}) {
  const c = await cfg();
  let base = normUrl(c.nexusUrl);
  if (!base) throw new Error('还没填 NEXUS 地址');
  const timeout = opt.timeout || NX_TIMEOUT;
  const opts = Object.assign({ signal: AbortSignal.timeout(timeout) }, opt.fetch || {});
  let r, firstErr = null;
  try {
    r = await fetch(base + path, opts);
  } catch (e) {
    firstErr = e;
  }
  // 协议填错（https 打成 http 或反过来）：自动换另一种再试，成功后把地址改掉并留一句说明
  if (!r) {
    const alt = altProto(base);
    if (alt) {
      try {
        r = await fetch(alt + path, Object.assign({ signal: AbortSignal.timeout(timeout) }, opt.fetch || {}));
        await saveCfg({ nexusUrl: alt });
        _urlNote = '这个地址在 ' + (base.split(':')[0]) + ' 协议下打不通，已自动改用 ' + alt;
        base = alt;
      } catch (e2) { /* 换协议也不行，用第一次的错误说话 */ }
    }
    if (!r) throw new Error(whyFailed(firstErr, base + path));
  }
  const text = await r.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON 交给下面判读 */ }
  return { r, url: base + path, text, json };
}
let _urlNote = '';

// 把一次「有响应但状态不对」翻成一句话：5xx 归网关/服务端，401 单独说清，4xx 优先用服务端原话
function httpError(res, url, text, json) {
  const s = res && res.status || 0;
  const serverMsg = (json && (json.error || json.message)) || '';
  if (s >= 500) return whyFailed(null, url, s, text.slice(0, 120));
  if (s === 401) return '账号或密码不对（HTTP 401）' + (serverMsg ? '：' + serverMsg : '');
  if (s === 403) return '被 NEXUS 拒绝（HTTP 403）：' + (serverMsg || '该账号没有这个权限，或来源被拦。');
  return serverMsg || whyFailed(null, url, s, text.slice(0, 120));
}

async function login() {
  _urlNote = '';
  const c = await cfg();
  if (!c.username || !c.password) throw new Error('请先在上方填写 NEXUS 账号密码');
  const { r, url, text, json } = await nxFetch('/api/login', {
    fetch: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Nexus-Client': 'extension' },
      body: JSON.stringify({ username: c.username, password: c.password })
    }
  });
  if (!r.ok) throw new Error(httpError(r, url, text, json));
  if (!json || !json.token) throw new Error('NEXUS 返回里没有 token（HTTP ' + r.status + '），版本可能不匹配：' + text.slice(0, 120));
  await saveCfg({ token: json.token });
  return json.token;
}

// 只验证「地址通不通」，不涉及账号：给设置页的「测试连接」用
async function probeNexus() {
  const c = await cfg();
  let base = normUrl(c.nexusUrl);
  if (!base) return { ok: false, error: '还没填 NEXUS 地址' };
  const t0 = Date.now();
  try {
    const r = await fetch(base + '/', { signal: AbortSignal.timeout(8000), redirect: 'follow' });
    const ms = Date.now() - t0;
    if (r.status >= 500) return { ok: false, url: base, ms, error: whyFailed(null, base, r.status) };
    return { ok: true, url: base, ms, status: r.status };
  } catch (e) {
    const alt = altProto(base);   // 协议打不通时探一下另一种，省得用户自己猜
    if (alt) {
      try {
        const t1 = Date.now();
        const r2 = await fetch(alt + '/', { signal: AbortSignal.timeout(8000), redirect: 'follow' });
        if (r2.status < 500) {
          return { ok: true, url: alt, ms: Date.now() - t1, status: r2.status,
                   note: '这个地址在 ' + base.split(':')[0] + ' 下打不通（' + whyFailed(e, base) + '），可以用 ' + alt };
        }
      } catch (e2) { /* 两个都不行，报原始错误 */ }
    }
    return { ok: false, url: base, ms: Date.now() - t0, error: whyFailed(e, base) };
  }
}

async function authToken() {
  const c = await cfg();
  if (c.token) return c.token;
  return await login();
}

function hostOf(u) {
  try { return new URL(u).hostname; } catch (e) { return ''; }
}

function baseOf(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return '';
    return x.origin;
  } catch (e) { return ''; }
}

// 取某站 cookie：与「浏览器给这个 URL 发请求时会带哪些 cookie」等价。
// 旧实现按 host 精确匹配（getAll({domain: host})），父域写的 cookie（比如 .m-team.cc）
// 对子域 kp.m-team.cc 永远取不回来 —— 「明明登录了却报没有登录态」的根因就在这。
// 现在：URL 语义（等价于浏览器真实行为）→ 仍为空再按父域逐级兜底 →
// 同名 cookie 取 path 更长（更具体）的那条，避免 / 与 /forum 的同名值打架。
async function cookiesFor(host, baseUrl) {
  const urls = [];
  const b = baseOf(baseUrl || '');
  // baseUrl 若自带路径（比如 /forum/index.php）就先按它查一次：path 限定的 cookie 只有这时才带得回来
  if (/^https?:\/\//i.test(String(baseUrl || ''))) urls.push(String(baseUrl));
  if (b) {
    for (const p of ['/', '/torrents.php', '/index.php']) {
      urls.push(b + p);
      urls.push((b.indexOf('https://') === 0 ? b.replace(/^https:/, 'http:') : b.replace(/^http:/, 'https:')) + p);
    }
  }
  if (host) {
    urls.push('https://' + host + '/');
    urls.push('http://' + host + '/');
  }

  const byName = new Map();
  const add = (list) => {
    for (const c of (list || [])) {
      if (!c || !c.name) continue;
      const prev = byName.get(c.name);
      if (!prev || String(c.path || '').length > String(prev.path || '').length) byName.set(c.name, c);
    }
  };
  for (const u of urls) {
    try { add(await chrome.cookies.getAll({ url: u })); } catch (e) { /* 某个协议不可用就跳过 */ }
  }

  // 父域兜底：cookie 写在 .m-team.cc / .qingwapt.com 这类父域时，URL 语义通常已经带回来了；
  // 这里再按域名逐级问一次，覆盖「站点用不常见端口/协议、URL 没匹配上」的情形。
  if (!byName.size && host) {
    const parts = host.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const d = parts.slice(i).join('.');
      try { add(await chrome.cookies.getAll({ domain: d })); } catch (e) {}
    }
  }

  return Array.from(byName.values()).map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure
  }));
}

function cookieHeader(list) {
  return list.map(c => c.name + '=' + c.value).join('; ');
}

// 现场实测：用真实浏览器上下文打一次该站的搜索页，能直接分辨
// DNS/TLS/超时 / 登录失效 / 429 / 挑战页 / 结构失配 —— 这是 NEXUS 服务端做不到的事
async function probeSite(baseUrl, opts = {}) {
  const t0 = Date.now();
  const engine = (opts.def && opts.def.engine) || 'nexusphp';
  let resp, text = '';
  try {
    resp = await fetch(baseUrl + '/torrents.php?search=' + encodeURIComponent(opts.query || 'test'), {
      credentials: 'include',
      redirect: 'follow',
      signal: AbortSignal.timeout(opts.timeout || 12000)
    });
  } catch (e) {
    const msg = String((e && e.message) || e);
    const code = /ERR_TIMED_OUT|TimeoutError|timed out|aborted/i.test(msg) ? 'timeout'
      : /ERR_CERT|certificate|SSL/i.test(msg) ? 'tls'
      : /ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION|getaddrinfo|name not|dns/i.test(msg) ? 'dns'
      : /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED/i.test(msg) ? 'http'
      : 'unknown';
    return { ok: false, ms: Date.now() - t0, diag: diag(code, { evidence: msg.slice(0, 120) }) };
  }
  const ms = Date.now() - t0;
  try { text = (await resp.text()).slice(0, 12000); } catch (e) { text = ''; }

  if (resp.status === 429) {
    const ra = resp.headers.get('retry-after');
    return { ok: false, ms, diag: diag('ratelimit', { status: 429, evidence: 'Retry-After=' + (ra || '-') }) };
  }
  if (resp.status === 401 || resp.status === 403) {
    const body = text.toLowerCase();
    const code = /just a moment|cf-mitigated|challenge-platform|verify you are human|attention required/.test(body)
      ? 'challenge' : 'auth';
    return { ok: false, status: resp.status, ms, diag: diag(code, { status: resp.status, evidence: text.slice(0, 90) }) };
  }
  if (!resp.ok) return { ok: false, status: resp.status, ms, diag: diag('http', { status: resp.status }) };

  const body = text.toLowerCase();
  if (/just a moment|cf-mitigated|challenge-platform|verify you are human|attention required/.test(body)) {
    return { ok: false, ms, diag: diag('challenge', { status: resp.status }) };
  }
  // 被 302 到登录页 = 没登录态，比看页面里有没有 username 输入框更可靠（各站登录页长得都不一样）
  const finalUrl = String(resp.url || '').toLowerCase();
  if (/\/login|takelogin|login\.php|signin/.test(finalUrl) && !/details\.php|download\.php/.test(body)) {
    return { ok: false, ms, diag: diag('auth', { status: resp.status, evidence: '被跳到登录页 ' + finalUrl.slice(0, 80) }) };
  }
  if (/name="username"|name='username'|takelogin|login\.php/.test(body) && !/details\.php|download\.php/.test(body)) {
    return { ok: false, ms, diag: diag('auth', { status: resp.status, evidence: '页面像登录页' }) };
  }
  const rows = (text.match(/details\.php\?id=|download\.php\?id=|\/torrents\/\d+/gi) || []).length;
  if (rows === 0 && /details\.php|download\.php|\/torrents\//.test(body)) {
    if (engine === 'json_api') {
      // 私有 API 站的浏览页没有 NexusPHP 的 details.php?id= 行结构，0 条 ≠ 解析失败；
      // 种子数由 NEXUS 侧按站点定义走 JSON 接口统计，这里只判「登录态通不通」。
      return { ok: true, ms, count: 0, diag: diag('ok', { status: resp.status, evidence: '接口站浏览页无 NexusPHP 行（条数交给 NEXUS 侧 JSON 接口）' }) };
    }
    return { ok: false, ms, diag: diag('parse', { status: resp.status, evidence: '列表页但没找到条目链接' }) };
  }
  return { ok: true, ms, count: rows, diag: diag('ok', { status: resp.status }) };
}

// 推送站点定义 + 探针到 NEXUS（端点需 settings:manage）
async function pushSites(sites, probes) {
  const token = await authToken();
  const { r, url, text, json: j } = await nxFetch('/api/sites/import', {
    fetch: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'X-Nexus-Client': 'extension' },
      body: JSON.stringify({ sites: (sites || []).map(s => Object.assign({}, s, {
        name: sanitizeName(s.name, s.base_url)   // 不把标签页标题当站名推给 NEXUS
      })), probes, client: 'extension' })
    }
  });
  if (!r.ok) throw new Error(httpError(r, url, text, j));
  return j || {};
}

// 批量投喂登录态：一次请求刷 NEXUS 站点库 + MoviePilot（与 NEXUS 的 CookieCloud 接收同一条合并链路）
async function pushCookieData(cookieData) {
  const token = await authToken();
  const { r, url, text, json: j } = await nxFetch('/api/sites/cookie-sync', {
    fetch: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'X-Nexus-Client': 'extension' },
      body: JSON.stringify({ cookie_data: cookieData, client: 'extension' })
    }
  });
  if (!r.ok) throw new Error(httpError(r, url, text, j));
  return j || {};
}

// 拉 NEXUS 站点健康度（用于角标与列表）
async function pullHealth() {
  const token = await authToken();
  const { r, url, text, json: j } = await nxFetch('/api/search/pt/sites', {
    fetch: { headers: { 'Authorization': 'Bearer ' + token } }
  });
  if (!r.ok) throw new Error(httpError(r, url, text, j));
  return (j && j.sites) || [];
}

// 站名清洗：标签页标题（「首页 1PTBA,壹PT吧…」「查看主题 xxx」「A :: B」）不是站名，
// 一律退回注册域；只有像站名的短中文/英文名（百川、聆音、UBits）才保留。
function looksLikeTabTitle(name) {
  const nm = String(name || '').trim();
  if (!nm) return true;
  if (nm.length > 20) return true;
  if (nm.includes('::') || nm.includes(' | ') || nm.includes(' - ')) return true;
  return ['首页', '查看主题', '站点', '众筹', '活动结束', '论坛', '登录'].some(t => nm.includes(t));
}

function sanitizeName(name, baseUrl) {
  let host = '';
  try { host = new URL(baseUrl).hostname.toLowerCase(); } catch (e) { host = ''; }
  if (host.startsWith('www.')) host = host.slice(4);
  if (looksLikeTabTitle(name)) return host || '未命名站点';
  return String(name).trim();
}

// 把本地已存的站名做一次就地清洗（旧版把标签页标题存成了站名）
async function sanitizeLocalSites() {
  const c = await cfg();
  const list = (c.sites || []).map(s => {
    const nm = sanitizeName(s.name, s.base_url);
    return nm === s.name ? s : Object.assign({}, s, { name: nm });
  });
  if (JSON.stringify(list) !== JSON.stringify(c.sites || [])) await saveCfg({ sites: list });
  return list;
}

async function upsertLocalSite(site) {
  const c = await cfg();
  const list = c.sites.slice();
  const clean = Object.assign({}, site, { name: sanitizeName(site.name, site.base_url) });
  const i = list.findIndex(s => s.base_url === site.base_url);
  if (i >= 0) {
    // 已有站：引擎与搜索规则以库里为准，插件只刷新 cookie / 站名 / 实测结论。
    // 否则每次点「导入当前站点」都会把用户在 NEXUS 站点页手调好的 path/method 冲回默认（方案 B：不覆盖）。
    const prev = list[i];
    const keep = {};
    if (prev.engine) keep.engine = prev.engine;
    if (prev.search && typeof prev.search === 'object') keep.search = prev.search;
    const def = defFor(hostOf(site.base_url || ''));
    if (def.matched && isLegacyDefaultDef(prev.engine, prev.search)) {
      // 例外：库里存的还是旧版插件写死的默认值，说明从没被调过 —— 升级成表里的正确定义，
      // 这不是覆盖用户配置，是修历史默认值（馒头就是这一段的主要受益者）。
      keep.engine = def.engine;
      keep.search = def.search;
    }
    list[i] = Object.assign({}, prev, clean, keep);
  }
  else list.push(clean);
  await saveCfg({ sites: list });
  return list;
}

function badge(n) {
  const txt = n > 0 ? String(n) : '';
  chrome.action.setBadgeText({ text: txt });
  chrome.action.setBadgeBackgroundColor({ color: n > 0 ? '#FF453A' : '#30D158' });
}

// —— 批量识别：把浏览器里所有已打开站点的登录态一次收齐 ——
// 判定分三档，不对站点规则做硬编码：
//   1) NEXUS 站点库里已有的域名 → 直接认（省一次探针）
//   2) 未知域名 → 打一次列表页，返回种子行才算 PT 站（否则记为「不像 PT」跳过）
//   3) douban.com → 单独记一类，只为投喂 cookie，不进站点库
const SCAN_TIMEOUT = 6000;
const SCAN_GAP = 250;         // 每次探针之后歇一下，别把人家打急了
const SCAN_PARALLEL = 4;      // 并发路数：43 站串行 × 6s 会把弹窗拖死
const SCAN_MAX_UNKNOWN = 24;  // 只约束「未知域名」（可能压根不是 PT 站）；NEXUS 站点库里的已知站点全扫，不设上限

function isDoubanHost(h) {
  return /^(www\.)?douban\.com$/i.test(h);
}

// 站点显示名：优先 NEXUS 站点库里登记的名字，其次用注册域（去 www./去尾部域名后缀），
// 绝不拿标签页标题冒充站名 —— 标题是「首页 1PTBA,壹PT吧…」「查看主题 xxx」这种页面文案。
function labelFromHost(host) {
  const h = String(host || '').replace(/^www\./i, '');
  return h || '未命名站点';
}

function nameForHost(host, knownNames) {
  if (knownNames && knownNames.has(host)) return knownNames.get(host);
  if (knownNames) {
    for (const [h, n] of knownNames) {
      if (h && (host === h || host.endsWith('.' + h) || h.endsWith('.' + host))) return n;
    }
  }
  return labelFromHost(host);
}

function knownSiteOf(host, knownHosts) {
  if (knownHosts.has(host)) return true;
  for (const h of knownHosts) {
    if (h && (host.endsWith('.' + h) || h.endsWith('.' + host))) return true;
  }
  return false;
}

// —— 同步门禁：初筛结论决定「默认勾不勾」，用户的选择覆盖默认 ——
// verdict 取值：known（NEXUS 库里已有）/ pt（探针确认是 PT）/ new（上一轮新登记）
//               other（不像 PT 站）/ douban（豆瓣，只投喂 cookie，不进站点库）/ unknown（还没判过）
const VERDICT_LABEL = {
  known: 'NEXUS 库里已有',
  pt: '探针确认是 PT 站',
  new: '上一轮新登记',
  other: '不像 PT 站',
  douban: '豆瓣（只同步 cookie）',
  unknown: '还没判定'
};

// 默认勾选依据：不是站点、豆瓣 → 默认不勾；其余（在库 / 确认是 PT / 未判定）→ 默认勾
function verdictDefaultOn(verdict) {
  if (verdict === 'other' || verdict === 'douban') return false;
  return true;
}

// 域名取值：精确命中优先，其次按父子域互相包含匹配（www.x ↔ x、子域 ↔ 父域）
function pickByHost(map, host) {
  if (!map || !host) return undefined;
  if (Object.prototype.hasOwnProperty.call(map, host)) return map[host];
  for (const h in map) {
    if (!h) continue;
    if (host.endsWith('.' + h) || h.endsWith('.' + host)) return map[h];
  }
  return undefined;
}

function verdictMapOf(gateItems) {
  const m = {};
  (gateItems || []).forEach(x => {
    const h = x && x.host;
    if (h && m[h] === undefined) m[h] = x.verdict || 'unknown';
  });
  return m;
}

// 某个域名这次到底扫不扫：用户显式选择 > 初筛默认值
function gateOn(host, gateChoice, verdictMap) {
  const explicit = pickByHost(gateChoice, host);
  if (explicit === true || explicit === false) return explicit;
  const v = pickByHost(verdictMap, host);
  return verdictDefaultOn(v || 'unknown');
}

// —— 站点定义：哪些站不是 NexusPHP 家族 ——
// 背景：NEXUS 后台 search_engine.py 的 _build_request() 本来就支持
//   path / paths（404 回退候选）/ method GET|POST / keywordParam / params / body / contentType，
// 但旧版插件对每条新站都写死 engine=nexusphp + GET /torrents.php，把这份表达力盖掉了。
// 馒头（M-Team）是 NexusPHP 魔改站：网页端 /torrents.php 只能浏览、搜索走私有 JSON API，
// 所以它必然搜不到（PT-depiler 也是给 mteam 单开一个 schema，见 mteam.ts:303）。
// 维护口径：只在「确认不是 /torrents.php?search= 能搜」的站加一条；其余一律走默认。
const NEXUS_DEFAULT_SEARCH = { path: '/torrents.php', method: 'GET', keywordParam: 'search' };

const SITE_DEFS = [
  {
    test: /(^|\/\/)(kp\.)?m-team\.cc(:|\/|$)/i,
    engine: 'json_api',
    note: '馒头：私有 JSON API，POST /api/torrent/search',
    search: {
      path: '/api/torrent/search',
      paths: ['/api/torrent/search', '/api/v2/torrent/search'],
      method: 'POST',
      contentType: 'application/json',
      keywordParam: 'keyword',
      body: { pageNumber: 1, pageSize: 100 }
    }
  }
];

// 按域名取站点定义；未命中返回默认的 NexusPHP 口径（返回副本，别让调用方改到表里）
function defFor(host) {
  const h = String(host || '');
  for (const d of SITE_DEFS) {
    if (d.test.test(h)) {
      return { engine: d.engine, search: JSON.parse(JSON.stringify(d.search)), matched: true, note: d.note || '' };
    }
  }
  return { engine: 'nexusphp', search: Object.assign({}, NEXUS_DEFAULT_SEARCH), matched: false, note: '' };
}

function makeSite(host, base, name, cookieStr, probe) {
  const def = defFor(host);
  const site = {
    id: host.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
    name,
    base_url: base,
    engine: def.engine,
    enabled: true,
    cookie_synced_at: Math.floor(Date.now() / 1000),
    search: def.search,
    last_probe: { at: Date.now(), ok: !!(probe && probe.ok), code: (probe && probe.diag && probe.diag.code) || 'unknown', label: (probe && probe.diag && probe.diag.label) || '未测' }
  };
  // 读不到 cookie 值时不带这个字段：服务端按字段合并，推空串会把库里已有的 cookie 抹掉
  if (cookieStr) site.cookie = cookieStr;
  return site;
}

// 服务端存的还是旧版插件写死的那一套（nexusphp + GET /torrents.php?search=）？
// 是 → 说明这站从没被人调过，命中定义表时可以安全升级；
// 否（已经是 POST / 自带 paths、params、advance）→ 有人配过，插件一律不动它。
function isLegacyDefaultDef(engine, search) {
  const sp = search || {};
  return (!engine || engine === 'nexusphp')
    && (!sp.path || sp.path === '/torrents.php')
    && ((sp.method || 'GET') === 'GET')
    && ((sp.keywordParam || 'search') === 'search');
}

// 并发池：把 n 个探针压到 limit 路同时跑，结果按入参顺序返回
async function pMapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= list.length) return;
      out[i] = await fn(list[i], i);
    }
  }
  const lanes = Math.min(Math.max(1, limit), Math.max(1, list.length));
  await Promise.all(Array.from({ length: lanes }, worker));
  return out;
}

// —— 扫描进度回传（实时跑码 + 落盘缓存）——
// 设计：每站一行文案，扫描过程中推给弹窗（弹窗关掉则丢弃，不报错），
// 同时节流写 chrome.storage.local，弹窗重开能接着看到这一轮与上一轮。
// 开销：一轮扫描最多几十行、纯文本追加，对性能没有可感影响。
const SCAN_LOG_MAX = 200;
let _scanLines = [];
let _scanFlushTimer = 0;

function emitScan(line) {
  _scanLines.push(line);
  if (_scanLines.length > SCAN_LOG_MAX) _scanLines = _scanLines.slice(-SCAN_LOG_MAX);
  try {
    chrome.runtime.sendMessage({ type: 'scanProgress', line }, () => { void chrome.runtime.lastError; });
  } catch (e) { /* 没有接收者（弹窗已关）属正常 */ }
  if (!_scanFlushTimer) {
    _scanFlushTimer = setTimeout(() => {
      _scanFlushTimer = 0;
      chrome.storage.local.set({ scanLog: _scanLines }).catch(() => {});
    }, 400);
  }
}

function flushScanLog(extra) {
  if (_scanFlushTimer) { clearTimeout(_scanFlushTimer); _scanFlushTimer = 0; }
  return chrome.storage.local.set(Object.assign({ scanLog: _scanLines }, extra || {}));
}

// 长扫描期间保活 service worker：MV3 空闲 30s 会被回收，扫描最坏能跑到 60s 以上
function keepWorkerAlive() {
  const h = setInterval(() => { try { chrome.runtime.getPlatformInfo(() => {}); } catch (e) {} }, 8000);
  return () => clearInterval(h);
}

async function scanOpenSites() {
  _scanLines = [];
  const stopKeepAlive = keepWorkerAlive();
  const t0 = Date.now();
  try { chrome.runtime.sendMessage({ type: 'scanReset' }, () => { void chrome.runtime.lastError; }); } catch (e) {}
  await saveCfg({ scanRunning: { at: t0 }, scanLog: [] });
  emitScan('开始扫描：枚举浏览器里已打开的标签页…');
  try {
    return await scanOpenSitesBody(t0, stopKeepAlive);
  } catch (e) {
    emitScan('✗ 扫描中断：' + String(e && e.message || e));
    await flushScanLog({ scanRunning: null }).catch(() => {});
    throw e;
  } finally {
    stopKeepAlive();
  }
}

async function scanOpenSitesBody(t0, stopKeepAlive) {
  const c = await cfg();
  const nexusHost = hostOf(c.nexusUrl);
  const tabs = await chrome.tabs.query({});
  const hostMap = new Map();
  for (const t of tabs) {
    const base = baseOf(t.url || '');
    if (!base) continue;
    const h = hostOf(base);
    if (!h || h === nexusHost) continue;
    if (!hostMap.has(h)) hostMap.set(h, { base, title: t.title || '', url: t.url || '' });
  }

  // NEXUS 现有站点库：命中就免探针；同时记下「域名 → 站名」，导入时用库里登记的名字
  const knownHosts = new Set();
  const knownNames = new Map();
  const knownDefs = new Map();   // 服务端当前的 engine/search：用于判断「还是不是旧版写死的默认值」
  let libraryCount = 0;
  try {
    const sites = await pullHealth();
    libraryCount = sites.length;
    sites.forEach(s => {
      const h = hostOf(s.base_url || '');
      if (!h) return;
      knownHosts.add(h);
      if (!knownDefs.has(h)) knownDefs.set(h, { engine: s.engine || '', search: s.search || null });
      const nm = String(s.name || '').trim();
      if (nm && !knownNames.has(h)) knownNames.set(h, nm);
    });
  } catch (e) { /* 拉不到库就全靠探针判定 */ }

  // 已知站点优先：先把 NEXUS 站点库里的站点排到前面，未知域名垫底
  const ordered = [...hostMap.entries()].sort((a, b) =>
    (knownSiteOf(a[0], knownHosts) ? 0 : 1) - (knownSiteOf(b[0], knownHosts) ? 0 : 1));
  emitScan('标签页 ' + tabs.length + ' 个 · 去重域名 ' + hostMap.size + ' 个 · NEXUS 站点库 ' + libraryCount + ' 站');

  const items = [];
  const cookieData = {};
  const newSites = [];
  const defFixes = [];   // 已在库里、但定义还是旧版默认值的站：本轮顺手改成正确定义
  const probes = [];
  const tasks = [];
  let unknownLeft = SCAN_MAX_UNKNOWN;
  const verdictMap = verdictMapOf(c.gateItems);

  // 第一步：先过门禁（上一轮初筛 + 用户选择），再读 cookie（本地 API，无网络开销）
  for (const [host, t] of ordered) {
    const name = nameForHost(host, knownNames);
    const knownNow = knownSiteOf(host, knownHosts);
    if (!gateOn(host, c.gateChoice, verdictMap)) {
      const v = pickByHost(verdictMap, host) || (knownNow ? 'known' : 'unknown');
      items.push({
        host, name, kind: v === 'douban' ? 'douban' : 'pt', status: 'gated', known: knownNow,
        label: '门禁未勾选（' + (VERDICT_LABEL[v] || '默认不勾') + '），本次不读 cookie、不探针、不推送',
        action: '设置 → 同步门禁 勾回来，再点「扫描已打开站点」'
      });
      emitScan('· ' + name + ' 门禁未勾选，跳过');
      continue;
    }
    const cks = await cookiesFor(host, t.base);
    if (!cks.length) {
      // 读不到 cookie 值 ≠ 没登录。PT-depiler 就是这么判的：请求交给浏览器发出，
      // cookie 由 Chromium 按 URL 自己带（父域、SameSite、分区键全在它手里），
      // 我们只看响应。站点库里的站一律实测一次，别把「读不到」当结论。
      if (knownNow && !isDoubanHost(host)) {
        tasks.push({ host, base: t.base, name, cookieStr: '', known: true, noCookie: true });
        emitScan('· ' + name + ' 本地读不到 cookie 值，改由浏览器直接带凭据实测…');
        continue;
      }
      items.push({
        host, name, kind: isDoubanHost(host) ? 'douban' : 'pt', status: 'nocookie', known: knownNow,
        label: knownNow ? '站点在库里，但浏览器里没有登录态' : '没有可读 cookie（没登录过）',
        action: knownNow ? '在该站登录一次，再点「扫描已打开站点」重扫' : ''
      });
      emitScan('· ' + name + (knownNow ? ' 在库里但没有登录态' : ' 没有可读 cookie（没登录过）'));
      continue;
    }
    const cookieStr = cookieHeader(cks);
    if (isDoubanHost(host)) {
      cookieData[host] = cookieStr;
      items.push({ host, name: '豆瓣', kind: 'douban', status: 'synced', label: '登录态已收集（投喂 NEXUS/MP 的 cookie 库）', cookieBytes: cookieStr.length });
      emitScan('✓ 豆瓣 登录态已收集（' + cookieStr.length + ' 字节）');
      continue;
    }
    const known = knownNow;
    if (!known) {
      if (unknownLeft <= 0) {
        items.push({ host, name, kind: 'pt', status: 'skip', label: '未知域名探针配额已满（已知站点不受限）' });
        continue;
      }
      unknownLeft--;
    }
    tasks.push({ host, base: t.base, name, cookieStr, known });
  }

  // 第二步：探针并发跑（4 路），串行 43 站 × 6s 会把弹窗拖到超时
  emitScan('开始实测 ' + tasks.length + ' 站（' + SCAN_PARALLEL + ' 路并发，单站超时 ' + (SCAN_TIMEOUT / 1000) + 's）…');
  const results = await pMapLimit(tasks, SCAN_PARALLEL, async (task) => {
    const p = await probeSite(task.base, { query: 'test', timeout: SCAN_TIMEOUT, def: defFor(task.host) });
    await new Promise(r => setTimeout(r, SCAN_GAP));
    const d = p.diag || {};
    emitScan((p.ok ? '✓ ' : '✗ ') + task.name + ' ' + (p.ok ? (task.noCookie ? '已登录（浏览器直连可用，无 cookie 值）' : (p.count ? ('已登录（' + p.count + ' 条可抓）') : '已登录（搜索 test 无结果）')) : (d.label || '待确认'))
      + ' · ' + (p.ms || 0) + 'ms' + (task.known ? '（库内）' : '（新站）'));
    return { task, p };
  });

  // 第三步：合并结果（按并发入参顺序，保证输出稳定）
  for (const { task, p } of results) {
    const host = task.host, name = task.name, known = task.known, cookieStr = task.cookieStr;
    const isPt = known || (p.ok && (p.count || 0) > 0);
    if (!isPt) {
      items.push({ host, name, kind: 'other', status: 'skip', label: '不像 PT 站（' + ((p.diag && p.diag.label) || '无种子行') + '），已跳过' });
      emitScan('· ' + name + ' 不像 PT 站，跳过');
      continue;
    }
    if (cookieStr) cookieData[host] = cookieStr;   // 读不到值时别拿空串覆盖 NEXUS 里已有的 cookie
    const site = makeSite(host, task.base, name, cookieStr, p);
    if (!known) {
      newSites.push(site);
      emitScan('＋ ' + (site.name || name) + ' 登记为新站（' + host + '）');
    } else {
      // 已在库里：只有「定义还是旧版默认值、且定义表说这站不一样」才重推一次（修正历史默认值），
      // 其余一律不推 sites，避免把用户手调过的规则冲掉。
      const def = defFor(host);
      const cur = knownDefs.get(host);
      if (def.matched && cur && isLegacyDefaultDef(cur.engine, cur.search)) {
        defFixes.push(site);
        emitScan('~ ' + (site.name || name) + ' 定义升级：' + def.engine + ' ' + def.search.method + ' ' + def.search.path + '（原为旧版默认 /torrents.php）');
      }
    }
    probes.push({ id: site.id, ok: p.ok, ms: p.ms, diag: p.diag });
    items.push({
      host, name, kind: 'pt', status: p.ok ? 'synced' : 'stale',
      known, label: p.ok
        ? (p.count ? ('已登录（' + p.count + ' 条可抓）')
          : (cookieStr ? '已登录（搜索 test 无结果）' : '已登录（浏览器直连可用；本地读不到 cookie 值，NEXUS 端仍缺）'))
        : ((p.diag && p.diag.label) || '登录态待确认'),
      action: p.ok ? '' : ((p.diag && p.diag.action) || ''), ms: p.ms
    });
  }

  // 第四步：本地站点库串行落盘，避免并发写 config 互相覆盖
  for (const s of newSites.concat(defFixes)) await upsertLocalSite(s);

  // 第五步：把本轮初筛结论写回门禁清单（下次进设置页看到的就是这批事实依据）
  const fresh = new Map();
  for (const it of items) {
    let v;
    if (it.status === 'gated') {
      v = pickByHost(verdictMap, it.host) || (it.known ? 'known' : 'unknown');   // 被门禁跳过就沿用旧结论
    } else if (it.kind === 'douban') {
      v = 'douban';
    } else if (it.kind === 'other') {
      v = 'other';
    } else if (it.known) {
      v = 'known';
    } else if (it.status === 'synced' || it.status === 'stale') {
      v = 'pt';                       // 探针认过是 PT，登录态坏了也还是 PT 站
    } else {
      v = it.status === 'nocookie' ? 'unknown' : 'unknown';
    }
    if (!fresh.has(it.host)) fresh.set(it.host, { host: it.host, name: it.name, verdict: v, at: Date.now() });
  }
  await saveCfg({ gateItems: [...fresh.values()] });

  const summary = {
    tabs: tabs.length,
    hosts: hostMap.size,
    library: libraryCount,
    gated: items.filter(x => x.status === 'gated').length,
    ptSynced: items.filter(x => x.kind === 'pt' && x.status === 'synced').length,
    ptNew: newSites.length,
    ptFixed: defFixes.length,
    douban: items.filter(x => x.kind === 'douban' && x.status === 'synced').length,
    skipped: items.filter(x => x.status === 'skip' || x.status === 'nocookie').length,
    items
  };

  let nexus = null, cookieSync = null, error = '';
  try {
    if (Object.keys(cookieData).length) {
      emitScan('推送登录态：' + Object.keys(cookieData).length + ' 个域名 → NEXUS / MP…');
      cookieSync = await pushCookieData(cookieData);
    }
    if (newSites.length || defFixes.length) {
      emitScan('推送站点定义：' + newSites.length + ' 个新站' + (defFixes.length ? (' + ' + defFixes.length + ' 个定义升级') : '') + ' → NEXUS 站点库…');
      nexus = await pushSites(newSites.concat(defFixes), probes);
    }
    if (cookieSync) {
      emitScan('NEXUS 已收到：站点库更新 ' + (cookieSync.sites_updated || 0) + ' 个 / MP 更新 ' + (cookieSync.mp_updated || 0) + ' 个');
    }
    if (nexus) emitScan('站点库已推：新增 ' + (nexus.added || 0) + ' / 更新 ' + (nexus.updated || 0) + ' 站');
  } catch (e) {
    error = String(e && e.message || e);
    emitScan('✗ 推送失败：' + error);
  }
  summary.nexus = nexus;
  summary.cookieSync = cookieSync;
  summary.error = error;
  summary.at = Date.now();
  summary.ms = summary.at - t0;
  emitScan((error ? '结束（有推送失败）：' : '完成：') + summary.ptSynced + ' 站已登录 / ' + newSites.length
    + ' 个新站 / 门禁跳过 ' + summary.gated + ' 站 · 用时 ' + (summary.ms / 1000).toFixed(1) + 's');
  // 缓存本轮明细：弹窗关掉再打开，直接读这份，不用重扫
  await flushScanLog({
    scanRunning: null,
    lastScanSummary: {
      at: summary.at, ms: summary.ms,
      tabs: summary.tabs, hosts: summary.hosts, library: summary.library,
      ptSynced: summary.ptSynced, ptNew: summary.ptNew, douban: summary.douban,
      gated: summary.gated, skipped: summary.skipped,
      sitesUpdated: (cookieSync && cookieSync.sites_updated) || 0,
      mpUpdated: (cookieSync && cookieSync.mp_updated) || 0,
      nexusAdded: (nexus && nexus.added) || 0, nexusUpdated: (nexus && nexus.updated) || 0,
      nexusSaved: (nexus && nexus.saved) || 0,
      error: error || '',
      items: summary.items.slice(0, 200)
    }
  });
  try { chrome.runtime.sendMessage({ type: 'scanDone', summary: { at: summary.at, error: error || '' } }, () => { void chrome.runtime.lastError; }); } catch (e) {}
  if (stopKeepAlive) stopKeepAlive();
  // 工具栏角标：关掉弹窗也能看到「这次同步了几站」；10 秒后自动落回异常数
  const okCount = summary.ptSynced + summary.ptNew;
  if (okCount > 0 && !error) {
    try {
      chrome.action.setBadgeBackgroundColor({ color: '#30D158' });
      chrome.action.setBadgeText({ text: okCount > 99 ? '99+' : String(okCount) });
      setTimeout(() => { badge(0); }, 10000);
    } catch (e) { /* ignore */ }
  } else {
    badge(0);
  }
  return summary;
}


// 定时保活：逐站探测（带请求间隔），cookie 变了就重推，失败就在角标记数
async function keepalive() {
  const c = await cfg();
  if (!c.sites.length) return;
  let bad = 0;
  const probes = [];
  for (const s of c.sites) {
    await new Promise(r => setTimeout(r, 1200));   // 站间间隔，别把人家打急了
    const p = await probeSite(s.base_url, { query: 'test' });
    if (!p.ok) bad++;
    probes.push({ id: s.id, ok: p.ok, ms: p.ms, diag: p.diag });
    const cks = await cookiesFor(hostOf(s.base_url), s.base_url);
    const header = cookieHeader(cks);
    if (header && header !== s.cookie) s.cookie = header;
    s.cookie = header || s.cookie;
    s.last_probe = { at: Date.now(), ok: p.ok, code: p.diag.code, label: p.diag.label };
  }
  await saveCfg({ sites: c.sites });
  try { await pushSites(c.sites, probes); } catch (e) { /* NEXUS 不在线也不阻塞 */ }
  badge(bad);
  await saveCfg({ lastKeepalive: Date.now() });
}

// —— 同步门禁清单 ——
// 数据源优先级：最近一次初筛结果 > NEXUS 站点库 > 本地登记。
// 每项都带「默认该不该勾」的依据，用户显式选择优先。
async function gateList() {
  const c = await cfg();
  let rows = [];
  let source = 'scan';
  if (c.gateItems.length) {
    rows = c.gateItems.map(x => ({ host: x.host, name: x.name, verdict: x.verdict || 'unknown' }));
  } else {
    source = 'nexus';
    try {
      const lib = await pullHealth();
      rows = lib.map(s => ({ host: hostOf(s.base_url || ''), name: String(s.name || '').trim(), verdict: 'known' }));
    } catch (e) { /* 拉不到库就退到本地登记 */ }
    if (!rows.length) {
      source = 'local';
      rows = (c.sites || []).map(s => ({ host: hostOf(s.base_url || ''), name: String(s.name || '').trim(), verdict: 'known' }));
    }
  }
  const seen = new Set();
  const items = [];
  for (const r of rows) {
    if (!r.host || seen.has(r.host)) continue;
    seen.add(r.host);
    const v = r.verdict || 'unknown';
    const def = verdictDefaultOn(v);
    const explicit = pickByHost(c.gateChoice, r.host);
    items.push({
      host: r.host,
      name: r.name || r.host,
      verdict: v,
      verdictLabel: VERDICT_LABEL[v] || VERDICT_LABEL.unknown,
      defaultOn: def,
      on: (explicit === true || explicit === false) ? explicit : def,
      explicit: (explicit === true || explicit === false) ? explicit : null
    });
  }
  items.sort((a, b) => (a.on === b.on ? String(a.name).localeCompare(String(b.name), 'zh') : (a.on ? -1 : 1)));
  return {
    source, total: items.length,
    on: items.filter(x => x.on).length,
    offCount: items.filter(x => !x.on).length,
    items
  };
}

async function setGate(host, on) {
  const c = await cfg();
  const choice = Object.assign({}, c.gateChoice);
  choice[host] = !!on;          // 显式选择，覆盖初筛默认
  await saveCfg({ gateChoice: choice });
  return { host, on: !!on, explicit: Object.keys(choice).length };
}

// mode: 'on' 全勾 / 'off' 全不勾 / 'default' 清空覆盖、回到初筛默认
async function setGateAll(mode) {
  const g = await gateList();
  if (mode === 'default') {
    await saveCfg({ gateChoice: {} });
    return { mode, total: g.total, on: g.items.filter(x => x.defaultOn).length, explicit: 0 };
  }
  const on = mode === 'on';
  const choice = {};
  g.items.forEach(x => { choice[x.host] = on; });
  await saveCfg({ gateChoice: choice });
  return { mode, total: g.total, on: on ? g.total : 0, explicit: Object.keys(choice).length };
}

chrome.runtime.onInstalled.addListener(async () => {
  const c = await cfg();
  chrome.alarms.create('keepalive', { periodInMinutes: Math.max(5, c.autoMin) });
  // 旧版把标签页标题存成了站名，升级后就地清洗一次
  try { await sanitizeLocalSites(); } catch (e) { }
});

chrome.alarms.onAlarm.addListener(a => { if (a.name === 'keepalive') keepalive(); });

// popup / options 消息路由
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    try {
      if (msg.type === 'config') return reply({ ok: true, data: await cfg() });
      if (msg.type === 'probeNexus') return reply(await probeNexus());
      if (msg.type === 'saveAddress') {
        await saveCfg({ nexusUrl: normUrl(msg.nexusUrl) });
        return reply({ ok: true, nexusUrl: normUrl(msg.nexusUrl) });
      }
      if (msg.type === 'login') {
        await saveCfg({
          username: msg.username, password: msg.password,
          nexusUrl: normUrl(msg.nexusUrl),
          autoMin: (msg.autoMin === undefined || isNaN(msg.autoMin)) ? 30 : msg.autoMin
        });
        const t = await login();
        const c = await cfg();
        return reply({ ok: true, token: t.slice(0, 6) + '…', nexusUrl: c.nexusUrl, note: _urlNote });
      }
      if (msg.type === 'currentTab') {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const t = tabs[0] || {};
        return reply({ ok: true, data: { url: t.url || '', title: t.title || '', base: baseOf(t.url || ''), host: hostOf(t.url || '') } });
      }
      if (msg.type === 'addCurrent') {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const t = tabs[0] || {};
        const base = baseOf(t.url || '');
        if (!base) throw new Error('当前页不是 http(s) 站点');
        const host = hostOf(base);
        const name = (t.title || host).replace(/[-|·].*$/, '').trim() || host;
        const cks = await cookiesFor(host, base);
        if (!cks.length) throw new Error('这个站没有可读 cookie（可能没登录）');
        const p = await probeSite(base, { query: msg.q || 'test', def: defFor(host) });
        const site = makeSite(host, base, name, cookieHeader(cks), p);
        // 已有站：引擎/搜索规则以库里为准，插件只推 cookie 与本次实测结论（不覆盖手调过的规则）
        const c0 = await cfg();
        const prev = (c0.sites || []).find(s => s.base_url === site.base_url || s.id === site.id);
        if (prev) {
          if (prev.engine) site.engine = prev.engine;
          if (prev.search && typeof prev.search === 'object') site.search = prev.search;
          // 库里还是旧版默认定义 → 推表里的正确定义（否则会把服务端刚调好的规则冲回 /torrents.php）
          const def = defFor(host);
          if (def.matched && isLegacyDefaultDef(prev.engine, prev.search)) {
            site.engine = def.engine;
            site.search = def.search;
          }
        }
        await upsertLocalSite(site);
        const r = await pushSites([site], [{ id: site.id, ok: p.ok, ms: p.ms, diag: p.diag }]);
        return reply({ ok: true, probe: p, site: { name: site.name, base_url: site.base_url }, nexus: r });
      }
      if (msg.type === 'probeAll') {
        const c = await cfg();
        const out = [];
        for (const s of c.sites) {
          const p = await probeSite(s.base_url, { query: 'test', def: defFor(hostOf(s.base_url)) });
          out.push({ id: s.id, name: s.name, ok: p.ok, ms: p.ms, diag: p.diag });
          await new Promise(r => setTimeout(r, 1200));
        }
        // 只推探针结论：不带 engine/search，避免「全部重测」把用户手调过的站点定义冲回默认
        await pushSites(c.sites.map(s => ({ id: s.id, name: s.name, base_url: s.base_url })), out).catch(() => {});
        return reply({ ok: true, list: out });
      }
      if (msg.type === 'health') return reply({ ok: true, list: await pullHealth() });
      if (msg.type === 'gateList') return reply({ ok: true, data: await gateList() });
      if (msg.type === 'saveGate') return reply({ ok: true, data: await setGate(String(msg.host || ''), !!msg.on) });
      if (msg.type === 'gateAll') return reply({ ok: true, data: await setGateAll(msg.mode || (msg.on ? 'on' : 'off')) });
      if (msg.type === 'scanOpen') { const r = await scanOpenSites(); return reply({ ok: true, data: r }); }
      if (msg.type === 'keepaliveNow') { await keepalive(); return reply({ ok: true }); }
      return reply({ ok: false, error: '未知指令 ' + msg.type });
    } catch (e) {
      reply({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true;   // 异步回复
});
