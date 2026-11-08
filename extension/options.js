// NEXUS 站点管家 — options
const $ = id => document.getElementById(id);
const send = msg => new Promise(res => chrome.runtime.sendMessage(msg, r => res(r || { ok: false, error: '后台没响应（扩展可能在更新，重开这个页面再试）' })));

// —— 统一的按钮载入态：文案换掉 + 转圈 + 禁用，结束后一定还原 ——
async function withBusy(btn, busyText, fn) {
  const old = btn.textContent;
  btn.classList.add('loading');
  btn.disabled = true;
  btn.textContent = busyText;
  try { return await fn(); }
  finally {
    btn.classList.remove('loading');
    btn.disabled = false;
    btn.textContent = old;
  }
}

// —— 一句话状态：不隐藏、不跳版，只换圆点颜色 ——
function showMsg(kind, text) {
  const el = $('msg');
  el.hidden = false;
  el.className = 'nx-msg ' + kind;
  el.querySelector('.txt').textContent = text;
}

// 等待中的秒表：长请求（最长 15s）期间让用户看到「已等 Ns」，不是一片静止
function busyTick(prefix) {
  const el = $('msg');
  el.hidden = false;
  el.className = 'nx-msg busy';
  const txt = el.querySelector('.txt');
  txt.textContent = prefix;
  let s = 0;
  const id = setInterval(() => { s += 1; txt.textContent = prefix + '（已等 ' + s + 's）'; }, 1000);
  return () => clearInterval(id);
}

async function boot() {
  const c = await send({ type: 'config' });
  if (!c.ok) return;
  const d = c.data || {};
  $('nexusUrl').value = d.nexusUrl || '';
  $('username').value = d.username || '';
  $('password').value = d.password || '';
  $('autoMin').value = d.autoMin === undefined ? 30 : d.autoMin;
  renderSites(d.sites || []);
  renderLastScan(d.lastScanSummary);
  renderGate();
  if (d.token) showMsg('ok', '已登录（令牌在本机扩展存储里，界面不显示）');
}

// —— 同步门禁：初筛给默认值（在库/是 PT 默认勾，非 PT/豆瓣默认不勾），用户的选择覆盖默认 ——
async function renderGate() {
  const el = $('gateList'), stat = $('gateStat');
  if (!el) return;
  const r = await send({ type: 'gateList' });
  if (!r.ok) { stat.textContent = '读取失败'; el.textContent = r.error || ''; return; }
  const d = r.data || {};
  const srcMap = { scan: '最近一次初筛', nexus: 'NEXUS 站点库', local: '本地登记' };
  const src = srcMap[d.source] || '初筛';
  const changed = (d.items || []).filter(x => x.explicit !== null).length;
  stat.textContent = '已勾 ' + (d.on || 0) + ' / ' + (d.total || 0) + ' 站' + (changed ? ('，你改过 ' + changed + ' 项') : '');
  if (!d.items || !d.items.length) {
    el.textContent = '还没有候选站点。打开一批 PT 站后点一次「扫描已打开站点」，这里就会出现清单（以及每项该不该勾的依据）。';
    return;
  }
  el.innerHTML = d.items.map(x =>
    '<div class="gate-row">'
    + '<label><input type="checkbox" data-host="' + esc(x.host) + '"' + (x.on ? ' checked' : '') + '>'
    + '<span>' + esc(x.name) + '</span></label>'
    + '<span class="gate-tags">'
    + '<span class="gate-why' + (x.defaultOn ? '' : ' off') + '">' + esc(x.verdictLabel) + (x.explicit !== null ? ' · 已手改' : '') + '</span>'
    + '<span class="gate-host">' + esc(x.host) + '</span>'
    + '</span></div>').join('');
  const total = d.items.length;
  el.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.onchange = async () => {
      const res = await send({ type: 'saveGate', host: cb.dataset.host, on: cb.checked });
      if (!res.ok) {
        cb.checked = !cb.checked;
        showMsg('bad', '门禁没保存成功：' + (res.error || '未知原因'));
        return;
      }
      const onCount = [...el.querySelectorAll('input[type=checkbox]')].filter(x => x.checked).length;
      const changedNow = [...el.querySelectorAll('.gate-why')].filter(x => x.textContent.indexOf('已手改') >= 0).length;
      stat.textContent = '已勾 ' + onCount + ' / ' + total + ' 站' + (changedNow ? ('，你改过 ' + changedNow + ' 项') : '');
      const row = cb.closest('.gate-row');
      const why = row && row.querySelector('.gate-why');
      if (why && why.textContent.indexOf('已手改') < 0) why.textContent = why.textContent + ' · 已手改';
      showMsg('ok', (cb.checked ? '已勾选并会同步：' : '已取消，扫描时跳过：') + cb.dataset.host + '（来源：' + src + '）');
    };
  });
}

