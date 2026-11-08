// NEXUS 站点管家 — popup 逻辑
// 扫描进度：后台逐站推 scanProgress，这里逐行追加；同时后台把这一轮写进 storage，
// 所以弹窗关掉再打开，既能看见正在跑的进度，也能看见上一轮的完整明细，不用重扫。
const $ = id => document.getElementById(id);
const send = msg => new Promise(res => chrome.runtime.sendMessage(msg, r => res(r || { ok: false, error: '后台没响应（扩展可能在更新，关掉重开）' })));

const LOG_MAX = 200;

// 按钮点击必须有反馈：转圈 + 文案换成进度，结束还原
async function busy(btn, text, fn) {
  const old = btn.textContent;
  btn.classList.add('loading');
  btn.disabled = true;
  btn.textContent = text;
  try { return await fn(); }
  finally { btn.classList.remove('loading'); btn.disabled = false; btn.textContent = old; }
}

function setScanBtn(on, text) {
  const btn = $('btnScan');
  if (on) {
    if (!btn.dataset.old) btn.dataset.old = btn.textContent;
    btn.classList.add('loading');
    btn.disabled = true;
    btn.textContent = text || '扫描中…';
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
    btn.textContent = btn.dataset.old || '扫描已打开的站点并同步';
  }
}

// 日志：一行一个 div，追加比整段重写便宜；超过 200 行丢最老的
function logClear() {
  const el = $('log');
  el.textContent = '';
  el.dataset.placeholder = '0';
}

function logLines(lines) {
  const el = $('log');
  el.textContent = '';
  const frag = document.createDocumentFragment();
  (lines || []).slice(-LOG_MAX).forEach(s => {
    const d = document.createElement('div');
    d.className = 'lg';
    d.textContent = s;
    frag.appendChild(d);
  });
  el.appendChild(frag);
  el.dataset.placeholder = '0';
  el.scrollTop = el.scrollHeight;
}

function log(line) {
  const el = $('log');
  if (el.dataset.placeholder === '1') { el.textContent = ''; el.dataset.placeholder = '0'; }
  const d = document.createElement('div');
  d.className = 'lg';
  d.textContent = line;
  el.appendChild(d);
  while (el.children.length > LOG_MAX) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

// 顶部的结论条：成功绿点 / 失败红点 + 一句话，用户不用翻日志就知道结果
function banner(kind, text) {
  const el = $('banner');
  el.hidden = false;
  el.className = 'nx-msg ' + kind;
  el.querySelector('.dot').className = 'dot ' + (kind === 'ok' ? 'ok' : kind === 'bad' ? 'bad' : 'info');
  el.querySelector('.txt').textContent = text;
}

function setNexus(ok, text) {
  $('nexusDot').className = 'dot ' + (ok ? 'ok' : 'bad');
  $('curNexus').textContent = text;
}

function pushResultLine(r) {
  const n = r.nexus || {};
  const added = n.added || 0, updated = n.updated || 0, saved = n.saved || 0;
  return 'NEXUS 已收到：新增 ' + added + ' 站 / 更新 ' + updated + ' 站（站点库共 ' + saved + ' 站）';
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// 上次扫描的一句话结论（与扫描按钮里的口径保持一致）
function summaryText(s) {
  if (!s) return '';
  if (s.error) return '上次扫描 ' + fmtTime(s.at) + ' 站点已收集，但推送失败：' + s.error;
  return '上次扫描 ' + fmtTime(s.at) + '：' + (s.ptSynced || 0) + ' 站已登录 / ' + (s.ptNew || 0) + ' 个新站'
    + (s.ptFixed ? (' · 定义升级 ' + s.ptFixed + ' 站') : '')
    + (s.gated ? (' · 门禁跳过 ' + s.gated + ' 站') : '')
    + ' · NEXUS 更新 ' + (s.sitesUpdated || 0) + ' 个 / MP ' + (s.mpUpdated || 0) + ' 个';
}

async function boot() {
  const t = await send({ type: 'currentTab' });
  if (t.ok && t.data) {
    const base = t.data.base || '';
    $('curSite').textContent = base ? (t.data.title || base).slice(0, 34) + ' · ' + t.data.host : '（不是网页）';
    $('btnAdd').disabled = !base;
  }
  const c = await send({ type: 'config' });
  if (c.ok) {
    setNexus(!!c.data.token, c.data.nexusUrl + (c.data.token ? ' · 已登录' : ' · 未登录（去设置里登录）'));
    const items = c.data.gateItems || [];
    const known = items.filter(x => x.verdict === 'known').length;
    $('tipChip').textContent = items.length
      ? ('门禁 ' + items.length + ' 项候选（其中 ' + known + ' 站在库里）')
      : '门禁等你扫描一次后生成';
  }

  // 恢复现场：正在扫描 → 按钮保持转圈，日志接上已有进度；否则显示上一轮的结论与明细
  const st = await chrome.storage.local.get(['scanLog', 'scanRunning', 'lastScanSummary']);
  const lines = Array.isArray(st.scanLog) ? st.scanLog : [];
  const running = !!(st.scanRunning && st.scanRunning.at);
  if (lines.length) logLines(lines);
  if (running) {
    setScanBtn(true, '扫描中…');
    banner('busy', '正在扫描…（后台进行中，关掉弹窗也会继续跑到结束）');
    $('logMeta').textContent = '本轮进行中 · 开始于 ' + fmtTime(st.scanRunning.at);
  } else if (st.lastScanSummary) {
    banner(st.lastScanSummary.error ? 'bad' : 'ok', summaryText(st.lastScanSummary));
    $('logMeta').textContent = '上一轮记录 · ' + fmtTime(st.lastScanSummary.at)
      + (st.lastScanSummary.ms ? (' · 用时 ' + (st.lastScanSummary.ms / 1000).toFixed(1) + 's') : '');
  } else {
    $('logMeta').textContent = '尚未扫描';
  }
}

// 后台推送：新增一行进度 / 新扫描开始清屏 / 扫描结束刷新结论
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'scanProgress') {
    log(msg.line);
    $('logMeta').textContent = '本轮进行中';
  } else if (msg.type === 'scanReset') {
    logClear();
    setScanBtn(true, '扫描中…');
    banner('busy', '正在扫描…');
    $('logMeta').textContent = '本轮进行中';
  } else if (msg.type === 'scanDone') {
    setScanBtn(false);
    chrome.storage.local.get(['lastScanSummary']).then(st => {
      const s = st.lastScanSummary;
      banner(s && s.error ? 'bad' : (s ? 'ok' : 'info'), summaryText(s) || '扫描结束');
      $('logMeta').textContent = s ? ('上一轮记录 · ' + fmtTime(s.at) + (s.ms ? (' · 用时 ' + (s.ms / 1000).toFixed(1) + 's') : '')) : '';
    }).catch(() => {});
  }
});

