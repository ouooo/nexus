(function(){
  // —— API 路径常量表（阶段 C） ——
  const API = {
  config: '/config',
  storage: '/storage',
  apps: '/apps',
  trending: '/trending',
  features: '/features',
  daily_tips: '/daily_tips',
  incoming: '/incoming',
  favorites: '/favorites',
  subscribe: '/subscribe',
  play_history: '/play-history',
  recent: '/recent',
  status: '/status',
  media: '/media',
  torrents: '/torrents',
  scripts: '/scripts',
  scriptsRun: '/scripts/run',
  scriptsSave: '/scripts/save',
  scriptsDelete: '/scripts/delete'
  };


// ========== 配置区 ==========
const CONFIG = {
  slides: [],
  interval: 60000,
  searchSources: {
    bing: { name: 'Bing', icon: '🔍', url: 'https://www.bing.com/search?q=' },
    emby: { name: '媒体库', icon: '🎬', url: '' },
    pt: { name: '站点资源', icon: '🌐', url: '' },
    pansou: { name: '网盘资源', icon: '📦', url: '' },
    online: { name: '在线观影', icon: '🎥', url: '' },
  },
  currentSearch: 'bing',
};

const PAGE_TITLES = {
  overview: '总览',
  trending: '流行趋势',
  journey: '观影历程',
  applications: '服务',
  media: '媒体库',
  favorites: '收藏',
  transfers: '数据活动',
  storage: '存储',
  scripts: '脚本服务',
  events: '日志中心',
  search: '搜索',
  settings: '设置',
};
const SUBTITLES = {
  overview: '实时监控 · 一键管理',
  trending: '影视热度追踪',
  journey: '抽卡认领 · 观影历程收藏',
  applications: '每个服务的运行状态',
  media: '媒体收藏统计',
  favorites: '想看的先收在这里',
  transfers: '实时传输与限速',
  storage: '存储空间使用情况',
  scripts: '自动化脚本与调度',
  events: '多类日志统一查阅',
  search: '多源检索结果',
  settings: '系统与权限配置',
};

// ========== 导航数据驱动（桌面 sidebar / 移动 tabbar / more 抽屉 自动同步）==========
const NAV_PAGES = [
  { key: 'overview',     label: '总览',     icon: '🏠', desktop: 1, tab: 1 },
  { key: 'applications', label: '服务',     icon: '🤵🏼‍♀️', desktop: 1, tab: 1 },
  { key: 'search',       label: '搜索',     icon: '🔍', desktop: 0 },
  { key: 'media',        label: '媒体库',   icon: '📽️', desktop: 1, tab: 1 },
  { key: 'favorites',    label: '收藏',     icon: '⭐', desktop: 1, more: 1 },
  { key: 'trending',     label: '流行趋势', icon: '🔥', desktop: 1, more: 1 },
  { key: 'journey',      label: '观影历程',     icon: '🎴', desktop: 1, more: 1 },
  { key: 'transfers',    label: '数据活动', icon: '⬇️', desktop: 1, tab: 1, tabLabel: '下载' },
  { key: 'storage',      label: '存储',     icon: '🗄️', desktop: 1, more: 1 },
  { key: 'scripts',      label: '脚本',     icon: '📝', desktop: 1, more: 1 },
  { key: 'events',       label: '日志中心', icon: '📋', desktop: 1, more: 1 },
  { key: 'settings',     label: '设置',     icon: '⚙️', desktop: 1, more: 1 },
];
function renderNav() {
  var active = document.querySelector('.page.active');
  var cur = active ? active.id.replace('page-', '') : 'overview';
  var desk = document.getElementById('desktopNav');
  var tabbar = document.getElementById('mobileTabbar');
  var more = document.getElementById('moreDrawer');
  if (desk) desk.innerHTML = NAV_PAGES.filter(p => p.desktop).map(p =>
    '<a class="nav-link' + (p.key === cur ? ' active' : '') + '" data-page="' + p.key + '"><span class="icon">' + p.icon + '</span> ' + p.label + '</a>'
  ).join('');
  if (tabbar) {
    tabbar.innerHTML = NAV_PAGES.filter(p => p.tab).map(p =>
      '<a class="tab' + (p.key === cur ? ' active' : '') + '" data-page="' + p.key + '"><span class="tab-icon">' + p.icon + '</span><span class="tab-label">' + (p.tabLabel || p.label) + '</span></a>'
    ).join('') +
    '<div class="tab" id="moreTab"><span class="tab-icon" style="font-size:18px;line-height:1;"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="opacity:0.7;"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></span><span class="tab-label">更多</span></div>';
  }
  if (more) {
    more.innerHTML = NAV_PAGES.filter(p => p.more).map(p =>
      '<a class="more-item" data-page="' + p.key + '"><span class="icon">' + p.icon + '</span> ' + p.label + '</a>'
    ).join('') +
    '<div class="more-item" id="btnClearCache" style="color:rgba(100,200,255,0.9);"><span class="icon">🧹</span> 清除前端缓存</div>' +
    '<div class="more-item" id="btnRestartMobile" style="color:rgba(255,200,100,0.9);"><span class="icon">🔄</span> 重启/清缓存</div>' +
    '<div class="more-item" id="btnLogout" style="color:rgba(255,100,100,0.9);"><span class="icon">🚪</span> 退出登录</div>';
  }
}
renderNav();

// ========== 页面切换 ==========
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const page = link.dataset.page;
    switchPage(page);
  });
});

// 移动端 tabbar 点击
document.querySelectorAll('.mobile-tabbar .tab[data-page]').forEach(tab => {
  tab.addEventListener('click', (e) => {
    e.preventDefault();
    switchPage(tab.dataset.page);
  });
});

// 演职员姓名健壮取值：兼容 字符串 / {name} / {nameZh,name} / 嵌套对象，避免渲染成 [object Object]
function personName(x) {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') {
    var v = x.nameZh || x.zhName || x.name_cn || x.name || x.person || x.name_en || x.original_name || x.originalName || x.title;
    if (v && typeof v === 'object') return personName(v);
    return v ? String(v) : '';
  }
  return '';
}

// 更多按钮切换弹出菜单
function closeMoreDrawer() {
  document.getElementById('moreDrawer').classList.remove('show');
  document.getElementById('moreOverlay').classList.remove('show');
}
document.getElementById('moreTab').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  var d = document.getElementById('moreDrawer');
  var o = document.getElementById('moreOverlay');
  var isOpen = d.classList.contains('show');
  if (isOpen) { closeMoreDrawer(); }
  else {
    // 对齐"更多"tab右边缘
    var tab = document.getElementById('moreTab');
    var rect = tab.getBoundingClientRect();
    d.style.right = (window.innerWidth - rect.right + 8) + 'px';
    d.classList.add('show'); o.classList.add('show');
  }
});
// 菜单里的 item 点击
document.querySelectorAll('.more-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    closeMoreDrawer();
    if (item.dataset.page) switchPage(item.dataset.page);
  });
});

function switchPage(pageName) {
  closeMoreDrawer();
  if (pageName !== 'search') window._lastPage = pageName;
  if (location.hash !== '#' + pageName) history.pushState(null, '', '#' + pageName);
  const targetPage = document.getElementById('page-' + pageName);
  if (!targetPage) return;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.mobile-tabbar .tab').forEach(t => t.classList.remove('active'));
  targetPage.classList.add('active');
  const navLink = document.querySelector(`.nav-link[data-page="${pageName}"]`);
  if (navLink) navLink.classList.add('active');
  const tab = document.querySelector(`.mobile-tabbar .tab[data-page="${pageName}"]`);
  if (tab) tab.classList.add('active');
  const topTitle = document.getElementById('topTitle');
  const topSub = document.getElementById('topSub');
  const topIcon = document.getElementById('topIcon');
  if (pageName === 'overview') {
    // 首页顶栏直接用问候 + 健康副标题（去掉「总览」标题模块），页面内问候区隐藏避免重复
    syncGreetingToTop();
  } else {
    if (topTitle) topTitle.textContent = PAGE_TITLES[pageName] || pageName;
    if (topSub) topSub.textContent = SUBTITLES[pageName] || '';
    if (topIcon) { const np = NAV_PAGES.find(p => p.key === pageName); if (np) topIcon.textContent = np.icon; }
    syncGreetingToTop();
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (pageName === 'settings') loadSettings();
  if (pageName === 'trending') loadTrending();
  if (pageName === 'favorites') loadFavorites();
  if (pageName === 'journey') loadJourney();
  if (pageName === 'events') { loadLogSources(); loadRunLogs(); fetchEvents(); }
  // 按页面自动切换搜索源：仅在用户未手动选择过时自动切
  const pageSearchSrc = { media: 'emby', transfers: 'pt', favorites: 'emby', trending: 'emby', overview: 'emby', search: 'emby' };
  const autoSrc = pageSearchSrc[pageName] || 'bing';
  if (!window._manualSearchSrc && CONFIG && CONFIG.searchSources && CONFIG.searchSources[autoSrc]) {
    CONFIG.currentSearch = autoSrc;
    document.querySelectorAll('.search-dropdown-item').forEach(i => i.classList.toggle('active', i.dataset.source === autoSrc));
    const ic = document.getElementById('currentSearchIcon');
    if (ic) ic.textContent = CONFIG.searchSources[autoSrc].icon;
    const inp = document.getElementById('searchInput');
    if (inp) inp.placeholder = (autoSrc === 'bing') ? '全网搜索' : `搜索 ${CONFIG.searchSources[autoSrc].name}...`;
  }
}

var NEXUS_FAVICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A84FF"/><stop offset="1" stop-color="#5E5CE6"/></linearGradient><linearGradient id="hl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="0.55" stop-color="#ffffff" stop-opacity="0"/></linearGradient><linearGradient id="hex" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="1" stop-color="#E8F1FF" stop-opacity="0.85"/></linearGradient><radialGradient id="core" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffffff" stop-opacity="1"/><stop offset="0.45" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs><rect x="2" y="2" width="60" height="60" rx="14" fill="url(#g)"/><rect x="2" y="2" width="60" height="26" rx="14" fill="url(#hl)"/><rect x="2" y="2" width="60" height="60" rx="14" fill="none" stroke="rgba(255,255,255,0.42)" stroke-width="1.5"/><polygon points="32,16.5 42.3,23 42.3,41 32,47.5 21.7,41 21.7,23" fill="rgba(255,255,255,0.10)" stroke="url(#hex)" stroke-width="2.8" stroke-linejoin="round"/><g opacity="0.6"><line x1="32" y1="21" x2="32" y2="43" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round"/><line x1="25.6" y1="27.4" x2="38.4" y2="36.6" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round"/><line x1="38.4" y1="27.4" x2="25.6" y2="36.6" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round"/></g><circle cx="32" cy="32" r="10.5" fill="url(#core)"/><circle cx="32" cy="32" r="4.8" fill="#ffffff"/><circle cx="32" cy="32" r="7.6" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.4"/></svg>');

function applyFavicon(v) {
  var link = document.querySelector('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  if (!v) v = 'icon';
  if (/^https?:\/\//i.test(v)) { link.href = v; link.type = ''; }
  else if (v === 'icon') { link.href = 'data:image/png;base64,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'; link.type = 'image/png'; }
  else { link.href = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">' + v + '</text></svg>'); link.type = 'image/svg+xml'; }
}
function faviconLive(v) {
  var pv = document.getElementById('faviconPreview');
  if (pv) {
    var txt = (/^https?:\/\//i.test(v)) ? '🔗' : v;
    pv.textContent = txt;
    pv.style.display = txt ? '' : 'none';
  }
}

function renderHealthLayoutCfg() {
  const box = document.getElementById('healthLayoutCfg');
  if (!box) return;
  // v1102: 总览卡片已改为等宽网格（宽屏 5 列 / 平板 4 列 / 手机 2 列，速率自动换行不截断），
  // 旧的 flex 宽度微调项不再适用，替换为说明文本（配置保存时兼容保留空值）。
  window._healthLayout = window._healthLayout || { flex: true };
  box.innerHTML = '<div style="padding:8px 10px;border-radius:var(--radius-xs);border:1px solid rgba(255,255,255,0.08);background:rgba(0,0,0,0.18);font-size:12px;color:rgba(255,255,255,0.55);line-height:1.6;">总览卡片两行对齐布局：宽屏（>1024px）3 列两行——网络状态跨 2 列与 CPU 同行，内存/存储/活跃任务第二行；窄屏（≤1024px）2 列、网络状态独占整行。网格列对齐，卡片高度自然收敛，无需手动设置宽度。</div>';
}
function collectHealthLayout() {
  // v1102: 等宽网格化后不再收集旧 flex 宽度参数
  return { flex: true };
}
function applyHealthLayoutConfig() {
  const v = window._healthLayout || {};
  const r = document.documentElement.style;
  r.setProperty('--health-wrap', v.flex === false ? 'nowrap' : 'wrap');
  if (v.net_min) r.setProperty('--health-net-min', v.net_min + 'px');
  if (v.net_max) r.setProperty('--health-net-max', v.net_max + 'px');
  if (v.card_min) r.setProperty('--health-card-min', v.card_min + 'px');
  r.setProperty('--health-net-basis', (Math.round(((v.net_min || 244) + (v.net_max || 276)) / 2)) + 'px');
}
function renderHealthShowCfg() {
  const box = document.getElementById('healthShowCfg');
  if (!box) return;
  const hidden = window._uiHealthHidden = Array.isArray(window._uiHealthHidden) ? window._uiHealthHidden : [];
  const items = [
    ['net', '网络状态'], ['cpu', 'CPU 使用率'], ['mem', '内存'],
    ['storage', '已用存储'], ['tasks', '活跃任务']
  ];
  box.innerHTML = items.map(function (it) {
    const k = it[0], label = it[1];
    return '<label style="display:flex;align-items:center;gap:6px;padding:8px 10px;border-radius:var(--radius-xs);border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.18);cursor:pointer;font-size:12.5px;">' +
      '<input type="checkbox" class="ui-check" data-health-show="' + k + '"' + (hidden.indexOf(k) < 0 ? ' checked' : '') + '> ' + label + '</label>';
  }).join('');
}
function renderSvcShowCfg() {
  const box = document.getElementById('svcShowCfg');
  if (!box) return;
  const hidden = window._uiSvcHidden = Array.isArray(window._uiSvcHidden) ? window._uiSvcHidden : [];
  const apps = window._svcData || [];
  if (!apps.length) { box.innerHTML = '<div style="font-size:12px;opacity:0.5;">暂无可配置服务</div>'; return; }
  box.innerHTML = apps.map(function (a) {
    const k = a.key || a.name;
    return '<label style="display:flex;align-items:center;gap:6px;padding:8px 10px;border-radius:var(--radius-xs);border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.18);cursor:pointer;font-size:12.5px;">' +
      '<input type="checkbox" class="ui-check" data-svc-show="' + esc(k) + '"' + (hidden.indexOf(k) < 0 ? ' checked' : '') + '> ' + esc(a.name) + '</label>';
  }).join('');
}
function collectHealthShowCfg() {
  const out = [];
  document.querySelectorAll('#healthShowCfg input[data-health-show]').forEach(function (inp) {
    if (!inp.checked) out.push(inp.getAttribute('data-health-show'));
  });
  return out;
}
function collectSvcShowCfg() {
  const out = [];
  document.querySelectorAll('#svcShowCfg input[data-svc-show]').forEach(function (inp) {
    if (!inp.checked) out.push(inp.getAttribute('data-svc-show'));
  });
  return out;
}
function applyHealthShowConfig() {
  const hidden = window._uiHealthHidden || [];
  const keys = ['net', 'cpu', 'mem', 'storage', 'tasks'];
  let vis = 0;
  keys.forEach(function (k) {
    const el = document.getElementById(k + '-card');
    const show = hidden.indexOf(k) < 0;
    if (el) el.style.display = show ? '' : 'none';
    if (show) vis++;
  });
  const grid = document.getElementById('healthGrid');
  if (grid) grid.style.display = vis ? '' : 'none';
  const sec = grid ? grid.previousElementSibling : null;
  if (sec && sec.classList && sec.classList.contains('section-title')) sec.style.display = vis ? '' : 'none';
}
function applySvcShowConfig() {
  const strip = document.getElementById('svcStrip');
  if (!strip) return;
  const hidden = window._uiSvcHidden || [];
  const chips = strip.children;
  if (!chips.length) return; // 尚未渲染，保持默认
  let vis = 0;
  Array.prototype.forEach.call(chips, function (chip) {
    const name = chip.getAttribute('data-svc-key');
    const show = !name || hidden.indexOf(name) < 0;
    chip.style.display = show ? '' : 'none';
    if (show) vis++;
  });
  strip.style.display = vis ? 'flex' : 'none';
  const sec = strip.previousElementSibling;
  if (sec && sec.classList && sec.classList.contains('section-title')) sec.style.display = vis ? '' : 'none';
}
async function loadSettings() {
  try {
    const cfg = await fetchJSON(API.config);
    if (!cfg) {
      // /api/config 失败时，从 _currentUser 兜底显示当前用户
      const vU = document.getElementById('authViewUser');
      if (vU) vU.textContent = (window._currentUser && window._currentUser.username) || 'admin';
      const vR = document.getElementById('authViewRole');
      if (vR) vR.textContent = (window._currentUser && window._currentUser.is_admin) ? '管理员（全部权限）' : '普通用户';
      return;
    }
    window._nexusCfg = cfg;
    const _prevDevTitles = JSON.stringify(window._deviceTitleMap || {});
    window._deviceTitleMap = (cfg && cfg.device_titles) || {};
    try { renderDevTitleEditor(); } catch(e) {}
    if (JSON.stringify(window._deviceTitleMap) !== _prevDevTitles && typeof fetchApps === 'function') {
      try { fetchApps(); } catch(e) {}
    }
    document.getElementById('cfgTmdbKey').value = cfg.tmdb_api_key || '';
    window._onlineSrcs = (cfg.online_urls && cfg.online_urls.length ? cfg.online_urls.slice() : (cfg.online_url ? [cfg.online_url] : []));
    window._onlineEditMode = false;
    const ob = document.getElementById('onlineEditBtn');
    if (ob) ob.textContent = '✏️ 编辑';
    const of = document.getElementById('onlineAddForm');
    if (of) of.style.display = 'none';
    renderOnlineSrcs();
    document.getElementById('cfgCCPass').value = cfg.cookiecloud_password || '';
    document.getElementById('ccEnabled').checked = cfg.cookiecloud_enabled !== false;
    document.getElementById('ccConfigArea').style.opacity = cfg.cookiecloud_enabled === false ? '0.4' : '1';
    document.getElementById('cfgAuthEnabled').checked = cfg.auth_enabled !== false;
    document.getElementById('cfgAuthUser').value = cfg.auth_username || 'admin';
    document.getElementById('cfgAuthPass').value = '';
    document.getElementById('cfgAuthPass2').value = '';
    // 只读展示态
    const vUser = document.getElementById('authViewUser');
    if (vUser) vUser.textContent = cfg.auth_username || 'admin';
    const vRole = document.getElementById('authViewRole');
    if (vRole) vRole.textContent = (window._currentUser && window._currentUser.is_admin) ? '管理员（全部权限）' : '普通用户';
    // 功能开关
    const ft = cfg.features || {};
    document.getElementById('featTrending').checked = ft.trending !== false;
    document.getElementById('featOnline').checked = ft.online_search !== false;
    document.getElementById('featPt').checked = ft.pt_search !== false;
    document.getElementById('featPansou').checked = ft.pansou_search !== false;
    document.getElementById('featCarousel').checked = ft.carousel !== false;
    // 轮播来源开关（默认全开）与媒体库排除短剧
    const hs = cfg.hero_sources || {};
    document.getElementById('heroSrcRecent').checked = hs.recent !== false;
    document.getElementById('heroSrcRandom').checked = hs.random !== false;
    document.getElementById('heroSrcTrending').checked = hs.trending !== false;
    document.getElementById('heroSrcTmdb').checked = hs.tmdb !== false;
    document.getElementById('heroSrcDouban').checked = hs.douban !== false;
    // 媒体库轮播内容类型（默认全开）
    const ht = cfg.hero_types || {};
    document.getElementById('heroTypeMovie').checked = ht.movie !== false;
    document.getElementById('heroTypeTv').checked = ht.tv !== false;
    document.getElementById('heroTypeShort').checked = ht.short !== false;
    document.getElementById('heroTypeAnime').checked = ht.anime !== false;
    applyHeroSrcCfgFromDom();
    // 流行趋势数据源（默认全开）
    const ts = cfg.trend_sources || {};
    document.getElementById('trendDouban').checked = ts.douban !== false;
    document.getElementById('trendDoubanTv').checked = ts.douban_tv !== false;
    document.getElementById('trendIqiyi').checked = ts.iqiyi !== false;
    document.getElementById('trendBilibili').checked = ts.bilibili !== false;
    // 观影卡片池来源（默认仅媒体库）
    const jsrc = (cfg.journey || {}).sources || ['media'];
    const jm = document.getElementById('journeyMedia');
    const jt = document.getElementById('journeyTmdb');
    if (jm) jm.checked = jsrc.indexOf('media') >= 0;
    if (jt) jt.checked = jsrc.indexOf('tmdb') >= 0;
    const jd = document.getElementById('journeyDaily');
    if (jd) jd.checked = (cfg.journey || {}).daily_limit !== false;
    // TMDB 源连通状态（服务可用性可视化）
    const jst = document.getElementById('journeyTmdbStatus');
    if (jst) {
      jst.innerHTML = '🌐 TMDB 源检测中…';
      fetchJSON('/journey/tmdb-status').then(function(s) {
        if (s && s.ok) {
          jst.innerHTML = '🌐 TMDB 源：<span style="color:#30D158">可用</span>（' + s.ms + 'ms，' + (s.proxy || '直连') + '）';
        } else {
          jst.innerHTML = '🌐 TMDB 源：<span style="color:#FF453A">不可达</span>（' + (s && s.proxy ? s.proxy : '直连') + '）—— TMDB 卡暂无法出卡';
          if (jt) jt.disabled = true;
        }
      }).catch(function() { jst.innerHTML = '🌐 TMDB 源：检测失败'; });
    }
    // RBAC（管理员）
    if (_currentUser && _currentUser.is_admin) {
      const rbs = cfg.rbac_roles || {};
      const rbu = cfg.rbac_users || [];
      window._rbacRoles = [{ name: 'admin', permissions: ALL_PAGES.slice(), emby_user: (rbs['admin'] || {}).emby_user || '', isAdmin: true }];
      Object.keys(rbs).forEach(function(k) {
        if (k === 'admin') return;
        window._rbacRoles.push({ name: k, permissions: ((rbs[k] || {}).permissions || []).slice(), emby_user: (rbs[k] || {}).emby_user || '', isAdmin: false });
      });
      window._rbacUsers = rbu.map(function(u) { return { username: u.username, role: u.role, password: '', hasPass: true }; });
      document.getElementById('rbacEnabled').checked = cfg.rbac_enabled !== false;
      rbacRenderRoles();
      rbacRenderUsers();
    }
    // 存储卷配置（独立 try：即使上方某段抛错，也确保挂载卷/设备列表能渲染或给出兜底，绝不无限转圈）
    const aliases = cfg.volume_aliases || {};
    window._volumeAliases = aliases;
    const storageCfg = cfg.storage || {};
    window._storageCfg = storageCfg;
    try {
    window._svcAliases = cfg.svc_aliases || {};
    window._svcCustom = cfg.monitor_services || [];
    window._svcFavs = cfg.svc_favs || {};
    window._svcOrder = cfg.svc_order || {};
    seedSvcDefaults();
    window._uiHealthHidden = Array.isArray(cfg.ui_health_hidden) ? cfg.ui_health_hidden.slice() : [];
    window._uiSvcHidden = Array.isArray(cfg.ui_svc_hidden) ? cfg.ui_svc_hidden.slice() : [];
    window._healthLayout = {
      flex: cfg.ui_health_flex !== false,
      net_min: cfg.ui_health_net_min || 244,
      net_max: cfg.ui_health_net_max || 276,
      card_min: cfg.ui_health_card_min || 190
    };
    renderHealthShowCfg();
    renderSvcShowCfg();
    try { applyHealthLayoutConfig(); } catch (e) {}
    try { applyHealthShowConfig(); } catch(e){}
    try { applySvcShowConfig(); } catch(e){}
    const fvInp = document.getElementById('cfgFavicon');
    if (fvInp) { fvInp.value = cfg.favicon || ''; try { applyFavicon(cfg.favicon); } catch(e){} }
    const pxInp = document.getElementById('cfgProxyUrl');
    if (pxInp) pxInp.value = cfg.proxy_url || '';
    const sbInp = document.getElementById('cfgShareBase');
    if (sbInp) sbInp.value = cfg.share_base_url || '';
    window._shareBase = cfg.share_base_url || '';
    const patInp = document.getElementById('cfgVolPattern');
    if (patInp) patInp.value = storageCfg.volume_pattern || '';
    const devDefs = (storageCfg.devices && storageCfg.devices.length) ? storageCfg.devices
      : [{name:'SA',match:['/dev/mapper']},{name:'DS',match:[]}];
    window._storageDevices = devDefs;
    try { renderDeviceRows(); } catch(e){}
    try {
      const sdata = await fetchJSON(API.storage);
      if (sdata && sdata.pools && sdata.pools.length) {
        // 数据交给顶层 renderVolAlias 渲染（响应存储卷配置编辑门禁：只读/编辑态）
        window._volCfg = storageCfg;
        window._volAliases = aliases;
        window._volPools = sdata.pools;
        window.renderVolAlias();
      } else {
        window._volPools = null;
        window.renderVolAlias();
      }
    } catch(e) {
      const l2 = document.getElementById('volumeAliasList');
      if (l2) l2.innerHTML = '<div style="font-size:12px;opacity:0.5;">无法获取存储列表</div>';
    }
    } catch(e) { /* 存储配置段独立兜底：此处失败不阻断其余设置页渲染 */ }
  } catch(e) {}
  try {
    const ep = document.getElementById('ccEndpoint');
    if (ep) ep.textContent = window.location.origin + '/cookiecloud/sync';
  } catch(e) {}
  try {
    const data = await fetchJSON(API.apps, 30000);
    if (data && data.apps) {
      window._svcData = data.apps;
      renderSvcConfig();
      renderHomeServices();
      renderFavSvcEditor();
    }
  } catch(e) {}
  try {
    const r = await fetch('/cookiecloud/status');
    const st = await r.json();
    const last = st.last_sync ? new Date(st.last_sync * 1000).toLocaleString('zh-CN') : '从未同步';
    document.getElementById('ccStatus').innerHTML = `已缓存 <b style="color:#fff;">${st.domains}</b> 个域名 · 上次同步：${last}`;
  } catch(e) {
    document.getElementById('ccStatus').textContent = '状态获取失败';
  }
}

async function testExtSvc(i, btn) {
  const addrEl = document.getElementById('svcExtAddr_' + i);
  if (!addrEl || !addrEl.value.trim()) { toast('请先填外网地址', 'error'); return; }
  const addr = addrEl.value.trim();
  const protoEl = document.getElementById('svcExtProto_' + i);
  const proto = protoEl ? protoEl.value : 'https';
  const m = addr.match(/^(.*?):(\d+)$/);
  if (!m) { toast('外网地址格式应为 host:port', 'error'); return; }
  btn.textContent = '…';
  try {
    const r = await fetch(API_BASE + '/test-service?host=' + encodeURIComponent(m[1]) + '&port=' + encodeURIComponent(m[2]) + '&proto=' + proto);
    const d = await r.json();
    toast(d.ok ? proto + '://' + addr + ' 外网可达' : proto + '://' + addr + ' 外网不可达', d.ok ? 'success' : 'error');
  } catch(e) {
    toast('测试请求失败', 'error');
  }
  btn.textContent = '测试';
}

async function testSvc(i, btn) {
  const proto = document.getElementById('svcProto_' + i).value;
  const addr = document.getElementById('svcAddr_' + i).value.trim();
  const m = addr.match(/^(.*?):(\d+)$/);
  if (!m) { toast('地址格式应为 host:port', 'error'); return; }
  const host = m[1], port = m[2];
  btn.textContent = '…';
  try {
    const r = await fetch(API_BASE + '/test-service?host=' + encodeURIComponent(host) + '&port=' + encodeURIComponent(port) + '&proto=' + proto);
    const d = await r.json();
    toast(d.ok ? proto + '://' + host + ':' + port + ' 在线' : proto + '://' + host + ':' + port + ' 连接失败', d.ok ? 'success' : 'error');
  } catch(e) {
    toast('测试请求失败', 'error');
  }
  btn.textContent = '测试';
}

// ========== 服务监控：自定义服务 CRUD ==========
const SERVICE_TYPES = [
  { name: 'Emby', icon: '🎬', desc: '媒体串流' },
  { name: 'MoviePilot', icon: '🤖', desc: '自动化整理' },
  { name: 'qBittorrent', icon: '⬇️', desc: '下载客户端' },
  { name: 'Transmission', icon: '📡', desc: '下载客户端' },
  { name: 'mihomo', icon: '🌐', desc: '代理网关' },
  { name: '网盘搜索', icon: '📦', desc: '网盘搜索' },
  { name: '云盘挂载', icon: '💾', desc: '网盘挂载' },
  { name: 'AdGuard Home', icon: '🛡️', desc: 'DNS 过滤' },
  { name: 'IYUU', icon: '🌱', desc: '辅种' },
  { name: '有声书', icon: '📚', desc: '有声书' },
  { name: '自定义', icon: '📦', desc: '自定义服务' },
];
// 服务类型选项：优先取真实容器/服务 key（/api/apps，含用户别名映射），中文名留给用户在服务别名中自定义；无容器数据时回退内置清单，并保留「自定义」兜底
function svcTypeOptions() {
  var seen = {}; var out = [];
  (window._svcData || []).forEach(function(a){
    var k = a.key || a.name; if (k && !seen[k]) { seen[k] = 1; out.push({ key: k, icon: a.icon || '📦', desc: a.desc || '服务' }); }
  });
  if (!out.length) { SERVICE_TYPES.forEach(function(t){ out.push({ key: t.name, icon: t.icon, desc: t.desc }); }); }
  if (!seen['自定义']) out.push({ key: '自定义', icon: '📦', desc: '自定义服务' });
  return out;
}
window.svcTypeOptions = svcTypeOptions;
// 各服务独有的配置项（服务监控编辑模式差异化渲染）；key 对应后端内部服务名
const _SVC_EXTRA_FIELDS = {
  'Emby':   [ { id:'cfgEmbyKey',  label:'Emby API Key',                     key:'emby_api_key',  type:'password', ph:'例：a1b2c3d4e5f6...' } ],
  'QB':     [ { id:'cfgQbUser',   label:'qBittorrent 用户名',                key:'qb_user',       type:'text',     ph:'例：admin' },
              { id:'cfgQbPass',   label:'qBittorrent 密码',                  key:'qb_pass',       type:'password', ph:'例：WebUI 登录密码' },
              { id:'cfgQbApiKey', label:'qBittorrent API Key（v5.2+，Bearer 认证，可选）', key:'qb_api_key', type:'password', ph:'例：WebUI 设置中配置的 API Key' } ],
  'Transmission': [ { id:'cfgTrUser', label:'Transmission 用户名',           key:'tr_user',       type:'text',     ph:'例：admin' },
                    { id:'cfgTrPass', label:'Transmission 密码',             key:'tr_pass',       type:'password', ph:'RPC 路径由后端自动拼接为 /transmission/rpc' } ],
  'MP':     [ { id:'cfgMpDb',     label:'媒体库数据库路径（MoviePilot user.db）', key:'mp_db',    type:'text',     ph:'例：/data/mp/config/user.db' },
              { id:'cfgMpScript', label:'MoviePilot 写库脚本路径（可选）',    key:'mp_script',     type:'text',     ph:'例：/data/scripts/mp_subscribe_add.py' },
              { id:'cfgMpApiKey', label:'MoviePilot API Key（可选）',         key:'mp_api_key',    type:'password', ph:'例：moviepilot-xxxx' },
              { id:'cfgMpEnabled',label:'启用 MoviePilot 接入（订阅 / 最近整理）', key:'mp_enabled', type:'checkbox' } ],
  '网盘搜索':[ { id:'cfgPansou',  label:'网盘搜索地址',                      key:'pansou_url',     type:'text',     ph:'例：http://192.168.1.1:18666' } ],
  '代理':    [ { id:'cfgProxy',   label:'代理地址（mihomo）',                key:'mihomo_proxy',   type:'text',     ph:'例：http://192.168.1.1:9090' } ],
};
function _svcExtraHTML(a) {
  const cfg = window._nexusCfg || {};
  const fields = _SVC_EXTRA_FIELDS[a.key || a.name];
  if (!fields || !fields.length) return '';
  return '<div style="display:grid;gap:8px;margin:8px 0 4px;padding:10px;border-radius:var(--radius-xs);background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);">' + fields.map(f => {
    if (f.type === 'checkbox') {
      const on = !!cfg[f.key];
      return `<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:rgba(255,255,255,0.6);cursor:pointer;"><input type="checkbox" class="tgl" id="${f.id}" ${on?'checked':''}> ${f.label}</label>`;
    }
    const eye = f.type === 'password' ? `<button type="button" onclick="togglePwd('${f.id}',this)" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:15px;color:rgba(255,255,255,0.4);padding:4px 6px;">👁</button>` : '';
    const t = f.type === 'password' ? 'password' : 'text';
    return `<div><label style="font-size:11px;color:rgba(255,255,255,0.4);">${f.label}</label>
      <div style="position:relative;margin-top:4px;"><input id="${f.id}" type="${t}" autocomplete="new-password" value="${esc(cfg[f.key] || '')}" placeholder="${f.ph}" style="width:100%;height:36px;padding:0 36px 0 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.25);color:#fff;font-size:13px;font-family:monospace;box-sizing:border-box;">${eye}</div></div>`;
  }).join('') + '</div>';
}
window._svcCustom = window._svcCustom || [];
window._svcEditMode = window._svcEditMode || false;
// 设备名兜底：必须在 renderSvcConfig 编辑模式前可用（避免进入编辑时报错导致编辑控件不渲染）
window._storageDeviceNames = window._storageDeviceNames || function() {
  const devs = window._storageDevices || [];
  const names = devs.map(d => d.name).filter(Boolean);
  if (names.indexOf('本地') < 0) names.push('本地');
  return names.length ? names : ['SA', 'DS'];
};

function toggleSvcEdit() {
  // 从编辑模式退出（完成）= 先保存
  if (window._svcEditMode) {
    saveConfig();
  } else {
    // 进入编辑模式前备份当前自定义服务，供「取消」恢复；并预取真实容器/服务 key 作为类型下拉数据源
    window._svcCustomBackup = JSON.parse(JSON.stringify(window._svcCustom || []));
    if (!window._svcData || !window._svcData.length) {
      _japi('/api/apps', {}).then(function(d){ if (d && d.apps) { window._svcData = d.apps; renderSvcConfig(); } });
    }
  }
  window._svcEditMode = !window._svcEditMode;
  const btn = document.getElementById('svcEditBtn');
  if (btn) btn.textContent = window._svcEditMode ? '✓ 完成' : '✏️ 编辑';
  const cb = document.getElementById('svcCancelBtn');
  if (cb) cb.style.display = window._svcEditMode ? '' : 'none';
  renderSvcConfig();
}
function cancelSvcEdit() {
  // 取消修改：恢复备份、不保存，直接退出编辑模式
  if (window._svcCustomBackup) window._svcCustom = JSON.parse(JSON.stringify(window._svcCustomBackup));
  window._svcEditMode = false;
  const btn = document.getElementById('svcEditBtn');
  if (btn) btn.textContent = '✏️ 编辑';
  const cb = document.getElementById('svcCancelBtn');
  if (cb) cb.style.display = 'none';
  renderSvcConfig();
  toast('已取消修改', 'info');
}
window._onlineEditMode = window._onlineEditMode || false;
window._onlineSrcs = window._onlineSrcs || [];
function toggleOnlineEdit() {
  if (window._onlineEditMode) {
    saveConfig();
  } else {
    window._onlineSrcBackup = JSON.parse(JSON.stringify(window._onlineSrcs || []));
  }
  window._onlineEditMode = !window._onlineEditMode;
  const btn = document.getElementById('onlineEditBtn');
  if (btn) btn.textContent = window._onlineEditMode ? '✓ 完成' : '✏️ 编辑';
  const cb = document.getElementById('onlineCancelBtn');
  if (cb) cb.style.display = window._onlineEditMode ? 'inline-flex' : 'none';
  const f = document.getElementById('onlineAddForm');
  if (f) f.style.display = window._onlineEditMode ? 'flex' : 'none';
  renderOnlineSrcs();
}
function cancelOnlineEdit() {
  if (window._onlineSrcBackup) window._onlineSrcs = JSON.parse(JSON.stringify(window._onlineSrcBackup));
  window._onlineEditMode = false;
  const btn = document.getElementById('onlineEditBtn');
  if (btn) btn.textContent = '✏️ 编辑';
  const cb = document.getElementById('onlineCancelBtn');
  if (cb) cb.style.display = 'none';
  const f = document.getElementById('onlineAddForm');
  if (f) f.style.display = 'none';
  renderOnlineSrcs();
  toast('已取消修改', 'info');
}
function renderOnlineSrcs() {
  const el = document.getElementById('onlineSrcList');
  if (!el) return;
  const edit = !!window._onlineEditMode;
  const list = window._onlineSrcs || [];
  if (!list.length) { el.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.4);">未配置，使用默认源 https://ddrk.one</div>'; return; }
  el.innerHTML = list.map(function(s, i) {
    if (edit) {
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
        '<input value="' + esc(s) + '" onchange="setOnlineSrc(' + i + ', this.value)" style="flex:1;height:36px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.25);color:#fff;font-size:13px;font-family:monospace;box-sizing:border-box;">' +
        '<button onclick="removeOnlineSrc(' + i + ')" style="padding:8px 10px;border-radius:8px;border:1px solid rgba(255,120,120,0.35);background:rgba(255,80,80,0.15);color:#f88;font-size:12px;cursor:pointer;white-space:nowrap;">删除</button>' +
        '</div>';
    }
    return '<div style="font-size:13px;padding:4px 0;color:#fff;font-family:monospace;">' + esc(s) + '</div>';
  }).join('');
}
function setOnlineSrc(i, v) { if (window._onlineSrcs) window._onlineSrcs[i] = v; }
function addOnlineSrc() {
  const inp = document.getElementById('cfgOnlineNew');
  const v = inp.value.trim();
  if (!v) { toast('请填在线观影源地址', 'error'); return; }
  window._onlineSrcs.push(v);
  inp.value = '';
  renderOnlineSrcs();
  toast('已添加源，点「✓ 完成」保存后生效', 'success');
}
function removeOnlineSrc(i) {
  if (!confirm('确定删除该在线观影源？')) return;
  window._onlineSrcs.splice(i, 1);
  renderOnlineSrcs();
}
window._authEditMode = window._authEditMode || false;
function toggleAuthEdit() {
  window._authEditMode = !window._authEditMode;
  const view = document.getElementById('authView');
  const form = document.getElementById('authEditForm');
  const btn = document.getElementById('authEditBtn');
  if (view) view.style.display = window._authEditMode ? 'none' : 'grid';
  if (form) form.style.display = window._authEditMode ? 'grid' : 'none';
  if (btn) btn.textContent = window._authEditMode ? '✓ 完成' : '✏️ 编辑';
}

function renderSvcConfig() {
  const list = document.getElementById('svcConfigList');
  if (!list) return;
  const edit = !!window._svcEditMode;
  let html = '';
  // 编辑模式下才显示添加表单（置顶）
  if (edit) {
  html += `<div id="svcAddForm" class="svc-add-form" style="display:none;">
    <div class="svc-name-row">
      <select id="svcNewType" onchange="svcTypeChanged()" style="flex:0 0 auto;min-width:140px;">
        <option value="" disabled selected>服务选择</option>
        ${svcTypeOptions().map(t => `<option value="${t.key}" data-icon="${t.icon}" data-desc="${t.desc}">${t.icon} ${t.key}</option>`).join('')}
      </select>
      <input id="svcNewName" placeholder="显示名称/别名（可选，默认用类型名）" style="flex:1;min-width:0;">
    </div>
    <div class="svc-url-row">
      <select id="svcNewDevice" title="所属设备" style="flex:0 0 auto;">${window._storageDeviceNames().map(n=>`<option value="${n}">${n}</option>`).join('')}</select>
      <div class="proto-sw" style="flex:0 0 auto;">
        <input type="hidden" id="svcNewProto" value="http">
        <div class="proto-sw-tag" onclick="toggleProto(this)"><span class="proto-sw-val">http</span><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div class="proto-sw-list">
          <div class="proto-sw-opt active" onclick="setProto(this)">http</div>
          <div class="proto-sw-opt" onclick="setProto(this)">https</div>
        </div>
      </div>
      <input id="svcNewHost" placeholder="host，如 192.168.1.10" style="flex:1;min-width:0;">
      <input id="svcNewPort" placeholder="端口" style="width:80px;flex:0 0 80px;">
      <button class="svc-add-confirm" onclick="addSvc()">添加</button>
      <button class="svc-add-cancel" onclick="toggleAddSvc()">取消</button>
    </div>
    <div class="svc-url-row" style="margin-top:4px;">
      <span style="font-size:11px;color:rgba(255,255,255,0.4);flex:0 0 36px;">外网</span>
      <div class="proto-sw" style="flex:0 0 auto;">
        <input type="hidden" id="svcNewExtProto" value="http">
        <div class="proto-sw-tag" onclick="toggleProto(this)"><span class="proto-sw-val">http</span><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <div class="proto-sw-list">
          <div class="proto-sw-opt active" onclick="setProto(this)">http</div>
          <div class="proto-sw-opt" onclick="setProto(this)">https</div>
        </div>
      </div>
      <input id="svcNewExtHost" placeholder="host，如 100.64.0.1（可选，Tailscale/公网）" style="flex:1;min-width:0;">
      <input id="svcNewExtPort" placeholder="端口" style="width:80px;flex:0 0 80px;">
    </div>
  </div>
  <button onclick="toggleAddSvc()" class="btn-primary" style="width:100%;padding:10px;margin-bottom:8px;">＋ 新增服务</button>`;
  }
  (window._svcData || []).forEach((a, i) => {
    const url = a.url || '';
    const proto = /^https:\/\//.test(url) ? 'https' : 'http';
    const host = url.replace(/^https?:\/\//, '').split(':')[0] || '192.168.1.1';
    const alias = (window._svcAliases || {})[a.key || a.name] || '';
    if (!edit) {
      // 只读模式：纯展示一行
      html += `
    <div class="svc-config-row">
      <div class="svc-body">
        <div class="svc-name-row"><span class="svc-ic">${a.icon || '📦'}</span><span class="svc-name">${esc(a.name)}</span><span class="svc-status ${a.status==='online'?'on':'off'}"></span><span class="svc-desc">${esc(a.desc)}</span></div>
      </div>
    </div>`;
      return;
    }
    html += `
    <div class="svc-config-row">
      <div class="svc-body">
        <div class="svc-name-row"><span class="svc-ic">${a.icon || '📦'}</span><span class="svc-name">${esc(a.name)}</span><span class="svc-status ${a.status==='online'?'on':'off'}"></span><span class="svc-desc">${esc(a.desc)}</span></div>
        <div class="svc-url-row" style="margin-bottom:4px;">
          <span style="font-size:11px;color:rgba(255,255,255,0.4);flex:0 0 36px;">内网</span>
          <input id="svcAlias_${i}" value="${esc(alias)}" placeholder="别名" style="width:48px;flex:0 0 48px;">
          <div class="proto-sw">
            <input type="hidden" id="svcProto_${i}" value="${proto}">
            <div class="proto-sw-tag" onclick="toggleProto(this)"><span class="proto-sw-val">${proto}</span><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            <div class="proto-sw-list">
              <div class="proto-sw-opt${proto==='http'?' active':''}" onclick="setProto(this)">http</div>
              <div class="proto-sw-opt${proto==='https'?' active':''}" onclick="setProto(this)">https</div>
            </div>
          </div>
          <input id="svcAddr_${i}" value="${esc(host + ':' + a.port)}" placeholder="host:port，必填">
          <button onclick="testSvc(${i}, this)" class="svc-test">测试</button>
          <button onclick="removeBuiltinSvc(${i})" title="隐藏此服务" class="svc-del">✕</button>
        </div>
        <div class="svc-url-row">
          <span style="font-size:11px;color:rgba(255,255,255,0.4);flex:0 0 36px;">外网</span>
          <div class="proto-sw">
            <input type="hidden" id="svcExtProto_${i}" value="${proto}">
            <div class="proto-sw-tag" onclick="toggleProto(this)"><span class="proto-sw-val">${proto}</span><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            <div class="proto-sw-list">
              <div class="proto-sw-opt${proto==='http'?' active':''}" onclick="setProto(this)">http</div>
              <div class="proto-sw-opt${proto==='https'?' active':''}" onclick="setProto(this)">https</div>
            </div>
          </div>
          <input id="svcExtAddr_${i}" value="${esc(url.replace(/^https?:\/\//, ''))}" placeholder="host:port，可选">
          <button onclick="testExtSvc(${i}, this)" class="svc-test" style="opacity:0.7;">测试</button>
        </div>
        ${_svcExtraHTML(a)}
      </div>
    </div>`;
  });
  (window._svcCustom || []).forEach((c, j) => {
    const proto = c.proto || 'http';
    const addr = c.host + (c.port ? (':' + c.port) : '');
    const extProto = c.ext_proto || 'http';
    const extAddr = c.ext_host ? (c.ext_host + (c.ext_port ? (':' + c.ext_port) : '')) : '';
    if (!edit) {
      html += `
    <div class="svc-config-row">
      <div class="svc-body">
        <div class="svc-name-row"><span class="svc-ic">${c.icon || '📦'}</span><span class="svc-name">${esc(c.name)}</span><span class="svc-desc">${esc(c.desc || '自定义服务')}</span></div>
      </div>
    </div>`;
      return;
    }
    html += `
    <div class="svc-config-row svc-custom">
      <div class="svc-body">
        <div class="svc-name-row"><span class="svc-ic">${c.icon || '📦'}</span><input id="svcCName_${j}" value="${esc(c.name)}" class="svc-edit-name" placeholder="服务名称"><span class="svc-desc">${esc(c.desc || '自定义服务')}</span></div>
        <div class="svc-url-row">
          <input id="svcCAlias_${j}" value="${esc(c.alias || '')}" placeholder="别名" style="width:120px;flex:0 0 120px;">
          <select id="svcCDevice_${j}" title="所属设备">
            ${window._storageDeviceNames().map(n=>`<option value="${n}"${(c.device||'')===n?' selected':''}>${esc(window.deviceTitle(n))}</option>`).join('')}
          </select>
          <div class="proto-sw">
            <input type="hidden" id="svcCProto_${j}" value="${proto}">
            <div class="proto-sw-tag" onclick="toggleProto(this)"><span class="proto-sw-val">${proto}</span><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            <div class="proto-sw-list">
              <div class="proto-sw-opt${proto==='http'?' active':''}" onclick="setProto(this)">http</div>
              <div class="proto-sw-opt${proto==='https'?' active':''}" onclick="setProto(this)">https</div>
            </div>
          </div>
          <input id="svcCAddr_${j}" value="${esc(addr)}" placeholder="host:port">
          <button onclick="testSvcC(${j}, this)" class="svc-test">测试</button>
        </div>
        <div class="svc-url-row">
          <span style="font-size:11px;color:rgba(255,255,255,0.4);flex:0 0 36px;">外网</span>
          <div class="proto-sw">
            <input type="hidden" id="svcCExtProto_${j}" value="${extProto}">
            <div class="proto-sw-tag" onclick="toggleProto(this)"><span class="proto-sw-val">${extProto}</span><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
            <div class="proto-sw-list">
              <div class="proto-sw-opt${extProto==='http'?' active':''}" onclick="setProto(this)">http</div>
              <div class="proto-sw-opt${extProto==='https'?' active':''}" onclick="setProto(this)">https</div>
            </div>
          </div>
          <input id="svcCExtAddr_${j}" value="${esc(extAddr)}" placeholder="host:port，可选">
        </div>
      </div>
      <button onclick="removeSvc(${j})" title="删除服务" class="svc-del">✕</button>
    </div>`;
  });
  list.innerHTML = html;
}

function toggleProto(el) { el.closest('.proto-sw').classList.toggle('open'); }
function setProto(opt) {
  const sw = opt.closest('.proto-sw');
  const v = opt.textContent.trim();
  const inp = sw.querySelector('input[type=hidden]');
  if (inp) inp.value = v;
  const tag = sw.querySelector('.proto-sw-val');
  if (tag) tag.textContent = v;
  sw.querySelectorAll('.proto-sw-opt').forEach(o => o.classList.toggle('active', o === opt));
  sw.classList.remove('open');
}
document.addEventListener('click', function(e){
  if (e.target.closest && e.target.closest('.proto-sw')) return;
  document.querySelectorAll('.proto-sw.open').forEach(s => s.classList.remove('open'));
});

function toggleAddSvc() {
  const f = document.getElementById('svcAddForm');
  if (f) f.style.display = (f.style.display === 'none') ? 'flex' : 'none';
}
function svcTypeChanged() {
  const s = document.getElementById('svcNewType');
  const nameInp = document.getElementById('svcNewName');
  if (s && nameInp) nameInp.value = s.value;
}
function addSvc() {
  const typeS = document.getElementById('svcNewType');
  const name = (document.getElementById('svcNewName').value || typeS.value).trim();
  const host = document.getElementById('svcNewHost').value.trim();
  const port = document.getElementById('svcNewPort').value.trim();
  const proto = document.getElementById('svcNewProto').value;
  const device = document.getElementById('svcNewDevice').value;
  // 外网（可选）：Tailscale/公网 host:port + 协议
  const extHost = document.getElementById('svcNewExtHost').value.trim();
  const extPort = document.getElementById('svcNewExtPort').value.trim();
  const extProto = document.getElementById('svcNewExtProto').value;
  if (!name || !host || !port) { toast('请填写服务名称、host 和端口', 'error'); return; }
  const sel = typeS.options[typeS.selectedIndex];
  const icon = sel ? (sel.getAttribute('data-icon') || '📦') : '📦';
  const desc = sel ? (sel.getAttribute('data-desc') || '自定义服务') : '自定义服务';
  window._svcCustom.unshift({
    name: name, icon: icon, desc: desc, host: host, port: parseInt(port), proto: proto, device: device, alias: '',
    ext_host: extHost, ext_port: extPort ? parseInt(extPort) : 0, ext_proto: extProto
  });
  renderSvcConfig();
  toast('已添加服务，点保存后生效', 'success');
}
function removeSvc(j) {
  if (!confirm('确定删除该自定义服务？\n此操作需点保存后才生效。')) return;
  window._svcCustom.splice(j, 1);
  renderSvcConfig();
  toast('已移除服务，点保存后生效', 'info');
}
function removeBuiltinSvc(i) {
  if (!window._svcData) return;
  if (!confirm('确定从列表中隐藏此服务？\n点保存后生效。')) return;
  window._svcData.splice(i, 1);
  renderSvcConfig();
  toast('已隐藏此服务，点保存后生效', 'info');
}
async function testSvcC(j, btn) {
  const proto = document.getElementById('svcCProto_' + j).value;
  const addr = document.getElementById('svcCAddr_' + j).value.trim();
  const m = addr.match(/^(.*?):(\d+)$/);
  if (!m) { toast('地址格式应为 host:port', 'error'); return; }
  const host = m[1], port = m[2];
  btn.textContent = '…';
  try {
    const r = await fetch(API_BASE + '/test-service?host=' + encodeURIComponent(host) + '&port=' + encodeURIComponent(port) + '&proto=' + proto);
    const d = await r.json();
    toast(d.ok ? proto + '://' + host + ':' + port + ' 在线' : proto + '://' + host + ':' + port + ' 连接失败', d.ok ? 'success' : 'error');
  } catch(e) { toast('测试请求失败', 'error'); }
  btn.textContent = '测试';
}

// ========== RBAC 管理（仅管理员） ==========
window._rbacRoles = []; // {name, permissions, emby_user, isAdmin}
window._rbacUsers = []; // {username, role, password, hasPass}
window._rbacEditMode = window._rbacEditMode || false;

function toggleRbacEdit() {
  // 进入编辑前先同步当前只读态数据（无输入框，直接重渲染即可）
  window._rbacEditMode = !window._rbacEditMode;
  var btn = document.getElementById('rbacEditBtn');
  if (btn) btn.textContent = window._rbacEditMode ? '✓ 完成' : '✏️ 编辑';
  var en = document.getElementById('rbacEnabledWrap');
  if (en) en.style.display = window._rbacEditMode ? 'flex' : 'none';
  var addBtn = document.getElementById('rbacAddRoleBtn');
  if (addBtn) addBtn.style.display = window._rbacEditMode ? '' : 'none';
  rbacRenderRoles();
  rbacRenderUsers();
}

// 只读模式：把权限数组转成标签 HTML
function rbacPermLabels(r) {
  if (r.isAdmin) return '<div style="font-size:11px;opacity:0.5;">内置全权限</div>';
  var labels = [];
  PERM_TREE.forEach(function(t) {
    if (r.permissions.indexOf(t.key) >= 0) {
      labels.push(t.label);
    } else {
      t.subs.forEach(function(s) {
        if (r.permissions.indexOf(t.key + ':' + s.key) >= 0) {
          labels.push(s.label);
        }
      });
    }
  });
  if (!labels.length) return '<div style="font-size:11px;opacity:0.4;">未授权任何页面</div>';
  return '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + labels.map(function(l) {
    return '<span style="font-size:11px;padding:3px 9px;border-radius:999px;background:rgba(10,132,255,0.15);border:1px solid rgba(10,132,255,0.3);color:#7AB8FF;">' + esc(l) + '</span>';
  }).join('') + '</div>';
}

function rbacPermHtml(r, idx) {
  if (r.isAdmin) return '<div style="font-size:11px;opacity:0.5;margin-bottom:8px;">内置全权限（无需勾选）</div>';
  return PERM_TREE.map(function(t) {
    var broad = r.permissions.indexOf(t.key) >= 0;
    var subsAll = t.subs.every(function(s) { return r.permissions.indexOf(t.key + ':' + s.key) >= 0; });
    var parentChecked = broad || subsAll;
    return `
    <div style="border:1px solid var(--border-lo);border-radius:var(--radius-xs);padding:7px 10px;margin-bottom:6px;background:var(--glass-faint);">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;cursor:pointer;">
        <input type="checkbox" id="rpp_${idx}_${t.key}" class="ui-check" onchange="rbacTogglePage(${idx},'${t.key}')" ${parentChecked ? 'checked' : ''}> ${t.label}
      </label>
      <div style="display:flex;flex-wrap:wrap;gap:4px 12px;padding-left:22px;margin-top:4px;">
        ${t.subs.map(function(s) {
          var ck = broad || r.permissions.indexOf(t.key + ':' + s.key) >= 0;
          return `<label style="display:inline-flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;">
            <input type="checkbox" id="rp_${idx}_${t.key}:${s.key}" class="ui-check" ${ck ? 'checked' : ''}> ${s.label}
          </label>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}
function rbacTogglePage(idx, page) {
  var parent = document.getElementById('rpp_' + idx + '_' + page);
  var chk = !!(parent && parent.checked);
  PERM_TREE.forEach(function(t) {
    if (t.key !== page) return;
    t.subs.forEach(function(s) {
      var c = document.getElementById('rp_' + idx + '_' + t.key + ':' + s.key);
      if (c) c.checked = chk;
    });
  });
}

function rbacRenderRoles() {
  var area = document.getElementById('rbacRolesArea');
  if (!area) return;
  var edit = !!window._rbacEditMode;
  var html = window._rbacRoles.map(function(r, idx) {
    var usersHtml = window._rbacUsers.map(function(u, uid) {
      if (u.role !== r.name) return '';
      if (!edit) {
        return '<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.07);border-radius:999px;padding:5px 12px;font-size:12px;">👤 <span style="color:#fff;font-weight:600;">' + esc(u.username || '(未命名)') + '</span></div>';
      }
      return `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:var(--glass-faint);border:1px solid var(--border-lo);border-radius:var(--radius-xs);padding:7px 10px;margin-bottom:6px;">
        <span style="font-size:12px;opacity:0.6;">👤</span>
        <input id="rusr_name_${uid}" value="${esc(u.username)}" placeholder="用户名" style="width:110px;padding:6px 9px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-size:12px;height:32px;box-sizing:border-box;">
        <input id="rusr_pass_${uid}" type="password" placeholder="${u.hasPass ? '留空不改密码' : '设置密码'}" style="width:120px;padding:6px 9px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-size:12px;height:32px;box-sizing:border-box;">
        <input id="rusr_pass2_${uid}" type="password" placeholder="确认密码" style="width:120px;padding:6px 9px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-size:12px;height:32px;box-sizing:border-box;">
        <button onclick="rbacDelUser(${uid})" style="height:32px;padding:0 12px;border-radius:var(--radius-xs);border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.08);color:#FF453A;font-size:12px;cursor:pointer;box-sizing:border-box;">移除</button>
      </div>`;
    }).join('');
    var cnt = window._rbacUsers.filter(function(u) { return u.role === r.name; }).length;

    if (!edit) {
      // 只读模式：纯展示
      var permsLabels = rbacPermLabels(r);
      return `
    <div class="rbac-role-card" style="padding:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:14px;font-weight:700;color:#fff;">${esc(r.name)}</span>
          ${r.isAdmin ? '<span style="font-size:10px;padding:2px 8px;border-radius:999px;background:rgba(255,214,10,0.15);border:1px solid rgba(255,214,10,0.3);color:#FFD60A;">内置管理员</span>' : ''}
        </div>
        <span style="font-size:11px;color:rgba(255,255,255,0.45;">👥 ${cnt} 个账号</span>
      </div>
      <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.45);margin-bottom:6px;">权限</div>
      <div style="margin-bottom:10px;">${permsLabels}</div>
      ${r.emby_user ? '<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:8px;">Emby 用户：<span style="font-family:monospace;color:#fff;">' + esc(r.emby_user) + '</span></div>' : ''}
      ${cnt > 0 ? '<div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:10px;display:flex;flex-wrap:wrap;gap:6px;">' + usersHtml + '</div>' : ''}
    </div>`;
    }

    // 编辑模式
    var permsHtml = rbacPermHtml(r, idx);
    return `
    <div class="rbac-role-card" style="padding:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <input id="rrole_name_${idx}" value="${esc(r.name)}" placeholder="角色名" ${r.isAdmin ? 'readonly' : ''} style="width:180px;padding:7px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:${r.isAdmin ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.25)'};color:${r.isAdmin ? 'rgba(255,255,255,0.5)' : '#fff'};font-size:13px;">
        <div>${r.isAdmin ? '<span style="font-size:11px;opacity:0.5;margin-right:8px;">内置全权限</span>' : `<button onclick="rbacDelRole(${idx})" style="padding:5px 14px;border-radius:var(--radius-xs);border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.08);color:#FF453A;font-size:12px;cursor:pointer;">删除</button>`}</div>
      </div>
      <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.45);margin-bottom:6px;">权限</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">${permsHtml}</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <label for="rrole_emby_${idx}" style="font-size:11px;color:rgba(255,255,255,0.4);white-space:nowrap;">Emby 用户 ID（媒体范围）<span class="hint-ic" data-h="rbacEmby" role="button" tabindex="0" aria-label="说明"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.2"/><path d="M9.3 9.3a2.7 2.7 0 0 1 5.3 0c0 1.9-2.6 2.3-2.6 4"/><line x1="12" y1="17.3" x2="12" y2="17.35"/></svg></span></label>
        <input id="rrole_emby_${idx}" value="${esc(r.emby_user || '')}" placeholder="留空=默认用户 m" style="flex:1;min-width:140px;padding:7px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-size:12px;font-family:monospace;">
      </div>
      <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.55);">👥 隶属账号 · ${cnt}</span>
          <button onclick="rbacAddUserToRole(${idx})" style="padding:5px 14px;border-radius:var(--radius-xs);border:1px dashed rgba(255,255,255,0.25);background:rgba(255,255,255,0.05);color:#fff;font-size:12px;cursor:pointer;">+ 添加账号</button>
        </div>
        ${usersHtml || '<div style="font-size:11px;opacity:0.4;padding:4px 0;">暂无账号，点击上方「+ 添加账号」</div>'}
      </div>
    </div>`;
  }).join('');
  area.innerHTML = html || '<div style="font-size:12px;opacity:0.5;">暂无角色（admin 始终存在）</div>';
}
function rbacAddRole() {
  var n = window._rbacRoles.filter(function(r){return !r.isAdmin;}).length + 1;
  window._rbacRoles.push({ name: '角色' + n, permissions: ['overview', 'media', 'search'], emby_user: '', isAdmin: false });
  rbacRenderRoles();
}
function rbacDelRole(idx) {
  var r = window._rbacRoles[idx];
  if (!r) return;
  window._rbacRoles.splice(idx, 1);
  window._rbacUsers.forEach(function(u) { if (u.role === r.name) u.role = ''; });
  rbacRenderRoles();
  rbacRenderUsers();
}
function rbacAddUserToRole(idx) {
  // 先同步当前所有输入框值到 _rbacUsers，防止重绘丢失
  window._rbacUsers.forEach(function(u, uid) {
    var nameInp = document.getElementById('rusr_name_' + uid);
    var passInp = document.getElementById('rusr_pass_' + uid);
    if (nameInp) u.username = nameInp.value;
    if (passInp && passInp.value) u.password = passInp.value;
  });
  // 同步角色名
  window._rbacRoles.forEach(function(r, ridx) {
    var nameInp = document.getElementById('rrole_name_' + ridx);
    var embyInp = document.getElementById('rrole_emby_' + ridx);
    if (nameInp && !r.isAdmin) r.name = nameInp.value;
    if (embyInp) r.emby_user = embyInp.value;
  });
  var r = window._rbacRoles[idx];
  if (!r) return;
  window._rbacUsers.push({ username: '', role: r.name, password: '' });
  rbacRenderRoles();
  rbacRenderUsers();
}
function rbacRenderUsers() {
  var area = document.getElementById('rbacUsersArea');
  if (!area) return;
  var edit = !!window._rbacEditMode;
  var roleNames = window._rbacRoles.map(function(r) { return r.name; }).filter(function(n) { return n; });
  var opts = roleNames.map(function(r) { return `<option value="${esc(r)}">${esc(r)}</option>`; }).join('');
  var orphans = window._rbacUsers.map(function(u, uid) {
    return (!u.role || roleNames.indexOf(u.role) < 0) ? { u: u, uid: uid } : null;
  }).filter(Boolean);

  if (!edit) {
    // 只读模式：未分配角色的账号纯展示
    var html = orphans.map(function(o) {
      var u = o.u;
      return '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:var(--radius-xs);padding:8px 12px;">'
        + '<span style="font-size:12px;opacity:0.6;">👤</span>'
        + '<span style="font-size:13px;color:#fff;font-weight:600;">' + esc(u.username || '(未命名)') + '</span>'
        + '<span style="font-size:11px;color:rgba(255,255,255,0.4);">未分配角色</span>'
        + '</div>';
    }).join('');
    area.innerHTML = html || '<div style="font-size:12px;opacity:0.5;padding:6px 0;">所有账号均已分配角色</div>';
    return;
  }

  var html = orphans.map(function(o) {
    var u = o.u, uid = o.uid;
    return `
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:var(--glass-faint);border:1px dashed rgba(255,255,255,0.14);border-radius:var(--radius-xs);padding:8px 10px;">
      <span style="font-size:12px;opacity:0.6;">👤</span>
      <input id="rusr_name_${uid}" value="${esc(u.username)}" placeholder="用户名" style="width:110px;padding:6px 9px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-size:12px;height:32px;box-sizing:border-box;">
      <select id="rusr_role_${uid}" style="padding:0 26px 0 10px;height:32px;"><option value="">未分配角色</option>${opts}</select>
      <input id="rusr_pass_${uid}" type="password" placeholder="${u.hasPass ? '留空不改密码' : '设置密码'}" style="width:120px;padding:6px 9px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-size:12px;height:32px;box-sizing:border-box;">
      <input id="rusr_pass2_${uid}" type="password" placeholder="确认密码" style="width:120px;padding:6px 9px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-size:12px;height:32px;box-sizing:border-box;">
      <button onclick="rbacDelUser(${uid})" style="height:32px;padding:0 12px;border-radius:var(--radius-xs);border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.08);color:#FF453A;font-size:12px;cursor:pointer;box-sizing:border-box;">移除</button>
    </div>`;
  }).join('');
  area.innerHTML = html || '<div style="font-size:12px;opacity:0.5;padding:6px 0;">未分配角色账号显示在这里 · 在角色卡片内点「+ 添加账号」即可把账号归入对应角色</div>';
  orphans.forEach(function(o) {
    var sel = document.getElementById('rusr_role_' + o.uid);
    if (sel) sel.value = o.u.role || '';
  });
}
function rbacAddUserRow() {
  var defaultRole = (window._rbacRoles.find(function(r) { return !r.isAdmin; }) || {}).name || 'member';
  window._rbacUsers.push({ username: '', role: defaultRole, password: '' });
  rbacRenderUsers();
}
function rbacDelUser(idx) {
  window._rbacUsers.splice(idx, 1);
  rbacRenderUsers();
}
/* ===== 存储设备：顶层定义（页面加载即生效，供存储卷配置模块与设置页使用；
   原定义误置于 saveConfig 函数体内，页面加载时不执行导致「＋ 添加设备」点击无效） ===== */
window._storageDeviceNames = function() {
  const devs = window._storageDevices || [];
  const names = devs.map(d => d.name).filter(Boolean);
  if (names.indexOf('本地') < 0) names.push('本地');
  return names.length ? names : ['SA', 'DS'];
};
window.renderDeviceRows = function() {
  const box = document.getElementById('deviceList');
  if (!box) return;
  const devs = window._storageDevices || [];
  const readonly = !!window._storageEditMode === false;
  box.innerHTML = devs.map((d, i) => `
    <div style="display:flex;gap:6px;align-items:center;">
      <input id="devName_${i}" value="${esc(d.name || '')}" placeholder="设备名" ${readonly?'disabled':''} style="flex:0 0 84px;height:30px;padding:0 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-size:12px;box-sizing:border-box;${readonly?'opacity:0.6;':''}">
      <input id="devMatch_${i}" value="${esc((d.match || []).join(', '))}" placeholder="匹配源关键字，逗号分隔" ${readonly?'disabled':''} style="flex:1;height:30px;padding:0 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-size:12px;box-sizing:border-box;${readonly?'opacity:0.6;':''}">
      <button onclick="removeDeviceRow(${i})" style="padding:3px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:rgba(255,255,255,0.7);font-size:12px;cursor:pointer;${readonly?'display:none;':''}">✕</button>
    </div>`).join('');
};
window.addDeviceRow = function() {
  window._storageDevices = window._storageDevices || [];
  window._storageDevices.push({ name: '', match: [] });
  window.renderDeviceRows();
};
window.removeDeviceRow = function(i) {
  window._storageDevices = window._storageDevices || [];
  window._storageDevices.splice(i, 1);
  window.renderDeviceRows();
};
/* ===== 存储卷配置：挂载卷渲染（响应编辑门禁） ===== */
window.renderVolAlias = function() {
  const list = document.getElementById('volumeAliasList');
  if (!list) return;
  const readonly = !window._storageEditMode;
  const vmap = (window._volCfg || {}).volumes || {};
  const aliases = window._volAliases || {};
  const devNames = (window._storageDevices || []).map(d => d.name).concat('本地');
  const rows = (window._volPools || []).map((p, i) => {
    const vc = vmap[p.mount] || {};
    const curDev = vc.device || p.device || '本地';
    return `<div style="display:flex;flex-direction:column;gap:4px;">
      <span style="font-size:12px;font-family:monospace;opacity:0.5;">${esc(p.mount)} · <span style="opacity:0.35;">${esc(p.source || '')}</span></span>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input id="volAlias_${i}" data-mount="${p.mount}" value="${esc(vc.alias || aliases[p.mount] || '')}" placeholder="别名" ${readonly?'disabled':''} style="flex:1 1 120px;height:34px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-size:13px;box-sizing:border-box;${readonly?'opacity:0.6;':''}">
        <select id="volDev_${i}" data-mount="${p.mount}" ${readonly?'disabled':''} style="height:34px;padding:0 28px 0 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-size:13px;${readonly?'opacity:0.6;':''}">
          ${devNames.map(n => `<option value="${n}" ${n === curDev ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
        <label style="font-size:12px;display:flex;align-items:center;gap:4px;white-space:nowrap;${readonly?'opacity:0.6;':''}">
          <input type="checkbox" id="volShow_${i}" data-mount="${p.mount}" ${vc.show === false ? '' : 'checked'} ${readonly?'disabled':''}> 显示
        </label>
      </div>
    </div>`;
  }).join('');
  list.innerHTML = rows || '<div style="font-size:12px;opacity:0.5;">无法获取存储列表</div>';
};
window.toggleStorageEdit = function() {
  window._storageEditMode = !window._storageEditMode;
  const edit = window._storageEditMode;
  const eb = document.getElementById('storageEditBtn');
  if (eb) eb.textContent = edit ? '✓ 完成' : '✏️ 编辑';
  const cb = document.getElementById('storageCancelBtn');
  if (cb) cb.style.display = edit ? '' : 'none';
  const ab = document.getElementById('addDevBtn');
  if (ab) ab.style.display = edit ? '' : 'none';
  const pat = document.getElementById('cfgVolPattern');
  if (pat) { pat.disabled = !edit; pat.style.opacity = edit ? '' : '0.6'; }
  window.renderDeviceRows();
  window.renderVolAlias();
};
window.cancelStorageEdit = function() {
  window._storageEditMode = false;
  const eb = document.getElementById('storageEditBtn');
  if (eb) eb.textContent = '✏️ 编辑';
  const cb = document.getElementById('storageCancelBtn');
  if (cb) cb.style.display = 'none';
  const ab = document.getElementById('addDevBtn');
  if (ab) ab.style.display = 'none';
  const pat = document.getElementById('cfgVolPattern');
  if (pat) { pat.disabled = true; pat.style.opacity = '0.6'; }
  window.renderDeviceRows();
  window.renderVolAlias();
};
function rbacCollect() {
  window._rbacRoles.forEach(function(r, idx) {
    var nEl = document.getElementById('rrole_name_' + idx);
    if (nEl) r.name = nEl.value.trim();
    var eEl = document.getElementById('rrole_emby_' + idx);
    if (eEl) r.emby_user = eEl.value.trim();
    if (!r.isAdmin) {
      var perms = [];
      PERM_TREE.forEach(function(t) {
        var pEl = document.getElementById('rpp_' + idx + '_' + t.key);
        if (pEl && pEl.checked) {
          perms.push(t.key);
        } else {
          t.subs.forEach(function(s) {
            var c = document.getElementById('rp_' + idx + '_' + t.key + ':' + s.key);
            if (c && c.checked) perms.push(t.key + ':' + s.key);
          });
        }
      });
      r.permissions = perms;
    }
  });
  window._rbacUsers.forEach(function(u, idx) {
    var nEl = document.getElementById('rusr_name_' + idx);
    var rEl = document.getElementById('rusr_role_' + idx);
    var pEl = document.getElementById('rusr_pass_' + idx);
    if (nEl) u.username = nEl.value.trim();
    if (rEl) u.role = rEl.value;
    u.password = (pEl && pEl.value) ? pEl.value : '';
    var p2El = document.getElementById('rusr_pass2_' + idx);
    if (u.password && p2El && pEl.value !== p2El.value) {
      toast('用户 "' + u.username + '" 两次密码输入不一致', 'err');
      return false;
    }
  });
  // 门禁：检查角色名重复
  var roleNames = {};
  for (var i = 0; i < window._rbacRoles.length; i++) {
    var rn = window._rbacRoles[i].name;
    if (!rn) continue;
    if (roleNames[rn]) {
      toast('角色名重复："' + rn + '"，请修改后再保存', 'err');
      return false;
    }
    roleNames[rn] = true;
  }
  // 门禁：检查用户名重复
  var userNames = {};
  for (var j = 0; j < window._rbacUsers.length; j++) {
    var un = window._rbacUsers[j].username;
    if (!un) continue;
    if (userNames[un]) {
      toast('用户名重复："' + un + '"，请修改后再保存', 'err');
      return false;
    }
    userNames[un] = true;
  }
  return true;
}

async function saveConfig() {
  const svcPorts = {};
  const svcAliases = {};
  if (window._svcData) {
    window._svcData.forEach((a, i) => {
      const proto = (document.getElementById('svcProto_' + i) || { value: 'http' }).value;
      const addr = (document.getElementById('svcAddr_' + i) || { value: '' }).value.trim();
      const m = addr.match(/^(.*?):(\d+)$/);
      const host = m ? m[1] : '';
      const port = m ? parseInt(m[2]) : a.port;
      const key = a.key || a.name;
      svcPorts[key] = { host: host, port: port, proto: proto };
      // 外网地址（可选）
      const extAddrEl = document.getElementById('svcExtAddr_' + i);
      const extProtoEl = document.getElementById('svcExtProto_' + i);
      if (extAddrEl) {
        const extAddr = extAddrEl.value.trim();
        if (extAddr) {
          const em = extAddr.match(/^(.*?):(\d+)$/);
          if (em) {
            svcPorts[key].ext_host = em[1];
            svcPorts[key].ext_port = parseInt(em[2]);
            svcPorts[key].ext_proto = extProtoEl ? extProtoEl.value : proto;
          }
        }
      }
      const aliasInp = document.getElementById('svcAlias_' + i);
      if (aliasInp) {
        const v = aliasInp.value.trim();
        if (v) svcAliases[key] = v;
      }
    });
  }
  const monitorServices = (window._svcCustom || []).map((c, j) => {
    const proto = (document.getElementById('svcCProto_' + j) || { value: 'http' }).value;
    const addr = (document.getElementById('svcCAddr_' + j) || { value: '' }).value.trim();
    const m = addr.match(/^(.*?):(\d+)$/);
    const host = m ? m[1] : (c.host || '');
    const port = m ? parseInt(m[2]) : (c.port || 80);
    const alias = (document.getElementById('svcCAlias_' + j) || { value: c.alias || '' }).value.trim();
    const name = (document.getElementById('svcCName_' + j) || { value: c.name }).value.trim() || c.name;
    const device = (document.getElementById('svcCDevice_' + j) || { value: c.device || 'SA' }).value;
    // 外网（可选）：svcCExtAddr_ host:port + svcCExtProto_ 协议
    let ext_host = c.ext_host || '', ext_port = c.ext_port || 0, ext_proto = c.ext_proto || 'http';
    const extAddrEl = document.getElementById('svcCExtAddr_' + j);
    if (extAddrEl) {
      const extAddr = extAddrEl.value.trim();
      const exm = extAddr.match(/^(.*?):(\d+)$/);
      if (exm) { ext_host = exm[1]; ext_port = parseInt(exm[2]); } else if (extAddr) { ext_host = extAddr; ext_port = 0; }
    }
    const extProtoEl = document.getElementById('svcCExtProto_' + j);
    if (extProtoEl) ext_proto = extProtoEl.value;
    return { name: name, icon: c.icon || '📦', desc: c.desc || '', host: host, port: port, proto: proto, device: device, alias: alias, ext_host: ext_host, ext_port: ext_port, ext_proto: ext_proto };
  });
  var newPass = document.getElementById('cfgAuthPass').value;
  var newPass2 = document.getElementById('cfgAuthPass2').value;
  if (newPass && newPass !== newPass2) {
    toast('两次输入的密码不一致', 'error');
    return;
  }
  const hl = collectHealthLayout();
  const data = {
    emby_api_key: (document.getElementById('cfgEmbyKey') || { value: '' }).value,
    tmdb_api_key: document.getElementById('cfgTmdbKey').value,
    qb_user: (document.getElementById('cfgQbUser') || { value: '' }).value,
    qb_pass: (document.getElementById('cfgQbPass') || { value: '' }).value,
    qb_api_key: (document.getElementById('cfgQbApiKey') || { value: '' }).value,
    tr_user: (document.getElementById('cfgTrUser') || { value: '' }).value,
    tr_pass: (document.getElementById('cfgTrPass') || { value: '' }).value,
    mp_db: (document.getElementById('cfgMpDb') || { value: '' }).value,
    mp_enabled: (document.getElementById('cfgMpEnabled') || { checked: false }).checked,
    mp_script: (document.getElementById('cfgMpScript') || { value: '' }).value,
    mp_api_key: (document.getElementById('cfgMpApiKey') || { value: '' }).value,
    pansou_url: (document.getElementById('cfgPansou') || { value: '' }).value,
    online_urls: (window._onlineSrcs || []).map(function(s){return (s||'').trim();}).filter(Boolean),
    mihomo_proxy: (document.getElementById('cfgProxy') || { value: '' }).value,
    cookiecloud_password: document.getElementById('cfgCCPass').value,
    cookiecloud_enabled: document.getElementById('ccEnabled').checked,
    auth_enabled: document.getElementById('cfgAuthEnabled').checked,
    auth_username: document.getElementById('cfgAuthUser').value,
    auth_password: newPass,
    features: {
      trending: document.getElementById('featTrending').checked,
      online_search: document.getElementById('featOnline').checked,
      pt_search: document.getElementById('featPt').checked,
      pansou_search: document.getElementById('featPansou').checked,
      carousel: document.getElementById('featCarousel').checked,
    },
    hero_sources: {
      recent: document.getElementById('heroSrcRecent').checked,
      random: document.getElementById('heroSrcRandom').checked,
      trending: document.getElementById('heroSrcTrending').checked,
      tmdb: document.getElementById('heroSrcTmdb').checked,
      douban: document.getElementById('heroSrcDouban').checked,
    },
    hero_types: {
      movie: document.getElementById('heroTypeMovie').checked,
      tv: document.getElementById('heroTypeTv').checked,
      short: document.getElementById('heroTypeShort').checked,
      anime: document.getElementById('heroTypeAnime').checked,
    },
    trend_sources: {
      douban: document.getElementById('trendDouban').checked,
      douban_tv: document.getElementById('trendDoubanTv').checked,
      iqiyi: document.getElementById('trendIqiyi').checked,
      bilibili: document.getElementById('trendBilibili').checked,
    },
    journey: (function() {
      const srcs = [];
      if (document.getElementById('journeyMedia').checked) srcs.push('media');
      if (document.getElementById('journeyTmdb').checked) srcs.push('tmdb');
      return { sources: srcs.length ? srcs : ['media'], daily_limit: document.getElementById('journeyDaily').checked };
    })(),
    svc_ports: svcPorts,
    svc_aliases: svcAliases,
    svc_favs: window._svcFavs || {},
    svc_order: window._svcOrder || {},
    device_titles: collectDeviceTitles(),
    monitor_services: monitorServices,
    favicon: (document.getElementById('cfgFavicon') || {}).value || '',
    proxy_url: (document.getElementById('cfgProxyUrl') || { value: '' }).value.trim(),
    share_base_url: (document.getElementById('cfgShareBase') || { value: '' }).value.trim(),
    ui_health_hidden: collectHealthShowCfg(),
    ui_svc_hidden: collectSvcShowCfg(),
    ui_health_flex: hl.flex,
    ui_health_net_min: hl.net_min,
    ui_health_net_max: hl.net_max,
    ui_health_card_min: hl.card_min,
  };
  // RBAC（管理员）
  if (_currentUser && _currentUser.is_admin) {
    if (rbacCollect() === false) return;  // 重名门禁阻止保存
    data.rbac_enabled = document.getElementById('rbacEnabled').checked;
    var rolesOut = {};
    window._rbacRoles.forEach(function(r) {
      if (r.name) rolesOut[r.name] = { permissions: r.isAdmin ? ALL_PAGES.slice() : r.permissions, emby_user: r.emby_user || '' };
    });
    data.rbac_roles = rolesOut;
    var adminName = (document.getElementById('cfgAuthUser').value || 'admin').trim();
    data.rbac_users = window._rbacUsers
      .filter(function(u) { return u.username && u.username !== adminName; })
      .map(function(u) { return { username: u.username, role: u.role || 'member', password: u.password || '' }; });
  }
  // 收集存储卷配置
  const storage = { volume_pattern: ((document.getElementById('cfgVolPattern')||{}).value||'').trim(), devices: [], volumes: {} };
  const dbox = document.getElementById('deviceList');
  if (dbox) {
    dbox.querySelectorAll('input[id^="devName_"]').forEach((inp, j) => {
      const nm = inp.value.trim();
      if (!nm) return;
      const mv = document.getElementById('devMatch_' + j);
      const match = (mv ? mv.value : '').split(',').map(s => s.trim()).filter(Boolean);
      storage.devices.push({ name: nm, match: match });
    });
  }
  if (window._volPools) {
    const aliases = {};
    window._volPools.forEach((p, i) => {
      const inp = document.getElementById('volAlias_' + i);
      const dev = document.getElementById('volDev_' + i);
      const sh = document.getElementById('volShow_' + i);
      const rec = storage.volumes[p.mount] = {};
      if (inp) { const v = inp.value.trim(); if (v) { rec.alias = v; aliases[p.mount] = v; } }
      if (dev) rec.device = dev.value;
      if (sh) rec.show = sh.checked;
    });
    data.volume_aliases = aliases;
    data.storage = storage;
  }
  try {
    await fetch(API_BASE + '/config', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+localStorage.getItem('nexus_token')}, body: JSON.stringify(data) });
    toast('配置已保存', 'success');
    applyHeroSrcCfgFromDom();
    setTimeout(() => { fetchApps(); loadSettings(); }, 500);
  } catch(e) {
    toast('保存失败: ' + e.message, 'error');
  }
}

// 密码可见性切换
function togglePwd(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.textContent = '🙈';
  } else {
    inp.type = 'password';
    btn.textContent = '👁';
  }
}

// 加载流行趋势（海报墙）
async function loadTrending() {
  const el = document.getElementById('trendingContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-block"><div class="spinner spinner-lg"></div></div>';
  // 趋势数据源开关（默认全开；从 /config 读取一次并缓存复用）
  if (!window._trendSources) {
    try {
      const c = await fetchJSON(API.config, 10000);
      window._trendSources = (c && c.trend_sources) || {};
    } catch(e) { window._trendSources = {}; }
  }
  const ts = window._trendSources;
  try {
    const data = await fetchJSON(API.trending, 60000);
    const d = data.data || {};
    let html = '';
    // 豆瓣电影海报墙（与媒体库搜索卡同字段同风格）
    if (d.douban && d.douban.length && ts.douban !== false) {
      html += '<div class="trend-section"><div class="trend-section-title">🎬 豆瓣热门电影</div><div class="trend-grid">';
      d.douban.forEach(it => {
        it.type = 'Movie'; // 补类型字段：卡片 meta 显示"电影"
        html += `<div class="movie-card" style="cursor:pointer;position:relative;" onclick="openTrendDetail('${esc(it.title)}','${esc(it.url)}','${esc(it.cover)}','${esc(it.intro || '')}','movie','${esc(it.rate || '')}','${esc(it.year || '')}','${esc(it.genres || '')}','${esc(it.country || '')}')">
          <div class="movie-poster" style="padding:0;background:rgba(255,255,255,0.06);position:relative;overflow:hidden;">
            <img src="${esc(imgProxy(it.cover))}" style="width:100%;height:100%;object-fit:cover;border-radius:14px;" loading="lazy" onerror="this.style.display='none'">
            ${it.rate ? `<div class="rating-badge"><span class="rb-star">★</span> ${esc(fmtRating(it.rate))}</div>` : ''}
          </div>
          <div class="movie-info">
            <div class="movie-title">${esc(it.title)}</div>
            ${_cardMeta(it)}
          </div>
        </div>`;
      });
      html += '</div></div>';
    }
    // 豆瓣电视
    if (d.douban_tv && d.douban_tv.length && ts.douban_tv !== false) {
      html += '<div class="trend-section"><div class="trend-section-title">📺 豆瓣热门电视</div><div class="trend-grid">';
      d.douban_tv.forEach((it, i) => {
        it.type = 'Series'; // 补类型字段：卡片 meta 显示"剧集"
        html += `<div class="movie-card" style="cursor:pointer;position:relative;" onclick="openTrendDetail('${esc(it.title)}','${esc(it.url)}','${esc(it.cover)}','${esc(it.intro || '')}','tv','${esc(it.rate || '')}','${esc(it.year || '')}','${esc(it.genres || '')}','${esc(it.country || '')}')">
          <div class="movie-poster" style="padding:0;background:rgba(255,255,255,0.06);position:relative;overflow:hidden;">
            <img src="${esc(imgProxy(it.cover))}" style="width:100%;height:100%;object-fit:cover;border-radius:14px;" loading="lazy" onerror="this.style.display='none'">
            ${it.rate ? `<div class="rating-badge"><span class="rb-star">★</span> ${esc(fmtRating(it.rate))}</div>` : ''}
          </div>
          <div class="movie-info" id="trendtv-${i}">
            <div class="movie-title">${esc(it.title)}</div>
            ${_cardMeta(it)}
          </div>
        </div>`;
        _queueTrendSeason(it, 'trendtv-' + i);
      });
      html += '</div></div>';
    }
    // 爱奇艺风云榜·电视剧（与媒体库搜索卡同字段同风格）
    if (d.iqiyi && d.iqiyi.length && ts.iqiyi !== false) {
      html += '<div class="trend-section"><div class="trend-section-title">📺 爱奇艺热门剧集</div><div class="trend-grid">';
      d.iqiyi.forEach((it, i) => {
        it.type = 'Series'; // 补类型字段：卡片 meta 显示"剧集"
        html += `<div class="movie-card" style="cursor:pointer;position:relative;" onclick="openTrendDetail('${esc(it.title)}','','${esc(it.cover || '')}','${esc(it.intro || '')}','tv')">
          <div class="movie-poster" style="padding:0;background:rgba(255,255,255,0.06);position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;">
            ${it.cover ? `<img src="${esc(imgProxy(it.cover))}" style="width:100%;height:100%;object-fit:cover;border-radius:14px;" loading="lazy" onerror="this.style.display='none';this.parentElement.innerHTML='<span style=&quot;font-size:40px;&quot;>🎬</span>'">` : '<span style="font-size:40px;">🎬</span>'}
          </div>
          <div class="movie-info" id="trendiq-${i}">
            <div class="movie-title">${esc(it.title)}</div>
            ${_cardMeta(it)}
          </div>
        </div>`;
        _queueTrendSeason(it, 'trendiq-' + i);
      });
      html += '</div></div>';
    }
    // B站热门海报墙
    if (d.bilibili && d.bilibili.length && ts.bilibili !== false) {
      html += '<div class="trend-section"><div class="trend-section-title">📺 哔哩哔哩热门</div><div class="trend-grid">';
      d.bilibili.forEach(it => {
        html += `<div class="movie-card" style="cursor:pointer;position:relative;" onclick="openTrendDetail('${esc(it.title)}','${esc(it.url)}','${esc(it.cover)}','${esc(it.intro || '')}','movie')">
          <div class="movie-poster trend-poster-bili" style="padding:0;background:rgba(255,255,255,0.06);position:relative;overflow:hidden;">
            <img src="${esc(imgProxy(it.cover))}" style="width:100%;height:100%;object-fit:cover;border-radius:14px;" loading="lazy" onerror="this.style.display='none'">
          </div>
          <div class="movie-info">
            <div class="movie-title">${esc(it.title)}</div>
            <div class="movie-meta"><span class="m-owner">${esc((it.owner||'').replace(/^UP\s*/i,''))}</span><span class="m-sub">${formatNum(it.play)} 播放</span></div>
          </div>
        </div>`;
      });
      html += '</div></div>';
    }
    if (!html) html = '<div style="text-align:center;padding:40px;opacity:0.5;">暂未获取到数据</div>';
    el.innerHTML = html;
    loadTrendSeason();
  } catch(e) {
    el.innerHTML = '<div style="text-align:center;padding:40px;opacity:0.5;">加载失败: ' + esc(e.message) + '</div>';
  }
}
// ========== 平台链接组件（flip 卡背面 / detailModal 共用）：实色品牌胶囊 + 链图标 + 6px 图标文本间距 ==========
var _platIc = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
function renderPlatformLinks(o) {
  o = o || {};
  var out = [];
  function item(cls, url, label) {
    return '<a class="' + o.cls + ' ' + o.cls + '-' + cls + '" target="_blank" rel="noopener" href="' + url + '" onclick="event.stopPropagation()">' + _platIc + '<span>' + label + '</span></a>';
  }
  if (o.tmdbId) out.push(item('tmdb', 'https://www.themoviedb.org/' + (o.isTv ? 'tv' : 'movie') + '/' + esc(o.tmdbId), 'TMDB'));
  if (o.imdbId) out.push(item('imdb', 'https://www.imdb.com/title/' + esc(o.imdbId), 'IMDB'));
  if (o.tvdbId) out.push(item('tvdb', 'https://www.thetvdb.com/?tab=series&id=' + esc(o.tvdbId), 'TVDB'));
  if (o.doubanUrl) out.push(item('douban', esc(o.doubanUrl), '豆瓣'));
  return out.join('');
}
async function openTrendDetail(title, url, poster = '', overview = '', mtype = 'movie', rate = '', year = '', genres = '', country = '') {
  // 翻转卡片（重做）：正面=图3（独立竖版海报封面大图+标题/评分/年份·类型+三枚操作按钮）；背面=图2原始卡（海报整卡背景+压暗模糊遮罩+完整简介卡片内纵向滚动+绿色豆瓣按钮+演职员）
  let modal = document.getElementById('flipModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'flipModal';
    modal.className = 'flip-modal-overlay';
    modal.onclick = (e) => { if (e.target === modal) closeFlipModal(); };
    document.body.appendChild(modal);
  }
  const isTv = mtype === 'tv';
  const typeLabel = isTv ? '剧集' : '电影';
  const nameSub = [typeLabel, year, country].filter(Boolean).join(' · '); // 名称区第二行：类别 · 年份 · 地区
  const metaSpace = [typeLabel, year, country].filter(Boolean).join(' · '); // 背面头部：类别 · 年份 · 地区（TMDB 补全时用 productionCountry 覆盖）
  const favId = 'trend-' + (title || 'trend').toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').slice(0, 48);
  const favAction = `flipFav(this,{id:${JSON.stringify(favId)},type:${JSON.stringify(isTv ? 'Series' : 'Movie')},title:${JSON.stringify(title)},year:${JSON.stringify(year)},poster:${JSON.stringify(poster)},rating:${JSON.stringify(rate)}})`;
  const _sIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  const _hIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  const _starIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  const backActions = `
    <button class="flip-back-btn flip-back-btn-plain" onclick='flipSubscribe(this,${JSON.stringify(title)},${JSON.stringify(isTv?'tv':'movie')},${JSON.stringify(year)},${JSON.stringify(poster)},${JSON.stringify(rate)},${JSON.stringify(overview)})'>${_starIcon}订阅</button>
    <button class="flip-back-btn flip-back-btn-plain" onclick='${favAction}'>${_starIcon}收藏</button>
    <button class="flip-back-btn flip-back-btn-plain" onclick='flipSearch(${JSON.stringify(title)})'>${_sIcon}搜索</button>`;
  modal.innerHTML = `
    <button class="flip-close" onclick="closeFlipModal()">✕</button>
    <div class="flip-card-container" onclick="flipCard(this)">
      <div class="flip-card">
        <!-- 正面（海报比例整卡）：完整海报 + 名称/类别·年份·地区(渐变压暗区) + 底部玻璃遮罩三行(评分/类型/点击查看简介) -->
        <div class="flip-card-front">
          <div class="flip-front">
            ${poster ? `<img class="flip-front-poster" src="${imgProxy(poster)}" onerror="this.style.display='none'">` : ''}
            <div class="flip-front-fade"></div>
            <div class="flip-front-name">
              <div class="flip-front-name-title">${esc(title)}</div>
              ${nameSub ? `<div class="flip-front-name-sub" id="flipFrontMeta">${esc(nameSub)}</div>` : ''}
            </div>
            <div class="flip-front-glass">
              ${rate ? `<div class="flip-front-rate"><span class="rb-star">★</span> ${esc(fmtRating(rate))}</div>` : ''}
              ${genres ? `<div class="flip-front-gtype">${esc(genres)}</div>` : ''}
              <div class="flip-front-hint">点击查看简介</div>
            </div>
          </div>
        </div>
        <!-- 背面（媒体库详情页字段）：海报整卡背景 + 深色玻璃遮罩 + 标题/星级评分/元数据/平台按钮/TMDB字段/DIRECTOR/简介/演职员/操作按钮 -->
        <div class="flip-card-back">
          ${poster ? `<img class="flip-back-bg" src="${imgProxy(poster)}" onerror="this.style.display='none'">` : ''}
          <div class="flip-back-dim"></div>
          <div class="flip-back-body">
            <div class="flip-back-head">
              <div class="flip-back-title">${esc(title)}</div>
              ${metaSpace ? `<div class="flip-back-meta" id="flipBackMeta">${esc(metaSpace)}</div>` : ''}
              <div class="flip-back-rate-num" id="flipBackRateNum"></div>
            </div>
            <div class="flip-back-scroll">
              <div class="flip-back-overview" id="flipBackOverview">${esc(String(overview || '').replace(/^[\s\u3000]+/, '').replace(/&emsp;/gi, ' ')) || '暂无简介'}</div>
              <div class="flip-back-platforms" id="flipBackPlatforms"></div>
              <div class="flip-back-directors" id="flipBackDirectors"></div>
              <div class="flip-cast" id="flipCast"></div>
              <div class="flip-back-stars" id="flipBackStars"></div>
              <div class="flip-back-fields" id="flipBackFields"></div>
            </div>
            <div class="flip-back-foot"><div class="flip-back-actions">${backActions}</div></div>
          </div>
        </div>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  lockScroll();
  // 翻转卡背面骨架：TMDB 补全前先显示加载骨架，避免点开干等
  ['flipBackPlatforms','flipBackDirectors','flipCast','flipBackStars','flipBackFields'].forEach(function(id){
    var el = document.getElementById(id);
    if (el && !el.childNodes.length) el.innerHTML = '<div class="skeleton" style="height:14px;border-radius:6px;margin:5px 0;width:55%;"></div><div class="skeleton" style="height:14px;border-radius:6px;margin:5px 0;width:75%;"></div>';
  });

  // TMDB 补全：豆瓣趋势缺高清海报/完整简介/演职员时补全（评分/年份/类型以豆瓣为准）
  try {
    const t = (title || '').trim();
    if (!t) return;
    const r = await fetchJSON(`/tmdb/detail?q=${encodeURIComponent(t)}&type=${isTv ? 'tv' : 'movie'}`, 15000);
    const d = (r && r.data) || {};
    ['flipBackPlatforms','flipBackDirectors','flipCast','flipBackStars','flipBackFields'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.innerHTML = '';
    });
    if (!d || !d.name || d.error) return; // TMDB 未命中则保留豆瓣原始数据
    window._flipTmdbId = d.tmdbId || '';  // 供订阅按钮传递 MP
    // 已订阅的片 → 打开时订阅按钮初始红色剪影填充
    if (window._flipTmdbId && _subTmdbIds[String(window._flipTmdbId)]) {
      const _sb = document.querySelector('.flip-back-btn-primary svg');
      if (_sb) _sb.setAttribute('fill', '#FF3B30');
    }
    // 1) 星级评分：5 颗星星生长进度（10 分制 → 每颗星 2 分，星星按评分比例部分点亮，评分以豆瓣为准）
    const sEl = document.getElementById('flipBackStars');
    const nEl = document.getElementById('flipBackRateNum');
    if (rate) {
      const v = parseFloat(rate);
      if (!isNaN(v)) {
        const val = Math.max(0, Math.min(5, v / 2)); // 星值（如 5.5/10 → 2.75 颗星）
        let stars = '';
        for (let i = 1; i <= 5; i++) {
          const fill = Math.max(0, Math.min(100, (val - (i - 1)) * 100)); // 第 i 颗星填充百分比（满星需 val>=i）
          stars += `<span class="star-grow"><span class="sg-mask" style="width:${fill.toFixed(1)}%">★</span>★</span>`;
        }
        if (sEl) sEl.innerHTML = stars;
      }
      if (nEl) nEl.innerHTML = `${esc(fmtRating(rate))} / 10`;
    }
    // 2) 元数据行追加季数集数/时长（与轮播模块一致：电影补分钟时长；剧集补总季/总集 + 单集时长）
    const mEl = document.getElementById('flipBackMeta');
    const frontMetaEl = document.getElementById('flipFrontMeta');
    if (mEl) {
      if (d.productionCountry) {
        mEl.textContent = [typeLabel, year, d.productionCountry].filter(Boolean).join(' · ');
      }
      if (isTv && d.totalSeasons) {
        const isEnded = /完结|ended/i.test(d.status || '');
        let tvMeta = isEnded && d.totalEpisodes ? (d.totalSeasons === 1 ? `共 ${d.totalEpisodes} 集` : `共 ${d.totalSeasons} 季 · ${d.totalEpisodes} 集`) : `共 ${d.totalSeasons} 季`;
        if (d.episodeRunTime) tvMeta += ` · ${d.episodeRunTime}分/集`;
        mEl.textContent = (mEl.textContent || '') + ' · ' + tvMeta;
      } else if (!isTv && d.runtime) {
        mEl.textContent = (mEl.textContent || '') + ' · ' + d.runtime + ' 分钟';
      }
    }
    // 正面名称区第二行同步追加（类别·年份·地区 + 时长/季集）
    if (frontMetaEl) {
      const baseMeta = [typeLabel, year, d.productionCountry || country].filter(Boolean).join(' · ');
      if (isTv && d.totalSeasons) {
        const isEnded = /完结|ended/i.test(d.status || '');
        let tvMeta = isEnded && d.totalEpisodes ? (d.totalSeasons === 1 ? `共 ${d.totalEpisodes} 集` : `共 ${d.totalSeasons} 季 · ${d.totalEpisodes} 集`) : `共 ${d.totalSeasons} 季`;
        if (d.episodeRunTime) tvMeta += ` · ${d.episodeRunTime}分/集`;
        frontMetaEl.textContent = baseMeta + ' · ' + tvMeta;
      } else if (!isTv && d.runtime) {
        frontMetaEl.textContent = baseMeta + ' · ' + d.runtime + ' 分钟';
      } else {
        frontMetaEl.textContent = baseMeta;
      }
    }
    // 3) 平台按钮：TMDB / IMDB / TVDB / 豆瓣（统一组件 renderPlatformLinks，样式与 detailModal 实色胶囊一致）
    const pEl = document.getElementById('flipBackPlatforms');
    if (pEl) {
      pEl.innerHTML = renderPlatformLinks({ cls: 'flip-plat', tmdbId: d.tmdbId, imdbId: d.imdbId, tvdbId: d.tvdbId, isTv: isTv, doubanUrl: url });
    }
    // 4) 媒体库详情字段：TMDB ID/IMDB ID/原始标题/状态/上映日期/原始语言/出品国家/别名/制作公司/文件名称/总季数/总集数
    const fEl = document.getElementById('flipBackFields');
    if (fEl) {
      const rows = [
        ['TMDB ID', d.tmdbId], ['IMDB ID', d.imdbId], ['原始标题', d.originalTitle || d.officialName],
        ['状态', d.status], ['上映日期', d.premiereDate], ['原始语言', d.originalLanguage],
        ['出品国家', d.productionCountry], ['别名', d.aliases],
        ['制作公司', (d.studios || []).join('、')],
        ['文件名称', d.fileName || '—'],
        ['文件路径', d.path || '—'],
        ['总季数', d.totalSeasons ? String(d.totalSeasons) : ''],
        ['总集数', d.totalEpisodes ? String(d.totalEpisodes) : '']
      ].filter(x => x[0] === '文件名称' || x[0] === '文件路径' || x[1]);
      if (rows.length) fEl.innerHTML = rows.map(r => `<div class="flip-back-field"><span class="lb">${esc(r[0])}</span><span class="vl">${esc(r[1])}</span></div>`).join('');
    }
    // 5) DIRECTOR 导演名单
    const dirEl = document.getElementById('flipBackDirectors');
    if (dirEl && d.directors && d.directors.length) {
      dirEl.innerHTML = `<div class="flip-sec-title">导演</div>${d.directors.map(n => `<div class="flip-dir-name">${esc(personName(n))}</div>`).join('')}`;
    }
    // 6) 背面完整简介：豆瓣无简介时用 TMDB 全文
    const ov = document.getElementById('flipBackOverview');
    if (ov && d.overview) ov.textContent = d.overview;
    // 3) 背面演职员（cast 头像 + 角色，无头像显示姓氏首字）
    const cast = document.getElementById('flipCast');
    if (cast && d.actors && d.actors.length) {
      cast.innerHTML = `<div class="flip-sec-title">演员</div>
        <div class="flip-cast-row">${d.actors.map(a => {
          const hasImg = a.image && !a.image.endsWith('/w200');
          return `<div class="flip-actor">
            ${hasImg ? `<img src="${esc(a.image)}" class="flip-actor-img" loading="lazy" onerror="this.style.display='none'">` : `<div class="flip-actor-img flip-actor-ph"><span>${esc((a.name || '?').charAt(0))}</span></div>`}
            <div class="flip-actor-name">${esc(a.name || '')}</div>
            ${a.role ? `<div class="flip-actor-role">${esc(a.role)}</div>` : ''}
          </div>`;
        }).join('')}</div>`;
    }
  } catch (e) { /* TMDB 补全失败则保留原始数据 */ }
}

function closeFlipModal() {
  const modal = document.getElementById('flipModal');
  if (modal) modal.style.display = 'none';
  unlockScroll();
}

// ========== 翻转卡搜索三选浮层（任务14）==========
// 翻转卡按钮为 innerHTML 注入，onclick 在全局作用域解析 → 必须挂 window
let _flipSearchModal = null;
window.flipSearch = function(title) {
  if (!_flipSearchModal) {
    _flipSearchModal = document.createElement('div');
    _flipSearchModal.id = 'flipSearchModal';
    _flipSearchModal.className = 'flip-search-overlay';
    _flipSearchModal.onclick = (e) => { if (e.target === _flipSearchModal) closeFlipSearch(); };
    document.body.appendChild(_flipSearchModal);
  }
  window._flipSearchTitle = title || '';
  _flipSearchModal.innerHTML = `
    <div class="flip-search-panel">
      <div class="flip-search-head">
        <div class="flip-search-title">🔍 搜索「${esc(title || '')}」</div>
        <button class="flip-search-close" onclick="closeFlipSearch()">✕</button>
      </div>
      <div class="flip-search-choices">
        <div class="flip-search-choice sel-pansou" onclick="flipSearchGo('pansou')">📦 网盘搜索</div>
        <div class="flip-search-choice sel-online" onclick="flipSearchGo('online')">🎥 在线观影</div>
        <div class="flip-search-choice sel-pt" onclick="flipSearchGo('pt')">🌐 站点搜索</div>
      </div>
      <div class="flip-search-body" id="flipSearchBody">
        <div class="flip-search-empty">选择上方来源，搜索全网资源</div>
      </div>
    </div>`;
  _flipSearchModal.style.display = 'flex';
};
window.closeFlipSearch = function() {
  if (_flipSearchModal) _flipSearchModal.style.display = 'none';
};
window.flipSearchGo = async function(source) {
  const body = document.getElementById('flipSearchBody');
  const title = window._flipSearchTitle || '';
  if (!body || !title) return;
  const LABELS = { pansou: '网盘搜索', online: '在线观影', pt: '站点搜索' };
  body.innerHTML = `<div class="flip-search-loading">
    <div style="width:240px;max-width:70%;height:4px;border-radius:2px;background:rgba(255,255,255,0.12);overflow:hidden;"><div style="height:100%;width:40%;border-radius:2px;background:#fff;animation:indeterm 1.1s ease-in-out infinite;"></div></div>
    <div style="font-size:13px;color:rgba(255,255,255,0.55);">正在${LABELS[source] || ''}…${source === 'pt' ? '（逐站检索约需 30-90 秒）' : ''}</div></div>`;
  let url;
  if (source === 'pt') url = '/search/pt?q=' + encodeURIComponent(title);
  else if (source === 'online') url = '/search/online?q=' + encodeURIComponent(title);
  else url = '/search/pansou?q=' + encodeURIComponent(title);
  const timeout = source === 'pt' ? 120000 : 120000;
  const data = await fetchJSON(url, timeout);
  const results = (data && data.results) || [];
  if (!results.length) {
    body.innerHTML = `<div class="flip-search-empty">未找到相关资源（${LABELS[source] || ''}）</div>`;
    return;
  }
  const PAN_TYPE = {
    aliyun:'阿里云盘', baidu:'百度网盘', quark:'夸克网盘', xunlei:'迅雷网盘',
    '123':'123云盘', tianyi:'天翼云盘', guangya:'光鸭网盘', mobile:'移动云盘',
    uc:'UC网盘', magnet:'磁力', other:'其他', others:'其他',
  };
  body.innerHTML = `<div class="torrent-list">` + results.map(r => {
    let srcLabel = r.site || r.source || '';
    if (source === 'pansou') srcLabel = PAN_TYPE[r.type] || r.type || srcLabel;
    let badge = `<span class="src-badge" data-src="${esc(source)}">${esc(srcLabel || LABELS[source])}</span>`;
    let subParts = [];
    if (r.quality) subParts.push(`<span style="color:rgba(255,255,255,0.5);">${esc(r.quality)}</span>`);
    if (r.password) subParts.push(`<span style="color:#FFD60A;">提取码: ${esc(r.password)}</span>`);
    if (r.date) subParts.push(`<span>${esc(r.date)}</span>`);
    if (r.size) subParts.push(`<span>${esc(r.size)}</span>`);
    if (r.seeders != null) subParts.push(`<span style="color:#30D158;">▲ ${r.seeders} 做种</span>`);
    const icon = r.icon || (source==='pansou'?'📦':source==='online'?'🔗':'🌐');
    const openClick = source === 'online'
      ? `onclick="playRecord('${esc(r.title)}','${esc(r.url)}');window.open('${esc(r.url)}','_blank')"`
      : `onclick="window.open('${esc(r.url)}','_blank')"`;
    return `<div class="torrent-item" style="cursor:pointer;" ${openClick}>
      <div class="torrent-icon">${icon}</div>
      <div class="torrent-main">
        <div class="torrent-name">${esc(r.title)}</div>
        <div class="torrent-sub">${subParts.join('')}</div>
      </div>
      ${badge}
    </div>`;
  }).join('') + `</div><div style="padding:12px 6px 4px;text-align:center;opacity:0.55;font-size:12px;">共 ${results.length} 条结果 · 点击条目在新标签页打开</div>`;
};

function flipCard(container) {
  const card = container.querySelector('.flip-card');
  if (card) card.classList.toggle('flipped');
}

function formatNum(n) {
  if (n >= 10000) return (n/10000).toFixed(1) + '万';
  return n;
}

// 应用功能开关
async function applyFeatureFlags() {
  try {
    const cfg = await fetchJSON(API.features);
    const ft = cfg.features || {};
    // 隐藏搜索源
    const hideSrc = (src, hide) => {
      const el = document.querySelector(`.search-dropdown-item[data-source="${src}"]`);
      if (el) el.style.display = hide ? 'none' : '';
    };
    hideSrc('online', ft.online_search === false);
    hideSrc('pt', ft.pt_search === false);
    hideSrc('pansou', ft.pansou_search === false);
    // 隐藏趋势菜单项
    const mt = document.getElementById('moreTrending');
    if (mt) mt.style.display = ft.trending === false ? 'none' : '';
    // 隐藏轮播
    const carousel = document.getElementById('heroCarousel');
    if (carousel) carousel.style.display = ft.carousel === false ? 'none' : '';
    // 同步设置页功能开关状态（双保险，避免开关显示与实际功能不一致）
    const setTgl = (id, on) => { const el = document.getElementById(id); if (el) el.checked = on; };
    setTgl('featTrending', ft.trending !== false);
    setTgl('featOnline', ft.online_search !== false);
    setTgl('featPt', ft.pt_search !== false);
    setTgl('featPansou', ft.pansou_search !== false);
    setTgl('featCarousel', ft.carousel !== false);
  } catch(e) {}
}

// 移动端 TabBar 点击
document.querySelectorAll('.mobile-tabbar .tab[data-page]').forEach(tab => {
  tab.addEventListener('click', (e) => {
    e.preventDefault();
    switchPage(tab.dataset.page);
  });
});

// ========== 搜索下拉 ==========
const searchSwitch = document.getElementById('searchSwitch');
const searchDropdown = document.getElementById('searchDropdown');

searchSwitch.addEventListener('click', (e) => {
  e.stopPropagation();
  // 互斥：打开搜索源下拉时关闭其他浮层
  document.getElementById('msgPanel') && (document.getElementById('msgPanel').style.display = 'none');
  heroSourceDropdown.classList.remove('show');
  var willShow = !searchDropdown.classList.contains('show');
  if (willShow) {
    // 锚定：从搜索框正下方展开，左侧对齐搜索框左缘
    var sb = document.querySelector('.search-box').getBoundingClientRect();
    searchDropdown.style.top = (sb.bottom + 8) + 'px';
    searchDropdown.style.left = sb.left + 'px';
  }
  searchDropdown.classList.toggle('show');
});

document.addEventListener('click', (e) => {
  const t = e.target;
  // 搜索源下拉：点击目标不在下拉本身即收起（点搜索框也会收起）
  if (!t.closest('.search-dropdown')) searchDropdown.classList.remove('show');
  // 消息面板：点击不在面板/铃铛内即强制收起
  if (!t.closest('.msg-panel') && !t.closest('.msg-bell')) {
    const mp = document.getElementById('msgPanel');
    if (mp) { mp.classList.remove('show'); mp.style.display = 'none'; }
  } else {
    const mp = document.getElementById('msgPanel');
    if (mp) mp.style.display = 'block';
  }
  // hero 源下拉
  if (!t.closest('.hero-source-dropdown') && !t.closest('#heroSourceSwitch')) heroSourceDropdown.classList.remove('show');
  // 更多浮层：点击不在浮层/更多tab内即收起（即使未点到遮罩）
  if (!t.closest('.more-drawer') && !t.closest('#moreTab')) closeMoreDrawer();
});

// ========== Hero 轮播源切换 ==========
const heroSourceSwitch = document.getElementById('heroSourceSwitch');
const heroSourceDropdown = document.getElementById('heroSourceDropdown');
let heroSource = 'auto';
let autoSourceIdx = 0;
const autoCycle = ['recent', 'random', 'trending'];
// 轮播来源开关缓存（来自设置页 hero_sources / hero_types）
let _heroSrcDisabled = [];
let _heroTypeDisabled = [];
function heroSrcEnabled(s) { return _heroSrcDisabled.indexOf(s) < 0; }
function heroTypeEnabled(t) { return !t || _heroTypeDisabled.indexOf(t) < 0; }
function _heroTypeOf(it) {
  const s = String(it.category || it.type || '').toLowerCase();
  if (/(短剧|微短剧|short)/.test(s)) return 'short';
  if (/(动漫|动画|anime)/.test(s)) return 'anime';
  if (/(电视剧|剧集|连续剧|series|tv)/.test(s)) return 'tv';
  if (/(电影|movie|film)/.test(s)) return 'movie';
  return '';  // 未知类型默认保留
}
function applyHeroSrcCfgFromDom() {
  const ids = { recent: 'heroSrcRecent', random: 'heroSrcRandom', trending: 'heroSrcTrending', tmdb: 'heroSrcTmdb', douban: 'heroSrcDouban' };
  _heroSrcDisabled = [];
  Object.keys(ids).forEach(function (k) {
    const el = document.getElementById(ids[k]);
    if (el && !el.checked) _heroSrcDisabled.push(k);
  });
  const tids = { movie: 'heroTypeMovie', tv: 'heroTypeTv', short: 'heroTypeShort', anime: 'heroTypeAnime' };
  _heroTypeDisabled = [];
  Object.keys(tids).forEach(function (k) {
    const el = document.getElementById(tids[k]);
    if (el && !el.checked) _heroTypeDisabled.push(k);
  });
  window._heroSrcCfgReady = true;
  // 轮播源切换下拉同步禁用态
  document.querySelectorAll('#heroSourceDropdown [data-herosource]').forEach(function (it) {
    const s = it.dataset.herosource;
    if (s === 'auto') return;
    const off = _heroSrcDisabled.indexOf(s) >= 0;
    it.style.opacity = off ? '0.4' : '';
    it.style.pointerEvents = off ? 'none' : '';
    if (off) it.classList.remove('active');
  });
}
// 轮播来源过滤配置预取：设置页打开前（首页轮播初始化时）先从 /api/config 加载一次并缓存
async function ensureHeroSrcCfg() {
  if (window._heroSrcCfgReady) return;
  try {
    const cfg = await fetchJSON(API.config, 10000);
    if (cfg) {
      const hs = cfg.hero_sources || {};
      const ids = { recent: 'heroSrcRecent', random: 'heroSrcRandom', trending: 'heroSrcTrending', tmdb: 'heroSrcTmdb', douban: 'heroSrcDouban' };
      Object.keys(ids).forEach(function (k) {
        const el = document.getElementById(ids[k]);
        if (el) el.checked = hs[k] !== false;
      });
      const ht = cfg.hero_types || {};
      const tids = { movie: 'heroTypeMovie', tv: 'heroTypeTv', short: 'heroTypeShort', anime: 'heroTypeAnime' };
      Object.keys(tids).forEach(function (k) {
        const el = document.getElementById(tids[k]);
        if (el) el.checked = ht[k] !== false;
      });
      applyHeroSrcCfgFromDom();
    } else {
      window._heroSrcCfgReady = true;  // 配置不可读时按全开兜底
    }
  } catch (e) {
    window._heroSrcCfgReady = true;
  }
}

heroSourceSwitch.addEventListener('click', (e) => {
  e.stopPropagation();
  // 互斥：打开 hero 源下拉时关闭其他浮层
  searchDropdown.classList.remove('show');
  var mp = document.getElementById('msgPanel');
  if (mp) mp.style.display = 'none';
  // 锚定：下拉从按钮正下方展开，左侧对齐按钮左缘（fixed 视口坐标）
  const r = heroSourceSwitch.getBoundingClientRect();
  heroSourceDropdown.style.left = Math.max(0, r.left) + 'px';
  heroSourceDropdown.style.top = (r.bottom + 6) + 'px';
  heroSourceDropdown.classList.toggle('show');
  // 底部空间不足时自动向上展开（避免菜单被视口/卡片截断）
  if (heroSourceDropdown.classList.contains('show')) {
    const _m = heroSourceDropdown.getBoundingClientRect();
    if (_m.bottom > window.innerHeight - 8) {
      heroSourceDropdown.style.top = Math.max(8, r.top - _m.height - 6) + 'px';
    }
  }
});

// 浮层收起（searchDropdown/msgPanel/heroSourceDropdown/moreDrawer）已由上方统一的 document click 处理器负责

document.querySelectorAll('[data-herosource]').forEach(item => {
  item.addEventListener('click', () => {
    heroSource = item.dataset.herosource;
    heroSourceDropdown.classList.remove('show');
    document.querySelectorAll('[data-herosource]').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    const labels = { auto: '自动切换', recent: '最近入库', random: '随机推荐', trending: '热门高分', tmdb: 'TMDB 流行', douban: '豆瓣热门' };
    document.getElementById('heroSourceLabel').textContent = labels[heroSource] || '自动切换';
    loadHeroSlides();
  });
});

/* 轮播图按图片比例精确定位：竖版海报（<1.25）偏上 18% 展示主体（头部/胸口条带），横版剧照居中偏上 40% */
function applyHeroPoster(el, url, blurPoster) {
  if (!el || !url) return;
  el.style.backgroundImage = `url('${url}')`;
  el.style.backgroundSize = 'cover';
  if (blurPoster) {
    el.style.filter = 'blur(24px) brightness(0.72) saturate(1.1)';
    el.style.transform = 'scale(1.2)';
    el.style.backgroundPosition = 'center 35%';
    return;
  }
  el.style.filter = 'brightness(0.92) saturate(1.25)';
  el.style.transform = 'scale(1.05)';
  const im = new Image();
  im.onload = () => {
    const r = im.width / im.height;
    el.style.backgroundPosition = (r < 1.25) ? 'center 18%' : 'center 40%';
  };
  im.src = url;
}

async function loadHeroSlides() {
  await ensureHeroSrcCfg();
  let actualSource = heroSource;
  if (heroSource === 'auto') {
    // 自动模式：仅在启用来源间循环（全部关闭时兜底最近入库）
    let pool = autoCycle.filter(s => heroSrcEnabled(s));
    if (!pool.length) pool = ['recent'];
    actualSource = pool[autoSourceIdx % pool.length];
  } else if (!heroSrcEnabled(heroSource)) {
    // 手动选了已关闭的来源 → 回退到首个启用的媒体库源
    actualSource = autoCycle.find(s => heroSrcEnabled(s)) || 'recent';
    const labels = { recent: '最近入库', random: '随机推荐', trending: '热门高分', tmdb: 'TMDB 流行', douban: '豆瓣热门' };
    document.getElementById('heroSourceLabel').textContent = labels[actualSource] || '最近入库';
  }
  const data = await fetchJSON('/carousel?src=' + actualSource, 30000);
  if (data && data.items && data.items.length) {
    let heroItems = data.items.filter(it => it.image);
    // 媒体库来源（最近入库/随机/热门）按内容类型开关过滤：关闭的类型不再展示，未知类型默认保留
    if (['recent', 'random', 'trending'].indexOf(actualSource) >= 0) {
      heroItems = heroItems.filter(it => heroTypeEnabled(_heroTypeOf(it)));
    }
    CONFIG.slides = heroItems
      .map(it => ({
        id: it.id || '',
        source: it.source || '',
        poster: imgProxy(it.image),
        backdrop: imgProxy(it.backdrop || it.image),
        title: it.title,
        year: it.year || '',
        type: it.type || '',
        genre: it.category || it.type || '',
        rating: it.rating || 0,
        genres: it.genres || '',
        overview: it.overview || '',
        runtime: it.runtime || 0,
        runtimeSecs: it.runtimeSecs || 0,
        extra: it.extra || '',
        series: it.series || null,
        officialRating: it.officialRating || '',
      }));
    // 自动模式更新标签
    if (heroSource === 'auto') {
      const labels = { recent: '自动 · 最近入库', random: '自动 · 随机推荐', trending: '自动 · 热门高分', tmdb: '自动 · TMDB 流行', douban: '自动 · 豆瓣热门' };
      document.getElementById('heroSourceLabel').textContent = labels[actualSource] || '自动';
    }
  }
  if (CONFIG.slides.length === 0) {
    CONFIG.slides = [{ poster: '', title: '暂无内容', year: '', genre: '' }];
  }
  currentSlide = 0;
  const first = CONFIG.slides[0];
  if (first.poster) {
    applyHeroPoster(document.getElementById('bg1'), first.backdrop || first.poster, !first.backdrop);
    applyHeroPoster(document.getElementById('poster1'), first.poster);
  }
  updateSlideInfo(0);
}

document.querySelectorAll('.search-dropdown-item').forEach(item => {
  item.addEventListener('click', () => {
    window._manualSearchSrc = true;
    document.querySelectorAll('.search-dropdown-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    const source = item.dataset.source;
    CONFIG.currentSearch = source;
    document.getElementById('currentSearchIcon').textContent = CONFIG.searchSources[source].icon;
    document.getElementById('searchInput').placeholder = (source === 'bing') ? '全网搜索' : `搜索 ${CONFIG.searchSources[source].name}...`;
    searchDropdown.classList.remove('show');
    // 仅在搜索结果页时才用新源重新搜索；首页只切源不跳页
    const searchPage = document.getElementById('page-search');
    const isOnSearchPage = searchPage && searchPage.classList.contains('active');
    const qEl = document.getElementById('searchQueryText');
    if (isOnSearchPage && qEl && qEl.textContent && qEl.textContent !== '…') {
      const q = qEl.textContent.replace(/[“”"]/g, '').trim();
      if (q && source !== 'bing') {
        showSearchResults(q, source);
      }
    }
  });
});

// 搜索输入：IME 输入法确认（compositionend）后自动执行搜索，物理 Enter 由 keydown 兜底；防抖避免 keydown+keypress 双触发
var _searchComposing = false;
var _searchComposingTimer = null;
var _searchLastExec = { q: '', source: '', t: 0 };
function handleSearch(e) {
  if (e.key === 'Enter') {
    const q = document.getElementById('searchInput').value.trim();
    if (!q) return;
    const source = CONFIG.currentSearch;
    const now = Date.now();
    if (_searchLastExec.q === q && _searchLastExec.source === source && now - _searchLastExec.t < 1500) {
      if (typeof toast === 'function') toast('正在搜索，请稍候…', 'info');
      return;
    }
    _searchLastExec = { q: q, source: source, t: now };

    // Bing 跳新标签页（弹窗被拦时同页跳转兜底，保证有响应）
    if (source === 'bing') {
      const url = CONFIG.searchSources[source].url + encodeURIComponent(q);
      if (typeof toast === 'function') toast('正在打开全网搜索…', 'info');
      const w = window.open(url, '_blank');
      if (!w) location.href = url;
      return;
    }

    // 媒体库/PT/网盘/在线: 站内展示结果
    showSearchResults(q, source);
  }
}

// ========== 搜索结果展示 ==========
async function showSearchResults(query, source) {
  switchPage('search');
  document.getElementById('searchQueryText').textContent = `“${query}”`;
  document.getElementById('searchSourceTag').textContent = CONFIG.searchSources[source].name;

  const moviesEl = document.getElementById('searchResultsMovies');
  const torrentsEl = document.getElementById('searchResultsTorrents');
  const emptyEl = document.getElementById('searchResultsEmpty');
  const countEl = document.getElementById('searchResultsCount');
  const filterBar = document.getElementById('ptFilterBar');

  // 搜索前清空旧结果，隐藏空状态，显示加载动效
  emptyEl.style.display = 'none';
  countEl.textContent = '搜索中…';
  filterBar.style.display = 'none';
  document.getElementById('filterToggle').style.display = source === 'emby' ? 'none' : 'flex';

  const loadingHtml = '<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:18px;">'
    + '<div style="width:240px;max-width:70%;height:4px;border-radius:2px;background:rgba(255,255,255,0.12);overflow:hidden;"><div style="height:100%;width:40%;border-radius:2px;background:#fff;animation:indeterm 1.1s ease-in-out infinite;"></div></div>'
    + '<div style="font-size:13px;color:rgba(255,255,255,0.5);">正在搜索…</div></div>';

  if (source === 'emby') {
    torrentsEl.style.display = 'none';
    moviesEl.style.display = 'grid';
    moviesEl.innerHTML = loadingHtml;
    const data = await fetchJSON('/search/emby?q=' + encodeURIComponent(query), 60000);
    const results = (data && data.results) || [];
    window._searchResults = results;
    window._mediaType = 'all';
    renderEmbyResults(results);
  } else if (source === 'pt') {
    moviesEl.style.display = 'none';
    torrentsEl.style.display = 'flex';
    setupFilterBar('pt');
    torrentsEl.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:16px;width:100%;">'
      + '<div style="width:240px;max-width:70%;height:4px;border-radius:2px;background:rgba(255,255,255,0.12);overflow:hidden;"><div style="height:100%;width:40%;border-radius:2px;background:#fff;animation:indeterm 1.1s ease-in-out infinite;"></div></div>'
      + '<div style="font-size:13px;color:rgba(255,255,255,0.5);">正在逐站搜索资源（约需 60-90 秒）…</div></div>';
    _suppressToasts = true;
    var excl = getChips('exclude').join(' ');
    var incl = getChips('include').join(' ');
    var ptQ = query;
    if (incl) ptQ = query + ' ' + incl;
    var data = await fetchJSON('/search/pt?q=' + encodeURIComponent(ptQ) + '&exclude=' + encodeURIComponent(excl), 120000);
    _suppressToasts = false;
    if (!data) {
      torrentsEl.innerHTML = '';
      emptyEl.style.display = 'block';
      emptyEl.querySelector('div:nth-child(2)').textContent = '搜索失败，请重试';
      countEl.textContent = '错误';
      return;
    }
    var results = data.results || [];
    window._searchResults = results;
    window._searchSource = 'pt';
    renderGenericResults();
    countEl.textContent = results.length + ' 个结果';
  } else if (source === 'pansou') {
    moviesEl.style.display = 'none';
    torrentsEl.style.display = 'flex';
    setupFilterBar('pansou');
    torrentsEl.innerHTML = loadingHtml;
    const data = await fetchJSON('/search/pansou?q=' + encodeURIComponent(query), 120000);
    let results = (data && data.results) || [];
    const kw = query.toLowerCase();
    results = results.filter(r => (r.title || '').toLowerCase().includes(kw));
    window._searchResults = results;
    window._searchSource = 'pansou';
    renderGenericResults();
  } else if (source === 'online') {
    moviesEl.style.display = 'none';
    torrentsEl.style.display = 'flex';
    setupFilterBar('online');
    torrentsEl.innerHTML = loadingHtml;
    const data = await fetchJSON('/search/online?q=' + encodeURIComponent(query), 120000);
    const results = (data && data.results) || [];
    window._searchResults = results;
    window._searchSource = 'online';
    renderGenericResults();
  }
}

// 趋势剧集卡季集信息：异步补（后端 /api/season，内存缓存 30 日 TTL），不阻塞首屏渲染
let _trendSeasonQueue = [];
function _queueTrendSeason(it, id) { _trendSeasonQueue.push({ it, id }); }
async function loadTrendSeason() {
  const q = _trendSeasonQueue;
  _trendSeasonQueue = [];
  if (!q.length) return;
  for (const { it, id } of q) {
    if (!it || (it.type !== 'Series')) continue;
    try {
      const r = await fetchJSON('/season?title=' + encodeURIComponent(it.title || '') + '&year=' + encodeURIComponent(it.year || ''), 15000);
      if (r && r.data && Object.keys(r.data).length) {
        it.seasonMeta = r.data;
        const el = document.getElementById(id);
        if (el) {
          const metaEl = el.querySelector('.movie-meta');
          if (metaEl) metaEl.innerHTML = _cardMeta(it).split('<div class="movie-meta">')[1].split('</div>')[0];
        }
      }
    } catch (e) {}
  }
}

// —— 地区字段中文化：英文名/ISO 码 → 中文；已是中文原样返回 ——
var _COUNTRY_CN = {
  'United States of America':'美国','USA':'美国','US':'美国','United States':'美国',
  'China':'中国','CN':'中国','中国大陆':'中国大陆','Mainland China':'中国大陆',
  'Japan':'日本','JP':'日本','South Korea':'韩国','Korea':'韩国','KR':'韩国','大韩民国':'韩国',
  'United Kingdom':'英国','UK':'英国','GB':'英国','Britain':'英国','England':'英国',
  'France':'法国','FR':'法国','Germany':'德国','DE':'德国','Italy':'意大利','IT':'意大利',
  'Spain':'西班牙','ES':'西班牙','India':'印度','IN':'印度','Canada':'加拿大','CA':'加拿大',
  'Australia':'澳大利亚','AU':'澳大利亚','Hong Kong':'中国香港','HK':'中国香港','Hong Kong SAR':'中国香港',
  'Taiwan':'中国台湾','TW':'中国台湾','Taiwan Province':'中国台湾','Russia':'俄罗斯','RU':'俄罗斯',
  'Brazil':'巴西','Mexico':'墨西哥','Thailand':'泰国','Vietnam':'越南','Singapore':'新加坡',
  'Malaysia':'马来西亚','Philippines':'菲律宾','Indonesia':'印尼','Turkey':'土耳其','Sweden':'瑞典',
  'Norway':'挪威','Denmark':'丹麦','Finland':'芬兰','Netherlands':'荷兰','Belgium':'比利时',
  'Switzerland':'瑞士','Austria':'奥地利','Poland':'波兰','Czech Republic':'捷克','Greece':'希腊',
  'Portugal':'葡萄牙','Ireland':'爱尔兰','New Zealand':'新西兰','Argentina':'阿根廷','Chile':'智利',
  'Egypt':'埃及','South Africa':'南非','Israel':'以色列','Iran':'伊朗','Ukraine':'乌克兰'
};
function _cnCountry(v){
  if (!v) return '';
  var s = String(v).trim();
  if (/[\u4e00-\u9fa5]/.test(s)) return s;
  return _COUNTRY_CN[s] || _COUNTRY_CN[s.toUpperCase()] || s;
}

// 卡片 meta 统一渲染：左对齐，类型·year·extra·时长·地区 仅在非空时以「·」分隔（extra 与类型标签重复时跳过，如趋势 extra=电影），genres 独立行；卡片 flow 不渲染简介正文（简介仅留在详情页）
function _cardMeta(m) {
  const parts = [];
  let typeLabel = '';
  if (m.type === 'Series' || /Series|剧集|tv/i.test(m.type)) typeLabel = '剧集';
  else if (m.type === 'Movie' || /Movie|电影/i.test(m.type)) typeLabel = '电影';
  if (typeLabel) parts.push('<span>' + typeLabel + '</span>');
  // 年份紧跟类型
  if (m.year) parts.push('<span>' + esc(m.year) + '</span>');
  // 地区字段紧跟年代字段后
  const _region = m.country || m.productionCountry || m.origin || m.region || m.country_region || m.origin_country || '';
  if (_region) parts.push('<span>' + esc(_cnCountry(_region)) + '</span>');
  // 剧集季集信息放最后
  if (typeLabel === '剧集' && m.seasonMeta) {
    const sm = m.seasonMeta;
    if (sm.total_episodes && !sm.status && !sm.current_season) {
      parts.push(`<span>共 ${sm.total_seasons || '?'} 季・${sm.total_episodes} 集</span>`);
    } else {
      const ended = sm.status === '已完结' || sm.status === '已取消';
      if (ended && sm.total_episodes) {
        parts.push(`<span>共 ${sm.total_seasons} 季・${sm.total_episodes} 集</span>`);
      } else if (sm.current_season && sm.eps_in_season && sm.eps_done) {
        parts.push(`<span>第 ${sm.current_season} 季 E${sm.eps_done}・共 ${sm.eps_in_season} 集</span>`);
      } else if (sm.current_season && sm.total_seasons) {
        parts.push(`<span>S${sm.current_season}・共 ${sm.total_seasons} 季</span>`);
      }
    }
  }
  const _smOn = typeLabel === '剧集' && m.seasonMeta && (m.seasonMeta.total_episodes || m.seasonMeta.current_season);
  if (m.extra && m.extra !== typeLabel && !/^[剧集电影]{2}$/.test(m.extra) && !(_smOn && /\d+\s*季/.test(m.extra))) parts.push('<span>' + esc(m.extra) + '</span>');
  if (m.duration && m.duration !== m.extra) parts.push('<span>' + esc(m.duration) + '</span>');
  // 分类不显示在卡上（已由顶部 chips 筛选承担），流派由 genres 提供
  let meta = '';
  if (parts.length) meta = '<div class="movie-meta">' + parts.map((p, i) => (i ? '<span class="m-sep"> · </span>' : '') + p).join('') + '</div>';
  let genres = '';
  // genre 字段字号与 meta 行一致（.movie-meta font-size:12px）
  if (m.genres) genres = '<div style="font-size:12px;color:rgba(255,255,255,0.4);margin-top:2px;">' + esc(m.genres) + '</div>';
  return meta + genres;
}

// 筛选面板展开/收起
function toggleFilterPanel() {
  const mtBar = document.getElementById('mediaTypeBar');
  const ptBar = document.getElementById('ptFilterBar');
  const chev = document.getElementById('filterChevron');
  const mtInUse = mtBar && mtBar.getAttribute('data-inuse') === '1';
  const ptInUse = ptBar && ptBar.getAttribute('data-inuse') === '1';
  const mtOpen = mtInUse && mtBar.style.display !== 'none';
  const ptOpen = ptInUse && ptBar.style.display !== 'none';
  const isOpen = mtOpen || ptOpen;
  if (mtInUse) mtBar.style.display = isOpen ? 'none' : 'block';
  if (ptInUse) ptBar.style.display = isOpen ? 'none' : 'flex';
  chev.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
}

// 通用筛选栏配置
function setupFilterBar(source) {
  const row = document.getElementById('dynamicFilterRow');
  const sortRow = document.getElementById('sortRow');
  let html = '';
  if (source === 'pt') {
    html += '<div class="pt-filter-chip active" data-filter="all">全部</div>';
    html += '<div class="pt-filter-chip" data-filter="seed100">做种≥100</div>';
    html += '<div class="pt-filter-chip" data-filter="seed10">做种≥10</div>';
    html += '<div class="pt-filter-chip" data-filter="4k">4K</div>';
    html += '<div class="pt-filter-chip" data-filter="1080p">1080p</div>';
    html += '<div class="pt-filter-chip" data-filter="bluray">BluRay</div>';
    sortRow.innerHTML = '<div class="pt-filter-chip active" data-sort="seeders" data-dir="desc">做种↓</div>'
      + '<div class="pt-filter-chip" data-sort="size" data-dir="desc">大小↓</div>'
      + '<div class="pt-filter-chip" data-sort="date" data-dir="desc">时间↓</div>';
  } else if (source === 'online') {
    html += '<div class="pt-filter-chip active" data-filter="all">全部</div>';
    html += '<div class="pt-filter-chip" data-filter="ddrk">低端影视</div>';
    html += '<div class="pt-filter-chip" data-filter="domain">域名直连</div>';
    sortRow.innerHTML = '<div class="pt-filter-chip active" data-sort="default">默认</div>'
      + '<div class="pt-filter-chip" data-sort="time" data-dir="desc">时间↓</div>';
  } else if (source === 'pansou') {
    html += '<div class="pt-filter-chip active" data-filter="all">全部</div>';
    html += '<div class="pt-filter-chip" data-filter="haspass">有提取码</div>';
    html += '<div class="pt-filter-chip" data-filter="nopass">无提取码</div>';
    sortRow.innerHTML = '<div class="pt-filter-chip active" data-sort="default">默认</div>'
      + '<div class="pt-filter-chip" data-sort="size" data-dir="desc">大小↓</div>'
      + '<div class="pt-filter-chip" data-sort="time" data-dir="desc">时间↓</div>';
  } else {
    sortRow.innerHTML = '<div class="pt-filter-chip active" data-sort="default">默认</div>';
  }
  row.innerHTML = html;
  window._filter = 'all';
  window._sort = 'default';
  window._sortDir = 'desc';
  // 重置为收起状态
  const _mtBar = document.getElementById('mediaTypeBar');
  if (_mtBar) { _mtBar.setAttribute('data-inuse', '0'); _mtBar.style.display = 'none'; }
  const _ptBar = document.getElementById('ptFilterBar');
  if (_ptBar) _ptBar.setAttribute('data-inuse', '1');
  document.getElementById('ptFilterBar').style.display = 'none';
  document.getElementById('filterChevron').style.transform = 'rotate(0deg)';
  updateFilterBadge();
}

// 通用结果渲染（pansou/online，带来源标签）
function sizeBytes(s) {
  if (!s) return 0;
  s = String(s).trim().toUpperCase();
  const m = s.match(/^([\d.]+)\s*(B|KB|MB|GB|TB)?$/);
  if (!m) return parseFloat(s) || 0;
  const u = { B:1, KB:1024, MB:1048576, GB:1073741824, TB:1099511627776 };
  return parseFloat(m[1]) * (u[m[2]] || 1);
}
function renderGenericResults() {
  const results = window._searchResults || [];
  const source = window._searchSource;
  let list = [...results];
  const f = window._filter || 'all';
  // 筛选
  if (source === 'online') {
    if (f === 'ddrk') list = list.filter(r => (r.source||'').includes('低端'));
    if (f === 'domain') list = list.filter(r => (r.source||'').includes('域名'));
  } else if (source === 'pansou') {
    if (f === 'haspass') list = list.filter(r => r.password);
    if (f === 'nopass') list = list.filter(r => !r.password);
    const dir = window._sortDir === 'asc' ? 1 : -1;
    if (window._sort === 'size') list.sort((a,b) => dir * (sizeBytes(b.size) - sizeBytes(a.size)));
    else if (window._sort === 'time') list.sort((a,b) => dir * ((b.date||'').localeCompare(a.date||'')));
  } else if (source === 'online') {
    const dir2 = window._sortDir === 'asc' ? 1 : -1;
    if (window._sort === 'time') list.sort((a,b) => dir2 * ((b.date||'').localeCompare(a.date||'')));
  } else if (source === 'pt') {
    if (f === 'seed100') list = list.filter(r => parseInt(r.seeders) >= 100);
    if (f === 'seed10') list = list.filter(r => parseInt(r.seeders) >= 10);
    if (f === '4k') list = list.filter(r => /4k|2160|uhd|2160p/i.test(r.title||''));
    if (f === '1080p') list = list.filter(r => /1080/i.test(r.title||''));
    if (f === 'bluray') list = list.filter(r => /bluray|bdrip|remux/i.test(r.title||''));
    const dir = window._sortDir === 'asc' ? 1 : -1;
    if (window._sort === 'size') list.sort((a,b) => dir * ((parseFloat(b.size)||0)-(parseFloat(a.size)||0)));
    else if (window._sort === 'date') list.sort((a,b) => dir * ((b.date||'').localeCompare(a.date||'')));
    else list.sort((a,b) => dir * ((parseInt(b.seeders)||0)-(parseInt(a.seeders)||0)));
  }
  // 应用 include/exclude chips
  const incl = getChips('include');
  const excl = getChips('exclude');
  list = list.filter(r => {
    const t = (r.title||'').toLowerCase();
    for (const kw of excl) if (t.includes(kw.toLowerCase())) return false;
    if (incl.length) { for (const kw of incl) if (!t.includes(kw.toLowerCase())) return false; }
    return true;
  });

  const torrentsEl = document.getElementById('searchResultsTorrents');
  const PAN_TYPE = {
    aliyun:'阿里云盘', baidu:'百度网盘', quark:'夸克网盘', xunlei:'迅雷网盘',
    '123':'123云盘', tianyi:'天翼云盘', guangya:'光鸭网盘', mobile:'移动云盘',
    uc:'UC网盘', magnet:'磁力', other:'其他', others:'其他',
  };
  torrentsEl.innerHTML = list.map(r => {
    const srcKey = source;
    let srcLabel = (r.source || '');
    if (source === 'pansou') srcLabel = PAN_TYPE[r.type] || r.type || srcLabel;
    let badge = `<span class="src-badge" data-src="${esc(srcKey)}">${esc(srcLabel || source.toUpperCase())}</span>`;
    let subParts = [];
    if (r.quality) subParts.push(`<span style="color:rgba(255,255,255,0.5);">${esc(r.quality)}</span>`);
    if (r.password) subParts.push(`<span style="color:#FFD60A;">提取码: ${esc(r.password)}</span>`);
    if (r.date) subParts.push(`<span>${esc(r.date)}</span>`);
    if (r.size) subParts.push(`<span>${esc(r.size)}</span>`);
    if (r.seeders != null) subParts.push(`<span style="color:#30D158;">▲ ${r.seeders} 做种</span>`);
    const icon = r.icon || (source==='pansou'?'📦':source==='online'?'🔗':'🌐');
    const openClick = source === 'online'
      ? `onclick="playRecord('${esc(r.title)}','${esc(r.url)}');window.open('${esc(r.url)}','_blank')"`
      : `onclick="window.open('${esc(r.url)}','_blank')"`;
    return `<div class="torrent-item" style="cursor:pointer;" ${openClick}>
      <div class="torrent-icon">${icon}</div>
      <div class="torrent-main">
        <div class="torrent-name">${esc(r.title)}</div>
        <div class="torrent-sub">${subParts.join('')}</div>
      </div>
      ${badge}
    </div>`;
  }).join('') || '<div style="padding:30px;text-align:center;opacity:0.5;">无符合条件的结果</div>';
  document.getElementById('searchResultsCount').textContent = `${list.length} / ${results.length} 个结果`;
}

// ===== 媒体库搜索结果：类型筛选 chips =====
function mediaTypeOf(m) {
  const g = (m.genres || '').toLowerCase();
  if (g.indexOf('纪录') >= 0) return 'doc';
  if (g.indexOf('动画') >= 0) return 'anime';
  if (g.indexOf('短剧') >= 0) return 'short';
  if (m.type === 'Series') return 'tv';
  return 'movie';
}
// 媒体库分类体系（来自 Emby 物理目录 /电视剧|/电影 下的子目录）
const _CAT_ORDER_TV = ['欧美剧','国产剧','日韩剧','动漫','纪录片','综艺','短剧','儿童','其他'];
const _CAT_ORDER_MOVIE = ['外语电影','华语电影','动画电影'];
const _ANIME_SUB_ORDER = ['动漫','国漫','日番'];
const _SORT_OPTIONS = [['name','名称 A-Z'],['year','年份 ↓'],['rating','评分 ↓'],['recent','最近添加 ↓']];

function _wallCategories() {
  const t = window._mediaWallType || 'all';
  if (t === 'movie') return _CAT_ORDER_MOVIE;
  if (t === 'tv') return _CAT_ORDER_TV;
  // all 视图：电影+剧集分类合并去重
  return [...new Set([..._CAT_ORDER_MOVIE, ..._CAT_ORDER_TV])];
}

function renderMediaTypeChips(results) {
  const el = document.getElementById('mediaTypeChips');
  if (!el) return;
  const cur = window._mediaFilter || 'all';
  const counts = {};
  results.forEach(function(r){ const c = r.category || '其他'; counts[c] = (counts[c]||0)+1; });
  // 直接从当前结果中提取所有出现过的分类（按数量降序），不再依赖预设分类列表
  const cats = Object.keys(counts).sort(function(a,b){ return counts[b]-counts[a]; });
  if (!cats.length) { el.innerHTML = ''; renderSubBar(false); renderSortRow(); return; }
  const chips = ['全部'].concat(cats);
  el.innerHTML = chips.map(function(c){
    // 「全部」在 cur==='all' 时也高亮（setMediaType 已把「全部」归一为 'all'）
    const active = cur === c || (c === '全部' && cur === 'all');
    const label = c === '全部' ? '全部' : c;
    const num = c === '全部' ? '' : ' ' + (counts[c]||0);
    return '<button class="media-type-chip' + (active?' active':'') + '" onclick="setMediaType(\'' + c.replace(/'/g,"\\'") + '\')">' + label + num + '</button>';
  }).join('');
  renderSubBar(cur === '动漫');
  renderSortRow();
}

function renderSubBar(show) {
  const subBar = document.getElementById('mediaSubBar');
  const subChips = document.getElementById('mediaSubChips');
  if (show) {
    const sc = {};
    (window._searchResults || []).forEach(function(r){ if(r.category==='动漫'){ const s=r.subcat||'动漫'; sc[s]=(sc[s]||0)+1; } });
    const curSub = window._mediaSubFilter || '';
    if (subChips) subChips.innerHTML = _ANIME_SUB_ORDER.filter(function(s){ return sc[s]>0; }).map(function(s){
      return '<button class="media-type-chip' + (curSub===s?' active':'') + '" onclick="setMediaSubType(\'' + s + '\')">' + s + ' ' + sc[s] + '</button>';
    }).join('');
    if (subBar) subBar.style.display = 'flex';
  } else {
    if (subBar) subBar.style.display = 'none';
    window._mediaSubFilter = '';
  }
}

function renderSortRow() {
  const el = document.getElementById('mediaSortRow');
  if (!el) return;
  const cur = window._mediaSort || 'name';
  const dir = window._mediaSortDir || 1;
  el.innerHTML = _SORT_OPTIONS.map(function(o){
    const active = cur === o[0];
    let label = o[1];
    if (active) { // 选中项：去掉固定方向，显示当前实际方向
      const base = o[1].replace(/ ↓| A-Z/g, '');
      label = base + (o[0] === 'name' ? (dir === 1 ? ' A-Z' : ' Z-A') : (dir === 1 ? ' ↑' : ' ↓'));
    }
    return '<button class="media-type-chip' + (active?' active':'') + '" onclick="setMediaSort(\'' + o[0] + '\')">' + label + '</button>';
  }).join('');
}

function applyMediaType(results) {
  const f = window._mediaFilter || 'all';
  if (f === 'all') return results;
  if (f === '动漫') {
    const sub = window._mediaSubFilter || '';
    return results.filter(function(r){ return r.category === '动漫' && (!sub || r.subcat === sub); });
  }
  return results.filter(function(r){ return (r.category || '其他') === f; });
}

function setMediaType(cat) {
  // 「全部」归一为 'all'，与 applyMediaType 的判定一致，否则点「全部」会落到分类过滤导致结果为空
  window._mediaFilter = (cat === '全部' || cat === 'all') ? 'all' : cat;
  window._mediaSubFilter = '';
  renderEmbyResults(window._searchResults || []);
}
function setMediaSubType(sub) {
  window._mediaSubFilter = sub;
  renderEmbyResults(window._searchResults || []);
}
function setMediaSort(k) {
  // 单击=选中（设默认方向），再点同项=翻转排序方向
  if (window._mediaSort === k) { window._mediaSortDir = -(window._mediaSortDir || (k === 'name' ? 1 : -1)); }
  else { window._mediaSort = k; window._mediaSortDir = (k === 'name') ? 1 : -1; }
  renderSortRow();
  renderEmbyResults(window._searchResults || []);
}
function sortMediaList(list) {
  const s = window._mediaSort || 'name';
  const dir = window._mediaSortDir || (s === 'name' ? 1 : -1);
  const arr = list.slice();
  if (s === 'year') arr.sort(function(a,b){ return ((a.year||0) - (b.year||0)) * dir; });
  else if (s === 'rating') arr.sort(function(a,b){ return ((a.rating||0) - (b.rating||0)) * dir; });
  else if (s === 'recent') arr.sort(function(a,b){ return String(a.dateCreated||'').localeCompare(String(b.dateCreated||'')) * dir; });
  else arr.sort(function(a,b){ return String(a.name||'').localeCompare(String(b.name||''),'zh') * dir; });
  return arr;
}
// 媒体库模块「查看全部海报墙」入口：进入 emby 源浏览媒体库海报墙，并按模块预置类型筛选
async function goMediaWall(t) {
  window._mediaType = t || 'all';
  window._mediaWallType = t || 'all';
  sessionStorage.setItem('nw_wall_type', t || 'all');
  sessionStorage.setItem('nw_wall_back', window._mediaWallBackTo || 'overview');
  window._mediaFilter = 'all';                 // 当前分类筛选（'all' 或分类名）
  window._mediaSubFilter = '';                 // 动漫子分类筛选
  if (!window._mediaSort) window._mediaSort = 'name'; // 默认按名称（与后端 SortName 一致）
  if (window._mediaWallBackTo === undefined) window._mediaWallBackTo = 'overview'; // 返回目标：媒体库进入=media，否则首页
  switchPage('search');
  const names = {movie:'电影', tv:'剧集', series:'剧集', doc:'纪录片', anime:'动漫', short:'短剧', other:'其他', all:'全部'};
  document.getElementById('searchQueryText').textContent = `媒体库 · ${(names[t] || '全部')}`;
  const srcTag = document.getElementById('searchSourceTag');
  if (srcTag) srcTag.textContent = '媒体库';
  const moviesEl = document.getElementById('searchResultsMovies');
  const torrentsEl = document.getElementById('searchResultsTorrents');
  const emptyEl = document.getElementById('searchResultsEmpty');
  const countEl = document.getElementById('searchResultsCount');
  const filterBar = document.getElementById('ptFilterBar');
  const ft = document.getElementById('filterToggle');
  if (emptyEl) emptyEl.style.display = 'none';
  if (countEl) countEl.textContent = '加载中…';
  if (filterBar) filterBar.style.display = 'none';
  if (ft) ft.style.display = 'none';
  if (torrentsEl) torrentsEl.style.display = 'none';
  if (moviesEl) { moviesEl.style.display = 'grid'; moviesEl.innerHTML = '<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:18px;"><div style="width:240px;max-width:70%;height:4px;border-radius:2px;background:rgba(255,255,255,0.12);overflow:hidden;"><div style="height:100%;width:40%;border-radius:2px;background:#fff;animation:indeterm 1.1s ease-in-out infinite;"></div></div><div style="font-size:13px;color:rgba(255,255,255,0.5);">正在加载媒体库…</div></div>'; }
  const data = await fetchJSON('/media/wall?type=' + encodeURIComponent(t||'all'), 60000);
  const results = (data && data.results) || [];
  window._searchResults = results;
  window._mediaType = t || 'all';
  renderEmbyResults(results);
}
// 海报墙返回按钮：显式指定的返回目标优先（_mediaWallBackTo），其次 _lastPage，最后 fallback 首页
function goMediaWallBack() {
  const savedBack = sessionStorage.getItem('nw_wall_back');
  const to = savedBack || window._lastPage || 'overview';
  console.log('[back] _lastPage=', window._lastPage, 'savedBack=', savedBack, 'to=', to);
  sessionStorage.removeItem('nw_wall_back');
  window._mediaWallBackTo = 'overview';
  switchPage(to);
  window.scrollTo(0, 0);
}
function renderEmbyResults(results) {
  const moviesEl = document.getElementById('searchResultsMovies');
  const countEl = document.getElementById('searchResultsCount');
  const emptyEl = document.getElementById('searchResultsEmpty');
  const sfc = document.querySelector('.search-filter-card');
  const mtBar = document.getElementById('mediaTypeBar');
  const ptBar = document.getElementById('ptFilterBar');
  const ft = document.getElementById('filterToggle');
  const chev = document.getElementById('filterChevron');
  renderMediaTypeChips(results);
  const filtered = sortMediaList(applyMediaType(results));
  if (!filtered.length) {
    moviesEl.innerHTML = '';
    emptyEl.style.display = 'block';
  } else {
    emptyEl.style.display = 'none';
    moviesEl.innerHTML = filtered.map(m => `
      <div class="movie-card" onclick="openDetail('${m.id}')" style="cursor:pointer;position:relative;">
        <div class="movie-poster" style="padding:0;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;">
          ${m.poster ? `<img src="${esc(imgProxy(m.poster))}" style="width:100%;height:100%;object-fit:cover;border-radius:14px;" loading="lazy" onload="this.style.opacity=1" onerror="this.style.display='none'">` : '🎬'}
          ${m.rating ? `<div class="rating-badge">★ ${esc(fmtRating(m.rating))}</div>` : ''}
        </div>
        <div class="movie-info">
          <div class="movie-title">${esc(m.name)}</div>
          ${_cardMeta(m)}
        </div>
      </div>
    `).join('');
  }
  countEl.textContent = (filtered.length === results.length)
    ? results.length + ' 个结果'
    : filtered.length + ' / ' + results.length + ' 个结果';
  // 有结果才显示类型筛选胶囊；无结果则隐藏整个筛选胶囊卡片（不留空壳）
  const isMobile = window.matchMedia('(max-width:768px)').matches;
  if (results.length) {
    if (sfc) sfc.style.display = 'block';
    if (mtBar) {
      mtBar.setAttribute('data-inuse', '1');
      mtBar.style.display = isMobile ? 'none' : 'block';
    }
    if (ptBar) ptBar.setAttribute('data-inuse', '0');
    if (ft) ft.style.display = isMobile ? 'flex' : 'none';
    if (chev) chev.style.transform = 'rotate(0deg)';
  } else {
    if (mtBar) mtBar.style.display = 'none';
    if (sfc) sfc.style.display = 'none';
  }
}

function applyFilters() {
  renderGenericResults();
}

// ========== 问候语 ==========
// 首页顶栏直接用问候 + 健康副标题（去掉「总览」标题模块），页面内问候区隐藏避免重复
function syncGreetingToTop() {
  const ov = document.getElementById('page-overview');
  const pt = ov ? ov.querySelector('.page-title') : null;
  const tt = document.getElementById('topTitle');
  const ts = document.getElementById('topSub');
  const ti = document.getElementById('topIcon');
  const g = document.getElementById('greeting');
  const st = document.getElementById('greetingSubText');
  const onOverview = !!(ov && ov.classList.contains('active'));
  if (pt) pt.style.display = onOverview ? 'none' : '';
  if (onOverview) {
    if (tt && g) tt.textContent = g.textContent || PAGE_TITLES.overview;
    if (ts && st) ts.textContent = st.textContent || SUBTITLES.overview;
    if (ti) ti.textContent = '🏠';
  }
}
function updateGreeting() {
  const hour = new Date().getHours();
  const el = document.getElementById('greeting');
  if (hour < 12) el.textContent = 'Good Morning.';
  else if (hour < 18) el.textContent = 'Good Afternoon.';
  else el.textContent = 'Good Evening.';
  syncGreetingToTop();
}

// ========== 问候副标题：健康小知识轮播 ==========
var _tips = [], _tipIdx = 0, _tipTimer = null, _tipExpanded = false;
async function initGreetingSub() {
  const t = document.getElementById('greetingSubText');
  if (!t) return;
  try {
    const d = await fetchJSON(API.daily_tips, 15000);
    if (d && d.tips && d.tips.length) _tips = d.tips;
  } catch (e) {}
  if (!_tips.length) return;
  showTip(0);
  if (_tipTimer) clearInterval(_tipTimer);
  _tipTimer = setInterval(() => { showTip((_tipIdx + 1) % _tips.length); }, 60000);
}
function showTip(i) {
  _tipIdx = i % _tips.length;
  const tip = _tips[_tipIdx];
  const t = document.getElementById('greetingSubText');
  const btn = document.getElementById('greetingExpand');
  if (!t || !tip) return;
  t.textContent = tip.content || '';
  // 移动端窄屏：超两行显示展开/收起
  btn.style.display = 'none';
  _tipExpanded = false;
  t.style.maxHeight = '';
  if (window.innerWidth <= 700) {
    requestAnimationFrame(() => {
      const lineH = parseFloat(getComputedStyle(t).lineHeight) || 18;
      if (t.scrollHeight > lineH * 2) {
        t.style.maxHeight = (lineH * 2) + 'px';
        t.style.overflow = 'hidden';
        btn.textContent = '展开';
        btn.style.display = 'inline-block';
      }
    });
  }
  syncGreetingToTop();
}
function toggleGreetingSub() {
  const t = document.getElementById('greetingSubText');
  const btn = document.getElementById('greetingExpand');
  if (!t || !btn) return;
  _tipExpanded = !_tipExpanded;
  t.style.maxHeight = _tipExpanded ? '' : '36px';
  t.style.overflow = _tipExpanded ? '' : 'hidden';
  btn.textContent = _tipExpanded ? '收起' : '展开';
}


// ========== 双图层交叉淡入淡出轮播 ==========
let currentSlide = 0;
let activeLayer = 1;

function preloadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(url);
    img.onerror = () => resolve(url);
    img.src = url;
  });
}

async function initSlideshow() {
  await loadHeroSlides();
  for (const slide of CONFIG.slides) {
    // 背景用 backdrop||poster，切换前两者都预加载，避免切图时露空档/穿帮
    if (slide.backdrop) await preloadImage(slide.backdrop);
    if (slide.poster) await preloadImage(slide.poster);
  }

  setInterval(nextSlide, CONFIG.interval);
}

function _applySlide(next, target) {
  if (activeLayer === 1) {
    applyHeroPoster(document.getElementById('bg2'), next.backdrop || next.poster, !next.backdrop);
    applyHeroPoster(document.getElementById('poster2'), next.poster);
    document.getElementById('bg2').classList.remove('next');
    document.getElementById('bg2').classList.add('active');
    document.getElementById('bg1').classList.remove('active');
    document.getElementById('bg1').classList.add('next');
    document.getElementById('poster2').classList.remove('next');
    document.getElementById('poster2').classList.add('active');
    document.getElementById('poster1').classList.remove('active');
    document.getElementById('poster1').classList.add('next');
    activeLayer = 2;
  } else {
    applyHeroPoster(document.getElementById('bg1'), next.backdrop || next.poster, !next.backdrop);
    applyHeroPoster(document.getElementById('poster1'), next.poster);
    document.getElementById('bg1').classList.remove('next');
    document.getElementById('bg1').classList.add('active');
    document.getElementById('bg2').classList.remove('active');
    document.getElementById('bg2').classList.add('next');
    document.getElementById('poster1').classList.remove('next');
    document.getElementById('poster1').classList.add('active');
    document.getElementById('poster2').classList.remove('active');
    document.getElementById('poster2').classList.add('next');
    activeLayer = 1;
  }
  currentSlide = target;
  updateSlideInfo(target);
}

async function nextSlide() {
  // 自动模式:播完一组自动切下一个源
  if (heroSource === 'auto' && currentSlide === CONFIG.slides.length - 1) {
    autoSourceIdx++;
    await loadHeroSlides();
    return;
  }
  const target = (currentSlide + 1) % CONFIG.slides.length;
  const next = CONFIG.slides[target];
  await preloadImage(next.backdrop || next.poster);
  _applySlide(next, target);
}

async function prevSlide() {
  if (!CONFIG.slides || !CONFIG.slides.length) return;
  const target = (currentSlide - 1 + CONFIG.slides.length) % CONFIG.slides.length;
  const next = CONFIG.slides[target];
  await preloadImage(next.backdrop || next.poster);
  _applySlide(next, target);
}

async function goToSlide(i) {
  if (!CONFIG.slides || !CONFIG.slides.length) return;
  if (i === currentSlide) return;
  const next = CONFIG.slides[i];
  await preloadImage(next.backdrop || next.poster);
  _applySlide(next, i);
}

// ===== 轮播手势：左右滑动手动切换当前组内图片（触屏 + 鼠标拖拽） =====
let _heroPX = 0, _heroPY = 0, _heroDrag = false, _heroSwiped = false;
const _heroCar = document.getElementById('heroCarousel');
if (_heroCar) {
  _heroCar.addEventListener('pointerdown', function(e) { _heroPX = e.clientX; _heroPY = e.clientY; _heroDrag = false; _heroSwiped = false; });
  _heroCar.addEventListener('pointermove', function(e) { if (Math.abs(e.clientX - _heroPX) > 6 || Math.abs(e.clientY - _heroPY) > 6) _heroDrag = true; });
  _heroCar.addEventListener('pointerup', function(e) {
    const dx = e.clientX - _heroPX, dy = e.clientY - _heroPY;
    if (_heroDrag && Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy)) {
      _heroSwiped = true; setTimeout(function() { _heroSwiped = false; }, 250);
      if (dx < 0) nextSlide(); else prevSlide();
    }
  });
  document.addEventListener('click', function(ev) {
    if (_heroSwiped && _heroCar.contains(ev.target)) { ev.preventDefault(); ev.stopPropagation(); _heroSwiped = false; }
  }, true);
}

function heroDurationText(secs) {
  if (!secs) return '';
  const m = Math.floor(secs / 60), s = secs % 60;
  return (m ? m + ' 分 ' : '') + s + ' 秒';
}

function updateSlideInfo(index) {
  const slide = CONFIG.slides[index];
  if (!slide) return;
  // 标题
  const ovTitle = document.getElementById('overlayTitle');
  ovTitle.textContent = slide.title;
  // 元信息 chips（类型 / 评分 / 年份 / 时长·季集 / 分级 / 类型标签）
  const chips = [];
  if (slide.type) chips.push('<span class="ov-chip">' + esc(slide.type) + '</span>');
  if (slide.rating) chips.push('<span class="ov-chip ov-chip-gold">★ ' + Number(slide.rating).toFixed(1) + '</span>');
  if (slide.year) chips.push('<span class="ov-chip">' + esc(slide.year) + '</span>');
  // 时长 / 季集标签：电影 → 分秒；剧集 → 完结/未完结/在播状态 + 单集时长
  if (slide.type === '电影') {
    if (slide.runtimeSecs) chips.push('<span class="ov-chip">' + heroDurationText(slide.runtimeSecs) + '</span>');
  } else if (slide.type === '剧集') {
    if (slide.series) {
      const sr = slide.series;
      if (sr.status === 'ended') {
        // 已完结：全季仅 1 季时直接写"共 N 集"
        chips.push('<span class="ov-chip">' + (sr.totalSeasons === 1 ? '共 ' + sr.totalEpisodes + ' 集' : '共 ' + sr.totalSeasons + ' 季 · ' + sr.totalEpisodes + ' 集') + '</span>');
      } else if (sr.curEps > 0) {
        chips.push('<span class="ov-chip">第 ' + sr.curSeason + ' 季</span>');
        chips.push('<span class="ov-chip">E' + String(sr.curEpIdx).padStart(2, '0') + ' · 共 ' + sr.curEps + ' 集</span>');
      } else {
        chips.push('<span class="ov-chip">S' + String(sr.curSeason).padStart(2, '0') + ' · 共 ' + sr.totalSeasons + ' 季</span>');
      }
      if (sr.firstEpRuntimeSecs) chips.push('<span class="ov-chip">' + Math.round(sr.firstEpRuntimeSecs / 60) + '分/集</span>');
      else if (sr.episodeRunTime) chips.push('<span class="ov-chip">' + sr.episodeRunTime + '分/集</span>');
    } else if (slide.extra) {
      chips.push('<span class="ov-chip">' + esc(slide.extra) + '</span>');
    }
  }
  if (slide.officialRating) chips.push('<span class="ov-chip">' + esc(slide.officialRating) + '</span>');
  if (slide.genres) chips.push('<span class="ov-chip">' + esc(slide.genres) + '</span>');
  if (slide.type !== '剧集' && !slide.runtimeSecs && slide.runtime) chips.push('<span class="ov-chip">' + Math.floor(slide.runtime) + ' 分钟</span>');
  document.getElementById('overlayMeta').innerHTML = chips.join('');
  // 简介
  const ov = document.getElementById('overlayOverview');
  if (ov) ov.textContent = (slide.overview || '').replace(/\s+/g, ' ').trim();
  // 指示器圆点（可横向滚动，当前项自动居中，左右遮罩）
  const dots = document.getElementById('heroDots');
  if (dots) {
    dots.innerHTML = CONFIG.slides.map(function(_, i) {
      return '<span class="hero-dot' + (i === index ? ' active' : '') + '" onclick="goToSlide(' + i + ')"></span>';
    }).join('');
    // 当前项自动居中
    var activeDot = dots.children[index];
    if (activeDot) {
      var center = activeDot.offsetLeft - dots.offsetWidth / 2 + activeDot.offsetWidth / 2;
      dots.scrollTo({ left: center, behavior: 'smooth' });
    }
    // 更新左右遮罩
    setTimeout(updateDotsFade, 350);
  }
}
function updateDotsFade() {
  var dots = document.getElementById('heroDots');
  if (!dots) return;
  var fadeL = document.getElementById('heroDotsFadeL');
  var fadeR = document.getElementById('heroDotsFadeR');
  if (fadeL) fadeL.style.opacity = dots.scrollLeft > 4 ? '1' : '0';
  if (fadeR) fadeR.style.opacity = (dots.scrollLeft + dots.clientWidth < dots.scrollWidth - 4) ? '1' : '0';
}
document.addEventListener('DOMContentLoaded', function() {
  var dots = document.getElementById('heroDots');
  if (dots) dots.addEventListener('scroll', updateDotsFade);
  // 刷新后根据 hash 恢复页面
  var h = location.hash.replace('#', '');
  if (h && document.getElementById('page-' + h)) switchPage(h);
  // 刷新后如果在海报墙页，自动加载海报墙数据（从 hash 恢复类型）
  if (h === 'search') {
    var savedType = sessionStorage.getItem('nw_wall_type') || 'all';
    var savedBack = sessionStorage.getItem('nw_wall_back') || 'overview';
    window._mediaWallType = savedType;
    window._mediaWallBackTo = savedBack;
    goMediaWall(savedType);
  }
  fetchSubscriptions();  // 加载 MoviePilot 订阅列表（订阅按钮初始状态）
  // 初始探测后端：若服务重启中（连接被拒），立即进入等待重连页
  fetch('/api/status', { cache: 'no-store' }).catch(function () { showReconnect(); });
});
window.addEventListener('popstate', function() {
  var h = location.hash.replace('#', '');
  if (h && document.getElementById('page-' + h)) switchPage(h);
});

// ========== 下载器限速 ==========
function _limitEngineKey() {
  return _currentDownloader === 'tr' ? 'tr_sa' : _currentDownloader === 'trds' ? 'tr_ds' : 'qb';
}
function renderLimit() {
  const data = _lastTorrentData;
  if (!data) return;
  const key = _limitEngineKey();
  const eng = data[key];
  if (!eng) return;
  const dl = eng.dl_limit ?? 0, up = eng.up_limit ?? 0;
  const view = document.getElementById('rateView');
  if (view) view.textContent = '↓ ' + (dl > 0 ? dl + ' KB' : '不限') + ' · ↑ ' + (up > 0 ? up + ' KB' : '不限');
  const dlI = document.getElementById('dlLimitInput'), upI = document.getElementById('upLimitInput');
  if (dlI) dlI.value = dl; if (upI) upI.value = up;
}
function enterLimitEdit() {
  const edit = document.getElementById('rateEdit');
  const view = document.getElementById('rateView');
  const btn = document.getElementById('rateEditBtn');
  if (edit) edit.style.display = 'inline-flex';
  if (view) view.style.display = 'none';
  if (btn) btn.style.display = 'none';
}
function cancelLimitEdit() {
  const edit = document.getElementById('rateEdit');
  const view = document.getElementById('rateView');
  const btn = document.getElementById('rateEditBtn');
  if (edit) edit.style.display = 'none';
  if (view) view.style.display = 'inline';
  if (btn) btn.style.display = 'inline-block';
  renderLimit();
}
async function applyLimit() {
  const dl = parseFloat(document.getElementById('dlLimitInput').value);
  const up = parseFloat(document.getElementById('upLimitInput').value);
  if (isNaN(dl) || isNaN(up) || dl < 0 || up < 0) { toast('限速需为非负数字', 'error'); return; }
  const btn = document.querySelector('.rate-apply');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const r = await fetch(API_BASE + '/limits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + localStorage.getItem('nexus_token') },
      body: JSON.stringify({ engine: _currentDownloader === 'tr' ? 'tr_sa' : _currentDownloader === 'trds' ? 'tr_ds' : 'qb', dl_kb: dl, up_kb: up }),
    });
    const d = await r.json();
    if (d.ok) { toast('限速已应用', 'success'); cancelLimitEdit(); setTimeout(() => fetchTorrents(), 800); }
    else toast(d.error || '设置失败', 'error');
  } catch (e) { toast('设置限速失败', 'error'); }
  if (btn) { btn.disabled = false; btn.textContent = '应用'; }
}

// 重启后端服务
async function doRestart() {
  if (!confirm('清除前端缓存并重启后端服务？\n页面将在几秒后自动刷新。')) return;
  // 全屏等待重连页（对齐 MP/DSM 重启体验）
  var ov = document.createElement('div');
  ov.className = 'restart-overlay';
  ov.innerHTML = '<div class="restart-box"><img src="/logo-teal-1.png" style="width:64px;height:64px;border-radius:14px;margin:0 auto 18px;display:block;box-shadow:0 4px 20px rgba(0,0,0,0.3);"><div class="restart-spin" style="margin-bottom:14px;"></div><div class="restart-title">正在重启服务</div><div class="restart-sub">正在等待服务重连…</div></div>';
  document.body.appendChild(ov);
  try { sessionStorage.clear(); } catch(e) {}   // 保留 localStorage(nexus_token)：重启后会话随 sessions.json 恢复，免登录（对齐 MP 重启体验）
  try { await fetch('/api/restart'); } catch(e) {}
  let retries = 0;
  const check = setInterval(async () => {
    retries++;
    try {
      const r = await fetch('/api/status');
      if (r.ok) { clearInterval(check); location.reload(); }
    } catch(e) {
      if (retries > 30) { clearInterval(check); location.reload(); }
    }
  }, 1000);
}
document.getElementById('btnRestart').addEventListener('click', doRestart);
document.getElementById('btnClearCache').addEventListener('click', function() {
  document.getElementById('moreDrawer').classList.remove('show');
  var token = localStorage.getItem('nexus_token');  // 保留登录态
  localStorage.clear();
  sessionStorage.clear();
  if (token) localStorage.setItem('nexus_token', token);
  location.reload();
});
document.getElementById('btnRestartMobile').addEventListener('click', function() {
  document.getElementById('moreDrawer').classList.remove('show');
  doRestart();
});

async function doLogout() {
  var token = localStorage.getItem('nexus_token');
  if (token) {
    try { await fetch('/api/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }); } catch(e) {}
  }
  localStorage.removeItem('nexus_token');
  showLogin();
}

document.getElementById('btnLogout').addEventListener('click', async function() {
  document.getElementById('moreDrawer').classList.remove('show');
  await doLogout();
});

var btnLogoutDesktop = document.getElementById('btnLogoutDesktop');
if (btnLogoutDesktop) btnLogoutDesktop.addEventListener('click', function() { doLogout(); });

// ========== 真实数据拉取 ==========
const API_BASE = `/api`;

// ===== 筛选 Chips =====
var _chips = { include: [], exclude: [] };

function addChip(type, text) {
  text = (text || '').trim();
  if (!text) return;
  if (_chips[type].indexOf(text) >= 0) return;
  _chips[type].push(text);
  renderChips(type);
}

function removeChip(type, text) {
  var i = _chips[type].indexOf(text);
  if (i >= 0) _chips[type].splice(i, 1);
  renderChips(type);
}

function getChips(type) {
  return _chips[type] || [];
}

function clearChips() {
  _chips.include = [];
  _chips.exclude = [];
  renderChips('include');
  renderChips('exclude');
  toast('已清空筛选条件', 'info');
}

function renderChips(type) {
  var container = document.getElementById(type === 'include' ? 'ptIncludeChips' : 'ptExcludeChips');
  if (!container) return;
  container.innerHTML = _chips[type].map(function(c) {
    return '<span class="chip chip-' + type + '">' + esc(c) +
      '<span class="chip-x" onclick="removeChip(\'' + type + '\',\'' + c.replace(/'/g, "\\'") + '\')">×</span></span>';
  }).join('');
}

function doPtSearch() {
  var q = document.getElementById('searchQueryText').textContent.replace(/[""]/g, '').trim();
  if (!q) { toast('请先输入搜索关键词', 'error'); return; }
  showSearchResults(q, 'pt');
}

function renderPtResults() {
  const results = window._ptResults || [];
  let list = [...results];
  // 筛选
  const f = window._ptFilter;
  if (f === 'seed100') list = list.filter(r => parseInt(r.seeders) >= 100);
  if (f === 'seed10') list = list.filter(r => parseInt(r.seeders) >= 10);
  // 排序
  if (window._ptSort === 'size') {
    list.sort((a, b) => {
      const pa = parseFloat(a.size) || 0, pb = parseFloat(b.size) || 0;
      return pb - pa;
    });
  } else {
    list.sort((a, b) => (parseInt(b.seeders)||0) - (parseInt(a.seeders)||0));
  }
  const torrentsEl = document.getElementById('searchResultsTorrents');
  torrentsEl.innerHTML = list.map(r => `
    <div class="torrent-item" style="cursor:pointer;" onclick="window.open('${esc(r.url)}','_blank')">
      <div class="torrent-icon">🌐</div>
      <div class="torrent-main">
        <div class="torrent-name"><span class="site-badge">${esc(r.site)}</span>${esc(r.title)}</div>
        <div class="torrent-sub">
          ${r.size ? `<span>${esc(r.size)}</span>` : ''}
          <span style="color:#30D158;">▲ ${r.seeders} 做种</span>
        </div>
      </div>
    </div>
  `).join('') || '<div style="padding:30px;text-align:center;opacity:0.5;">无符合条件的结果</div>';
  document.getElementById('searchResultsCount').textContent = `${list.length} / ${results.length} 个结果`;
}

// 绑定筛选 chip 点击（通用）
document.addEventListener('click', e => {
  const chip = e.target.closest('.pt-filter-chip');
  if (!chip) return;
  if (chip.dataset.filter) {
    const row = document.getElementById('dynamicFilterRow');
    row.querySelectorAll('[data-filter]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    window._filter = chip.dataset.filter;
    updateFilterBadge();
  }
  if (chip.dataset.sort) {
    const sortRow = document.getElementById('sortRow');
    // 点击已选中的排序 = 切换方向
    if (chip.classList.contains('active')) {
      window._sortDir = window._sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      sortRow.querySelectorAll('[data-sort]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      window._sort = chip.dataset.sort;
      window._sortDir = chip.dataset.dir || 'desc';
    }
    // 更新箭头
    sortRow.querySelectorAll('[data-sort]').forEach(c => {
      if (c.classList.contains('active')) {
        const base = c.dataset.sort;
        c.textContent = base === 'seeders' ? '做种' : base === 'size' ? '大小' : base === 'date' ? '时间' : '默认';
        if (base !== 'default') c.textContent += window._sortDir === 'desc' ? '↓' : '↑';
      }
    });
  }
  applyFilters();
});

function updateFilterBadge() {
  const count = (window._filter && window._filter !== 'all') ? 1 : 0;
  const badge = document.getElementById('filterActiveCount');
  if (count > 0) { badge.style.display = 'inline'; badge.textContent = count; }
  else { badge.style.display = 'none'; }
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// 评分显示格式化：整数补一位小数（8 → 8.0），小数保持原样（8.5 → 8.5）
function fmtRating(v) {
  if (v === undefined || v === null || v === '') return '';
  var n = parseFloat(v);
  if (isNaN(n)) return String(v);
  return (n % 1 === 0) ? n.toFixed(1) : String(n);
}

var _toastMap = {};
var _msgHistory = [];
var _unread = 0;
// 消息已读持久化（localStorage：已读消息 id 集合，刷新/重进后恢复）
var _READ_KEY = 'nexus_msg_read_v2';
function _readStore() { try { return JSON.parse(localStorage.getItem(_READ_KEY) || '[]'); } catch (e) { return []; } }
function _saveReadStore(ids) { try { localStorage.setItem(_READ_KEY, JSON.stringify(ids.slice(-500))); } catch (e) {} }
function _markRead(msgs) {
  var ids = _readStore(), changed = false;
  (msgs || []).forEach(function (m) {
    m.read = true;
    var id = String(m.id);
    if (ids.indexOf(id) < 0) { ids.push(id); changed = true; }
  });
  if (changed) _saveReadStore(ids);
}
function _applyRead(msgs) {
  var ids = _readStore();
  (msgs || []).forEach(function (m) { if (ids.indexOf(String(m.id)) >= 0) m.read = true; });
}
function _isRead(m) { return !!m.read || _readStore().indexOf(String(m.id)) >= 0; }
function _pushMsg(msg, type) {
  var icons = { error: '⚠️', success: '✅', info: 'ℹ️' };
  _msgHistory.unshift({ msg: msg, type: type || 'info', time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), _ts: Date.now() });
  if (_msgHistory.length > 100) _msgHistory.length = 100;
  // 错误/警告级系统通知同步进入「系统通知」会话（source='system'，30s 内同文案去重）
  if ((type === 'error' || type === 'warning') && msg) {
    window._sysToastSeen = window._sysToastSeen || {};
    if (Date.now() - (window._sysToastSeen[msg] || 0) > 30000) {
      window._sysToastSeen[msg] = Date.now();
      window._incomingMsgs = window._incomingMsgs || [];
      window._incomingMsgs.push({ id: 'sys_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), source: 'system', title: msg, level: type, ts: Math.floor(Date.now() / 1000), read: false });
      if (window._incomingMsgs.length > 200) window._incomingMsgs = window._incomingMsgs.slice(-200);
    }
  }
  _unread++;
  renderMsgList();
  updateBadge();
}
function updateBadge() {
  var badge = document.getElementById('msgBadge');
  if (!badge) return;
  var extMsgs = window._incomingMsgs || [];
  var unreadExt = extMsgs.filter(function(m) { return !_isRead(m); }).length;
  badge.style.display = (unreadExt + _unread > 0) ? 'block' : 'none';
}
function _systemMsgs() {
  // 收集所有系统类消息（外部推送的 system + 内部 toast），统一归入「系统通知」会话
  var out = [];
  (window._incomingMsgs || []).forEach(function (m) {
    if ((m.source || 'system') === 'system') {
      out.push({ id: m.id, title: m.title || m.content || '系统通知', level: m.level || 'info', ts: m.ts || 0, actions: m.actions || [], read: _isRead(m), source: 'system' });
    }
  });
  _msgHistory.forEach(function (m) {
    out.push({ id: 'int_' + (m._ts || Date.now()) + '_' + Math.random().toString(36).slice(2, 6), title: m.msg, level: m.type || 'info', ts: m._ts || 0, actions: [], read: true, source: 'system' });
  });
  return out;
}
function renderMsgList() {
  var list = document.getElementById('msgList');
  if (!list) return;
  var extMsgs = window._incomingMsgs || [];
  var icons = { error: '⚠️', warning: '⚠️', success: '✅', info: 'ℹ️' };
  if (!_msgHistory.length && !extMsgs.length) { list.innerHTML = '<div class="msg-empty">暂无消息</div>'; return; }
  // 外部推送消息 → 按 来源+标题 归纳为会话；系统类通知统一归入一条「系统通知」会话
  var groups = {};
  // 系统类消息（内部 toast + incoming system）统一归并为一条「系统通知」会话
  _systemMsgs().forEach(function(m) {
    if (!groups['system|__sys__']) groups['system|__sys__'] = [];
    groups['system|__sys__'].push(m);
  });
  // 非系统 incoming 消息按 来源+标题 归并
  extMsgs.forEach(function(m) {
    if ((m.source || 'system') === 'system') return;
    var key = (m.source || 'system') + '|' + (m.title || m.content || '');
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  });
  var html = '';
  Object.keys(groups).forEach(function(key) {
    var arr = groups[key];
    arr.sort(function(a, b) { return (a.ts || 0) - (b.ts || 0); });
    var last = arr[arr.length - 1];
    var unread = arr.filter(function(m) { return !_isRead(m); }).length;
    var time = last.ts ? new Date(last.ts * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
    var src = arr[0].source || 'system';
    var title = (src === 'system') ? '系统通知' : (last.title || last.content || '');
    var srcLabel = (src === 'system') ? '系统通知' : src;
    var srcJ = esc(JSON.stringify(src));
    var titleJ = esc(JSON.stringify(title));
    html += '<div class="msg-item" onclick="openMsgThread(' + srcJ + ',' + titleJ + ')" style="' + (unread ? 'color:#fff;font-weight:600;' : '') + '">' +
      '<span>' + (icons[last.level] || 'ℹ️') + '</span>' +
      '<span class="mi-text"><b>[' + esc(srcLabel) + ']</b> ' + esc(title) + (arr.length > 1 ? ' <span style="font-size:11px;color:rgba(255,255,255,0.5);">×' + arr.length + '</span>' : '') + '</span>' +
      (unread ? '<span class="msg-unread">' + unread + '</span>' : '') +
      '<span class="mi-time">' + time + '</span></div>';
  });
  list.innerHTML = html;
}
function openMsgThread(source, title) {
  // 进入会话：确保消息面板保持展开（防止点击冒泡触发其他浮层互斥逻辑误关面板）
  var panel = document.getElementById('msgPanel');
  if (panel) panel.style.display = 'block';
  // 点击事件流结束后再次兜底强制显示（某些浮层互斥逻辑在事件流内异步关闭面板）
  setTimeout(function () { if (panel) panel.style.display = 'block'; }, 0);
  var list = document.getElementById('msgList');
  if (!list) return;
  var extMsgs = window._incomingMsgs || [];
  var icons = { error: '⚠️', warning: '⚠️', success: '✅', info: 'ℹ️' };
  var arr = extMsgs.filter(function(m) {
    if (source === 'system') return (m.source || 'system') === 'system';
    return (m.source || 'system') === source && (m.title || m.content || '') === title;
  });
  arr.sort(function(a, b) { return (a.ts || 0) - (b.ts || 0); });
  // 进入会话即标记该会话已读（持久化）
  _markRead(arr);
  var html = '<div class="msg-thread-head" onclick="renderMsgList()"><span class="mi-back">←</span> <b>[' + esc(source === 'system' ? '系统通知' : source) + ']</b> ' + esc(source === 'system' ? '系统通知' : title) + '</div>';
  if (source === 'system') {
    // 系统通知会话：内部消息按子类（消息文案）分组展示，每个子类显示名称供查阅
    var sys = _systemMsgs();
    sys.sort(function(a, b) { return (a.ts || 0) - (b.ts || 0); });
    _markRead(sys);
    var sub = {};
    sys.forEach(function(m) { var t = m.title || '系统通知'; (sub[t] = sub[t] || []).push(m); });
    Object.keys(sub).forEach(function(t) {
      var g = sub[t];
      html += '<div class="msg-subhead">' + esc(t) + (g.length > 1 ? ' <span class="mi-count">×' + g.length + '</span>' : '') + '</div>';
      html += g.map(function(m) {
        var time = m.ts ? new Date(m.ts * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
        var actions = (m.actions || []).map(function(a, j) {
          return '<button class="msg-action-btn" onclick="execAction(\'' + m.id + '\',' + j + ')" style="margin-left:8px;padding:2px 8px;font-size:11px;border-radius:6px;border:none;background:rgba(255,255,255,0.15);color:#fff;cursor:pointer;">' + esc(a.label) + '</button>';
        }).join('');
        return '<div class="msg-item"><span>' + (icons[m.level] || 'ℹ️') + '</span><span class="mi-text">' + esc(m.title || m.content) + actions + '</span><span class="mi-time">' + time + '</span></div>';
      }).join('');
    });
  } else {
    html += arr.map(function(m) {
      var time = new Date(m.ts * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      var actions = (m.actions || []).map(function(a, j) {
        return '<button class="msg-action-btn" onclick="execAction(\'' + m.id + '\',' + j + ')" style="margin-left:8px;padding:2px 8px;font-size:11px;border-radius:6px;border:none;background:rgba(255,255,255,0.15);color:#fff;cursor:pointer;">' + esc(a.label) + '</button>';
      }).join('');
      return '<div class="msg-item"><span>' + (icons[m.level] || 'ℹ️') + '</span><span class="mi-text">' + esc(m.title || m.content) + actions + '</span><span class="mi-time">' + time + '</span></div>';
    }).join('');
  }
  list.innerHTML = html;
  updateBadge();
}
function loadIncoming() {
  fetchJSON(API.incoming).then(function(d) {
    if (d && d.messages) {
      window._incomingMsgs = d.messages;
      _applyRead(window._incomingMsgs); // 恢复持久化的已读状态
      updateBadge();
      renderMsgList();
    }
  }).catch(function(){});
}
function execAction(msgId, actionIdx) {
  var msgs = window._incomingMsgs || [];
  var msg = msgs.find(function(m){ return m.id === msgId; });
  if (!msg || !msg.actions[actionIdx]) return;
  var a = msg.actions[actionIdx];
  fetch(a.api, {
    method: a.method || 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(a.body || {})
  }).then(function(r) { return r.json(); }).then(function(d) {
    toast(d.ok ? '操作成功' : '操作失败', d.ok ? 'success' : 'error');
    _markRead([msg]);
    renderMsgList();
  }).catch(function(e) { toast('操作失败：' + e.message, 'error'); });
}
function toggleMsgCenter(e) {
  if (e) e.stopPropagation();
  var p = document.getElementById('msgPanel');
  if (!p) return;
  var show = p.style.display !== 'block';
  // 互斥：打开消息面板时关闭其他浮层
  searchDropdown.classList.remove('show');
  heroSourceDropdown.classList.remove('show');
  if (show) {
    // 锚定：从铃铛正下方展开，右缘对齐铃铛右缘
    var rb = document.getElementById('msgBell').getBoundingClientRect();
    p.style.top = (rb.bottom + 8) + 'px';
    p.style.right = Math.max(12, window.innerWidth - rb.right - 2) + 'px';
    p.style.left = 'auto';
  }
  p.style.display = show ? 'block' : 'none';
  if (show) { loadIncoming(); renderMsgList(); }
}
function markAllRead() {
  _unread = 0;
  _markRead(window._incomingMsgs || []);
  updateBadge();
  renderMsgList();
}
function clearMsgCenter() {
  _msgHistory = [];
  _unread = 0;
  window._incomingMsgs = [];
  renderMsgList();
  updateBadge();
}
function toast(msg, type) {
  type = type || 'info';
  _pushMsg(msg, type);
  var c = document.getElementById('toastContainer');
  if (!c) return;
  // Deduplicate: same message within 5s updates existing
  var key = type + ':' + msg;
  if (_toastMap[key]) {
    clearTimeout(_toastMap[key]._timer);
  } else {
    // Max 2 toasts
    while (c.children.length >= 2) c.firstChild.remove();
    var icons = { error: '⚠️', success: '✅', info: 'ℹ️' };
    var t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.innerHTML = '<span class="toast-icon">' + (icons[type] || 'ℹ️') + '</span><span class="toast-text">' + esc(msg) + '</span>';
    c.appendChild(t);
    _toastMap[key] = t;
  }
  var el = _toastMap[key];
  el._timer = setTimeout(function() {
    el.remove();
    delete _toastMap[key];
  }, 4000);
}
// 点击页面其它区域关闭消息面板
document.addEventListener('click', function(e) {
  var p = document.getElementById('msgPanel');
  if (p && p.style.display === 'block' && e.target.closest && !e.target.closest('.msg-center') && !e.target.closest('.msg-panel')) {
    p.style.display = 'none';
  }
});

var _activeRequests = {};
var _requestSeq = 0;

var _suppressToasts = false;
var _last404Toast = 0; // 404 限频：同一窗口内只提示一次，避免瞬时 404 反复刷屏消息中心
async function clearSeasonCache() {
  try {
    const r = await fetchJSON('/cache/season', 20000);
    toast(r && r.cleared !== undefined ? ('已清理 ' + r.cleared + ' 条媒体库季集缓存') : '清理完成', 'success');
  } catch (e) { toast('清理失败: ' + e.message, 'error'); }
}

// ========== 服务重连等待（重启时全屏遮罩 + 轮询，恢复自动跳转，对齐 MP/DSM 等待重连页） ==========
var _reconnecting = false;
function showReconnect() {
  if (_reconnecting) return;
  _reconnecting = true;
  _suppressToasts = true;
  var ov = document.getElementById('reconnectOverlay');
  if (ov) ov.style.display = 'flex';
  var ll = document.getElementById('loginLogo');
  var rl = document.getElementById('reconnectLogo');
  if (ll && ll.src && rl) rl.src = ll.src;
  if (!window._reconnectTimer) {
    window._reconnectTimer = setInterval(function () {
      fetch('/api/status', { cache: 'no-store' }).then(function () { hideReconnect(); }).catch(function () { /* 仍不可达，继续轮询 */ });
    }, 2000);
  }
}
function hideReconnect() {
  _reconnecting = false;
  _suppressToasts = false;
  if (window._reconnectTimer) { clearInterval(window._reconnectTimer); window._reconnectTimer = null; }
  var ov = document.getElementById('reconnectOverlay');
  if (ov) ov.style.display = 'none';
  location.reload();
}

async function fetchJSON(path, timeoutMs) {
  timeoutMs = timeoutMs || 20000;
  var reqId = ++_requestSeq;
  _activeRequests[reqId] = true;
  var controller = new AbortController();
  var timer = setTimeout(function() {
    if (_activeRequests[reqId]) {
      controller.abort();
    }
  }, timeoutMs);
  try {
    var headers = {};
    var token = localStorage.getItem('nexus_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var resp = await fetch(API_BASE + path, { signal: controller.signal, headers: headers });
    clearTimeout(timer);
    delete _activeRequests[reqId];
    if (resp.status === 401) {
      showLogin();
      return null;
    }
    if (resp.status === 403) {
      // 权限不足：静默返回，不当作服务器错误提示
      return null;
    }
    if (!resp.ok) {
      // 404/403 都是「前端调用了后端不存在的端点或无权访问」，属代码/权限状态，而非服务器故障：
      // 提示"请稍后重试"反而误导且会随轮询反复刷屏，故静默返回。
      if (resp.status === 404 || resp.status === 403) {
        return null;
      }
      if (!_suppressToasts) toast('服务器错误 (' + resp.status + ')，请稍后重试', 'error');
      return null;
    }
    var ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      // 返回了 HTML（登录页/未知端点 SPA 兜底/反代异常）而非 JSON：静默返回，避免轮询接口反复刷屏
      if (resp.status === 401) { showLogin(); return null; }
      return null;
    }
    return await resp.json();
  } catch (e) {
    clearTimeout(timer);
    delete _activeRequests[reqId];
    if (e.name === 'AbortError') {
      if (!_suppressToasts) {
        var _now = Date.now();
        if (_now - _lastTimeoutToast > 30000) {
          _lastTimeoutToast = _now;
          toast('请求超时(' + Math.round(timeoutMs/1000) + 's)，服务器可能繁忙或正在执行长时间搜索，请稍后重试', 'error');
        }
      }
    } else {
      // 网络层失败（连接拒绝/中断）：极可能是服务重启中 → 进入等待重连页（不再逐次刷 toast）
      showReconnect();
    }
    return null;
  }
}

// ========== 收藏 Favorites ==========
async function apiPost(path, data) {
  var controller = new AbortController();
  var timer = setTimeout(function(){ controller.abort(); }, 15000);
  try {
    var headers = { 'Content-Type': 'application/json' };
    var token = localStorage.getItem('nexus_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var resp = await fetch(API_BASE + path, { method: 'POST', body: JSON.stringify(data), headers: headers, signal: controller.signal });
    clearTimeout(timer);
    if (resp.status === 401) { showLogin(); return null; }
    if (resp.status === 403) return null;
    return await resp.json();
  } catch(e) { clearTimeout(timer); return null; }
}

var _favs = [];
async function loadFavorites() {
  var _g = document.getElementById('favoritesGrid');
  if (_g) _g.innerHTML = Array(6).fill('<div class="movie-card" style="background:linear-gradient(145deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03));border:1px solid rgba(255,255,255,0.06);border-radius:14px;overflow:hidden;padding:10px;cursor:default;"><div class="skeleton" style="aspect-ratio:2/3;border-radius:12px;"></div><div class="skeleton" style="height:12px;border-radius:6px;margin-top:10px;width:70%;"></div><div class="skeleton" style="height:10px;border-radius:6px;margin-top:6px;width:45%;"></div></div>').join('');
  try { const r = await fetchJSON(API.favorites); _favs = r.favorites || []; }
  catch(e) { _favs = []; }
  renderFavorites();
}
function currentFavFilter() {
  var a = document.querySelector('#favFilterRow .pt-filter-chip.active');
  return a ? (a.dataset.favfilter || 'all') : 'all';
}
function renderFavorites() {
  var grid = document.getElementById('favoritesGrid');
  var empty = document.getElementById('favEmpty');
  if (!grid) return;
  if (!_favs.length) { grid.innerHTML = ''; if (empty) empty.style.display = 'block'; return; }
  if (empty) empty.style.display = 'none';
  var filter = currentFavFilter();
  var list = filter === 'all' ? _favs : _favs.filter(f => f.type === filter);
  if (!list.length) { grid.innerHTML = '<div style="opacity:0.5;text-align:center;padding:40px;">该分类暂无收藏</div>'; return; }
  grid.innerHTML = list.map(f => `
    <div class="movie-card" style="cursor:pointer;position:relative;" onclick="openDetail('${esc(f.id)}')">
      <div class="movie-poster" style="padding:0;background:rgba(255,255,255,0.06);position:relative;overflow:hidden;">
        ${f.poster ? `<img src="${esc(imgProxy(f.poster))}" style="width:100%;height:100%;object-fit:cover;border-radius:14px;" loading="lazy" onerror="this.style.display='none'">` : '<div style="width:100%;aspect-ratio:2/3;display:flex;align-items:center;justify-content:center;font-size:34px;">🎬</div>'}
        ${f.rating ? `<div class="rating-badge">★ ${esc(fmtRating(f.rating))}</div>` : ''}
        <button onclick="event.stopPropagation();removeFav('${esc(f.id)}')" title="取消收藏" style="position:absolute;top:8px;right:8px;border:none;background:rgba(0,0,0,0.5);color:#FFD60A;cursor:pointer;border-radius:50%;width:26px;height:26px;font-size:14px;line-height:1;">★</button>
      </div>
      <div class="movie-info">
        <div class="movie-title">${esc(f.title)}</div>
        <div class="movie-meta"><span>${esc(f.year || '')}</span>${f.type === 'Series' ? '<span>· 剧集</span>' : '<span>· 电影</span>'}</div>
      </div>
    </div>`).join('');
}
function isFav(id) { return (_favs || []).some(f => f.id === id); }

// ========== 收藏中心：Tab 切换（收藏 / 订阅 / 播放历史） ==========
document.addEventListener('click', function(e) {
  var tab = e.target.closest && e.target.closest('#favTabs .pt-filter-chip');
  if (!tab || !tab.dataset.favtab) return;
  document.querySelectorAll('#favTabs .pt-filter-chip').forEach(c => c.classList.remove('active'));
  tab.classList.add('active');
  var mode = tab.dataset.favtab;
  document.getElementById('favSection').style.display = mode === 'fav' ? '' : 'none';
  document.getElementById('subSection').style.display = mode === 'sub' ? '' : 'none';
  document.getElementById('historySection').style.display = mode === 'history' ? '' : 'none';
  if (mode === 'sub') renderSubscriptions();
  if (mode === 'history') loadPlayHistory();
});
// 订阅状态徽章映射（MP subscribe.state）
const SUB_STATE = { N: ['订阅中', '#0A84FF'], R: ['订阅中', '#0A84FF'], S: ['已完成', '#30D158'], F: ['失败', '#FF453A'] };
function subStateOf(s) {
  const m = SUB_STATE[s] || [s || '订阅中', '#8E8E93'];
  return m;
}
async function renderSubscriptions() {
  const grid = document.getElementById('subscriptionsGrid');
  const empty = document.getElementById('subEmpty');
  if (!grid) return;
  if (_mpSubEnabled === false) {
    grid.innerHTML = '';
    if (empty) { empty.innerHTML = 'MoviePilot 接入未启用，订阅不可用。请在「设置 → MoviePilot 接入」开启后刷新。'; empty.style.display = 'block'; }
    return;
  }
  // 加载骨架：数据到位前先展示骨架卡片，避免干等
  grid.innerHTML = Array(6).fill(
    '<div class="movie-card" style="background:linear-gradient(145deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03));border:1px solid rgba(255,255,255,0.06);border-radius:14px;overflow:hidden;padding:10px;cursor:default;"><div class="skeleton" style="aspect-ratio:2/3;border-radius:12px;"></div><div class="skeleton" style="height:12px;border-radius:6px;margin-top:10px;width:70%;"></div><div class="skeleton" style="height:10px;border-radius:6px;margin-top:6px;width:45%;"></div></div>'
  ).join('');
  if (empty) empty.style.display = 'none';
  var subOk = false;
  try { subOk = await fetchSubscriptions(); } catch(e) { subOk = false; }
  if (!_subscriptions.length) {
    grid.innerHTML = '';
    if (empty) {
      // 区分「拉取失败」与「确实无订阅」，避免接口异常时误显示"暂无订阅"
      empty.innerHTML = subOk
        ? '暂无 MoviePilot 订阅。在影片翻转卡点 <span style="color:#FF3B30;">♥ 订阅</span> 即可加入订阅。'
        : '订阅加载失败，请稍后重试。';
      empty.style.display = 'block';
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  grid.innerHTML = _subscriptions.map(function(s, i) {
    var isTv = /电视剧|Series|tv|剧集/i.test(s.type);
    var st = subStateOf(s.state);
    var paused = s.state === 'S';
    var emoji = isTv ? '📺' : '🎬';
    var metaLine = isTv ? '剧集' : '电影';
    if (s.year) metaLine += ' · ' + esc(s.year);
    // 进度主字段（替换原重复的"订阅中"状态）：剧集→更新至 X/Y 集；电影→流媒体上线
    var progMain = '';
    // 下一行保持更新时间显示：仅剧集有下一集信息
    var progSub = '';
    if (isTv && s.eps_total) {
      progMain = '更新至 ' + (s.eps_done || 0) + '/' + s.eps_total + ' 集';
      if (s.next_ep && s.next_air) progSub = '更新 ' + s.next_air;
    } else if (!isTv && s.release_date) {
      progMain = '流媒体上线 ' + s.release_date;
    }
    return `<div class="movie-card sub-card" data-subidx="${i}" style="cursor:pointer;position:relative;">
      <div class="movie-poster" style="padding:0;background:rgba(255,255,255,0.06);position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;">
        ${s.poster ? `<img src="${esc(imgProxy(s.poster))}" style="width:100%;height:100%;object-fit:cover;border-radius:14px;" loading="lazy" onerror="this.style.display='none'">` : `<span class="sub-poster-ph" style="font-size:34px;">${emoji}</span>`}
        <span style="position:absolute;bottom:6px;left:6px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;color:#fff;background:${paused ? 'rgba(120,120,140,0.85)' : st[1]};opacity:0.92;z-index:3;">${paused ? '已暂停' : st[0]}</span>
        <div class="sub-overlay">
          <button class="sub-btn" onclick="togglePauseSub('${esc(String(s.name || '').replace(/'/g, "\\'"))}','${esc(String(s.tmdbid || '').replace(/'/g, "\\'"))}',${paused ? 'false' : 'true'});event.stopPropagation();" title="${paused ? '恢复订阅' : '暂停订阅'}">${paused ? '▶' : '⏸'}</button>
          <button class="sub-btn sub-btn-del" onclick="removeSubscription('${esc(String(s.name || '').replace(/'/g, "\\'"))}','${esc(String(s.tmdbid || '').replace(/'/g, "\\'"))}');event.stopPropagation();" title="取消订阅">🗑</button>
        </div>
      </div>
      <div class="movie-info">
        <div class="movie-title">${esc(s.name)}</div>
        <div class="movie-meta"><span>${metaLine}</span>${progMain ? `<span>${esc(progMain)}</span>` : ''}</div>
        ${progSub ? `<div class="sub-prog">${esc(progSub)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  // 移动端：点击 flow 卡片在海报压暗遮罩上显示暂停/删除按钮（桌面 hover 由 CSS 承担）
  grid.querySelectorAll('.sub-card').forEach(function(card) {
    card.addEventListener('click', function(ev) {
      if (ev.target.closest('button')) return;
      var already = card.classList.contains('sub-open');
      grid.querySelectorAll('.sub-card.sub-open').forEach(function(o) { o.classList.remove('sub-open'); });
      if (!already) card.classList.add('sub-open');
    });
  });
  if (!grid._subDocBound) {
    grid._subDocBound = true;
    document.addEventListener('click', function(ev) {
      if (ev.target.closest && !ev.target.closest('.sub-card')) {
        grid.querySelectorAll('.sub-card.sub-open').forEach(function(o) { o.classList.remove('sub-open'); });
      }
    });
  }
  // 按 tmdbid 异步补海报（与流行趋势影视卡同图源，加载失败保留 emoji 占位）
  _subscriptions.forEach(function(s, i) {
    if (!s.tmdbid) return;
    if (s.poster) return; // 后端已带海报，无需异步补
    fetchJSON('/tmdb/detail?tmdbid=' + encodeURIComponent(String(s.tmdbid))).then(function(r) {
      if (!r || !r.data || !r.data.poster) return;
      var card = grid.querySelector('[data-subidx="' + i + '"]');
      if (!card) return;
      var ph = card.querySelector('.sub-poster-ph');
      if (ph) ph.outerHTML = '<img src="' + esc(imgProxy(r.data.poster)) + '" style="width:100%;height:100%;object-fit:cover;border-radius:14px;" loading="lazy" onerror="this.style.display=\'none\'">';
    }).catch(function() {});
  });
}
async function togglePauseSub(name, tmdbid, doPause) {
  if (!name || !tmdbid) { toast('缺少订阅标识，无法操作', 'error'); return; }
  try {
    var r = await apiPost(API.subscribe, { action: doPause ? 'pause' : 'resume', name: name, tmdbid: tmdbid });
    if (r && r.ok) {
      toast(doPause ? '订阅已暂停' : '订阅已恢复', 'success');
      renderSubscriptions();
    } else {
      toast((r && r.error) || '操作失败', 'error');
    }
  } catch(e) { toast('操作失败', 'error'); }
}
async function removeSubscription(name, tmdbid) {
  if (!name || !tmdbid) { toast('缺少订阅标识，无法删除', 'error'); return; }
  if (!confirm(`确定取消订阅「${name}」？\n此操作不可恢复。`)) return;
  try {
    var r = await apiPost(API.subscribe, { action: 'remove', name: name, tmdbid: tmdbid });
    if (r && r.ok) {
      toast(r.removed ? '已取消订阅' : '订阅已移除', 'success');
      _subTmdbIds[String(tmdbid)] && delete _subTmdbIds[String(tmdbid)];
      renderSubscriptions();
    } else {
      toast((r && r.error) || '操作失败', 'error');
    }
  } catch(e) { toast('操作失败', 'error'); }
}
// ========== 播放历史 ==========
let _playHistory = [];
async function loadPlayHistory() {
  const list = document.getElementById('playHistoryList');
  const empty = document.getElementById('histEmpty');
  if (!list) return;
  list.innerHTML = Array(5).fill('<div style="display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.05);"><div class="skeleton" style="width:28px;height:28px;border-radius:8px;flex-shrink:0;"></div><div style="flex:1;"><div class="skeleton" style="height:13px;border-radius:6px;width:60%;"></div><div class="skeleton" style="height:10px;border-radius:6px;margin-top:6px;width:40%;"></div></div></div>').join('');
  try { const r = await fetchJSON(API.play_history, 10000); _playHistory = (r && r.history) || []; }
  catch(e) { _playHistory = []; }
  if (!_playHistory.length) { list.innerHTML = ''; if (empty) empty.style.display = 'block'; return; }
  if (empty) empty.style.display = 'none';
  list.innerHTML = _playHistory.map(function(h) {
    var time = h.ts ? new Date(h.ts * 1000).toLocaleString('zh-CN', { hour12: false }) : '';
    return `<div class="torrent-item" style="cursor:pointer;" onclick="window.open('${esc(h.url)}','_blank')">
      <div class="torrent-icon">🔗</div>
      <div class="torrent-main">
        <div class="torrent-name">${esc(h.title)}</div>
        <div class="torrent-sub">${time}${h.source ? ' · ' + esc(h.source) : ''}</div>
      </div>
    </div>`;
  }).join('');
}
function playRecord(title, url) {
  try {
    fetch(API_BASE + '/play-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.getItem('nexus_token') || '') },
      body: JSON.stringify({ title: title || '', url: url || '', ts: Math.floor(Date.now() / 1000) })
    }).catch(function(){});
  } catch(e) {}
}
window.playRecord = playRecord;
async function toggleFav(item) {
  var already = isFav(item.id);
  try {
    var payload = { action: already ? 'remove' : 'add' };
    if (already) payload.id = item.id; else payload.item = item;
    var r = await apiPost(API.favorites, payload);
    if (r) {
      _favs = r.favorites || _favs;
      // 详情页收藏按钮状态同步（已收藏 ↔ 收藏）——文字保持黑色与订阅按钮同款，仅星形填充变黄
      var favBtn = document.querySelector('#detailModal button[data-favbtn]');
      if (favBtn) {
        var nowFav = isFav(item.id);
        favBtn.style.color = '#0a0a0a';
        var svg = favBtn.querySelector('svg');
        if (svg) svg.setAttribute('fill', nowFav ? '#FFD60A' : 'none');
        var lab = favBtn.querySelector('.fav-label');
        if (lab) lab.textContent = nowFav ? '已收藏' : '收藏';
      }
      toast(already ? '已取消收藏' : '已收藏 ⭐', already ? 'info' : 'success');
    }
  } catch(e) { toast(already ? '取消失败' : '收藏失败', 'error'); }
}
async function flipFav(btn, item) {
  var already = isFav(item.id);
  try {
    var payload = { action: already ? 'remove' : 'add' };
    if (already) payload.id = item.id; else payload.item = item;
    var r = await apiPost(API.favorites, payload);
    if (r) {
      _favs = r.favorites || _favs;
      var svg = btn && btn.querySelector('svg');
      if (svg) svg.setAttribute('fill', already ? 'none' : '#FFD60A');
      toast(already ? '已取消收藏' : '已收藏 ⭐', already ? 'info' : 'success');
    }
  } catch(e) { toast(already ? '取消失败' : '收藏失败', 'error'); }
}
let _subscriptions = [];
let _subTmdbIds = {};
async function fetchSubscriptions() {
  try {
    var d = await fetchJSON(API.subscribe);
    if (d && d.ok) {
      _mpSubEnabled = d.enabled !== false;
      _subscriptions = d.subscriptions || [];
      _subTmdbIds = {};
      _subscriptions.forEach(function(s){ if (s.tmdbid) _subTmdbIds[String(s.tmdbid)] = true; });
      return true; // 拉取成功（即使列表为空）
    }
  } catch(e) {}
  return false; // 拉取失败 / 未启用
}
async function flipSubscribe(btn, title, type, year, poster, rating, overview) {
  var tmdbid = (typeof window !== 'undefined' && window._flipTmdbId) || '';
  if (!tmdbid) { toast('暂无 TMDB 身份，无法订阅', 'error'); return; }
  var already = !!_subTmdbIds[String(tmdbid)];
  try {
    var r = await apiPost(API.subscribe, {
      action: already ? 'remove' : 'add',
      name: title, type: type, year: year, tmdbid: tmdbid,
      poster: poster, rating: rating || 0, description: overview || ''
    });
    if (r && r.ok) {
      // 本地同步订阅状态（保证下次点击正确切换）
      if (already) delete _subTmdbIds[String(tmdbid)];
      else _subTmdbIds[String(tmdbid)] = true;
      var svg = btn && btn.querySelector('svg');
      if (svg) svg.setAttribute('fill', already ? 'none' : '#FF3B30');  // 订阅红/取消恢复描边
      toast(already ? '已取消 MoviePilot 订阅' : (r.already ? '已在 MoviePilot 订阅中' : '已订阅至 MoviePilot'), 'success');
    } else {
      toast((r && r.error) || '操作失败', 'error');
    }
  } catch(e) { toast('操作失败', 'error'); }
}
// 翻转卡按钮为 innerHTML 注入，onclick 在全局作用域解析；挂到 window 供内联调用
window.flipSubscribe = flipSubscribe;
window.flipFav = flipFav;
async function removeFav(id) {
  if (!confirm('确定取消收藏？')) return;
  try {
    var r = await apiPost(API.favorites, { action: 'remove', id: id });
    if (r) { _favs = r.favorites || _favs; renderFavorites(); toast('已取消收藏', 'info'); }
  } catch(e) { toast('操作失败', 'error'); }
}
document.addEventListener('click', (e) => {
  var chip = e.target.closest('#favFilterRow .pt-filter-chip');
  if (chip) {
    document.querySelectorAll('#favFilterRow .pt-filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderFavorites();
  }
});

function updateStatusCards(data) {
  if (!data) return;
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.classList.remove('skeleton'); }
  };
  const setBar = (id, pct) => {
    const el = document.getElementById(id);
    if (el) { el.style.width = Math.min(100, pct) + '%'; el.classList.remove('skeleton'); }
  };
  // CPU
  const cpuPct = Math.round(data.cpu);
  setText('cpuVal', cpuPct + '%');
  const cpuDesc = cpuPct > 80 ? '高负载' : cpuPct > 50 ? '中等负载' : '正常负载';
  const tempStr = data.cpu_temp ? ' · ' + data.cpu_temp + '°C' : '';
  setText('cpuSub', 'SA · ' + cpuDesc + tempStr);
  setBar('cpuBar', data.cpu);
  // 内存
  const memPct = Math.round(data.memory);
  setText('memVal', memPct + '%');
  const memDesc = memPct > 85 ? '内存紧张' : memPct > 60 ? '使用偏高' : '充足可用';
  setText('memSub', '合计 · ' + memDesc);
  setBar('memBar', data.memory);
  // 网络
  const formatSpeed = (kbps) => {
    if (kbps >= 1048576) return { value: (kbps/1048576).toFixed(1), unit: 'GB/s' };
    if (kbps >= 1024) return { value: (kbps/1024).toFixed(1), unit: 'MB/s' };
    return { value: Math.round(kbps), unit: 'KB/s' };
  };
  const downSpeed = formatSpeed(data.net_down);
  const upSpeed = formatSpeed(data.net_up);
  const netDownEl = document.getElementById('netDown');
  const netUpEl = document.getElementById('netUp');
  if (netDownEl) { netDownEl.classList.remove('skeleton'); netDownEl.innerHTML = `↓ ${downSpeed.value} <span style="font-size:16px;font-weight:600;opacity:0.7;">${downSpeed.unit}</span>`; }
  if (netUpEl) { netUpEl.classList.remove('skeleton'); netUpEl.innerHTML = `↑ ${upSpeed.value} <span style="font-size:16px;font-weight:600;opacity:0.7;">${upSpeed.unit}</span>`; }
  if (data.day_down !== undefined) {
    setText('netDaily', '当日 ↓ ' + data.day_down + ' GB · ↑ ' + data.day_up + ' GB');
  }
  // 运行时间（真实数据）
  if (typeof data.uptime === 'number') {
    let sec = data.uptime, label;
    if (sec >= 86400) label = Math.floor(sec/86400) + '天' + Math.floor((sec%86400)/3600) + '小时';
    else if (sec >= 3600) label = Math.floor(sec/3600) + '小时' + Math.floor((sec%3600)/60) + '分';
    else if (sec >= 60) label = Math.floor(sec/60) + '分钟';
    else label = sec + '秒';
    const uv = document.querySelector('.uptime-value');
    if (uv) { uv.textContent = label; }
  }
  // 活跃任务由 fetchTorrents 填充
}

async function fetchStorage() {
  try {
    const data = await fetchJSON(API.storage);
    if (!data || !data.pools) {
      const c = document.getElementById('storagePageContent');
      if (c) c.innerHTML = '<div style="padding:40px;text-align:center;opacity:0.5;">存储数据加载失败</div>';
      return;
    }
    let totalUsedGB = 0, totalSizeGB = 0;
    data.pools.forEach(p => {
      totalUsedGB += (p.used_bytes || 0) / (1024**3);
      totalSizeGB += (p.size_bytes || 0) / (1024**3);
    });
    const usedTB = (totalUsedGB / 1024).toFixed(1);
    const totalTB = (totalSizeGB / 1024).toFixed(1);
    const percent = totalSizeGB > 0 ? Math.round(totalUsedGB / totalSizeGB * 100) : 0;
    const storageEl = document.getElementById('storageVal');
    if (storageEl) { storageEl.textContent = usedTB + ' TB'; storageEl.classList.remove('skeleton'); }
    const storageSub = document.getElementById('storageSub');
    if (storageSub) { storageSub.textContent = `共 ${totalTB} TB · 已用 ${percent}%`; storageSub.classList.remove('skeleton'); }
    const storageBar = document.getElementById('storageBar');
    if (storageBar) { storageBar.style.width = percent + '%'; storageBar.classList.remove('skeleton'); }
    renderStoragePage(data);
  } catch(e) {
    console.error('fetchStorage error:', e);
  }
}

function _groupByDevice(pools) {
  const m = {};
  pools.forEach(p => { (m[p.device || 'SA'] = m[p.device || 'SA'] || []).push(p); });
  return Object.keys(m).map(dev => {
    const plist = m[dev];
    return {
      name: dev,
      size_bytes: plist.reduce((a, p) => a + (p.size_bytes || 0), 0),
      used_bytes: plist.reduce((a, p) => a + (p.used_bytes || 0), 0),
      avail_bytes: plist.reduce((a, p) => a + (p.avail_bytes || 0), 0),
      percent: 0,
      pools: plist,
    };
  });
}

function renderStoragePage(data) {
  const container = document.getElementById('storagePageContent');
  if (!container) return;
  const pools = data.pools || [];
  const devices = data.devices || [];

  const fmt = (bytes) => {
    const tb = bytes / (1024**4);
    if (tb >= 1) return tb.toFixed(1) + ' TB';
    const gb = bytes / (1024**3);
    return gb.toFixed(0) + ' GB';
  };

  let totalUsed = 0, totalSize = 0, totalAvail = 0;
  pools.forEach(p => {
    totalUsed += p.used_bytes || 0;
    totalSize += p.size_bytes || 0;
    totalAvail += p.avail_bytes || 0;
  });
  const totalPercent = totalSize > 0 ? Math.round(totalUsed / totalSize * 100) : 0;

  let html = '';

  const highUsage = pools.filter(p => p.percent >= 95);
  if (highUsage.length > 0) {
    html += `<div class="alert-card-top"><div class="alert-icon">⚠️</div><div><div class="alert-title">容量提醒</div><div class="alert-desc" style="line-height:1.8;">${highUsage.map(p => `${p.alias || p.mount} <b>${p.percent}%</b>`).join('、')}</div></div></div>`;
  }

  html += `<div class="glass-card" style="padding:24px;margin-bottom:20px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:14px;opacity:0.6;">总存储</div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:8px;">
      <div style="font-size:32px;font-weight:700;line-height:1;">${fmt(totalSize)}</div>
      <div style="text-align:right;line-height:1.3;">
        <div style="font-size:20px;font-weight:700;">${totalPercent}%</div>
        <div style="font-size:12px;opacity:0.6;">已用 ${fmt(totalUsed)} · 可用 ${fmt(totalAvail)}</div>
      </div>
    </div>
    <div class="progress-bar" style="height:10px;margin-top:14px;"><div class="progress-fill ${totalPercent >= 90 ? 'orange' : (totalPercent >= 70 ? 'cyan' : 'green')}" style="width:${totalPercent}%"></div></div>
  </div>`;

  // 按设备分类（设备标识见配置）—— 玻璃卡片=设备总览，内部透明色块=存储池
  const groups = devices.length ? devices : _groupByDevice(pools);
  groups.forEach(dev => {
    const devPct = Math.round(((dev.used_bytes || 0) / (dev.size_bytes || 1)) * 100);
    const devColor = devPct >= 90 ? 'orange' : (devPct >= 70 ? 'cyan' : 'green');
    // 存储池按编号排序（M1→M2→M3→M4…）
    const sortedPools = (dev.pools || []).slice().sort((a, b) => {
      const na = parseInt(String(a.alias || a.mount || '').replace(/[^0-9]/g, '')) || 0;
      const nb = parseInt(String(b.alias || b.mount || '').replace(/[^0-9]/g, '')) || 0;
      return na - nb;
    });
    const poolsHtml = sortedPools.map(p => {
      const colorClass = p.percent >= 95 ? 'orange' : (p.percent >= 80 ? 'blue' : 'green');
      const displayName = p.alias || p.mount;
      const subName = p.alias ? `<div style="font-size:10px;opacity:0.4;margin-top:1px;">${p.mount}</div>` : '';
      return `<div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
          <div style="font-size:13px;font-weight:600;">${esc(displayName)}</div>
          <div style="font-size:12px;opacity:0.65;">${p.percent}%</div>
        </div>
        ${subName}
        <div class="progress-bar" style="height:5px;margin:8px 0 6px;"><div class="progress-fill ${colorClass}" style="width:${p.percent}%"></div></div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <div style="font-size:11px;opacity:0.6;">已用 ${fmt(p.used_bytes)} / 共 ${fmt(p.size_bytes)}</div>
          <div style="font-size:11px;opacity:0.55;">${fmt(p.avail_bytes)} 可用</div>
        </div>
      </div>`;
    }).join('');
    html += `<div class="glass-card" style="padding:20px;margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:13px;opacity:0.6;">🖥️ ${esc(dev.name)}</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:6px;">
        <div style="font-size:26px;font-weight:700;line-height:1;">${fmt(dev.size_bytes)}</div>
        <div style="text-align:right;line-height:1.3;">
          <div style="font-size:16px;font-weight:700;">${devPct}%</div>
          <div style="font-size:11px;opacity:0.6;">已用 ${fmt(dev.used_bytes)} · 可用 ${fmt(dev.avail_bytes)}</div>
        </div>
      </div>
      <div class="progress-bar" style="height:8px;margin:12px 0 16px;"><div class="progress-fill ${devColor}" style="width:${devPct}%"></div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">
        ${poolsHtml}
      </div>
    </div>`;
  });

  container.innerHTML = html;
}

function togglePoolGroup(el) {
  const detail = el.querySelector('.pool-group-detail');
  if (detail) {
    detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
  }
}

var _lastTorrentData = null;
var _currentDownloader = 'qb';
// 种子表排序状态：默认按实时速率降序（保持原有活跃优先行为）
var _torrentSortKey = 'speed';
var _torrentSortDir = -1;

// 种子名排序 key：去掉开头的标点/空白/括号，避免 "[电影名]" "." "-电影名" 这类前导符号干扰字母序
function _cleanTorrentName(n) {
  return String(n || '').toLowerCase().replace(/^[\s\[\]【】()（）.\-_~!@#$%^&*+=|\\:;"'<>,?/]+/, '');
}
function _statusOf(t) {
  var pct = Math.round((t.progress || 0));
  return pct >= 100 ? '做种中' : (t.dlspeed > 0 ? '下载中' : '排队中');
}
function _sortTorrents(list) {
  var key = _torrentSortKey, dir = _torrentSortDir;
  var arr = list.slice();
  arr.sort(function(a, b) {
    var va, vb;
    if (key === 'name') {
      va = _cleanTorrentName(a.name); vb = _cleanTorrentName(b.name);
      return va < vb ? -dir : (va > vb ? dir : 0);
    }
    if (key === 'site') {
      va = String(a.site || ''); vb = String(b.site || '');
      return va < vb ? -dir : (va > vb ? dir : 0);
    }
    if (key === 'status') {
      va = _statusOf(a); vb = _statusOf(b);
      return va < vb ? -dir : (va > vb ? dir : 0);
    }
    if (key === 'progress') { va = a.progress || 0; vb = b.progress || 0; return (va - vb) * dir; }
    if (key === 'size') { va = a.size || 0; vb = b.size || 0; return (va - vb) * dir; }
    va = (a.dlspeed || 0) + (a.upspeed || 0); vb = (b.dlspeed || 0) + (b.upspeed || 0);
    return (va - vb) * dir;
  });
  return arr;
}
function _torrentSortBy(key) {
  if (_torrentSortKey === key) { _torrentSortDir = -_torrentSortDir; }
  else { _torrentSortKey = key; _torrentSortDir = (key === 'name' || key === 'site' || key === 'status') ? 1 : -1; }
  _renderTorrents(_currentDownloader);
  var hdr = document.getElementById('torrentsHeader');
  if (hdr) {
    hdr.querySelectorAll('.th-arrow').forEach(function(i) { i.textContent = ''; });
    var cur = hdr.querySelector('.th-arrow[data-k="' + key + '"]');
    if (cur) cur.textContent = _torrentSortDir === 1 ? '▲' : '▼';
  }
}

function _renderTorrents(type) {
  if (!_lastTorrentData) return;
  const data = _lastTorrentData;
  let torrents = [];
  let engineLabel = '';
  if (type === 'qb') { torrents = data.qb?.torrents || []; engineLabel = 'QB'; }
  else if (type === 'tr') { torrents = data.tr_sa?.torrents || []; engineLabel = 'SA·TR'; }
  else if (type === 'trds') { torrents = data.tr_ds?.torrents || []; engineLabel = 'DS·TR'; }
  const listEl = document.getElementById('transfersList');
  if (!listEl) return;
  if (!torrents.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:60px;opacity:0.6;">' + engineLabel + ': 暂无种子</div>';
    return;
  }
  torrents = _sortTorrents(torrents);
  listEl.innerHTML = torrents.map(t => {
    const pct = Math.round((t.progress || 0));
    const color = pct >= 100 ? '#30D158' : '#0A84FF';
    const statusText = _statusOf(t);
    const site = (t.site || '').trim();
    return `<div class="torrent-row" style="display:grid;grid-template-columns:minmax(0,1fr) 72px 110px 120px 58px;align-items:center;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
      <div style="min-width:0;"><div class="task-name" style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.name)}</div>
        ${(t.fileCount || t.size) ? `<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:3px;">${t.fileCount ? t.fileCount + ' 个文件 · ' : ''}${formatSize(t.size)}</div>` : ''}
      </div>
      <div style="width:72px;text-align:center;"><span style="font-size:11px;color:${color};font-weight:600;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color};margin-right:4px;"></span>${statusText}</span></div>
      <div style="width:110px;text-align:center;"><div class="progress-bar" style="display:inline-block;width:62px;height:4px;border-radius:2px;background:rgba(255,255,255,0.1);overflow:hidden;"><div style="height:100%;border-radius:2px;background:${color};width:${pct}%;"></div></div><span style="font-size:11px;font-weight:600;margin-left:4px;">${pct}%</span></div>
      <div style="width:120px;text-align:right;font-size:11px;"><span style="color:#64D2FF;">↓${formatSpeed(t.dlspeed)}</span> <span style="color:#30D158;">↑${formatSpeed(t.upspeed)}</span></div>
      <div style="width:58px;text-align:center;">${site ? `<span style="display:inline-block;max-width:58px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(100,210,255,0.15);color:#64D2FF;">${esc(site)}</span>` : '<span style="font-size:11px;color:rgba(255,255,255,0.3);">—</span>'}</div>
    </div>`;
  }).join('');
}

// 首页「数据活动」概览表排序状态 + 函数（表头 onclick 调起，重拉数据并用新排序键渲染）
var _homeTorrentSortKey = 'speed';
var _homeTorrentSortDir = -1;
function _homeTorrentSortBy(key) {
  if (_homeTorrentSortKey === key) { _homeTorrentSortDir = -_homeTorrentSortDir; }
  else { _homeTorrentSortKey = key; _homeTorrentSortDir = (key === 'name' || key === 'site' || key === 'status' || key === 'leech' || key === 'seed') ? 1 : -1; }
  fetchTorrents();
  var hdr = document.getElementById('homeTorrentsHeader');
  if (hdr) {
    hdr.querySelectorAll('.th-arrow').forEach(function (i) { i.textContent = ''; });
    var cur = hdr.querySelector('.th-arrow[data-k="' + key + '"]');
    if (cur) cur.textContent = _homeTorrentSortDir === 1 ? '▲' : '▼';
  }
}

function switchDownloader(type) {
  _currentDownloader = type;
  document.querySelectorAll('.downloader-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.downloader === type);
  });
  if (!_lastTorrentData) { fetchTorrents(); return; }
  renderLimit();
  _renderTorrents(type);
}

async function fetchRecent() {
  const data = await fetchJSON(API.recent, 60000);
  if (!data || !data.items) return;
  const listEl = document.getElementById('recentList');
  if (!listEl) return;
  listEl.innerHTML = data.items.map(item => `
    <div class="recent-item" style="cursor:pointer;" ${item.id ? `onclick="openDetail('${item.id}')"` : ''}>
      <div class="recent-poster">${item.image ? `<img src="${esc(imgProxy(item.image))}" alt="">` : '🎬'}</div>
      <div class="recent-info">
        <div class="recent-title">${item.rating ? `<span style="color:#FFD60A;margin-right:6px;">★${fmtRating(item.rating)}</span>` : ''}${esc(item.title)}</div>
        <div class="recent-meta">
          ${item.year ? `<span>${esc(item.year)}</span>` : ''}
          ${item.type ? `<span>${esc(item.type)}</span>` : ''}
        </div>
        <div class="recent-date">${esc(item.date || '')}</div>
      </div>
    </div>
  `).join('');
}

async function fetchStatus() {
  const data = await fetchJSON(API.status, 15000);
  updateStatusCards(data);
}

function _isPrivateHost(u) {
  try {
    var h = new URL(u, location.href).hostname;
    return /^(10\.|127\.|localhost$|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h);
  } catch (e) { return false; }
}

function imgProxy(url) {
  if (!url) return '';
  if (_isPrivateHost(url) || url.includes('doubanio.com') || url.includes('hdslb.com') || url.includes('//douban.com') || url.includes('tmdb.org'))
    return '/api/img?url=' + encodeURIComponent(url);
  return url;
}

async function fetchMediaStats() {
  const data = await fetchJSON(API.media, 60000);
  if (!data) return;
  const cats = data.libraries || [];

  // 更新总览页统计数字
  cats.forEach(cat => {
    if (cat.category === '电影') {
      const el = document.getElementById('statMovies');
      if (el) el.textContent = Number(cat.total).toLocaleString();
    }
    if (cat.category === '电视剧') {
      const el = document.getElementById('statShows');
      if (el) el.textContent = Number(cat.total).toLocaleString();
    }
    if (cat.category === '音频') {
      const musicSub = (cat.subs || []).find(s => s.albums !== undefined);
      const el = document.getElementById('statMusic');
      if (el && musicSub) el.textContent = Number(musicSub.albums).toLocaleString();
    }
  });

  const grid = document.getElementById('mediaLibsGrid');
  if (!grid) return;

  grid.innerHTML = cats.map(cat => {
    // 子类小卡片渲染
    const subCards = (cat.subs || []).map(s => {
      // 电视剧子类
      if (s.shows !== undefined) {
        return `<div style="background:linear-gradient(145deg,rgba(255,255,255,0.09),rgba(255,255,255,0.04));border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;">
          <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:4px;">${esc(s.name)}</div>
          <div style="font-size:20px;font-weight:700;color:#fff;">${Number(s.shows).toLocaleString()}<span style="font-size:11px;font-weight:400;opacity:0.5;margin-left:2px;">部</span></div>
          <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:4px;">${Number(s.seasons).toLocaleString()} 季 · ${Number(s.episodes).toLocaleString()} 集</div>
        </div>`;
      }
      // 音乐子类
      if (s.songs !== undefined) {
        return `<div class="music-sub-card" style="background:linear-gradient(145deg,rgba(255,255,255,0.09),rgba(255,255,255,0.04));border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;">
          <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:8px;">🎵 ${esc(s.name)}</div>
          <div style="display:flex;align-items:baseline;gap:18px;flex-wrap:wrap;">
            <div style="font-size:20px;font-weight:700;color:#fff;line-height:1;">${Number(s.songs).toLocaleString()}<span style="font-size:11px;font-weight:400;opacity:0.5;margin-left:2px;">歌曲</span></div>
            <div style="font-size:20px;font-weight:700;color:#fff;line-height:1;">${Number(s.albums).toLocaleString()}<span style="font-size:11px;font-weight:400;opacity:0.5;margin-left:2px;">专辑</span></div>
            <div style="font-size:20px;font-weight:700;color:#fff;line-height:1;">${Number(s.artists).toLocaleString()}<span style="font-size:11px;font-weight:400;opacity:0.5;margin-left:2px;">艺术家</span></div>
          </div>
        </div>`;
      }
      // 有声书
      if (s.books !== undefined) {
        return `<div class="music-sub-card" style="background:linear-gradient(145deg,rgba(255,255,255,0.09),rgba(255,255,255,0.04));border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px;">
          <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:8px;">📚 ${esc(s.name)}</div>
          <div style="display:flex;align-items:baseline;gap:18px;flex-wrap:wrap;">
            <div style="font-size:20px;font-weight:700;color:#fff;line-height:1;">${Number(s.books).toLocaleString()}<span style="font-size:11px;font-weight:400;opacity:0.5;margin-left:2px;">部</span></div>
            <div style="font-size:20px;font-weight:700;color:#fff;line-height:1;">${Number(s.chapters).toLocaleString()}<span style="font-size:11px;font-weight:400;opacity:0.5;margin-left:2px;">集</span></div>
          </div>
        </div>`;
      }
      // 电影子类
      return `<div style="background:rgba(255,255,255,0.05);border-radius:12px;padding:14px;">
        <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:4px;">${esc(s.name)}</div>
        <div style="font-size:20px;font-weight:700;color:#fff;">${Number(s.count).toLocaleString()}<span style="font-size:11px;font-weight:400;opacity:0.5;margin-left:2px;">部</span></div>
      </div>`;
    }).join('');

    return `
      <div style="margin-bottom:20px;">
        <div class="section-title" style="margin-bottom:10px;">
          <span class="section-icon">${cat.icon || '📁'}</span>
          <h3>${esc(cat.category)}</h3>
          ${cat.total ? `<span style="margin-left:8px;font-size:12px;color:rgba(255,255,255,0.45);">共 <b style="color:#fff;">${Number(cat.total).toLocaleString()}</b> ${cat.total_label||''}</span>` : ''}
          <a class="manage-link" style="margin-left:auto;cursor:pointer;white-space:nowrap;flex-shrink:0;position:relative;z-index:2;pointer-events:auto;" onclick="window._mediaWallBackTo='media';goMediaWall('${cat.category==='电影'?'movie':cat.category==='电视剧'?'tv':'all'}')">查看全部海报墙 <svg width="9" height="9" viewBox="0 0 10 10" style="fill:currentColor;display:inline-block;vertical-align:-1px;flex-shrink:0;"><path d="M3.2 1.4 8.6 5 3.2 8.6Z"/></svg></a>
        </div>
        <div class="glass-card" style="padding:16px;">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;">${subCards}</div>
        </div>
      </div>`;
  }).join('');

  // Hero meta
  const movieCat = cats.find(c => c.category === '电影');
  const tvCat = cats.find(c => c.category === '电视剧');
  const heroMeta = document.getElementById('heroMeta');
  if (heroMeta) {
    const parts = [];
    if (movieCat) parts.push(`${movieCat.total.toLocaleString()} 部电影`);
    if (tvCat) parts.push(`${tvCat.total.toLocaleString()} 部剧集`);
    heroMeta.textContent = parts.join(' · ') + ' · 实时更新';
  }
}

// ========== 常用服务标记 + 拖动排序 ==========
// 首页"家庭服务"模块只展示标记为"常用"的服务，按排序值(svc_order)升序排列。
// 服务页/设置页均可：★ 标记常用、拖动排序。持久化到后端 config(svc_favs / svc_order)。
const HOME_META = {
  'Emby':         { name: '媒体库',         icon: '🎬', desc: '媒体串流' },
  'Jellyseerr':   { name: 'Jellyseerr',     icon: '🎬', desc: '请求管理' },
  'Navidrome':    { name: 'Navidrome',      icon: '🎵', desc: '音乐服务' },
  'MP':           { name: 'MoviePilot',     icon: '🤖', desc: '自动化整理' },
  'HomeAssistant':{ name: 'Home Assistant', icon: '🏠', desc: '智能家居' },
  'AdGuard':      { name: 'AdGuard Home',   icon: '🛡️', desc: 'DNS 过滤' },
};
const DEFAULT_FAVS = ['Emby', 'Jellyseerr', 'Navidrome', 'MP', 'HomeAssistant', 'AdGuard'];

function svcCatalog(apps) {
  const list = apps || window._svcData || [];
  const out = (list || []).map(a => ({
    key: a.key || a.name, name: a.name, icon: a.icon || '📦', desc: a.desc || '',
    url: a.url || '', status: a.status, device: a.device || ''
  }));
  const hasKey = {}; out.forEach(x => hasKey[x.key] = 1);
  // 首页独有、后端 /api/apps 未列出的服务
  [{ key: 'Jellyseerr', name: 'Jellyseerr', icon: '🎬', desc: '请求管理', status: 'online' },
   { key: 'Navidrome',  name: 'Navidrome',  icon: '🎵', desc: '音乐服务', status: 'online' },
   { key: 'HomeAssistant', name: 'Home Assistant', icon: '🏠', desc: '智能家居', status: 'online' }]
    .forEach(e => { if (!hasKey[e.key]) { out.push(e); hasKey[e.key] = 1; } });
  // 首页展示名/图标覆盖（保留原有"媒体库/Home Assistant"等观感）
  out.forEach(x => { const m = HOME_META[x.key]; if (m) { x.name = m.name; x.icon = m.icon; x.desc = m.desc; } });
  return out;
}
function seedSvcDefaults() {
  window._svcFavs = window._svcFavs || {}; window._svcOrder = window._svcOrder || {};
  if (Object.keys(window._svcFavs).length === 0) {
    DEFAULT_FAVS.forEach((k, i) => { window._svcFavs[k] = true; if (!(k in window._svcOrder)) window._svcOrder[k] = i; });
  }
}
async function renderHomeServices() {
  const el = document.getElementById('homeServices');
  if (!el) return;
  try {
    if (!window._svcData || !window._svcData.length) {
      const d = await _japi('/api/apps', {}); if (d && d.apps) window._svcData = d.apps;
    }
  } catch (e) {}
  seedSvcDefaults();
  const favs = window._svcFavs, order = window._svcOrder || {};
  const cat = svcCatalog(window._svcData)
    .filter(x => favs[x.key])
    .sort((a, b) => (order[a.key] ?? 1e9) - (order[b.key] ?? 1e9));
  if (!cat.length) {
    el.innerHTML = '<div style="grid-column:1/-1;font-size:12px;color:rgba(255,255,255,0.45);padding:12px 4px;">尚未标记常用服务 — 在「服务 / 设置」页点 ★ 标记</div>';
    return;
  }
  el.innerHTML = cat.map(x => `
    <div class="service-item" ${x.url ? `onclick="window.open('${esc(x.url)}','_blank');return false;"` : ''} style="cursor:${x.url ? 'pointer' : 'default'};" title="${esc(x.desc)} · ${esc(x.name)}">
      <div class="service-icon" style="background:rgba(255,255,255,0.08);">${x.icon}</div>
      <div class="service-info"><div class="service-name">${esc(x.name)}</div><div class="service-desc">${esc(x.desc)}</div></div>
      <div class="service-dot ${x.status === 'online' ? 'on' : 'warn'}"></div>
    </div>`).join('');
}
async function persistServiceOrder() {
  try {
    await _japi('/api/config', { method: 'POST', body: JSON.stringify({ svc_favs: window._svcFavs || {}, svc_order: window._svcOrder || {} }) });
    renderHomeServices();
    renderFavSvcEditor();
  } catch (e) { toast('保存常用服务失败', 'error'); }
}
function toggleSvcFav(key) {
  seedSvcDefaults();
  window._svcFavs = window._svcFavs || {};
  if (window._svcFavs[key]) { delete window._svcFavs[key]; }
  else { window._svcFavs[key] = true; if (!(key in (window._svcOrder || {}))) window._svcOrder[key] = 1000 + Object.keys(window._svcOrder).length; }
  persistServiceOrder();
}
function svcKeyOf(el) { return (el && el.getAttribute('data-key')) || ''; }
function enableSvcFavButtons() {
  document.querySelectorAll('[data-svcfav]').forEach(function (btn) {
    if (btn.__favBound) return; btn.__favBound = true;
    btn.onclick = function (e) { e.preventDefault(); e.stopPropagation(); toggleSvcFav(btn.getAttribute('data-svcfav')); };
  });
}
function serializeSvcOrder() {
  const order = {};
  const cards = document.querySelectorAll('#saServicesList .app-card, #favSvcList .favsvc-row');
  cards.forEach((el, i) => { const k = svcKeyOf(el); if (k) order[k] = i; });
  window._svcOrder = order;
}
function bindGroupDrag(containerSel) {
  const c = typeof containerSel === 'string' ? document.querySelector(containerSel) : containerSel;
  if (!c) return;
  c.addEventListener('dragstart', function (e) {
    const el = e.target.closest('[draggable]'); if (!el) return;
    el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', svcKeyOf(el));
  });
  c.addEventListener('dragover', function (e) {
    e.preventDefault();
    const target = e.target.closest('[draggable]'); if (!target) return;
    const dragging = c.querySelector('.dragging'); if (!dragging || dragging === target) return;
    const box = target.getBoundingClientRect();
    const after = (e.clientX - box.left) > (box.width / 2);
    c.insertBefore(dragging, after ? target.nextSibling : target);
  });
  c.addEventListener('drop', function (e) {
    e.preventDefault(); const el = c.querySelector('.dragging'); if (el) el.classList.remove('dragging');
    serializeSvcOrder(); persistServiceOrder();
  });
  c.addEventListener('dragend', function (e) {
    const el = c.querySelector('.dragging'); if (el) el.classList.remove('dragging');
  });
}
// 设置页"常用服务"编辑器
function renderFavSvcEditor() {
  const el = document.getElementById('favSvcList');
  if (!el) return;
  const cat = svcCatalog(window._svcData);
  seedSvcDefaults();
  const favs = window._svcFavs, order = window._svcOrder || {};
  cat.sort((a, b) => (order[a.key] ?? 1e9) - (order[b.key] ?? 1e9));
  el.innerHTML = cat.map(x => {
    const fav = !!favs[x.key];
    return `
    <div class="favsvc-row" data-key="${esc(x.key)}" draggable="true">
      <span class="favsvc-grip" title="拖动排序">⠿</span>
      <span class="favsvc-ic">${x.icon}</span>
      <span class="favsvc-name">${esc(x.name)}</span>
      <span class="favsvc-desc">${esc(x.desc)}</span>
      <span class="svc-star ${fav ? 'on' : ''}" data-svcfav="${esc(x.key)}" title="${fav ? '取消常用' : '标记常用'}">${fav ? '★' : '☆'}</span>
    </div>`;
  }).join('');
  enableSvcFavButtons();
  bindGroupDrag('#favSvcList');
}

// ===== 服务分类名称（设备分组标题）：可在设置页配置，仅影响显示 =====
window._deviceTitleMap = window._deviceTitleMap || {};
window.deviceTitle = function (key) {
  var d = String(key || 'SA');
  var map = window._deviceTitleMap || {};
  if (!Object.keys(map).length && window._nexusCfg && window._nexusCfg.device_titles) {
    map = window._nexusCfg.device_titles;
  }
  var v = map[d];
  if (v && String(v).trim()) return String(v).trim();
  return d + ' 服务';
};
function collectDeviceTitles() {
  var out = {};
  var box = document.getElementById('devTitleList');
  if (!box) return out;
  var inps = box.querySelectorAll('input[data-devt]');
  Array.prototype.forEach.call(inps, function (inp) {
    var k = inp.getAttribute('data-devt');
    var v = (inp.value || '').trim();
    if (k && v) out[k] = v;
  });
  return out;
}
function renderDevTitleEditor() {
  var el = document.getElementById('devTitleList');
  if (!el) return;
  var names = [];
  try { names = (window._storageDeviceNames ? window._storageDeviceNames() : []) || []; } catch (e) { names = []; }
  ['SA', 'DS'].forEach(function (k) { if (names.indexOf(k) < 0) names.push(k); });
  var map = collectDeviceTitles();
  if (!Object.keys(map).length) map = window._deviceTitleMap || {};
  el.innerHTML = names.map(function (k) {
    var v = map[k] || '';
    return `<div class="devtitle-row" data-key="${esc(k)}">
      <span class="devtitle-key">${esc(k)}</span>
      <input class="devtitle-inp" data-devt="${esc(k)}" value="${esc(v)}" placeholder="${esc(window.deviceTitle(k))}" maxlength="20">
    </div>`;
  }).join('');
}
window.renderDevTitleEditor = renderDevTitleEditor;
window.collectDeviceTitles = collectDeviceTitles;

async function fetchApps() {
  const data = await fetchJSON(API.apps, 30000);
  if (!data || !data.apps) return;
  if (data.apps) window._svcData = data.apps;
  const listEl = document.getElementById('saServicesList');
  if (listEl) {
    // 按设备分组：已知设备优先，其余兜底追加
    const groups = {};
    data.apps.forEach(a => { const d = a.device || 'SA'; (groups[d] = groups[d] || []).push(a); });
    const known = ['SA', 'DS'];
    // 已知设备优先排序，其余设备兜底追加（避免新增设备分组不显示）
    const order = known.concat(Object.keys(groups).filter(d => known.indexOf(d) < 0));
    listEl.innerHTML = order.filter(d => groups[d]).map(dev => `
      <div class="section-title" style="margin-bottom:16px;"><span class="section-icon">🖥️</span><h3>${esc(window.deviceTitle(dev))}</h3></div>
      <div class="apps-grid" style="margin-bottom:28px;">
        ${groups[dev].map(app => `
          <a class="glass-card app-card" data-key="${esc(app.key || app.name)}" draggable="true" href="${app.url}" target="_blank" style="text-decoration:none;color:inherit;cursor:pointer;">
            <div class="app-icon">${app.icon || '📦'}</div>
            <div class="app-info">
              <div class="app-name">${esc(app.name)} ${(window._svcFavs || {})[app.key || app.name] ? `<span class="svc-star on" data-svcfav="${esc(app.key || app.name)}">★</span>` : `<span class="svc-star" data-svcfav="${esc(app.key || app.name)}">☆</span>`}</div>
              <div class="app-desc">${esc(app.desc)}</div>
            </div>
            <div class="app-status ${app.status === 'online' ? 'on' : 'off'}"><span class="dot"></span> ${app.status === 'online' ? '运行中' : '离线'}</div>
          </a>`).join('')}
      </div>`).join('');
      enableSvcFavButtons();
      document.querySelectorAll('#saServicesList .apps-grid').forEach(function (g) { bindGroupDrag(g); });
  }
  // 总览页紧凑状态条（全部集成服务在线计数）
  const strip = document.getElementById('svcStrip');
  if (strip) {
    const core = data.apps || [];
    const online = core.filter(a => a.status === 'online').length;
    const total = core.length;
    const sumEl = document.getElementById('svcSummary');
    if (sumEl) sumEl.textContent = online + '/' + total + ' 在线';
    strip.innerHTML = core.map(app => {
      const ok = app.status === 'online' || app.status === 'running' || app.status === 'up' || app.online === true;
      return `
      <div data-svc-key="${esc(app.key || app.name)}" title="${esc(app.desc)} · ${esc(app.name)}" class="svc-chip" style="background:${ok ? 'rgba(255,255,255,0.08)' : 'rgba(255,69,58,0.15)'};border:1px solid ${ok ? 'rgba(255,255,255,0.12)' : 'rgba(255,69,58,0.3)'};">
        <span class="svc-chip-dot" style="background:${ok ? '#30D158' : '#FF453A'};box-shadow:0 0 6px ${ok ? 'rgba(48,209,88,0.7)' : 'rgba(255,69,58,0.7)'}"></span>
        <span class="svc-chip-name">${esc(app.name)}</span>
      </div>`;
    }).join('');
    try { applySvcShowConfig(); } catch(e){}
  }
  renderHomeServices();
}

const formatSize = (bytes) => {
  if (!bytes) return '—';
  if (bytes >= 1099511627776) return (bytes/1099511627776).toFixed(1) + ' TB';
  if (bytes >= 1073741824) return (bytes/1073741824).toFixed(1) + ' GB';
  if (bytes >= 1048576) return (bytes/1048576).toFixed(1) + ' MB';
  return Math.round(bytes/1024) + ' KB';
};
const formatSpeed = (bytes) => {
  if (!bytes) return '0 B/s';
  if (bytes >= 1048576) return (bytes/1048576).toFixed(1) + ' MB/s';
  if (bytes >= 1024) return (bytes/1024).toFixed(0) + ' KB/s';
  return bytes + ' B/s';
};

async function fetchTorrents() {
  const data = await fetchJSON(API.torrents, 30000);
  if (!data) return;
  _lastTorrentData = data;
  const renderList = (torrents, engineLabel) => {
    if (!torrents || !torrents.length) return `<div style="text-align:center;padding:30px;opacity:0.5;">${engineLabel}: 无活跃种子</div>`;
    // 按当前表头排序键排序（名称/状态/下载者/做种者/进度/速率/站点）
    const _k = _homeTorrentSortKey, _d = _homeTorrentSortDir;
    const _sorted = torrents.slice().sort((a, b) => {
      let va, vb;
      if (_k === 'name') { va = _cleanTorrentName(a.name); vb = _cleanTorrentName(b.name); return va < vb ? -_d : (va > vb ? _d : 0); }
      if (_k === 'site') { va = String(a.site || ''); vb = String(b.site || ''); return va < vb ? -_d : (va > vb ? _d : 0); }
      if (_k === 'status') { const s = t => (t.progress >= 100 || (t.state && String(t.state).toLowerCase().includes('upload'))) ? '做种中' : '下载中'; va = s(a); vb = s(b); return va < vb ? -_d : (va > vb ? _d : 0); }
      if (_k === 'leech') { va = a.num_leechs || 0; vb = b.num_leechs || 0; return (va - vb) * _d; }
      if (_k === 'seed') { va = a.num_seeds || 0; vb = b.num_seeds || 0; return (va - vb) * _d; }
      if (_k === 'progress') { va = a.progress || 0; vb = b.progress || 0; return (va - vb) * _d; }
      va = (a.dlspeed || 0) + (a.upspeed || 0); vb = (b.dlspeed || 0) + (b.upspeed || 0); return (va - vb) * _d;
    });
    return _sorted.slice(0, 15).map(t => {
      const isSeeding = (t.progress >= 100) || (t.state && t.state.toLowerCase().includes('upload'));
      const statusText = isSeeding ? '做种中' : '下载中';
      const color = isSeeding ? '#30D158' : '#64D2FF';
      const pct = (t.progress || 0).toFixed(1);
      return `
        <div class="transfer-row">
          <div>
            <div class="task-name" style="font-size:13px;font-weight:500;">${(t.engine || t.src) ? `<span class="src-tag" style="display:inline-block;font-size:10px;font-weight:700;color:#fff;background:rgba(100,210,255,0.18);border:1px solid rgba(100,210,255,0.3);border-radius:5px;padding:1px 6px;margin-right:6px;vertical-align:1px;">${esc(t.engine || t.src)}</span>` : ''}${esc(t.name)}</div>
            ${(t.fileCount || t.size) ? `<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:3px;">${t.fileCount ? t.fileCount + ' 个文件 · ' : ''}${formatSize(t.size)}</div>` : ''}
          </div>
          <div><span style="font-size:11px;color:${color};font-weight:600;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color};margin-right:4px;"></span>${statusText}</span></div>
          <div style="text-align:center;font-size:12px;">${t.num_leechs ?? 0}</div>
          <div style="text-align:center;font-size:12px;">${t.num_seeds ?? 0}</div>
          <div style="text-align:left;"><div style="display:flex;align-items:center;gap:6px;"><div class="progress-bar" style="width:44px;height:4px;border-radius:2px;background:rgba(255,255,255,0.1);overflow:hidden;flex-shrink:0;"><div style="height:100%;border-radius:2px;background:${color};width:${pct}%;"></div></div><span style="font-size:11px;font-weight:600;min-width:34px;text-align:left;white-space:nowrap;">${pct}%</span></div></div>
          <div style="font-size:11px;text-align:right;white-space:nowrap;"><span style="color:#64D2FF;">↓${formatSpeed(t.dlspeed)}</span> <span style="color:#30D158;">↑${formatSpeed(t.upspeed)}</span></div>
          <div style="text-align:center;">${(t.site||t.engine||'').trim() ? `<span style="display:inline-block;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(100,210,255,0.15);color:#64D2FF;">${esc(t.site||t.engine)}</span>` : '<span style="font-size:11px;color:rgba(255,255,255,0.3);">—</span>'}</div>
        </div>`;
    }).join('');
  };
  // 活跃任务计数
  // 每个引擎的种子补上 engine 标签（下载器标识 QB/SA·TR/DS·TR），供首页数据活动表 renderList 渲染种子名前下载器标签
  const _tagged = (k, e) => (data[k]?.torrents || []).map(t => ({ ...t, engine: e }));
  const allTorrents = [..._tagged('qb', 'QB'), ..._tagged('tr_sa', 'SA·TR'), ..._tagged('tr_ds', 'DS·TR')];
  const active = allTorrents.filter(t => (t.dlspeed||0) > 0 || (t.upspeed||0) > 0 || (t.progress||0) < 100);
  data.active = active; // 后端不返回 active 时，用前端算出的活跃种子写回，供首页数据活动聚合（torrentList）与活跃传输标签渲染
  const seeding = allTorrents.filter(t => (t.progress||0) >= 100);
  const tv = document.getElementById('tasksVal');
  const ts = document.getElementById('tasksSub');
  if (tv) { tv.textContent = allTorrents.length; tv.classList.remove('skeleton'); }
  if (ts) { ts.textContent = active.length + ' 个下载中 · ' + seeding.length + ' 个做种'; ts.classList.remove('skeleton'); }
  const tb = document.getElementById('tasksBar');
  if (tb) { tb.style.width = Math.min(100, active.length * 10) + '%'; tb.classList.remove('skeleton'); }
  // 当前引擎聚合速率 + 限速回填
  const _eng = (_t0 => _t0 === 'tr' ? data.tr_sa : _t0 === 'trds' ? data.tr_ds : data.qb)(_currentDownloader) || {};
  const _aggSum = (f) => (data.qb?.[f] || 0) + (data.tr_sa?.[f] || 0) + (data.tr_ds?.[f] || 0);
  const _ov = document.getElementById('overviewRateText');
  if (_ov) _ov.textContent = '↓ ' + formatSpeed(_aggSum('agg_dl')) + ' · ↑ ' + formatSpeed(_aggSum('agg_up'));
  const _d = document.getElementById('aggRateDl');
  const _u = document.getElementById('aggRateUp');
  if (_d) _d.textContent = formatSpeed(_eng.agg_dl);
  if (_u) _u.textContent = formatSpeed(_eng.agg_up);
  const _dl = document.getElementById('dlLimitInput');
  const _up = document.getElementById('upLimitInput');
  if (_dl) _dl.value = _eng.dl_limit ? +_eng.dl_limit : 0;
  if (_up) _up.value = _eng.up_limit ? +_eng.up_limit : 0;
  // Render based on currently selected tab：只显示该引擎下有数据传输的活跃种子
  var _t = _currentDownloader;
  var _label = _t === 'tr' ? 'SA·TR' : _t === 'trds' ? 'DS·TR' : 'QB';
  var _torrents = (data.active || []).filter(t => t.engine === _label);
  // 活跃传输表格（transfersList）由 _renderTorrents 按 名称/状态/进度/速率/站点 表头渲染；
  // 此处不再用 6 列的 renderList 覆盖它（否则列错位）。仅渲染总览聚合（torrentList）
  const aggList = document.getElementById('torrentList');
  if (aggList) {
    const agg = data.active || [];
    aggList.innerHTML = renderList(agg, '聚合') || '<div style="text-align:center;padding:40px;opacity:0.6">暂无活跃种子</div>';
  }
  // 活跃传输表格随聚合刷新重渲染当前下载器（初次进入 / 轮询刷新后 transfersList 才会出现数据，
  // 否则只在点击 tab 或点排序时才渲染，导致 SA·QB 等首次进入显示为空）
  _renderTorrents(_currentDownloader);
}

var _consecutiveFailures = 0;
var _lastFailToast = 0;
var _lastTimeoutToast = 0;
var _fetchingAll = false; // 防重叠：上一轮聚合请求未完成时跳过本轮，避免服务器过载时并发堆积

async function fetchAllData() {
  if (_fetchingAll) return;
  _fetchingAll = true;
  // 仅拉当前用户有权限的端点，避免无权限请求刷屏
  var jobs = [];
  if (hasPerm('overview')) jobs.push(fetchStatus());
  if (hasPerm('transfers')) jobs.push(fetchTorrents());
  if (hasPerm('storage')) jobs.push(fetchStorage());
  if (hasPerm('media')) { jobs.push(fetchRecent()); jobs.push(fetchMediaStats()); }
  if (hasPerm('applications')) jobs.push(fetchApps());
  if (hasPerm('scripts')) jobs.push(fetchScripts());
  if (hasPerm('events')) jobs.push(fetchEvents());
  jobs.push(applyFeatureFlags());
  try {
    await Promise.all(jobs);
    if (_consecutiveFailures >= 3) {
      toast('连接已恢复', 'success');
    }
    _consecutiveFailures = 0;
    if (!window._nexusFirstLayout) {
      window._nexusFirstLayout = true;
      var _m0 = document.querySelector('.main');
      if (_m0) { _m0.scrollTop = 0; void _m0.offsetHeight; }
    }
  } catch (e) {
    _consecutiveFailures++;
    if (_consecutiveFailures === 3) {
      toast('服务器连续无响应，可能正在执行长时间任务（如站点搜索），请稍候…', 'error');
    } else if (_consecutiveFailures > 3 && Date.now() - _lastFailToast > 30000) {
      toast('服务器仍无响应（第' + _consecutiveFailures + '次），如持续异常请刷新页面', 'error');
      _lastFailToast = Date.now();
    }
  } finally {
    _fetchingAll = false;
  }
}

let allScripts = [];
let _scriptFilter = 'all';
async function fetchScripts() {
  try {
    const d = await fetchJSON(API.scripts);
    const el = document.getElementById('scriptList');
    if (!el) return;
    allScripts = (d && d.scripts) || [];
    renderScripts(_filteredScripts());
  } catch(e) {}
}
function _filteredScripts() {
  if (_scriptFilter === 'ok') return allScripts.filter(s => s.exit_code === 0);
  if (_scriptFilter === 'fail') return allScripts.filter(s => s.exit_code !== undefined && s.exit_code !== null && s.exit_code !== 0);
  if (_scriptFilter === 'never') return allScripts.filter(s => !s.last_run);
  return allScripts;
}
function _fmtSize(n) {
  if (!n && n !== 0) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
  return (n/1024/1024).toFixed(1) + ' MB';
}
function _fmtTime(ts) {
  if (!ts) return '从未运行';
  const d = new Date(ts * 1000);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return Math.floor(diff) + ' 秒前';
  if (diff < 3600) return Math.floor(diff/60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff/3600) + ' 小时前';
  return d.toLocaleString('zh-CN', {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
}
function renderScripts(scripts) {
  const el = document.getElementById('scriptList');
  if (!el) return;
  if (!scripts.length) { el.innerHTML = '<div style="padding:30px 20px;opacity:0.5;text-align:center;font-size:13px;">暂无脚本</div>'; return; }
  const canManage = hasPerm('scripts:manage');
  el.innerHTML = scripts.map((s, i) => {
    let statusHtml, statusColor;
    if (s.running) { statusHtml = '<span style="width:8px;height:8px;border-radius:50%;background:#FFD60A;box-shadow:0 0 6px rgba(255,214,10,0.6);display:inline-block;"></span>'; }
    else if (!s.last_run) { statusHtml = '<span style="width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.25);display:inline-block;"></span>'; }
    else if (s.exit_code === 0) { statusHtml = '<span style="width:8px;height:8px;border-radius:50%;background:#30D158;box-shadow:0 0 6px rgba(48,209,88,0.6);display:inline-block;"></span>'; }
    else { statusHtml = '<span style="width:8px;height:8px;border-radius:50%;background:#FF453A;box-shadow:0 0 6px rgba(255,69,58,0.6);display:inline-block;"></span>'; }
    const extIcon = s.ext === '.py' ? '🐍' : '📜';
    const expanded = s._expanded ? `
      <div style="margin:8px 0 4px 28px;padding:10px;border-radius:8px;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.06);font-family:monospace;font-size:11px;line-height:1.5;max-height:200px;overflow:auto;white-space:pre-wrap;color:rgba(255,255,255,0.8);">${esc(s.output_tail || '')}${s.error_tail ? '\n[stderr]\n' + esc(s.error_tail) : ''}${(!s.output_tail && !s.error_tail) ? '(无输出)' : ''}</div>` : '';
    const manageBtns = canManage ? `
      <button onclick='openScriptEditor(${JSON.stringify(s.name)})' style="flex:0 0 auto;padding:5px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.07);color:#fff;font-size:11px;cursor:pointer;">✏️ 编辑</button>
      <button onclick='deleteScript(${JSON.stringify(s.name)})' style="flex:0 0 auto;padding:5px 10px;border-radius:8px;border:1px solid rgba(255,69,58,0.4);background:rgba(255,69,58,0.12);color:#FF6961;font-size:11px;cursor:pointer;">🗑 删除</button>` : '';
    return `
    <div class="script-row">
      <div class="script-row-main">
        <span style="flex:0 0 auto;">${statusHtml}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:#fff;">${extIcon} ${esc(s.name)}${s.running ? ' <span style="font-size:10px;color:#FFD60A;font-weight:400;">(运行中)</span>' : ''}${s.executable ? '' : ' <span style="font-size:10px;opacity:0.4;font-weight:400;">(不可执行)</span>'}</div>
          <div style="font-size:11px;opacity:0.45;margin-top:2px;">${_fmtSize(s.size)} · 修改于 ${new Date(s.mtime*1000).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}${s.shebang ? ' · ' + esc(s.shebang.replace('#!','')) : ''}</div>
        </div>
        <div class="script-meta-time">
          <div>${_fmtTime(s.last_run)}</div>
          ${s.last_run ? `<div style="font-size:10px;opacity:0.7;">退出码 ${s.exit_code} · ${s.duration}s</div>` : ''}
        </div>
      </div>
      <div class="script-actions">
        <button onclick="toggleScriptExpand(${i})" style="flex:0 0 auto;padding:5px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:#fff;font-size:11px;cursor:pointer;">${s._expanded ? '收起' : '详情'}</button>
        ${manageBtns}
        <button onclick='runScript(${JSON.stringify(s.name)})' id="runBtn_${i}" style="flex:0 0 auto;padding:5px 12px;border-radius:8px;border:1px solid rgba(10,132,255,0.4);background:rgba(10,132,255,0.18);color:#7AB8FF;font-size:11px;cursor:pointer;font-weight:600;">▶ 运行</button>
      </div>
      ${expanded}
    </div>`;
  }).join('');
}
function toggleScriptExpand(i) {
  const arr = _filteredScripts();
  if (arr[i]) { arr[i]._expanded = !arr[i]._expanded; renderScripts(arr); }
}
async function runScript(name) {
  try {
    const d = await apiPost(API.scriptsRun, { name: name });
    if (!d) { toast('运行脚本失败：无权限或未登录', 'error'); return; }
    toast(d.ok ? `${name} 运行成功（退出码 ${d.exit_code}，${d.duration}s）` : `${name} 运行失败（退出码 ${d.exit_code}）`, d.ok ? 'success' : 'error');
    fetchScripts();
  } catch(e) {
    toast('运行脚本失败: ' + e.message, 'error');
  }
}

// ========== 脚本编辑器（任务15：查看/新建/编辑/删除）==========
let _scriptEditorModal = null;
function _ensureScriptEditor() {
  if (_scriptEditorModal) return _scriptEditorModal;
  _scriptEditorModal = document.createElement('div');
  _scriptEditorModal.id = 'scriptEditorModal';
  _scriptEditorModal.className = 'script-editor-overlay';
  _scriptEditorModal.onclick = (e) => { if (e.target === _scriptEditorModal) closeScriptEditorSafe(); };
  document.body.appendChild(_scriptEditorModal);
  return _scriptEditorModal;
}
async function openScriptEditor(name) {
  const modal = _ensureScriptEditor();
  modal.style.display = 'flex';
  window._scriptInit = name ? null : ''; // 编辑脚本加载完成后回填；null=尚未加载完成
  const isNew = !name;
  modal.innerHTML = `
    <div class="script-editor-panel">
      <div class="script-editor-head">
        <div class="script-editor-title">${isNew ? '➕ 新建脚本' : `✏️ 编辑 ${esc(name)}`}</div>
        <button class="script-editor-close" onclick="closeScriptEditorSafe()">✕</button>
      </div>
      <div class="script-editor-form">
        <div class="script-editor-row">
          <label>文件名</label>
          <input class="script-editor-name" id="scriptEditorName" placeholder="如 my_script.py / my_task.sh" ${isNew ? '' : `value="${esc(name)}" readonly style="opacity:0.6;"`}>
        </div>
        <div class="script-editor-hint">仅支持 .py / .sh / .bash 后缀，保存在服务端脚本目录</div>
      </div>
      <div class="script-editor-body">
        <textarea class="script-editor-ta" id="scriptEditorContent" placeholder="# 在此输入脚本内容…" spellcheck="false">${isNew ? '' : '加载中…'}</textarea>
      </div>
      <div class="script-editor-foot">
        <button class="script-editor-btn script-editor-btn-ghost" onclick="closeScriptEditorSafe()">取消</button>
        <button class="script-editor-btn script-editor-btn-primary" id="scriptEditorSaveBtn" onclick="saveScriptEditor()">保存</button>
      </div>
    </div>`;
  if (!isNew) {
    const btn = document.getElementById('scriptEditorSaveBtn');
    if (btn) btn.disabled = true;
    try {
      const d = await fetchJSON('/scripts/read?name=' + encodeURIComponent(name), 15000);
      const ta = document.getElementById('scriptEditorContent');
      if (!ta) return;
      if (d && d.ok) {
        ta.value = d.content || '';
        window._scriptInit = ta.value;
        ta.placeholder = '';
      } else {
        ta.value = '';
        window._scriptInit = '';
        ta.placeholder = '读取失败: ' + ((d && d.error) || '未知错误');
      }
    } catch(e) {
      const ta = document.getElementById('scriptEditorContent');
      if (ta) { ta.value = ''; ta.placeholder = '读取失败: ' + e.message; }
    } finally {
      if (btn) btn.disabled = false;
    }
  }
}
function closeScriptEditor() {
  if (_scriptEditorModal) _scriptEditorModal.style.display = 'none';
}
function closeScriptEditorSafe() {
  const ta = document.getElementById('scriptEditorContent');
  if (ta && window._scriptInit !== null && ta.value !== window._scriptInit && !confirm('有未保存的脚本修改，确定放弃并关闭？')) return;
  closeScriptEditor();
}
async function saveScriptEditor() {
  const nameEl = document.getElementById('scriptEditorName');
  const ta = document.getElementById('scriptEditorContent');
  const btn = document.getElementById('scriptEditorSaveBtn');
  const name = (nameEl && nameEl.value || '').trim();
  const content = ta ? ta.value : '';
  if (!name) { toast('请输入文件名', 'error'); return; }
  if (btn) btn.disabled = true;
  try {
    const d = await apiPost(API.scriptsSave, { name: name, content: content });
    if (d && d.ok) {
      toast(`脚本 ${name} 已保存`, 'success');
      window._scriptInit = content; // 保存后不再视为未保存改动
      closeScriptEditor();
      fetchScripts();
    } else {
      toast('保存失败: ' + ((d && d.error) || '未知错误'), 'error');
    }
  } catch(e) {
    toast('保存失败: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}
async function deleteScript(name) {
  if (!name) return;
  if (!confirm(`确定删除脚本「${name}」？\n此操作不可恢复。`)) return;
  try {
    const d = await apiPost(API.scriptsDelete, { name: name });
    if (d && d.ok) {
      toast(`脚本 ${name} 已删除`, 'success');
      fetchScripts();
    } else {
      toast('删除失败: ' + ((d && d.error) || '未知错误'), 'error');
    }
  } catch(e) {
    toast('删除失败: ' + e.message, 'error');
  }
}
function filterScripts(type) {
  _scriptFilter = type;
  document.querySelectorAll('.script-filter-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.filter === type);
  });
  renderScripts(_filteredScripts());
}

async function fetchEvents() {
  try {
    const d = await fetchJSON('/events');
    if (!d) return; // 401/403 已由 fetchJSON 静默处理
    const el = document.getElementById('eventList');
    if (!el) return;
    el.innerHTML = (d.events || []).map(ev => {
      const dt = ev.date || '';
      const shown = /^\d{4}-\d{2}-\d{2}/.test(dt) ? dt.substring(0, 16) : dt;
      return `
      <div class="event-row">
        <div class="event-time" style="white-space:nowrap;font-size:12px;">${shown}</div>
        <div class="event-text">${esc(ev.title)} <span style="opacity:0.4;font-size:12px;margin-left:6px;">${esc(ev.category || ev.type || '')}</span></div>
        <div class="event-tag success">入库</div>
      </div>`;
    }).join('') || '<div style="padding:20px;opacity:0.5;">暂无活动记录</div>';
  } catch(e) {}
}

// ========== 日志中心查看器（系统运行 + 媒体事件 + 服务容器日志） ==========
var _logLevel = 'ALL';
var _logSource = 'all';   // all | system | <service>
var _logSearch = '';
var _logSrcMeta = {};     // source -> {size, mtime}
var _logAuto = true;
function _lvColor(lv) {
  if (lv === 'ERROR' || lv === 'CRITICAL') return { c: '#FF453A', b: 'rgba(255,69,58,0.16)' };
  if (lv === 'WARN') return { c: '#f59e0b', b: 'rgba(245,158,11,0.16)' };
  return { c: '#64D2FF', b: 'rgba(100,210,255,0.14)' };
}
function _lvLabel(lv) { return lv === 'CRITICAL' ? 'CRIT' : lv; }
function _srcColor(src) {
  // 来源 badge 按名称散列取色，稳定区分
  let h = 0;
  const s = String(src || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h},55%,62%)`;
}
async function loadLogSources() {
  const d = await fetchJSON('/logs/sources');
  if (!d || !d.sources) return;
  const sel = document.getElementById('logSourceSel');
  if (!sel) return;
  const svc = d.sources;
  _logSrcMeta = {};
  svc.forEach(function(x) { _logSrcMeta[x.source] = x; });
  const cur = _logSource;
  sel.innerHTML = '<option value="system">系统运行</option><option value="all">全部来源</option>';
  svc.forEach(function(x) {
    const o = document.createElement('option');
    o.value = x.source;
    o.textContent = x.source;
    sel.appendChild(o);
  });
  sel.value = _logSrcMeta[cur] ? cur : (cur === 'system' || cur === 'all' ? cur : 'all');
  // 来源状态条
  const bar = document.getElementById('logSrcBar');
  if (bar) {
    bar.innerHTML = '<span style="font-size:11px;color:rgba(255,255,255,0.35);">服务日志源（NAS 每 5 分钟导出）：</span>' +
      svc.map(function(x) {
        const kb = (x.size / 1024).toFixed(0);
        const mt = x.mtime ? new Date(x.mtime * 1000).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
        return `<span title="最近导出 ${mt}，${kb} KB" style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:999px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);font-size:11px;color:rgba(255,255,255,0.75);">
          <span style="width:6px;height:6px;border-radius:50%;background:${_srcColor(x.source)};"></span>${esc(x.source)}<span style="color:rgba(255,255,255,0.3);">${kb}K</span></span>`;
      }).join('');
  }
}
async function loadRunLogs() {
  const el = document.getElementById('runLogList');
  if (!el) return;
  _logSearch = (document.getElementById('logSearchInp') ? document.getElementById('logSearchInp').value : '').trim();
  let url = '/logs?level=' + encodeURIComponent(_logLevel) + '&limit=300';
  if (_logSearch) url += '&search=' + encodeURIComponent(_logSearch);
  if (_logSource === 'system') url += '&category=system';
  else if (_logSource !== 'all') url += '&category=service&source=' + encodeURIComponent(_logSource);
  const d = await fetchJSON(url);
  if (!d) return;
  const logs = d.logs || [];
  el.innerHTML = logs.map(lg => {
    const lv = lg.level || 'INFO';
    const lc = _lvColor(lv);
    const src = lg.source || '-';
    return `
    <div style="display:grid;grid-template-columns:150px 70px 96px 1fr;gap:12px;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,0.05);align-items:baseline;font-size:12px;">
      <span style="color:rgba(255,255,255,0.4);white-space:nowrap;font-family:monospace;font-size:11px;">${esc(lg.ts || '')}</span>
      <span><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${lc.c};margin-right:5px;"></span><span style="color:${lc.c};font-weight:600;">${_lvLabel(lv)}</span></span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${_srcColor(src)};font-size:11px;font-weight:600;">${esc(src)}</span>
      <span style="color:rgba(255,255,255,0.82);word-break:break-all;">${esc(lg.msg || '')}</span>
    </div>`;
  }).join('') || '<div style="padding:20px;opacity:0.5;font-size:12px;">暂无日志</div>';
}
function setLogSource(v) { _logSource = v; loadRunLogs(); }
function toggleLogAuto(on) { _logAuto = !!on; }
function exportLogs() {
  const rows = Array.from(document.querySelectorAll('#runLogList > div')).map(function(div) {
    const cells = Array.from(div.querySelectorAll('span')).map(function(s) { return s.textContent; });
    return cells.join(' | ');
  }).join('\n');
  if (!rows) { alert('当前无日志可导出'); return; }
  const blob = new Blob([new Date().toLocaleString('zh-CN') + '\n' + rows], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nexus_logs_' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}
async function clearRunLogs() {
  if (!confirm('确认清空全部系统运行日志？（内存与 /data/nexus.log 都会清空，服务日志导出不受影响）')) return;
  await fetch(API_BASE + '/logs?clear=1', {
    method: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('nexus_token') || '') }
  });
  loadRunLogs();
}
document.addEventListener('click', function(e) {
  const lvBtn = e.target.closest ? e.target.closest('.log-level') : null;
  if (!lvBtn) return;
  _logLevel = lvBtn.getAttribute('data-lv');
  document.querySelectorAll('.log-level').forEach(b => {
    const active = b.getAttribute('data-lv') === _logLevel;
    b.style.background = active ? 'rgba(100,210,255,0.16)' : 'rgba(255,255,255,0.06)';
    b.style.color = active ? '#64D2FF' : 'rgba(255,255,255,0.7)';
    b.style.fontWeight = active ? '600' : '400';
  });
  loadRunLogs();
});
setInterval(function() {
  const pg = document.getElementById('page-events');
  if (pg && pg.classList.contains('active') && _logAuto) loadRunLogs();
}, 15000);

// ========== 登录门禁 ==========
var _authed = false;
var _currentUser = null; // {username, role, permissions, is_admin, rbac_enabled}
const PERM_TREE = [
  { key: 'overview', label: '总览', subs: [{ key: 'view', label: '查看总览' }] },
  { key: 'applications', label: '服务', subs: [{ key: 'view', label: '查看状态' }, { key: 'config', label: '修改服务配置' }] },
  { key: 'media', label: '媒体库', subs: [{ key: 'view', label: '查看媒体库' }, { key: 'detail', label: '查看详情' }] },
  { key: 'search', label: '搜索', subs: [{ key: 'all', label: '全部来源' }, { key: 'bing', label: 'Bing' }, { key: 'pansou', label: '网盘' }, { key: 'tmdb', label: 'TMDB' }, { key: 'douban', label: '豆瓣' }] },
  { key: 'trending', label: '流行趋势', subs: [{ key: 'view', label: '查看' }] },
  { key: 'transfers', label: '下载活动', subs: [{ key: 'view', label: '查看任务' }, { key: 'limit', label: '设置限速' }, { key: 'manage', label: '管理下载' }] },
  { key: 'storage', label: '存储', subs: [{ key: 'view', label: '查看容量' }] },
  { key: 'scripts', label: '脚本', subs: [{ key: 'view', label: '查看' }, { key: 'run', label: '运行' }, { key: 'manage', label: '管理（新建/编辑/删除）' }] },
  { key: 'events', label: '日志中心', subs: [{ key: 'view', label: '查看' }] },
  { key: 'settings', label: '设置', subs: [{ key: 'view', label: '查看设置' }, { key: 'manage', label: '修改配置' }, { key: 'rbac', label: '管理权限' }] },
];
const ALL_PAGES = PERM_TREE.map(function(t) { return t.key; });
const PERM_LABELS = {};
PERM_TREE.forEach(function(t) { PERM_LABELS[t.key] = t.label; });

// —— iOS 安全滚动锁：遮罩/弹层打开时锁定下层滚动（touchmove 只在弹层外 preventDefault，弹层内部仍可滚动）——
var _scrollLocks = 0;
function lockScroll() {
  _scrollLocks++;
  document.body.style.overflow = 'hidden';
  document.body.style.overscrollBehavior = 'none';
  if (!document.body._nexusTmd) {
    document.body._nexusTmd = function(e) {
      var m = document.getElementById('detailModal');
      var l = document.getElementById('loginOverlay');
      var f = document.getElementById('flipModal');
      var fs = document.getElementById('flipSearchModal');
      var inside = (m && m.style.display !== 'none' && m.contains(e.target)) ||
                   (l && l.style.display !== 'none' && l.contains(e.target)) ||
                   (f && f.style.display !== 'none' && f.contains(e.target)) ||
                   (fs && fs.style.display !== 'none' && fs.contains(e.target));
      if (!inside) { e.preventDefault(); return; }
      // 弹层内部允许自由滚动；下层滚动已由 body overflow:hidden + overscroll-behavior:none 阻断
    };
    document.addEventListener('touchmove', document.body._nexusTmd, { passive: false });
  }
}
function unlockScroll() {
  _scrollLocks = Math.max(0, _scrollLocks - 1);
  if (_scrollLocks === 0) {
    document.body.style.overflow = '';
    document.body.style.overscrollBehavior = '';
    if (document.body._nexusTmd) {
      document.removeEventListener('touchmove', document.body._nexusTmd);
      document.body._nexusTmd = null;
    }
  }
}
function showLogin() {
  _authed = false;
  var el = document.getElementById('loginOverlay');
  el.style.display = 'flex';
  lockScroll();
  document.getElementById('loginError').textContent = '';
  setTimeout(function() { document.getElementById('loginUser').focus(); }, 100);
}

function hideLogin() {
  _authed = true;
  document.getElementById('loginOverlay').style.display = 'none';
  unlockScroll();
}

// 按当前用户权限隐藏无权限页面入口；perm 可为 'page' 或 'page:sub'
function hasPerm(p) {
  var perms = (_currentUser && _currentUser.permissions) || [];
  if (perms.length === 0) return true; // 全放开
  if (perms.indexOf(p) >= 0) return true;
  var page = p.split(':')[0];
  if (perms.indexOf(page) >= 0) return true; // 大类=全子权限
  if (p.indexOf(':') < 0) return perms.some(function(x) { return x.indexOf(page + ':') === 0; }); // 页面级=有任一子权限
  return false;
}
function applyPermissions() {
  var perms = (_currentUser && _currentUser.permissions) || [];
  var has = function(p) { return hasPerm(p); };
  // 兼容旧后端（未返回权限数组）：视为全开
  var unlocked = perms.length === 0;
  var hidden = {};
  ALL_PAGES.forEach(function(p) { hidden[p] = !unlocked && !has(p); });
  document.querySelectorAll('.nav-link[data-page]').forEach(function(l) {
    l.style.display = hidden[l.dataset.page] ? 'none' : '';
  });
  document.querySelectorAll('.mobile-tabbar .tab[data-page]').forEach(function(t) {
    t.style.display = hidden[t.dataset.page] ? 'none' : '';
  });
  document.querySelectorAll('.more-item[data-page]').forEach(function(m) {
    m.style.display = hidden[m.dataset.page] ? 'none' : '';
  });
  // 脚本管理按钮（新建）仅 scripts:manage 可见；行内编辑/删除按钮由 renderScripts 内按权限控制
  var newScriptBtn = document.getElementById('newScriptBtn');
  if (newScriptBtn) newScriptBtn.style.display = (unlocked || has('scripts:manage')) ? '' : 'none';
  // 若当前激活页无权限，切到首个有权限页
  var cur = document.querySelector('.page.active');
  if (cur) {
    var cp = cur.id.replace('page-', '');
    if (hidden[cp]) {
      var fallback = ALL_PAGES.find(function(p) { return !hidden[p]; }) || 'overview';
      switchPage(fallback);
    }
  }
  // RBAC 管理卡片仅管理员可见（且需在「权限与安全」tab 下）
  var rbacCard = document.getElementById('rbacCard');
  if (rbacCard) {
    var at = document.querySelector('#setTabs .set-tab.active');
    rbacCard.style.display = (_currentUser && _currentUser.is_admin && at && at.dataset.tab === 'auth') ? '' : 'none';
  }
}

async function doLogin() {
  var u = document.getElementById('loginUser').value.trim();
  var p = document.getElementById('loginPass').value;
  if (!u || !p) {
    document.getElementById('loginError').textContent = '请输入用户名和密码';
    return;
  }
  try {
    var r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    });
    var d = await r.json();
    if (d.ok && d.token) {
      localStorage.setItem('nexus_token', d.token);
      _currentUser = { username: d.username, role: d.role, permissions: d.permissions || [], is_admin: !!d.is_admin, rbac_enabled: d.rbac_enabled !== false };
      hideLogin();
      applyPermissions();
      fetchAllData();
      initGreetingSub();
    } else {
      document.getElementById('loginError').textContent = d.error || '登录失败';
    }
  } catch (e) {
    document.getElementById('loginError').textContent = '网络错误';
  }
}

async function checkAuth() {
  var token = localStorage.getItem('nexus_token');
  if (!token) { showLogin(); return false; }
  try {
    var r = await fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + token } });
    if (r.ok) {
      var d = await r.json();
      _currentUser = { username: d.username, role: d.role, permissions: d.permissions || [], is_admin: !!d.is_admin, rbac_enabled: !!d.rbac_enabled };
      hideLogin();
      applyPermissions();
      return true;
    }
  } catch(e) {}
  showLogin();
  return false;
}

// ========== 初始化 ==========
updateGreeting();
initGreetingSub();
checkAuth().then(function(ok) {
  if (ok) {
    if (hasPerm('media')) initSlideshow();
    initGreetingSub();
    fetchAllData();
    loadIncoming();   // 初始化未读角标（红点）
  }
});
setInterval(function() { if (_authed) fetchAllData(); }, 5000);

// ========== 详情页 ==========
function openHeroDetail() {
  const slide = CONFIG.slides && CONFIG.slides[currentSlide];
  if (!slide) return;
  // 媒体库源 → 影视详情页；外部平台源(TMDB/豆瓣等) → 豆瓣热门 flow 翻转卡片
  if (slide.source === 'external') {
    openTrendDetail(
      slide.title, '', slide.poster, slide.overview,
      slide.genre === '剧集' ? 'tv' : 'movie', slide.rating, slide.year, slide.genres, ''
    );
    return;
  }
  if (slide.id) openDetail(slide.id);
}
function openDetail(id) {
  let modal = document.getElementById('detailModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'detailModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(6,6,12,0.97);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;display:none;';
    modal.onclick = (e) => { if (e.target === modal) closeDetail(); };
    document.body.appendChild(modal);
  }
  modal.style.display = 'block';
  // 详情页打开时隐藏吸底 Tabbar（防止浮层滚动时 Tabbar 悬浮干扰 / 视觉穿透）
  const tb = document.querySelector('.mobile-tabbar');
  if (tb) tb.style.display = 'none';
  lockScroll();
  modal.innerHTML = '<div class="loading-block" style="height:60vh;"><div class="spinner spinner-lg"></div></div>';
  fetchJSON('/detail/' + id).then(d => {
    if (!d || d.error) { modal.innerHTML = '<div style="text-align:center;padding:60px;color:rgba(255,255,255,0.5);">加载失败，请重试</div>'; toast('详情加载失败', 'error'); return; }
    const backdrop = d.backdrop ? `background-image:url('${imgProxy(d.backdrop)}');` : 'background:rgba(20,20,30,1);';
    const genres = (d.genres || []).map(g => `<span style="display:inline-block;white-space:nowrap;background:rgba(255,255,255,0.1);padding:3px 10px;border-radius:14px;font-size:11px;margin:2px;">${esc(g)}</span>`).join('');
    const directors = d.directors || [];
    const writers = d.writers || [];
    const actors = (d.actors || []).slice(0, 10).map(a => {
      const initial = (a.name || '?').charAt(0);
      return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px;min-width:72px;">
        <div style="width:60px;height:60px;border-radius:50%;overflow:hidden;background:rgba(255,255,255,0.08);border:2px solid rgba(255,255,255,0.1);">
          ${a.image ? `<img src="${imgProxy(a.image)}" onerror="this.parentNode.innerHTML='<div style=&quot;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:rgba(255,255,255,0.4);background:rgba(255,255,255,0.05);&quot;>${esc(initial)}</div>'" style="width:100%;height:100%;object-fit:cover;">` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:rgba(255,255,255,0.4);background:rgba(255,255,255,0.05);">${esc(initial)}</div>`}
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,0.8);text-align:center;font-weight:600;">${esc(a.nameZh || a.name)}</div>
        ${a.nameZh && a.nameZh !== a.name ? `<div style="font-size:9px;color:rgba(255,255,255,0.4);text-align:center;">${esc(a.name)}</div>` : ''}
        <div style="font-size:10px;color:rgba(255,255,255,0.35);text-align:center;">${esc(a.role || '演员')}</div>
      </div>`;
    }).join('');

    // 三列演职员网格
    const crewCols = [];
    if (d.producers && d.producers.length) crewCols.push({ label: '制片', names: d.producers });
    if (writers.length) crewCols.push({ label: '编剧', names: writers });
    if (directors.length) crewCols.push({ label: '导演', names: directors });
    if (d.editors && d.editors.length) crewCols.push({ label: '剪辑', names: d.editors });
    // 幕后人员：每个职位一组，名字横向排列可横向滚动（与演员阵容一致的横向展示逻辑）
    const crewHtml = crewCols.length ? `<div style="margin-bottom:24px;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:20px;">${crewCols.map(c => `
      <div>
        <div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">${c.label}</div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start;">
          ${c.names.map(n => { const _d = personName(n); return `<span style="font-size:13px;color:rgba(255,255,255,0.85);background:rgba(255,255,255,0.08);padding:5px 12px;border-radius:999px;white-space:nowrap;">${esc(_d)}</span>`; }).join('')}
        </div>
      </div>
    `).join('')}</div>` : '';

    // 右侧元信息表（按用户"图2"字段清单顺序：ID/原始标题/状态/上映日期/数字发行/原始语言/出品国家/制作公司）
    const metaRows = [];
    if (d.tmdbId) metaRows.push(['TMDB ID', d.tmdbId]);
    if (d.imdbId) metaRows.push(['IMDB ID', d.imdbId]);
    if (!d.tmdbId && !d.imdbId && d.id) metaRows.push(['ID', d.id]);
    metaRows.push(['原始标题', d.originalTitle]);
    metaRows.push(['状态', d.status]);
    metaRows.push(['上映日期', d.premiereDate]);
    metaRows.push(['原始语言', d.originalLanguage]);
    metaRows.push(['出品国家', d.productionCountry]);
    if (d.officialName && d.officialName !== d.name) metaRows.push(['别名', d.officialName]);
    if (d.studios && d.studios.length) metaRows.push(['制作公司', d.studios.join(', ')]);
    if (d.fileName) metaRows.push(['文件名称', d.fileName]);
    metaRows.push(['文件路径', d.path || '—']);
    if (d.type === 'Series' || d.seriesCount) {
      metaRows.push(['总季数', String(d.seriesCount || '-')]);
      metaRows.push(['总集数', String(d.episodeCount || '-')]);
      if (d.episodeRunTime) metaRows.push(['单集时长', d.episodeRunTime + ' 分']);
    }
    const metaHtml = metaRows.filter(r => r[0] === '文件路径' || r[1]).map(r => `
      <div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
        <span style="font-size:12px;color:rgba(255,255,255,0.4);white-space:nowrap;">${r[0]}</span>
        <span style="font-size:12px;text-align:right;color:rgba(255,255,255,0.85);">${esc(r[1])}</span>
      </div>`).join('');

    // 四个操作按钮（搜资源 / 字幕 / 订阅 / 收藏）——收藏按钮与订阅按钮同款样式（白底黑字），已收藏仅星形填充变黄
    var _isFav = (_favs || []).some(function(f) { return String(f.id) === String(d.id); });
    var _favFill = _isFav ? '#FFD60A' : 'none';
    var _favLabel = _isFav ? '已收藏' : '收藏';
    const _sIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    const _cIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    const _hIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    const _starIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="' + _favFill + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    const actionBtns = `
      <div class="detail-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px;">
        <button onclick="if(window.flipSearch) flipSearch('${esc(d.name).replace(/'/g,"\\'")}')" style="display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:7px 14px;border-radius:999px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;">${_sIcon} 搜索</button>
        <button onclick="if(window.flipSearch) flipSearch('${esc(d.name).replace(/'/g,"\\'")}')" style="display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:999px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;">${_cIcon} 字幕</button>
        <button onclick="if(window.flipSubscribe) flipSubscribe(this,'${esc(d.name).replace(/'/g,"\\'")}','${d.type==='Series'?'tv':'movie'}','${esc(d.year||'')}','${esc(d.poster||d.backdrop||'')}','${esc(d.rating||'')}','${esc((d.overview||'').replace(/'/g,"\\'"))}')" style="display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:999px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;">${_hIcon} 订阅</button>
        <button data-favbtn onclick="toggleFav({id:'${esc(d.id)}',type:${d.type === 'Series' ? '"Series"' : '"Movie"'},title:'${esc(d.name)}',year:'${esc(d.year || '')}',poster:'${esc(d.poster || d.backdrop || '')}',rating:'${esc(d.rating || '')}'})" style="display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:999px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;">${_starIcon} <span class="fav-label">${_favLabel}</span></button>
      </div>`;

    modal.innerHTML = `
      <!-- 固定背景：顶部清晰海报沉浸感，往下渐变到模糊玻璃 -->
      <div class="detail-bg" style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:0;overflow:hidden;pointer-events:none;">
        <!-- 底层：模糊玻璃（铺满全屏，滚动区看到的就是这个） -->
        <div style="position:absolute;inset:0;background:url('${imgProxy(d.poster || d.backdrop)}') center 30% / cover no-repeat;transform:scale(1.08);filter:blur(30px) saturate(1.2) brightness(0.7);"></div>
        <!-- 顶层：清晰海报，只覆盖顶部约45vh（标题区），往下渐变淡出 -->
        <div style="position:absolute;top:0;left:0;right:0;height:45vh;background:url('${imgProxy(d.poster || d.backdrop)}') center 30% / cover no-repeat;-webkit-mask-image:linear-gradient(180deg,rgba(0,0,0,1) 0%,rgba(0,0,0,0.9) 50%,rgba(0,0,0,0.4) 75%,rgba(0,0,0,0) 100%);mask-image:linear-gradient(180deg,rgba(0,0,0,1) 0%,rgba(0,0,0,0.9) 50%,rgba(0,0,0,0.4) 75%,rgba(0,0,0,0) 100%);"></div>
        <!-- 暗化渐变 -->
        <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(6,6,12,0.25) 0%,rgba(6,6,12,0.45) 40%,rgba(6,6,12,0.82) 100%);"></div>
      </div>
      <!-- 固定高度容器：100vh，顶部信息固定，中间内容区独立滚动 -->
      <div style="position:relative;z-index:1;height:100vh;overflow:hidden;display:flex;flex-direction:column;">
        <button onclick="closeDetail()" class="detail-close" style="position:fixed;right:20px;z-index:20;background:rgba(0,0,0,0.4);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.15);color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:16px;">✕</button>
        <!-- 顶部标题区（固定不滚，在清晰海报区上） -->
        <div class="detail-top" style="max-width:1100px;width:100%;margin:0 auto;padding:0 24px;padding-top:calc(env(safe-area-inset-top, 0px) + 130px);display:flex;gap:24px;align-items:flex-end;flex-shrink:0;">
            ${d.poster ? `<div style="position:relative;flex-shrink:0;"><img src="${imgProxy(d.poster)}" style="width:110px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.2);">${d.inLibrary ? '<span style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:10px;font-weight:600;background:rgba(48,209,88,0.85);color:#fff;padding:2px 8px;border-radius:4px;">✅ 已入库</span>' : ''}</div>` : ''}
            <div style="padding-bottom:4px;flex:1;">
              ${d.logo
                ? `<div style="display:flex;align-items:flex-end;gap:12px;margin-bottom:8px;flex-wrap:wrap;">
                <img src="${imgProxy(d.logo)}" alt="${esc(d.name)}" style="max-width:240px;max-height:68px;width:auto;height:auto;object-fit:contain;filter:drop-shadow(0 2px 10px rgba(0,0,0,0.5));" onerror="this.style.display='none';">
                <h1 style="font-size:24px;font-weight:800;margin:0;opacity:0.7;text-shadow:0 1px 4px rgba(0,0,0,0.3);line-height:1.25;">${esc(d.name)}</h1>
              </div>`
                : `<h1 style="font-size:24px;font-weight:800;margin-bottom:8px;text-shadow:0 1px 4px rgba(0,0,0,0.3);line-height:1.25;">${esc(d.name)}</h1>`}
              <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-bottom:2px;line-height:1.7;">
                ${(d.type === 'Series' ? '剧集' : '电影')}${d.year ? ` · ${esc(d.year)}` : ''}${d.productionCountry ? ` · ${esc(d.productionCountry)}` : ''}${d.runtime ? ` · ${d.runtime} 分钟` : ''}
                ${(d.type === 'Series' || d.seriesCount) ? ` · ${d.seriesCount || '-'} 季 ${d.episodeCount || '-'} 集` : ''}
                ${genres ? genres : ''}
              </div>
              <!-- 评分位于片名标题模块最下方（fmtRating：整数补 .0，统一一位小数） -->
              ${d.rating ? `<div style="display:flex;align-items:center;gap:8px;margin-top:0;"><span style="color:#FFD60A;font-size:26px;font-weight:800;line-height:1;">★ ${fmtRating(d.rating)}</span><span style="font-size:12px;color:rgba(255,255,255,0.5);">/ 10</span></div>` : ''}
            </div>
          </div>
          <!-- 操作按钮（固定不滚）：宽度与顶部海报容器一致（1100px），按钮组左缘与海报左对齐 -->
          <div style="max-width:1100px;width:100%;margin:0 auto;padding:16px 24px 0;flex-shrink:0;">
            ${actionBtns}
          </div>
          <!-- 内容区：左滚动+右固定 -->
          <div style="flex:1;display:flex;min-height:0;">
          <div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;min-width:0;">
          <div style="max-width:800px;margin:0 auto;padding:8px 24px 80px;">
                <h3 style="font-size:13px;font-weight:700;margin:0 0 12px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:1px;">简介</h3>
                <p style="font-size:15px;line-height:1.8;color:rgba(255,255,255,0.78);margin-bottom:16px;text-indent:0;text-align:justify;">${esc(String(d.overview || '暂无简介').replace(/^[\s\u3000\u2002\u2003\u00a0]+/, ''))}</p>
                <!-- 外部源链接（统一组件 renderPlatformLinks，与 flip 卡背面共用实色胶囊） -->
                <div style="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap;">
                  ${renderPlatformLinks({ cls: 'plat-link', tmdbId: d.tmdbId, imdbId: d.imdbId, tvdbId: d.tvdbId, isTv: d.type === 'Series', doubanUrl: 'https://search.douban.com/movie/subject_search?search_text=' + encodeURIComponent(d.name) })}
                </div>
                ${crewHtml}
                ${actors ? `<h3 style="font-size:13px;font-weight:700;margin-bottom:16px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:1px;">演员阵容</h3><div style="display:flex;gap:16px;overflow-x:auto;flex-wrap:nowrap;padding-bottom:6px;-webkit-overflow-scrolling:touch;scrollbar-width:none;min-width:0;max-width:100%;">${actors}</div>` : ''}
                <div class="detail-side-mobile" style="margin-top:24px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px 20px;">
                  ${d.rating ? (function(){
                    var pct = Math.max(0, Math.min(100, (parseFloat(d.rating) / 10) * 100));
                    var W = 22, GAP = 3, totalW = W * 5 + GAP * 4;
                    var starPath = 'M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z';
                    function starRow(color) {
                      var svgs = '';
                      for (var i = 0; i < 5; i++) { svgs += '<svg x="' + (i*(W+GAP)) + '" y="0" width="' + W + '" height="' + W + '" viewBox="0 0 24 24" fill="' + color + '"><path d="' + starPath + '"/></svg>'; }
                      return '<svg width="' + totalW + '" height="' + W + '" viewBox="0 0 ' + totalW + ' ' + W + '">' + svgs + '</svg>';
                    }
                    return `<div style="text-align:center;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                      <div style="position:relative;display:inline-block;">
                        <div style="color:rgba(255,255,255,0.18);">${starRow('rgba(255,255,255,0.18)')}</div>
                        <div style="position:absolute;top:0;left:0;overflow:hidden;width:${pct}%;color:#FFD60A;">${starRow('#FFD60A')}</div>
                      </div>
                      <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:6px;">${d.rating} / 10</div>
                    </div>`;
                  })() : ''}
                  ${metaHtml}
                </div>
          </div>
          </div>
          <div style="width:280px;flex-shrink:0;padding:16px 24px 24px 0;display:none;" class="detail-side">
                <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px 20px;">
                  ${d.rating ? (function(){
                    // SVG 精确评分条：底层灰星，上层黄星按百分比裁剪
                    var pct = Math.max(0, Math.min(100, (parseFloat(d.rating) / 10) * 100));
                    var W = 22, GAP = 3; // 每颗星宽 + 间距
                    var totalW = W * 5 + GAP * 4;
                    var starPath = 'M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z';
                    function starRow(color) {
                      var svgs = '';
                      for (var i = 0; i < 5; i++) {
                        var x = i * (W + GAP);
                        svgs += '<svg x="' + x + '" y="0" width="' + W + '" height="' + W + '" viewBox="0 0 24 24" fill="' + color + '"><path d="' + starPath + '"/></svg>';
                      }
                      return '<svg width="' + totalW + '" height="' + W + '" viewBox="0 0 ' + totalW + ' ' + W + '">' + svgs + '</svg>';
                    }
                    return `<div style="text-align:center;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                      <div style="position:relative;display:inline-block;">
                        <div style="color:rgba(255,255,255,0.18);">${starRow('rgba(255,255,255,0.18)')}</div>
                        <div style="position:absolute;top:0;left:0;overflow:hidden;width:${pct}%;color:#FFD60A;">${starRow('#FFD60A')}</div>
                      </div>
                      <div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:6px;">${d.rating} / 10</div>
                    </div>`;
                  })() : ''}
                  ${metaHtml}
                </div>
          </div>
          </div><!-- /内容区 flex -->
        </div><!-- /内容容器 height:100vh flex column -->
    `;
    // modal 自身背景：纯深色兜底（背景层已在内容容器内 absolute 跟随滚动）
    modal.style.background = '#0a0a14';
  });
}
function closeDetail() {
  const m = document.getElementById('detailModal');
  if (m) m.style.display = 'none';
  // 恢复吸底 Tabbar
  const tb = document.querySelector('.mobile-tabbar');
  if (tb) tb.style.display = '';
  unlockScroll();
}
/* 设置页 tab 切换：按 data-tab 显隐分组卡片 */
function initSetTabs() {
  var tabs = document.getElementById('setTabs');
  if (!tabs) return;
  var cards = document.querySelectorAll('#page-settings .glass-card[data-tab]');
  function showTab(tab) {
    document.querySelectorAll('#setTabs .set-tab').forEach(function(x) { x.classList.toggle('active', x.dataset.tab === tab); });
    cards.forEach(function(c) { c.style.display = (c.dataset.tab === tab) ? '' : 'none'; });
    var rbac = document.getElementById('rbacCard');
    if (rbac && tab === 'auth') rbac.style.display = (_currentUser && _currentUser.is_admin) ? '' : 'none';
  }
  tabs.querySelectorAll('.set-tab').forEach(function(b) {
    b.addEventListener('click', function() { showTab(b.dataset.tab); });
  });
  try { renderDevTitleEditor(); } catch(e) {}
  showTab('base');
}
initSetTabs();

// —— 全局暴露（onclick/事件属性/跨块依赖兼容） ——
window.NEXUS = {};
window.doLogin = doLogin;
window.closeMoreDrawer = closeMoreDrawer;
window.toggleMsgCenter = toggleMsgCenter;
window.prevSlide = prevSlide;
window.nextSlide = nextSlide;
window.openHeroDetail = openHeroDetail;
window.switchPage = switchPage;
window.loadRunLogs = loadRunLogs;
window.loadLogSources = loadLogSources;
window.setLogSource = setLogSource;
window.toggleLogAuto = toggleLogAuto;
window.exportLogs = exportLogs;
window.clearRunLogs = clearRunLogs;
window.handleSearch = handleSearch;
window.showSearchResults = showSearchResults;
window.goMediaWall = goMediaWall;
window._searchComposing = _searchComposing;
window._searchComposingTimer = _searchComposingTimer;
window.switchDownloader = switchDownloader;
window.cancelLimitEdit = cancelLimitEdit;
window.applyLimit = applyLimit;
window.enterLimitEdit = enterLimitEdit;
window.filterScripts = filterScripts;
window.fetchScripts = fetchScripts;
window.openScriptEditor = openScriptEditor;
window.toggleFilterPanel = toggleFilterPanel;
window.clearChips = clearChips;
window.applyFilters = applyFilters;
window.togglePwd = togglePwd;
window.toggleAuthEdit = toggleAuthEdit;
window.toggleRbacEdit = toggleRbacEdit;
window.rbacAddRole = rbacAddRole;
window.cancelSvcEdit = cancelSvcEdit;
window.toggleSvcEdit = toggleSvcEdit;
window.markAllRead = markAllRead;
window.clearMsgCenter = clearMsgCenter;
window.esc = esc;
window.fmtRating = fmtRating;
window.personName = personName;
window.imgProxy = imgProxy;
window.toggleProto = toggleProto;
window.setProto = setProto;
window.toggleOnlineEdit = toggleOnlineEdit;
window.cancelOnlineEdit = cancelOnlineEdit;
window.addOnlineSrc = addOnlineSrc;
window.removeOnlineSrc = removeOnlineSrc;
window.setOnlineSrc = setOnlineSrc;
window.addSvc = addSvc;
window.toggleAddSvc = toggleAddSvc;
window.testSvc = testSvc;
window.removeBuiltinSvc = removeBuiltinSvc;
window.testExtSvc = testExtSvc;
window.testSvcC = testSvcC;
window.removeSvc = removeSvc;
window.rbacDelUser = rbacDelUser;
window.rbacDelRole = rbacDelRole;
window.rbacAddUserToRole = rbacAddUserToRole;
window.openTrendDetail = openTrendDetail;
window.renderPlatformLinks = renderPlatformLinks;
window._platIc = _platIc;
window.closeFlipModal = closeFlipModal;
window.setMediaType = setMediaType;
window.setMediaSort = setMediaSort;
window.setMediaSubType = setMediaSubType;
window.flipCard = flipCard;
window.openDetail = openDetail;
window.goToSlide = goToSlide;
window.setMediaType = setMediaType;
window.setMediaSort = setMediaSort;
window.setMediaSubType = setMediaSubType;
window.removeChip = removeChip;
window.openMsgThread = openMsgThread;
window.renderMsgList = renderMsgList;
window.execAction = execAction;
window.removeSubscription = removeSubscription;
window.togglePauseSub = togglePauseSub;
window.toggleScriptExpand = toggleScriptExpand;
window.closeScriptEditor = closeScriptEditor;
window.saveScriptEditor = saveScriptEditor;
window.alert = alert;
window.toggleFav = toggleFav;
window._torrentSortBy = _torrentSortBy;
window._homeTorrentSortBy = _homeTorrentSortBy;
window.removeFav = removeFav;
window.isFav = isFav;
window.closeDetail = closeDetail;
window.deleteScript = deleteScript;
window.runScript = runScript;
window.faviconLive = faviconLive;
window.svcTypeChanged = svcTypeChanged;
window.rbacTogglePage = rbacTogglePage;
if (typeof fetchJSON !== 'undefined') window.fetchJSON = fetchJSON;
if (typeof apiPost !== 'undefined') window.apiPost = apiPost;
if (typeof CONFIG !== 'undefined') window.CONFIG = CONFIG;
if (typeof _subscriptions !== 'undefined') window._subscriptions = _subscriptions;
if (typeof _subTmdbIds !== 'undefined') window._subTmdbIds = _subTmdbIds;
if (typeof _playHistory !== 'undefined') window._playHistory = _playHistory;
if (typeof _favs !== 'undefined') window._favs = _favs;
})();
;

window.addEventListener('scroll', function() {
  // 滚动时收起"更多"浮层，避免其与置顶按钮同时悬浮
  var _md = document.getElementById('moreDrawer');
  if (_md && _md.classList.contains('show')) closeMoreDrawer();
  var btn = document.getElementById('backToTop');
  if (window.scrollY > window.innerHeight * 0.8) {
    btn.style.display = 'flex';
  } else {
    btn.style.display = 'none';
  }
}, { passive: true });

// ========== 观影历程（抽卡 + 海报墙） ==========
function _japi(path, opts) {
  opts = opts || {};
  var h = { 'Authorization': 'Bearer ' + (localStorage.getItem('nexus_token') || '') };
  if (opts.body) h['Content-Type'] = 'application/json';
  return fetch(path, Object.assign({ headers: h }, opts)).then(function(r){ return r.json().catch(function(){ return {}; }); });
}
function _jtoast(msg) {
  var t = document.createElement('div'); t.className = 'jw-share-toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(function(){ t.remove(); }, 2200);
}
function loadJourney() {
  showJTab('draw');
  loadJDraw();
  loadJWall();
}
function showJTab(tab) {
  document.querySelectorAll('.journey-tab').forEach(function(b){ b.classList.toggle('active', b.dataset.jtab === tab); });
  var dv = document.getElementById('journeyDrawView'), wv = document.getElementById('journeyWallView');
  if (dv) dv.style.display = tab === 'draw' ? '' : 'none';
  if (wv) wv.style.display = tab === 'wall' ? '' : 'none';
}
document.querySelectorAll('.journey-tab').forEach(function(b){
  b.addEventListener('click', function(){ showJTab(b.dataset.jtab); if (b.dataset.jtab === 'wall') loadJWall(); });
});
async function loadJDraw() {
  var w = await _japi('/api/journey/wall');
  var s = document.getElementById('journeyDrawStatus');
  if (!s) return;
  var btn = document.getElementById('btnJourneyDraw');
  s.innerHTML = (w.can_claim ? '✅ 今日还可认领 1 张' : '⚠️ 今日已认领 1 张，明日再来') + ' · <span style="opacity:0.6">点卡片翻开，认领即入观影历程海报墙</span>';
  if (btn) { btn.disabled = !w.can_claim; btn.style.opacity = w.can_claim ? '1' : '0.45'; }
}
async function doDraw() {
  var box = document.getElementById('journeyDrawCards');
  var CARD_BACKS = ['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'];
  function todayCardBack(){var d=new Date();var doy=Math.floor((Date.now()-(new Date(d.getFullYear(),0,1)).getTime())/86400000);return CARD_BACKS[doy % CARD_BACKS.length];}
  var CARD_BACK=todayCardBack();
  if (!box) return;
  box.innerHTML = '<div class="journey-status">🎴 抽卡中…</div>';
  var p = await _japi('/api/journey/pick');
  if (!p.cards || !p.cards.length) { box.innerHTML = '<div class="journey-status">卡片池暂无更多可抽影片（已认领/已看完的被跳过）</div>'; return; }
  box.innerHTML = '';
  // 虚空黑洞：由里及外由大到小蹦出三张卡片
  if (!p || !Array.isArray(p.cards) || !p.cards.length) {
    _jtoast('暂无可用卡片，请稍后再试');
    return;
  }
  var hole = document.createElement('div');
  hole.className = 'jd-blackhole';
  box.appendChild(hole);
  setTimeout(function(){ if (hole.parentNode) hole.parentNode.removeChild(hole); }, 1250);
    // 抽卡数据补全：仅 tmdb 源卡并行查 /tmdb/detail 补时长/导演/演员/平台（media 卡已有 emby 信息，直接渲染，避免慢）；并行+6s超时，抽卡快速出卡
    await Promise.all(p.cards.map(function(c0){
      if (c0.source === 'media' || c0.source === 'auto') return Promise.resolve();
      return (async function(){
        try {
          var dr = await fetchJSON('/tmdb/detail?q=' + encodeURIComponent(c0.title || '') + '&type=' + (c0.type === 'series' ? 'tv' : 'movie'), 6000);
          var dd = (dr && dr.data) || {};
          if (dd && dd.name) {
            c0.runtime = dd.runtime || '';
            c0.productionCountry = dd.productionCountry || c0.region || '';
            c0.directors = dd.directors || [];
            c0.actors = dd.actors || [];
            c0.tmdbId = dd.tmdbId || '';
            c0.imdbId = dd.imdbId || '';
          }
        } catch (e) {}
      })();
    }));
  p.cards.forEach(function(c, i){
    var wrap = document.createElement('div');
    wrap.className = 'journey-draw-card';
    wrap.style.animationDelay = (i * 0.1) + 's';
    var genres = (c.genres && c.genres.length ? c.genres.join(' · ') : '');
    var itemStr = JSON.stringify(c).replace(/"/g, '&quot;');
    var pimg = c.image ? imgProxy(c.image) : '';
    // 正面：复用流行趋势翻转卡结构（img 裁切海报 + 渐变压暗 + 名称区 + 底部玻璃遮罩）
    var region = c.productionCountry || c.region || '';
    var metaParts = [(c.type === 'series' ? '剧集' : '电影'), (c.year || ''), region, (c.runtime ? c.runtime + ' 分钟' : '')].filter(Boolean);
    var meta = metaParts.join(' · ');
    var rate10 = c.rating ? esc(fmtRating(c.rating * 2)) : '';
    var front =
      '<div class="flip-front">' +
        (pimg ? '<img class="flip-front-poster" src="' + pimg + '" onerror="this.style.display=\'none\'">' : '<div class="flip-front-noposter">🎬</div>') +
        '<div class="flip-front-fade"></div>' +
        '<div class="flip-front-name"><div class="flip-front-name-title">' + esc(c.title || '') + '</div>' +
          (meta ? '<div class="flip-front-name-sub">' + esc(meta) + '</div>' : '') +
        '</div>' +
        '<div class="flip-front-glass">' +
          (rate10 ? '<div class="flip-front-rate"><span class="rb-star">★</span> ' + rate10 + '</div>' : '') +
          (genres ? '<div class="flip-front-gtype">' + esc(genres) + '</div>' : '') +
          '<div class="flip-front-hint">点击翻开</div>' +
        '</div>' +
      '</div>';
    var metaB = meta;
    var rate10B = rate10;
    var platHtml = renderPlatformLinks({ cls: 'flip-plat', tmdbId: c.tmdbId, imdbId: c.imdbId, tvdbId: c.tvdbId, isTv: c.type === 'series', doubanUrl: '' });
    platHtml = platHtml ? '<div class="flip-back-platforms">' + platHtml + '</div>' : '';
    var dirHtml = (c.directors && c.directors.length) ? '<div class="flip-sec-title">导演</div>' + c.directors.slice(0, 3).map(function(n){ return '<div class="flip-dir-name">' + esc(personName(n)) + '</div>'; }).join('') : '';
    var castHtml = (c.actors && c.actors.length) ? '<div class="flip-sec-title">演员</div><div class="flip-cast-row">' + c.actors.slice(0, 6).map(function(a){
      var hasImg = a.image && !a.image.endsWith('/w200');
      return '<div class="flip-actor">' +
        (hasImg ? '<img src="' + esc(a.image) + '" class="flip-actor-img" loading="lazy" onerror="this.style.display=\'none\'">' : '<div class="flip-actor-img flip-actor-ph"><span>' + esc((a.name || '?').charAt(0)) + '</span></div>') +
        '<div class="flip-actor-name">' + esc(a.name || '') + '</div>' +
        (a.role ? '<div class="flip-actor-role">' + esc(a.role) + '</div>' : '') +
      '</div>';
    }).join('') + '</div>' : '';
    var back =
      (pimg ? '<img class="flip-back-bg" src="' + pimg + '" onerror="this.style.display=\'none\'">' : '') +
      '<div class="flip-back-dim"></div>' +
      '<div class="flip-back-body">' +
        '<div class="flip-back-head">' +
          '<div class="flip-back-title">' + esc(c.title || '') + '</div>' +
          (metaB ? '<div class="flip-back-meta">' + esc(metaB) + '</div>' : '') +
          (rate10B ? '<div class="flip-back-rate-num">★ ' + rate10B + ' / 10</div>' : '') +
        '</div>' +
        (c.overview ? '<div class="flip-back-overview">' + esc(String(c.overview).slice(0, 150)) + '</div>' : '') +
        platHtml +
        dirHtml +
        castHtml +
        '<div class="journey-back-actions">' +
          '<button class="jbtn-claim" data-item="' + itemStr + '">认领</button>' +
          '<button class="jbtn-pass">放弃</button>' +
        '</div>' +
      '</div>';
    wrap.innerHTML =
      '<div class="jd-overlay"><div class="jd-overlay-bg" style="background:url(data:image/jpeg;base64,' + CARD_BACK + ') center/cover no-repeat;"></div></div>' +
      '<div class="flip-card-container"><div class="flip-card" style="width:100%;height:100%;">' +
        '<div class="flip-card-front">' + front + '</div>' +
        '<div class="flip-card-back">' + back + '</div>' +
      '</div></div>';
    // 点击遮罩（卡背）→ 燃烧消失 → 揭开可翻转的影视卡
    var ov = wrap.querySelector('.jd-overlay');
    ov.addEventListener('click', function(e){
      e.stopPropagation();
      if (ov.classList.contains('burning')) return;
      ov.classList.add('burning');
      ov.addEventListener('animationend', function(){ ov.style.display = 'none'; }, { once: true });
    });
    wrap.querySelector('.flip-card').addEventListener('click', function(e){
      // 点击背面按钮(认领/放弃)已 stopPropagation，不会触发翻转
      this.classList.toggle('flipped');
    });
    wrap.querySelector('.jbtn-claim').addEventListener('click', function(e){
      e.stopPropagation();
      var item = JSON.parse(this.getAttribute('data-item'));
      _japi('/api/journey/claim', { method: 'POST', body: JSON.stringify({ item: item }) }).then(function(r){
        if (r.error) _jtoast(r.error);
        else { _jtoast('🎉 已认领《' + item.title + '》入观影历程海报墙'); loadJDraw(); loadJWall(); doDrawSafe(); }
      });
    });
    wrap.querySelector('.jbtn-pass').addEventListener('click', function(e){ e.stopPropagation(); doDrawSafe(); });
    box.appendChild(wrap);
  });
}
async function doDrawSafe() {
  var btn = document.getElementById('btnJourneyDraw');
  if (btn) { if (btn.disabled) return; btn.disabled = true; btn.innerHTML = '<span class="jd-btn-spinner"></span>抽卡中…'; }
  try { await doDraw(); } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '🎃 抽一张<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:2px;"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>'; }
  }
}
var _btnJourneyDraw = document.getElementById('btnJourneyDraw');
if (_btnJourneyDraw) _btnJourneyDraw.addEventListener('click', doDrawSafe);
function renderJGroups(cards) {
  var bar = document.getElementById('journeyGroupBar');
  if (!bar) return;
  var groups = {};
  cards.forEach(function(c){ var g = ((c.group||'').trim()) || '未分组'; (groups[g] = groups[g] || []).push(c); });
  (window._jGroups || []).forEach(function(g){ if (!(g in groups)) groups[g] = []; });
  var cur = window._jGroup || 'all';
  var names = Object.keys(groups).sort();
  var html = '<div class="journey-group-cell' + (cur==='all'?' active':'') + '" onclick="setJGroup(\'all\')"><div class="jg-icon">🗂️</div><div class="jg-name">全部</div><div class="jg-count">' + cards.length + ' 张</div></div>';
  names.forEach(function(g){
    var isUn = (g === '未分组');
    var del = isUn ? '' : '<button class="jg-del" title="解散分组" onclick="event.stopPropagation();jwallDisbandGroup(\'' + String(g).replace(/'/g,"\\'") + '\')">✕</button>';
    html += '<div class="journey-group-cell' + (cur===g?' active':'') + '" onclick="setJGroup(\'' + String(g).replace(/'/g,"\\'") + '\')"><div class="jg-icon">🎬</div><div class="jg-name">' + esc(g) + '</div>' + del + '<div class="jg-count">' + groups[g].length + ' 张</div></div>';
  });
  bar.style.display = 'flex';
  bar.innerHTML = html;
}
function setJGroup(g) {
  window._jGroup = g;
  window._selSet = window._selSet || {};
  window._selMode = window._selMode || false;
  if (window._jAllCards) {
    // 纯前端过滤重渲染，不请求 API
    var cards = window._jAllCards;
    var grid = document.getElementById('journeyWallGrid');
    if (!grid) return;
    renderJGroups(cards);
    grid.innerHTML = '';
    var cur = g || 'all';
    var base = cur === 'all' ? cards : cards.filter(function(c){ return ((c.group||'').trim() || '未分组') === cur; });
    if (cur !== 'all' && !base.length) { cur = 'all'; window._jGroup = 'all'; base = cards; }
    var shown = base.filter(jwallMatchesFilter);
    if (!shown.length) {
      grid.innerHTML = '<div class="journey-status">' + (window._jFilter ? '当前筛选无影片' : '该分组暂无影片') + '</div>';
      return;
    }
    shown.forEach(function(c){
      var grey = c.status !== 'watched';
      var el = document.createElement('div');
      el.className = 'journey-wall-card' + (grey ? ' grey' : '') + (window._selMode ? ' sel' : '');
      var badge = c.status === 'watched' ? '<span class="jw-badge watched">已完成</span>' : (c.playing ? '<span class="jw-badge playing">观看中</span>' : '<span class="jw-badge claimed">已认领</span>');
      var acts = (grey && !window._selMode)
        ? (c.playing
            ? '<div class="jw-actions"><button class="jw-act" data-act="play">继续播放</button><button class="jw-act" data-act="sub">订阅</button></div>'
            : '<div class="jw-actions"><button class="jw-act" data-act="play">播放</button><button class="jw-act" data-act="sub">订阅</button><button class="jw-act" data-act="search">搜索</button></div>')
        : '';
      var poster = c.image ? '<img class="jw-poster" src="' + esc(c.image) + '" alt=""/>'
        : '<div style="position:absolute;inset:0;background:linear-gradient(135deg,#33384d,#22263a);display:flex;align-items:center;justify-content:center;font-size:30px;">🎬</div>';
      var srcLabel = c.source === 'auto' ? '自主观看' : '每日认领';
      var metaDate = (c.status === 'watched' && c.completed_date ? '完成于 ' + c.completed_date : '认领于 ' + c.claimed_date);
      el.innerHTML =
        '<div class="jw-check' + (window._selSet[c.id] ? ' checked' : '') + '" data-jwcheck="' + c.id + '">' + (window._selSet[c.id] ? '✓' : '') + '</div>' +
        '<div class="jw-media">' + poster + '<div class="jw-fade"></div>' + badge + acts +
          '<div class="jw-glass">' +
            '<div class="jw-name">' + (c.title || '') + '</div>' +
            '<div class="jw-meta">' + srcLabel + (c.group ? ' · ' + c.group : '') + '</div>' +
            '<div class="jw-date">' + metaDate + '</div>' +
          '</div>' +
        '</div>';
      el.addEventListener('click', function(){ openJWallFlip(c.id); });
      grid.appendChild(el);
    });
  } else {
    loadJWall();
  }
}
async function loadJWall() {
  if (!window._embyHost) {
    try { var c0 = await _japi('/api/config'); window._embyHost = c0.emby_host || ''; } catch (e) {}
  }
  var w = await _japi('/api/journey/wall');
  var cards = w.cards || [];
  window._jAllCards = cards;
  renderJourneyTimeline(cards);
  var stats = document.getElementById('journeyWallStats');
  if (stats) {
    var watched = cards.filter(function(c){ return c.status === 'watched'; }).length;
    stats.innerHTML = '共 ' + cards.length + ' 张 · 已完成 ' + watched + ' 张 · ' + (w.can_claim ? '今日可认领' : '今日已满');
  }
  var grid = document.getElementById('journeyWallGrid');
  if (!grid) return;
  if (!cards.length) { grid.innerHTML = '<div class="journey-status">还没有认领的影片，去「抽卡」认领一张吧 🎴</div>'; return; }
  renderJGroups(cards);
  grid.innerHTML = '';
  var cur = window._jGroup || 'all';
  var base = cur === 'all' ? cards : cards.filter(function(c){ return ((c.group||'').trim() || '未分组') === cur; });
  // 分组残留指向已解散/不存在分组时回退显示全部，避免卡片区空
  if (cur !== 'all' && !base.length) { cur = 'all'; window._jGroup = 'all'; base = cards; }
  var shown = base.filter(jwallMatchesFilter);
  if (!shown.length) {
    grid.innerHTML = '<div class="journey-status">' + (window._jFilter ? '当前筛选无影片' : '该分组暂无影片') + '</div>' +
      '<div style="text-align:center;margin-top:14px;"><button class="jwall-reset" onclick="window._jFilter=null;window._jGroup=null;loadJWall();">查看全部 ' + cards.length + ' 张</button></div>';
    return;
  }
  shown.forEach(function(c){
    var grey = c.status !== 'watched';
    var el = document.createElement('div');
    window._selSet = window._selSet || {};
    window._selMode = window._selMode || false;
    var sel = window._selSet[c.id] ? ' checked' : '';
    el.className = 'journey-wall-card' + (grey ? ' grey' : '') + (window._selMode ? ' sel' : '');
    var badge = c.status === 'watched' ? '<span class="jw-badge watched">已完成</span>' : (c.playing ? '<span class="jw-badge playing">观看中</span>' : '<span class="jw-badge claimed">已认领</span>');
    // 未完成卡（grey）按状态差异化悬浮操作：已认领/未观看→播放/订阅/搜索；观看中→继续播放/订阅
    var acts = (grey && !window._selMode)
      ? (c.playing
          ? '<div class="jw-actions"><button class="jw-act" data-act="play">继续播放</button><button class="jw-act" data-act="sub">订阅</button></div>'
          : '<div class="jw-actions"><button class="jw-act" data-act="play">播放</button><button class="jw-act" data-act="sub">订阅</button><button class="jw-act" data-act="search">搜索</button></div>')
      : '';
    var poster = c.image ? '<img class="jw-poster" src="' + esc(c.image) + '" alt=""/>'
      : '<div style="position:absolute;inset:0;background:linear-gradient(135deg,#33384d,#22263a);display:flex;align-items:center;justify-content:center;font-size:30px;">🎬</div>';
    var srcLabel = c.source === 'auto' ? '自主观看' : '每日认领';
    var metaDate = (c.status === 'watched' && c.completed_date ? '完成于 ' + c.completed_date : '认领于 ' + c.claimed_date);
    el.innerHTML =
      '<div class="jw-check' + sel + '" data-jwcheck="' + c.id + '">' + (sel ? '✓' : '') + '</div>' +
      '<div class="jw-media">' + poster + '<div class="jw-fade"></div>' + badge + acts +
        '<div class="jw-glass">' +
          '<div class="jw-name">' + (c.title || '') + '</div>' +
          '<div class="jw-meta">' + srcLabel + (c.group ? ' · ' + c.group : '') + '</div>' +
          '<div class="jw-date">' + metaDate + '</div>' +
        '</div>' +
      '</div>';
    var ck = el.querySelector('[data-jwcheck]');
    ck.addEventListener('click', function(e){ e.stopPropagation(); toggleJWallSelect(c.id, ck); });
    if (acts) el.querySelectorAll('.jw-act').forEach(function(b){
      b.addEventListener('click', function(e){ e.stopPropagation(); if (window._selMode) return; jwallAct(b.getAttribute('data-act'), c); });
    });
    el.addEventListener('click', function(){
      if (window._selMode) { toggleJWallSelect(c.id, el.querySelector('[data-jwcheck]')); return; }
      openJWallFlip(c);
    });
    grid.appendChild(el);
  });
}
function jwallAct(act, c) {
  if (act === 'search') { if (window.flipSearch) window.flipSearch(c.title || ''); return; }
  if (act === 'play') { jwallActPlay(c); return; }
  if (act === 'sub') { jwallActSub(c); return; }
}
function jwallActSub(c) {
  var tid = (c.item_id || '').indexOf('tmdb:') === 0 ? (c.item_id || '').slice(5) : (c.tmdbid || '');
  if (!tid) { _jtoast('该影片来自媒体库暂无 TMDB 标识，可点「搜索」在网盘/站点订阅'); return; }
  _japi('/api/subscribe', { method: 'POST', body: JSON.stringify({ name: c.title || '', tmdbid: tid, type: c.type === 'series' ? 'tv' : 'movie', action: 'add' }) }).then(function(r){
    if (r && r.ok) _jtoast('已添加订阅：' + (c.title || ''));
    else _jtoast((r && r.error) || '订阅失败');
  });
}
function jwallActPlay(c) {
  var h = window._embyHost;
  var iid = c.item_id || '';
  if (h && iid && iid.indexOf('tmdb:') !== 0) { window.open(h.replace(/\/+$/, '') + '/web/index.html#!/item?id=' + iid, '_blank'); return; }
  // tmdb / 无媒体库条目：走搜索后播放
  if (window.flipSearch) window.flipSearch(c.title || '');
}
function toggleJWallSelect(id, ck) {
  if (window._selSet[id]) { delete window._selSet[id]; }
  else { window._selSet[id] = true; }
  if (ck) { ck.classList.toggle('checked', !!window._selSet[id]); ck.textContent = window._selSet[id] ? '✓' : ''; }
  refreshJWallSelection();
}
function refreshJWallSelection() {
  var total = (window._jAllCards || []).length;
  var cnt = Object.keys(window._selSet).length;
  var el = document.getElementById('journeySelectCount');
  if (el) el.textContent = '已选 ' + cnt + ' 张';
  var allBtn = document.getElementById('btnSelectAll');
  if (allBtn) allBtn.textContent = cnt > 0 ? '取消全选' : '全选';
  var grpBtn = document.getElementById('btnGroupSelected');
  if (grpBtn) grpBtn.style.display = cnt > 0 ? '' : 'none';
}
function enterJWallSelect() {
  window._selMode = true;
  var sb = document.getElementById('journeySelectBar');
  var sm = document.getElementById('btnSelectMode');
  if (sb) sb.style.display = 'flex';
  if (sm) { sm.textContent = '取消选择'; sm.classList.add('active'); }
  loadJWall();
}
function exitJWallSelect() {
  window._selMode = false;
  window._selSet = {};
  var sb = document.getElementById('journeySelectBar');
  var sm = document.getElementById('btnSelectMode');
  if (sb) sb.style.display = 'none';
  if (sm) { sm.textContent = '选择'; sm.classList.remove('active'); }
  loadJWall();
}
function jwallSelectAllToggle() {
  var cards = window._jAllCards || [];
  var cnt = Object.keys(window._selSet).length;
  if (cnt === 0) { cards.forEach(function(c){ window._selSet[c.id] = true; }); }
  else { window._selSet = {}; }
  refreshJWallSelection();
  var grid = document.getElementById('journeyWallGrid');
  if (grid) grid.querySelectorAll('.jw-check').forEach(function(ck){
    var id = ck.getAttribute('data-jwcheck');
    var on = !!window._selSet[id];
    ck.classList.toggle('checked', on); ck.textContent = on ? '✓' : '';
  });
}
function openJWallFilter() {
  var cards = window._jAllCards || [];
  var el = document.getElementById('jwallFilterOpts');
  var cur = window._jFilter;
  var opts = [['status_all','状态：全部'],['status_unwatched','未完成'],['status_watched','已完成'],['status_playing','观看中']];
  var groups = {}; cards.forEach(function(c){ var g=((c.group||'').trim())||'未分组'; groups[g]=1; });
  Object.keys(groups).sort().forEach(function(g){ opts.push(['group_'+g, '分组：'+g]); });
  el.innerHTML = opts.map(function(o){
    var k = o[0], label = o[1];
    var active = cur && cur.k === k;
    return '<button class="jw-filter-chip' + (active?' active':'') + '" data-jwfk="' + k + '">' + label + '</button>';
  }).join('');
  el.querySelectorAll('[data-jwfk]').forEach(function(b){
    b.addEventListener('click', function(){
      var k = b.getAttribute('data-jwfk');
      if (window._jFilter && window._jFilter.k === k) window._jFilter = null;
      else {
        if (k.indexOf('group_') === 0) window._jFilter = { k: k, group: k.slice(6) };
        else window._jFilter = { k: k };
      }
      el.querySelectorAll('[data-jwfk]').forEach(function(x){ x.classList.toggle('active', x.getAttribute('data-jwfk')===k && !!window._jFilter); });
    });
  });
  document.getElementById('jwallFilterModal').style.display = 'flex';
}
function jwallFilterReset() { window._jFilter = null; document.getElementById('jwallFilterModal').style.display = 'none'; loadJWall(); }
function jwallMatchesFilter(c) {
  var f = window._jFilter; if (!f) return true;
  if (f.k === 'status_all') return true;
  if (f.k === 'status_unwatched') return c.status !== 'watched';
  if (f.k === 'status_watched') return c.status === 'watched';
  if (f.k === 'status_playing') return !!c.playing;
  if (f.group) return ((c.group||'').trim() || '未分组') === f.group;
  return true;
}
function openJWallFlip(c) {
  var box = document.getElementById('jwallFlipCard');
  var genres = (c.genres && c.genres.length ? c.genres.join(' · ') : '');
  var img = c.image ? ('background:url(' + imgProxy(c.image) + ') center/cover no-repeat;') : 'background:linear-gradient(135deg,#3a3f58,#20243a);';
  var front;
  if (c.image) {
    front = '<div class="flip-front" data-src="' + esc(imgProxy(c.image)) + '"><div class="shimmer"></div><img class="flip-front-poster" src="' + esc(imgProxy(c.image)) + '" onload="this.previousElementSibling.style.display=\'none\'" onerror="flipImgErr(this)"></div>';
  } else {
    front = '<div class="flip-front" style="' + img + '"></div>';
  }
  var metaLine = (c.type === 'series' ? '剧集' : '电影') + (c.year ? (' · ' + c.year) : '');
  var rateVal = parseFloat(c.rating);
  var starsHtml = '';
  if (c.rating && !isNaN(rateVal)) {
    var stVal = Math.max(0, Math.min(5, rateVal / 2));
    var st = '';
    for (var si = 1; si <= 5; si++) {
      var fill = Math.max(0, Math.min(100, (stVal - (si - 1)) * 100));
      st += '<span class="star-grow"><span class="sg-mask" style="width:' + fill.toFixed(1) + '%">★</span>★</span>';
    }
    starsHtml = '<div class="flip-back-stars">' + st + '</div>';
  }
  var fRows = [
    ['类型', c.type === 'series' ? '剧集' : '电影'],
    ['年份', c.year || '—'],
    ['状态', c.status === 'watched' ? '✔ 已看完' : '● 已认领'],
    ['看完日期', c.completed_date || '—'],
    ['认领日期', c.claimed_date || '—'],
    ['备注', ((c.notes || []).length || 0) + ' 条']
  ];
  var fieldsHtml = '<div class="flip-back-fields">' + fRows.map(function(r){ return '<div class="flip-back-field"><span class="lb">' + esc(r[0]) + '</span><span class="vl">' + esc(r[1]) + '</span></div>'; }).join('') + '</div>';
  var platHtml = renderPlatformLinks({ cls: 'flip-plat', tmdbId: c.tmdbId, imdbId: c.imdbId, tvdbId: c.tvdbId, isTv: c.type === 'series', doubanUrl: c.url || '' });
  var dirInner = (c.directors && c.directors.length) ? '<div class="flip-sec-title">导演</div>' + c.directors.slice(0, 3).map(function(n){ return '<div class="flip-dir-name">' + esc(personName(n)) + '</div>'; }).join('') : '';
  var castInner = (c.actors && c.actors.length) ? '<div class="flip-sec-title">演员</div><div class="flip-cast-row">' + c.actors.slice(0, 6).map(function(a){
    var hasImg = a.image && !a.image.endsWith('/w200');
    return '<div class="flip-actor">' +
      (hasImg ? '<img src="' + esc(a.image) + '" class="flip-actor-img" loading="lazy" onerror="this.style.display=\'none\'">' : '<div class="flip-actor-img flip-actor-ph"><span>' + esc((a.name || '?').charAt(0)) + '</span></div>') +
      '<div class="flip-actor-name">' + esc(a.name || '') + '</div>' +
      (a.role ? '<div class="flip-actor-role">' + esc(a.role) + '</div>' : '') +
    '</div>';
  }).join('') + '</div>' : '';
  // 背面结构对齐流行趋势 flow 翻转卡：head(标题/meta/星级) + scroll(简介/平台链接/导演/演职员/星级条/字段)，容器恒定，无数据时由 TMDB 补全填充；按钮由卡外 jwflip-actions 承担（唯一差异）
  var back = '<div class="flip-back-bg"' + (c.image ? ' style="' + img + '"' : '') + '></div><div class="flip-back-dim"></div><div class="flip-back-body">' +
    '<div class="flip-back-head">' +
      '<div class="flip-back-title">' + esc(c.title || '') + '</div>' +
      '<div class="flip-back-meta">' + esc(metaLine) + '</div>' +
      (c.rating ? '<div class="flip-back-rate-num">' + esc(fmtRating(c.rating)) + ' / 10</div>' : '') +
    '</div>' +
    '<div class="flip-back-scroll">' +
      '<div class="flip-back-overview">' + (c.overview ? esc(c.overview) : '') + '</div>' +
      '<div class="flip-back-platforms">' + (platHtml || '') + '</div>' +
      '<div class="flip-back-directors">' + dirInner + '</div>' +
      '<div class="flip-cast">' + castInner + '</div>' +
      starsHtml + fieldsHtml +
    '</div>' +
  '</div>';
  box.innerHTML = '<div class="flip-card-container" onclick="flipCard(this)"><div class="flip-card" style="width:100%;height:100%;">' +
    '<div class="flip-card-front">' + front + '</div><div class="flip-card-back">' + back + '</div></div></div>';
  var isTmdb = (c.item_id || '').indexOf('tmdb:') === 0;
  var wBtn = document.querySelector('#jwallFlipModal [data-jwact="watch"]');
  if (wBtn) wBtn.style.display = (c.source === 'media' && !isTmdb) ? '' : 'none';
  var acts = document.querySelectorAll('#jwallFlipModal [data-jwact]');
  var handlers = {
    note: function(){ openJWallNotes(c.id); },
    group: function(){ openJWallGroup([c.id]); },
    watch: function(){ var h = window._embyHost; if (!h) return _jtoast('未获取到媒体库地址'); window.open(h.replace(/\/+$/, '') + '/web/index.html#!/item?id=' + c.item_id, '_blank'); },
    share: function(){ _japi('/api/journey/share', { method: 'POST', body: JSON.stringify({ id: c.id }) }).then(function(r){ if (r.url) { var base = window._shareBase || location.origin; var u = base.replace(/\/+$/, '') + r.url; var done = function(){ _jtoast('🔗 分享链接已复制，游客可直接打开查看'); }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(done, done); else done(); } else if (r.error) _jtoast(r.error); }); }
  };
  acts.forEach(function(b){ b.onclick = handlers[b.getAttribute('data-jwact')]; });
  document.getElementById('jwallFlipModal').style.display = 'flex';
  jwallTmdbEnrich(c);
}
// TMDB 实时补全：时间轴翻转卡与流行趋势 flow 同机制 —— 认领记录缺简介/平台 ID/演职员时按片名补全（overview/platforms/directors/cast），星级用卡内评分；失败保留原始
function jwallTmdbEnrich(c) {
  var card = document.getElementById('jwallFlipCard'); if (!card) return;
  var title = (c.title || '').trim(); if (!title) return;
  var isTv = c.type === 'series';
  fetchJSON('/tmdb/detail?q=' + encodeURIComponent(title) + '&type=' + (isTv ? 'tv' : 'movie'), 15000).then(function(r){
    var d = (r && r.data) || {};
    if (!d || d.error || !d.name) return;
    var ov = card.querySelector('.flip-back-overview');
    if (ov && !ov.textContent.trim() && d.overview) ov.textContent = d.overview;
    var pl = card.querySelector('.flip-back-platforms');
    if (pl && !pl.querySelector('a')) {
      var ph = renderPlatformLinks({ cls: 'flip-plat', tmdbId: d.tmdbId, imdbId: d.imdbId, tvdbId: d.tvdbId, isTv: isTv, doubanUrl: c.url || '' });
      if (ph) pl.innerHTML = ph;
    }
    var de = card.querySelector('.flip-back-directors');
    if (de && d.directors && d.directors.length && !de.querySelector('.flip-dir-name')) {
      de.innerHTML = '<div class="flip-sec-title">导演</div>' + d.directors.slice(0, 3).map(function(n){ return '<div class="flip-dir-name">' + esc(personName(n)) + '</div>'; }).join('');
    }
    var ca = card.querySelector('.flip-cast');
    if (ca && d.actors && d.actors.length && !ca.querySelector('.flip-actor')) {
      ca.innerHTML = '<div class="flip-sec-title">演员</div><div class="flip-cast-row">' + d.actors.slice(0, 6).map(function(a){
        var hasImg = a.image && !a.image.endsWith('/w200');
        return '<div class="flip-actor">' +
          (hasImg ? '<img src="' + esc(a.image) + '" class="flip-actor-img" loading="lazy" onerror="this.style.display=\'none\'">' : '<div class="flip-actor-img flip-actor-ph"><span>' + esc((a.name || '?').charAt(0)) + '</span></div>') +
          '<div class="flip-actor-name">' + esc(a.name || '') + '</div>' +
          (a.role ? '<div class="flip-actor-role">' + esc(a.role) + '</div>' : '') +
        '</div>';
      }).join('') + '</div>';
    }
  }).catch(function(){});
}
window.jwallTmdbEnrich = jwallTmdbEnrich;
function closeJWallFlip() { document.getElementById('jwallFlipModal').style.display = 'none'; }
function flipImgErr(img) {
  var p = img.parentElement;
  var src = p.getAttribute('data-src') || '';
  p.innerHTML = '<div class="img-fail">海报加载失败<br><button onclick="flipImgRetry(this)">重试</button></div>';
  p.setAttribute('data-src', src);
}
function flipImgRetry(btn) {
  var p = btn.closest('.flip-front');
  var src = p.getAttribute('data-src') || '';
  p.innerHTML = '<div class="shimmer"></div><img class="flip-front-poster" src="' + src + '" onload="this.previousElementSibling.style.display=\'none\'" onerror="flipImgErr(this)">';
}
var _jNoteTimer = null;
function openJWallNotes(id) {
  var c = (window._jAllCards || []).find(function(x){ return x.id === id; });
  window._jNoteId = id;
  window._jEditIdx = undefined;
  var title = document.getElementById('jwallNotesTitle');
  if (title) title.textContent = '观后感 · ' + (c ? c.title : '');
  renderJNotes(id);
  resetNoteBtn();
  var ta = document.getElementById('jwallNoteText');
  if (ta) ta.value = '';
  var hint = document.getElementById('jwallNoteHint');
  if (hint) hint.textContent = '可多次追加感想';
  document.getElementById('jwallNoteModal').style.display = 'flex';
  if (ta) ta.focus();
}
function renderJNotes(id) {
  var list = document.getElementById('jwallNotesList');
  if (!list) return;
  var c = (window._jAllCards || []).find(function(x){ return x.id === id; });
  var notes = (c && c.notes) || [];
  if (!notes.length) { list.innerHTML = '<div style="font-size:12.5px;color:rgba(255,255,255,0.4);padding:6px 2px;">还没有感想，写一条吧</div>'; return; }
  list.innerHTML = notes.map(function(n, i){
    return '<div class="jw-note-item"><span class="n-t">' + esc(n.text || '') + '<span class="n-ts">' + (n.ts || '') + '</span></span>' +
      '<span class="n-ops"><button class="jt-iconbtn" data-ed="' + id + '" data-idx="' + i + '" title="编辑">✎</button>' +
      '<button class="jt-iconbtn del" data-del="' + id + '" data-idx="' + i + '" title="删除">✕</button></span></div>';
  }).join('');
  list.querySelectorAll('[data-ed]').forEach(function(b){
    b.onclick = function(){ jwallEditNote(b.getAttribute('data-ed'), +b.getAttribute('data-idx')); };
  });
  list.querySelectorAll('[data-del]').forEach(function(b){
    b.onclick = function(){ if (confirm('删除这条感想？')) jwallDelNote(b.getAttribute('data-del'), +b.getAttribute('data-idx')); };
  });
}
function jwallAddNote() {
  var id = window._jNoteId;
  var ta = document.getElementById('jwallNoteText');
  var v = (ta && (ta.value || '').trim()) || '';
  if (!v) { _jtoast('先写点内容再追加'); return; }
  _japi('/api/journey/note', { method: 'POST', body: JSON.stringify({ id: id, text: v }) }).then(function(r){
    if (r && r.ok) { _jtoast('已追加感想'); if (ta) ta.value = ''; loadJWall(); if (window._jNoteId === id) renderJNotes(id); }
    else _jtoast((r && r.error) || '保存失败');
  });
}
function jwallEditNote(id, idx) {
  var c = (window._jAllCards || []).find(function(x){ return x.id === id; });
  var n = ((c && c.notes) || [])[idx];
  var ta = document.getElementById('jwallNoteText');
  if (!ta || !n) return;
  window._jNoteId = id;
  window._jEditIdx = idx;
  ta.value = n.text || '';
  var btn = document.getElementById('btnJNoteAdd');
  if (btn) { btn.textContent = '保存修改'; btn.onclick = function(){ jwallSaveEdit(); }; }
  var hint = document.getElementById('jwallNoteHint');
  if (hint) hint.textContent = '正在编辑第 ' + (idx + 1) + ' 条';
  ta.focus();
}
function jwallSaveEdit() {
  var id = window._jNoteId, idx = window._jEditIdx;
  var ta = document.getElementById('jwallNoteText');
  var v = (ta && (ta.value || '').trim()) || '';
  _japi('/api/journey/note', { method: 'POST', body: JSON.stringify({ id: id, text: v, index: idx }) }).then(function(r){
    if (r && r.ok) { _jtoast('已保存'); if (ta) ta.value = ''; loadJWall(); if (window._jNoteId === id) renderJNotes(id); resetNoteBtn(); }
    else _jtoast((r && r.error) || '保存失败');
  });
}
function jwallDelNote(id, idx) {
  _japi('/api/journey/note/del', { method: 'POST', body: JSON.stringify({ id: id, index: idx }) }).then(function(r){
    if (r && r.ok) { _jtoast('已删除'); loadJWall(); if (window._jNoteId === id) renderJNotes(id); resetNoteBtn(); }
    else _jtoast((r && r.error) || '删除失败');
  });
}
function resetNoteBtn() {
  window._jEditIdx = undefined;
  var btn = document.getElementById('btnJNoteAdd');
  if (btn) { btn.textContent = '＋ 追加感想'; btn.onclick = function(){ jwallAddNote(); }; }
  var hint = document.getElementById('jwallNoteHint');
  if (hint) hint.textContent = '可多次追加感想';
}
function closeJWallNote() {
  var ta = document.getElementById('jwallNoteText');
  var v = (ta && (ta.value || '').trim()) || '';
  if (v && !confirm('有未保存的感想，确定放弃并关闭？')) return;
  document.getElementById('jwallNoteModal').style.display = 'none';
  resetNoteBtn();
}
// ===== 观影时间轴视图 =====
function renderJourneyTimeline(cards) {
  var view = document.getElementById('journeyTimelineView');
  if (!view) return;
  // 仅当时间轴子tab激活时才隐藏海报墙工具栏；否则保持海报墙布局
  var tlBtn = document.querySelector('.journey-sub-tab[data-jsub="timeline"]');
  var isTimeline = tlBtn && tlBtn.classList.contains('active');
  var grpBar = document.getElementById('journeyGroupBar');
  if (grpBar) grpBar.style.display = isTimeline ? 'none' : '';
  var stats = document.getElementById('journeyWallStats');
  if (stats) stats.style.display = isTimeline ? 'none' : '';
  var acts = document.querySelector('.jw-tool-actions');
  if (acts) acts.style.display = isTimeline ? 'none' : '';
  var selBar = document.getElementById('journeySelectBar');
  if (selBar) selBar.style.display = (!isTimeline && window._selMode) ? 'flex' : 'none';
  var all = (cards || []).slice();
  if (!all.length) { view.innerHTML = '<div class="journey-status">还没有认领的影片，认领后会出现在这里</div>'; return; }
  all.sort(function(a,b){ var ta = a.completed_date || a.claimed_date || a.created_at || ''; var tb = b.completed_date || b.claimed_date || b.created_at || ''; return tb.localeCompare(ta); });
  var days = {};
  all.forEach(function(c){ var d = c.completed_date || c.claimed_date || c.created_at || '未知日期'; (days[d] = days[d] || []).push(c); });
  var html = '';
  Object.keys(days).forEach(function(day){
    var list = days[day];
    html += '<div class="jt-day"><div class="jt-dayhead"><span class="jt-dot"></span><span class="jt-lbl">' + esc(day) + '<small>' + list.length + ' 部</small></span></div>';
    list.forEach(function(c){
      var poster = c.image ? '<img src="' + esc(c.image) + '" alt=""/>' : '<div class="jt-noimg">🎬</div>';
      var meta = (c.type === 'series' ? '剧集' : '电影') + (c.year ? (' · ' + c.year) : '') + (c.rating ? (' · ★' + c.rating) : '');
      var genre = (c.genres || []).slice(0, 3).join(' · ');
      var notes = (c.notes && c.notes.length) ? c.notes : [];
      var noteHtml = notes.length
        ? notes.map(function(n, i){
            return '<div class="jt-note"><span class="jt-mark"></span><span class="jt-txt">' + esc(n.text || '') + '<span class="jt-t">' + esc(n.ts || '') + '</span></span>' +
              '<span class="jt-ops"><button class="jt-iconbtn" data-ed="' + c.id + '" data-idx="' + i + '" title="编辑">✎</button>' +
              '<button class="jt-iconbtn del" data-del="' + c.id + '" data-idx="' + i + '" title="删除">✕</button></span></div>';
          }).join('')
        : '<div class="jt-note-empty">还没有写感想，点下方按钮补一条</div>';
      var statusTag = c.status === 'watched'
        ? '<span class="jt-tag">✔ 已看完</span>'
        : '<span class="jt-tag" style="background:rgba(255,159,10,0.2);color:#FF9F0A;">● 已认领</span>';
      html += '<div class="jt-item"><div class="jt-time">' + esc(day) + '</div><div class="jt-axis"><div class="jt-node"></div><div class="jt-stem"></div></div><div class="jt-card"><div class="jt-body"><div class="jt-poster" data-cid="' + c.id + '" title="点击查看详情">' + poster + '</div><div class="jt-main">' +
        '<div class="jt-title">' + esc(c.title || '') + ' ' + statusTag + '</div>' +
        '<div class="jt-meta">' + meta + '</div>' +
        (genre ? '<div class="jt-genre">' + esc(genre) + '</div>' : '') +
        '<div class="jt-notes">' + noteHtml + '</div>' +
        '<div class="jt-add"><button data-add="' + c.id + '">＋ 追加感想</button></div>' +
        '</div></div></div></div>';
    });
    html += '</div>';
  });
  view.innerHTML = html;
  view.addEventListener('click', function(e){
    var p = e.target.closest('.jt-poster'); if (p && p.getAttribute('data-cid')) { var pc = (window._jAllCards||[]).find(function(x){return x.id===p.getAttribute('data-cid');}); if (pc) openJWallFlip(pc); return; }
    var t = e.target.closest('[data-add],[data-ed],[data-del]');
    if (!t) return;
    var id = t.getAttribute('data-add') || t.getAttribute('data-ed') || t.getAttribute('data-del');
    if (t.hasAttribute('data-add')) { openJWallNotes(id); return; }
    var idx = +t.getAttribute('data-idx');
    if (t.hasAttribute('data-ed')) { jwallEditNote(id, idx); return; }
    if (t.hasAttribute('data-del')) { if (confirm('删除这条感想？')) jwallDelNote(id, idx); }
  });
}
(function(){
  document.querySelectorAll('.journey-sub-tab').forEach(function(b){
    b.addEventListener('click', function(){
      var sub = b.getAttribute('data-jsub');
      document.querySelectorAll('.journey-sub-tab').forEach(function(x){ x.classList.toggle('active', x === b); });
      var grid = document.getElementById('journeyWallGrid');
      var tl = document.getElementById('journeyTimelineView');
      var stats = document.getElementById('journeyWallStats');
      var selBar = document.getElementById('journeySelectBar');
      var grpBar = document.getElementById('journeyGroupBar');
      var acts = document.querySelector('.jw-tool-actions');
      var showWall = sub === 'wall';
      if (grid) grid.style.display = showWall ? '' : 'none';
      if (tl) tl.style.display = showWall ? 'none' : '';
      if (stats) stats.style.display = showWall ? '' : 'none';
      if (acts) acts.style.display = showWall ? '' : 'none';
      if (selBar) selBar.style.display = (showWall && window._selMode) ? 'flex' : 'none';
      if (grpBar) grpBar.style.display = showWall ? '' : 'none';
    });
  });
})();
var _jGroupTarget = [];
function openJWallGroup(ids) {
  _jGroupTarget = ids || [];
  var title = document.getElementById('jwallGroupTitle');
  if (title) title.textContent = ids.length > 1 ? '将 ' + ids.length + ' 张归入分组' : '分组';
  var opts = document.getElementById('jwallGroupOpts');
  var cards = window._jAllCards || [];
  var groups = {}; cards.forEach(function(c){ var g=((c.group||'').trim())||'未分组'; groups[g]=1; });
  (window._jGroups || []).forEach(function(g){ groups[g]=1; });
  window._jGroupPick = null;
  opts.innerHTML = Object.keys(groups).sort().map(function(g){
    return '<button class="jw-filter-chip" data-jwg="' + String(g).replace(/"/g,'&quot;') + '">' + esc(g) + '</button>';
  }).join('');
  opts.querySelectorAll('[data-jwg]').forEach(function(b){
    b.addEventListener('click', function(){
      window._jGroupPick = b.getAttribute('data-jwg');
      opts.querySelectorAll('[data-jwg]').forEach(function(x){ x.classList.toggle('active', x===b); });
    });
  });
  // 已有分组管理：列出已命名分组，点 ✕ 解散
  var mg = document.getElementById('jwallGroupManage');
  var named = ((window._jGroups || []).concat(Object.keys(groups))).filter(function(g){ var t=(g||'').trim(); return t && t!=='未分组'; });
  named = Array.from(new Set(named));
  if (mg) {
    mg.innerHTML = named.length
      ? '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin:4px 0 8px;">已有分组（点 ✕ 解散）</div>' + named.map(function(g){
          return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.04);margin-bottom:6px;"><span style="font-size:12px;color:rgba(255,255,255,0.85);">' + esc(g) + '</span><button class="jw-tool-btn" data-jwgdel style="color:#f88;border-color:rgba(255,120,120,0.35);padding:4px 8px;font-size:11px;">✕ 解散</button></div>';
        }).join('')
      : '<div style="font-size:11px;color:rgba(255,255,255,0.3);margin:4px 0;">暂无已命名分组</div>';
    mg.querySelectorAll('[data-jwgdel]').forEach(function(b, i){
      b.addEventListener('click', function(){ jwallDisbandGroup(named[i]); });
    });
  }
  document.getElementById('jwallGroupNew').value = '';
  document.getElementById('jwallGroupModal').style.display = 'flex';
}
function closeJWallGroupSafe() {
  const inp = document.getElementById('jwallGroupNew');
  if (inp && inp.value.trim() && !confirm('有未填完的分组输入，确定放弃并关闭？')) return;
  document.getElementById('jwallGroupModal').style.display = 'none';
}
function jwallGroupConfirm() {
  var newName = document.getElementById('jwallGroupNew').value.trim();
  var g = newName || window._jGroupPick;
  if (!g) { _jtoast('请选择或输入一个分组'); return; }
  (window._jGroups = window._jGroups || []).indexOf(g) === -1 && window._jGroups.push(g);
  Promise.all(_jGroupTarget.map(function(id){ return _japi('/api/journey/group', { method: 'POST', body: JSON.stringify({ id: id, group: g }) }); }))
    .then(function(){
      _jtoast('已归入「' + g + '」');
      document.getElementById('jwallGroupModal').style.display = 'none';
      if (window._selMode) { window._selSet = {}; refreshJWallSelection(); }
      loadJWall();
    });
}
function jwallDisbandGroup(g) {
  if (!g) return;
  if (!confirm('解散分组「' + g + '」？该分组下所有卡片将移入「未分组」。')) return;
  var targets = (window._jAllCards || []).filter(function(c){ return (c.group || '').trim() === g; }).map(function(c){ return c.id; });
  if (!targets.length) { _jtoast('该分组下暂无卡片'); return; }
  Promise.all(targets.map(function(id){ return _japi('/api/journey/group', { method: 'POST', body: JSON.stringify({ id: id, group: '' }) }); }))
    .then(function(){
      window._jGroups = (window._jGroups || []).filter(function(x){ return x !== g; });
      _jtoast('已解散分组「' + g + '」');
      document.getElementById('jwallGroupModal').style.display = 'none';
      loadJWall();
    });
}
(function initJWallOps(){
  var bNG = document.getElementById('btnNewGroup');
  if (bNG) bNG.addEventListener('click', function(){ openJWallGroup([]); });
  var bSM = document.getElementById('btnSelectMode');
  if (bSM) bSM.addEventListener('click', function(){ window._selMode ? exitJWallSelect() : enterJWallSelect(); });
  var bSA = document.getElementById('btnSelectAll');
  if (bSA) bSA.addEventListener('click', jwallSelectAllToggle);
  var bSF = document.getElementById('btnSelectFilter');
  if (bSF) bSF.addEventListener('click', openJWallFilter);
  var bGS = document.getElementById('btnGroupSelected');
  if (bGS) bGS.addEventListener('click', function(){ openJWallGroup(Object.keys(window._selSet)); });
  var bCS = document.getElementById('btnCancelSelect');
  if (bCS) bCS.addEventListener('click', exitJWallSelect);
})();


;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(regs) {
    regs.forEach(function(r) { r.unregister(); });
  }).catch(function(){});
}

;

// ========== 设置项帮助（❓ 说明体系）==========
function _escHtml(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
var HELP_DB = {
  auth: { t: '安全与登录', d: '控制管理员登录与密码。开启「启用登录」后，访问 NEXUS 需要输入用户名和密码；新密码留空表示保持原密码，建议定期更换并使用 8 位以上的混合字符。' },
  authUser: { t: '管理员用户名', d: '登录使用的用户名，默认为 admin。修改后下次登录请使用新用户名。' },
  authPass: { t: '新密码', d: '设置新的登录密码。留空则不修改原密码；保存后即时生效，修改期间请勿关闭页面。' },
  authPass2: { t: '确认新密码', d: '再次输入一遍新密码用于校验。两次输入不一致时不会保存，避免手误。' },
  rbac: { t: '权限与角色 (RBAC)', d: '为不同角色勾选可用功能，并绑定 Emby 用户限定其媒体可见范围。账号隶属于角色、继承角色权限；首页轮播与搜索会按角色范围过滤；没有「设置」权限的账号看不到本页。' },
  rbacEmby: { t: 'Emby 用户 ID（媒体范围）', d: '绑定该角色可浏览的 Emby 用户 ID（例如 m）。留空表示使用默认用户；绑定后该角色下的账号在媒体库、轮播与搜索中只能看到此 Emby 用户范围内的内容。' },
  svc: { t: '服务监控', d: '首页「服务」区展示的每张服务卡对应一个家庭服务（Emby、MoviePilot、qBittorrent 等）。点右上角「编辑」可修改服务名称、地址、图标，或添加/删除服务；每张卡右侧的「跳转」按钮可一键在新标签打开对应服务（服务导航）。' },
  favSvc: { t: '常用服务', d: '首页「家庭服务」区域只展示被标记 ★ 的服务；按住「⠿」手柄拖动可以调整展示顺序。服务页每张服务卡上也可直接点 ★ 标记常用。' },
  favicon: { t: '浏览器标签图标', d: '浏览器标签页左侧显示的标识。可以填一个 emoji（如 🏠）或图片 URL（如 https://example.com/favicon.png），保存后生效，右侧有实时预览。' },
  tmdb: { t: 'TMDB API', d: '用于获取电影/剧集的海报、简介与地区信息。在 TMDB 官网注册后进入 Settings → API 申请密钥（v3 auth）。密钥仅保存在本机配置中。' },
  proxy: { t: '代理设置', d: 'NEXUS 所有外发请求（流行趋势、媒体刮削、PT 站点、在线搜索等）统一经过该代理出口。支持 http:// 与 socks5:// 两种协议，留空表示直连；保存后即时生效，无需重启。' },
  share: { t: '分享设置', d: '观影历程「分享」按钮生成的游客链接基址。填入你的公网域名或反向代理地址（不要带尾部斜杠），游客即可直接打开查看；留空则使用当前访问地址（内网地址游客无法访问）。' },
  homeShow: { t: '首页展示', d: '控制总览页各模块、卡片与服务是否展示。关闭后对应内容不再出现在首页（功能仍在，可从其它入口访问），保存后即时生效。' },
  cache: { t: '数据缓存', d: '媒体库影视卡的季/集信息由 TMDB 补充并持久化缓存，避免每次访问都请求 TMDB。点击「清理」后缓存清空，下次访问会自动重新拉取。' },
  creds: { t: '连接凭证', d: 'Emby / qBittorrent / MoviePilot / 网盘搜索 / 代理等服务凭证已并入「服务监控」对应服务条目内，点各服务卡右侧「编辑」即可配置；下方可额外维护在线观影源地址（支持多个，每行一个）。' },
  feat: { t: '功能开关', d: '控制各功能模块是否在前端展示。关闭后对应入口不再显示，但后端服务不受影响；保存后生效。' },
  trend: { t: '流行趋势数据源', d: '勾选需要在「流行趋势」页展示的来源（如豆瓣热门电影/电视），可多选；保存后生效。' },
  devTitle: { t: '服务分类名称', d: '服务页按设备分组展示服务卡，分组标题默认是「SA 服务」「DS 服务」这类「设备名 + 服务」的形式。在这里给每个设备填一个自己的显示名（例如「主力 NAS」「备份机」），服务页标题与服务编辑里的「所属设备」下拉都会跟着变。留空则回到默认名称；设备标识本身不变，端口与健康检查完全不受影响。' },
  cc: { t: 'CookieCloud', d: 'CookieCloud 用于把浏览器 Cookie 端到端加密同步到 NEXUS。NEXUS 只需配置「服务器地址 + 端到端加密密码」：插件端与 NEXUS 使用同一套 UUID 与密码即可（UUID 只需在插件端生成并保持一致）。工作模式、加密算法、Cookie 过期时间等由浏览器插件端控制，NEXUS 侧无需重复配置。' }
};
var _helpIconSvg = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.2"/><path d="M9.3 9.3a2.7 2.7 0 0 1 5.3 0c0 1.9-2.6 2.3-2.6 4"/><line x1="12" y1="17.3" x2="12" y2="17.35"/></svg>';
function openHint(key, anchor) {
  var h = HELP_DB[key];
  if (!h) return;
  var pop = document.getElementById('hintPop');
  if (!pop) return;
  pop.innerHTML = '<div class="hp-title">' + _helpIconSvg + _escHtml(h.t) + '</div><div>' + _escHtml(h.d) + '</div>';
  pop.classList.add('show');
  pop.setAttribute('aria-hidden', 'false');
  var r = anchor.getBoundingClientRect();
  var pw = pop.offsetWidth, ph = pop.offsetHeight;
  var x = Math.min(Math.max(r.right - pw, 12), window.innerWidth - pw - 12);
  var y = r.bottom + 8;
  if (y + ph > window.innerHeight - 12) y = Math.max(12, r.top - ph - 8);
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
}
function closeHint() {
  var pop = document.getElementById('hintPop');
  if (!pop) return;
  pop.classList.remove('show');
  pop.setAttribute('aria-hidden', 'true');
}
document.addEventListener('click', function(e) {
  var ic = e.target.closest ? e.target.closest('.hint-ic') : null;
  if (ic) { e.stopPropagation(); openHint(ic.getAttribute('data-h'), ic); }
  else closeHint();
});
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeHint(); });