// 上次扫描/导入回执：插件端也要看得见结果，不能静默
function renderLastScan(s) {
  const el = $('lastScan');
  if (!el) return;
  if (!s || !s.at) { el.textContent = '还没有扫描过。打开 PT 站后在弹出面板点「扫描已开站点」即可。'; return; }
  const t = new Date(s.at);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  const at = (t.getMonth() + 1) + '-' + pad(t.getDate()) + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes());
  el.textContent = s.error
    ? ('上次扫描 ' + at + ' · 推送失败：' + s.error)
    : ('上次扫描 ' + at + ' · ' + (s.ptSynced || 0) + ' 站已同步 / 新登记 ' + (s.ptNew || 0)
       + ' 站 · 豆瓣 ' + (s.douban || 0) + (s.gated ? (' · 门禁跳过 ' + s.gated + ' 站') : '')
       + ' · NEXUS 站点库更新 ' + (s.sitesUpdated || 0)
       + ' 个 / MP 更新 ' + (s.mpUpdated || 0) + ' 个');
}

function renderSites(list) {
  const el = $('siteList');
  if (!list.length) { el.textContent = '还没有登记站点。打开一个 PT 站，点插件「导入当前站点并推送」即可。'; return; }
  el.innerHTML = list.map(s => {
    const p = s.last_probe || {};
    const ok = p.ok ? '✓ 正常' : ('✗ ' + (p.label || '未测'));
    return '<div>' + esc(s.name || '') + ' · ' + esc(s.base_url || '') + ' — ' + esc(ok) + '</div>';
  }).join('');
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 门禁批量操作：全选 / 全不选写显式选择；「按初筛恢复」清空覆盖，回到默认值
$('gateAllOn').onclick = () => withBusy($('gateAllOn'), '处理中…', async () => {
  const r = await send({ type: 'gateAll', mode: 'on' });
  if (!r.ok) { showMsg('bad', '全选失败：' + (r.error || '未知原因')); return; }
  showMsg('ok', '已全部勾选（' + ((r.data && r.data.total) || 0) + ' 站）');
  await renderGate();
});

$('gateAllOff').onclick = () => withBusy($('gateAllOff'), '处理中…', async () => {
  const r = await send({ type: 'gateAll', mode: 'off' });
  if (!r.ok) { showMsg('bad', '全不选失败：' + (r.error || '未知原因')); return; }
  showMsg('info', '已全部取消，下次扫描不会读任何站的 cookie');
  await renderGate();
});

$('gateDefault').onclick = () => withBusy($('gateDefault'), '处理中…', async () => {
  const r = await send({ type: 'gateAll', mode: 'default' });
  if (!r.ok) { showMsg('bad', '恢复失败：' + (r.error || '未知原因')); return; }
  showMsg('ok', '已按初筛结论恢复默认（' + ((r.data && r.data.on) || 0) + ' 站默认勾选）');
  await renderGate();
});

// 测试连接：只探地址通不通，不校验账号
$('testConn').onclick = () => withBusy($('testConn'), '测试中…', async () => {
  // 先把手填的地址存进去，否则后台用的是上次保存的地址
  await send({ type: 'saveAddress', nexusUrl: $('nexusUrl').value.trim() });
  const addr = $('nexusUrl').value.trim() || '（空地址）';
  const stop = busyTick('正在连 ' + addr + ' …');
  const r = await send({ type: 'probeNexus' });
  stop();
  if (r.ok) {
    if (r.note) { $('nexusUrl').value = r.url; showMsg('info', r.note); }
    else showMsg('ok', '能连通 ' + r.url + '（HTTP ' + r.status + '，' + r.ms + 'ms）');
  } else showMsg('bad', r.error || '连不上');
});

$('save').onclick = () => withBusy($('save'), '登录中…', async () => {
  const nexusUrl = $('nexusUrl').value.trim();
  const username = $('username').value.trim();
  const password = $('password').value;
  const autoMin = parseInt($('autoMin').value, 10);
  if (!nexusUrl || !username || !password) { showMsg('bad', '地址、账号、密码三项都必填'); return; }
  const stop = busyTick('正在登录 ' + nexusUrl + ' …');

  const r = await send({ type: 'login', nexusUrl, username, password, autoMin });
  stop();
  if (!r.ok) {
    showMsg('bad', '登录失败：' + (r.error || '未知原因'));
    return;
  }
  if (r.nexusUrl && r.nexusUrl !== nexusUrl.replace(/\/+$/, '')) $('nexusUrl').value = r.nexusUrl;
  if (r.note) showMsg('info', r.note + '；登录成功，令牌已保存到本机扩展存储。');
  else showMsg('ok', '已登录，令牌已保存到本机扩展存储。');
  chrome.alarms.create('keepalive', { periodInMinutes: Math.max(5, isNaN(autoMin) ? 30 : autoMin) });
  // 登录成功顺手刷一次站点列表，免得看到的是旧的
  const c = await send({ type: 'config' });
  if (c.ok) renderSites(c.data.sites || []);
});

boot();