$('btnAdd').onclick = () => busy($('btnAdd'), '导入中…', async () => {
  log('开始：读取 cookie → 实测 → 推送…');
  const r = await send({ type: 'addCurrent', q: 'test' });
  if (!r.ok) { banner('bad', '导入失败：' + r.error); return log('✗ ' + r.error); }
  const p = r.probe || {};
  const d = p.diag || {};
  if (p.ok) {
    banner('ok', '已导入「' + ((r.site && r.site.name) || '') + '」并推送 · ' + pushResultLine(r));
  } else {
    banner('bad', '推了但在站上没验通：' + (d.label || '失败') + (d.action ? ' → ' + d.action : ''));
  }
  log((p.ok ? '✓ 站点可用' : '✗ ' + (d.label || '失败')) + '（' + (p.ms || 0) + 'ms）'
    + (d.action ? '\n→ ' + d.action : ''));
  if (r.nexus) log(pushResultLine(r));
});

// 对标 PTD 的「一把抓」：枚举所有已打开标签页 → 匹配 PT/豆瓣站 → 读 cookie → 同步 NEXUS + MP
// 进度由后台逐站推回来（scanProgress），这里只负责触发与收尾
$('btnScan').onclick = async () => {
  logClear();
  setScanBtn(true, '扫描中…');
  banner('busy', '正在扫描浏览器里已打开的站点（只扫门禁放行的），逐个读 cookie 并实测…');
  $('logMeta').textContent = '本轮进行中';
  const r = await send({ type: 'scanOpen' });
  setScanBtn(false);
  // 正常路径下结论已由 scanDone 推回来；这里兜住后台异常（例如扩展被重载）
  if (!r.ok) {
    banner('bad', '扫描失败：' + r.error);
    log('✗ ' + r.error);
  }
};

$('btnProbe').onclick = () => busy($('btnProbe'), '实测中…', async () => {
  log('逐站实测中（每站间隔 1.2s，避免打急）…');
  const r = await send({ type: 'probeAll' });
  if (!r.ok) { banner('bad', '实测失败：' + r.error); return log('✗ ' + r.error); }
  const list = r.list || [];
  const bad = list.filter(x => !x.ok);
  banner(bad.length ? 'info' : 'ok', '实测完成：' + (list.length - bad.length) + ' 站正常 / ' + bad.length + ' 站待处理');
  log('完成：' + (list.length - bad.length) + ' 站正常 / ' + bad.length + ' 站待处理');
  bad.slice(0, 6).forEach(x => log('  · ' + x.name + '：' + (x.diag && x.diag.label) + ' → ' + (x.diag && x.diag.action)));
});

$('btnKeep').onclick = () => busy($('btnKeep'), '同步中…', async () => {
  const r = await send({ type: 'keepaliveNow' });
  banner(r.ok ? 'ok' : 'bad', r.ok ? '保活完成，cookie 有变化的站已重推 NEXUS' : '保活失败：' + r.error);
  log(r.ok ? '保活完成（cookie 有变化的站已重推）' : '✗ ' + r.error);
});

$('btnSync').onclick = () => busy($('btnSync'), '读取中…', async () => {
  const r = await send({ type: 'health' });
  if (!r.ok) { banner('bad', '读取失败：' + r.error); return log('✗ ' + r.error); }
  const list = r.list || [];
  const bad = list.filter(x => x.state !== 'ok');
  banner(bad.length ? 'info' : 'ok', 'NEXUS 共 ' + list.length + ' 站，异常 ' + bad.length + ' 站');
  log('NEXUS 共 ' + list.length + ' 站，异常 ' + bad.length + ' 站');
  bad.slice(0, 8).forEach(x => {
    const why = x.diag ? (x.diag.label + ' → ' + x.diag.action) : (x.reason || '');
    log('  · ' + x.name + '（' + x.state + '）' + why);
  });
});

// 首次打开：先铺占位，再按缓存恢复
$('log').textContent = '准备就绪';
$('log').dataset.placeholder = '1';
boot();
