#!/usr/bin/env python3
"""NEXUS Dashboard 数据服务 v4 - 认证 + 安全加固

端点域分组（阶段 D 规范化注释）：
- auth:        /api/login /api/logout /api/status /api/restart
- config:      /api/config (GET/POST) /api/features
- emby:        /api/emby/* /api/detail/* /api/media /api/recent
- mp:          /api/subscribe (GET/POST) /api/tmdb/detail
- search:      /api/search /api/search-sources /api/pansou /api/online /api/pt
- scripts:     /api/scripts /api/scripts/run|save|delete
- favorites:   /api/favorites (GET/POST)
- play-history:/api/play-history (GET/POST)
- trending:    /api/trending
- incoming:    /api/incoming (GET/POST) /api/events
- system:      /api/storage /api/apps /api/torrents /api/network /api/cookiecloud /api/volume-aliases
"""

import json
import os
import re
import sys
import time
import hmac
import hashlib
import secrets
import subprocess
import sqlite3
import threading
import urllib.request
import urllib.parse
import ssl
from http.server import ThreadingHTTPServer as HTTPServer, BaseHTTPRequestHandler

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get('DASH_DATA_DIR', BASE_DIR)
# P0-3 防呆：容器内若未显式外置数据目录（DATA_DIR == BASE_DIR），拒绝启动，
# 杜绝「容器重建丢全部配置/会话/Cookie」的默认风险。
if os.path.exists('/.dockerenv') and os.path.normpath(DATA_DIR) == os.path.normpath(BASE_DIR):
    print('[CRITICAL] 检测到容器内 DATA_DIR == BASE_DIR 且未设置 DASH_DATA_DIR。', flush=True)
    print('[CRITICAL] 这会导致容器重建丢失全部配置/会话/Cookie。请设置环境变量 DASH_DATA_DIR=/data 并挂载数据卷后重启。', flush=True)
    raise SystemExit(1)
os.makedirs(DATA_DIR, exist_ok=True)
CONFIG_PATH = os.path.join(DATA_DIR, 'config.json')
COOKIES_PATH = os.path.join(DATA_DIR, 'cookies.json')
MP_SUB_SCRIPT = os.environ.get('DASH_MP_SUB_SCRIPT', '') or ''  # 向 MoviePilot 添加订阅(state=N)，由环境变量/config.json 注入
MP_DB = os.environ.get('DASH_MP_DB', '') or ''  # MoviePilot 数据库，由环境变量/config.json 注入
SESSIONS_PATH = os.path.join(DATA_DIR, 'sessions.json')
PLAY_HISTORY_PATH = os.path.join(DATA_DIR, 'play_history.json')  # 在线观影播放历史（收藏中心「播放历史」tab）

# ========== 运行日志（内存环形 + 落盘 /data/nexus.log）==========
LOG_RING_MAX = 3000
LOG_FILE = os.path.join(DATA_DIR, 'nexus.log')
_log_ring = []
_log_lock = threading.Lock()

def _log(level, source, message):
    """写入运行日志：内存环形缓冲 + 追加落盘。level: INFO/WARN/ERROR/CRITICAL"""
    try:
        # 日志时间统一用北京时间（Asia/Shanghai），避免容器 UTC 时区差 8 小时误导抓虫
        try:
            import datetime
            ts = (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).strftime('%Y-%m-%d %H:%M:%S')
        except Exception:
            ts = time.strftime('%Y-%m-%d %H:%M:%S')
        entry = {'ts': ts, 'level': level, 'source': source, 'msg': str(message)}
        with _log_lock:
            _log_ring.append(entry)
            if len(_log_ring) > LOG_RING_MAX:
                del _log_ring[:len(_log_ring) - LOG_RING_MAX]
        try:
            with open(LOG_FILE, 'a', encoding='utf-8') as f:
                f.write('[%s] [%s] [%s] %s\n' % (ts, level, source, message))
        except Exception:
            pass
    except Exception:
        pass

def get_logs(level=None, limit=300):
    """按级别过滤返回最近日志（时间倒序，最新在前）"""
    with _log_lock:
        items = list(_log_ring)
    if level and level.upper() != 'ALL':
        items = [e for e in items if e['level'].upper() == level.upper()]
    return items[-limit:][::-1]

def clear_logs():
    with _log_lock:
        _log_ring[:] = []
    try:
        if os.path.exists(LOG_FILE):
            os.remove(LOG_FILE)
    except Exception:
        pass

# ========== 多源服务日志（NAS 侧 docker logs 导出 + 已挂载服务文件） ==========
LOG_DIR = os.path.join(DATA_DIR, 'logs')
_LEVELS_ORDER = ('CRITICAL', 'ERROR', 'WARN', 'INFO', 'DEBUG')

def _parse_log_line(line):
    """宽松解析服务日志行 -> (ts, level, msg)；解析不出就兜底 INFO"""
    s = line.rstrip('\n')
    if not s.strip():
        return None
    ts = None
    level = None
    msg = s[:2000]
    m = re.match(r'^[\[\(]?(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})', s)
    if m:
        ts = m.group(1).replace('T', ' ')
        rest = s[m.end():].lstrip(']() -:')
    else:
        rest = s
    for lv in _LEVELS_ORDER:
        if re.search(r'\b%s\b' % lv, rest, re.IGNORECASE):
            level = lv
            break
    if level is None:
        level = 'INFO'
    return {'ts': ts, 'level': level, 'msg': msg}

def read_service_log(source, tail=200, search=None):
    """读取 /data/logs/<source>.log 尾部（大文件只读末尾），倒序返回解析行"""
    p = os.path.join(LOG_DIR, source + '.log')
    if not os.path.exists(p):
        return []
    try:
        sz = os.path.getsize(p)
        # 粗算取尾部：约 tail 行 × 400B/行，下限 64KB 兜底
        tail_bytes = min(sz, max(tail * 400, 65536))
        with open(p, 'r', encoding='utf-8', errors='replace') as f:
            f.seek(max(0, sz - tail_bytes))
            data = f.read()
        lines = data.splitlines()[-tail:]
    except Exception:
        return []
    out = []
    for ln in lines:
        e = _parse_log_line(ln)
        if e is None:
            continue
        if search and search.lower() not in e['msg'].lower():
            continue
        e['source'] = source
        out.append(e)
    out.reverse()
    return out

def get_service_log_sources():
    """扫描 /data/logs/*.log -> 服务日志源清单（含大小/更新时间）"""
    res = []
    try:
        names = sorted(os.listdir(LOG_DIR)) if os.path.isdir(LOG_DIR) else []
    except Exception:
        names = []
    for n in names:
        if not n.endswith('.log') or n.startswith('.'):
            continue
        p = os.path.join(LOG_DIR, n)
        try:
            st = os.stat(p)
        except Exception:
            continue
        if st.st_size <= 0:
            continue
        res.append({'source': n[:-4], 'category': 'service',
                    'file': n, 'size': st.st_size, 'mtime': int(st.st_mtime)})
    return res

# 服务健康状态变化追踪（flapping 入运行日志）
_svc_prev_state = {}

def _track_svc_state(name, ok):
    """服务状态变化 -> 运行日志；首轮只记录基线不输出"""
    prev = _svc_prev_state.get(name)
    if prev is not None and prev != ok:
        _log('WARN' if not ok else 'INFO', 'svc', '%s %s' % (name, '不可达' if not ok else '恢复'))
    _svc_prev_state[name] = ok

# ========== 版本指纹（多会话协作部署对账） ==========
SERVER_START_TS = time.strftime('%Y-%m-%d %H:%M:%S')
_BUILD_CACHE = {}

def get_version_info(refresh=False):
    """返回当前部署指纹：api/dashboard 双文件 sha256 前 12 位 + 启动时间。
    多会话协作时任何一方部署前可先查询线上指纹，确认基线未被他人改写。"""
    import hashlib
    if not refresh and _BUILD_CACHE:
        return _BUILD_CACHE
    def _fp(path):
        try:
            with open(path, 'rb') as f:
                return hashlib.sha256(f.read()).hexdigest()[:12]
        except Exception:
            return 'n/a'
    info = {
        'api': _fp(os.path.join(BASE_DIR, 'api.py')),
        'dashboard': _fp(os.path.join(BASE_DIR, 'dashboard.html')),
        'index': _fp(os.path.join(BASE_DIR, 'index.html')),
        'started_at': SERVER_START_TS,
    }
    _BUILD_CACHE.update(info)
    return info

# ========== P0-4: 统一原子写 + 损坏保全 ==========
def _atomic_write(path, data, indent=None):
    """原子写 JSON：tmp + fsync + os.replace，杜绝半截文件。"""
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)

def _mark_corrupt(path):
    """文件存在但 JSON 损坏：改名 <name>.corrupt-<ts> 保全现场，便于事后排查。"""
    try:
        ts = time.strftime('%Y%m%d-%H%M%S')
        new = f'{path}.corrupt-{ts}'
        os.replace(path, new)
        print(f'[CRITICAL] {path} 损坏已改名保全 -> {new}', flush=True)
        return new
    except Exception as e:
        print(f'[ERROR] corrupt rename failed for {path}: {e}', flush=True)
        return None

def _load_json_file(path, default):
    """统一 JSON 加载：文件不存在返回 default；存在但解析失败 -> 改名保全后返回 default。"""
    if not os.path.exists(path):
        return default
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f'[warn] load {path}: {e}', flush=True)
        _mark_corrupt(path)
        return default

def _load_play_history():
    """读取播放历史（在线观影打开记录），最新在前，最多保留 200 条。"""
    h = _load_json_file(PLAY_HISTORY_PATH, [])
    return h if isinstance(h, list) else []

def _save_play_history(history):
    try:
        _atomic_write(PLAY_HISTORY_PATH, history[:200])
    except Exception as e:
        print(f"[warn] play_history save: {e}", flush=True)

def load_cookies():
    d = _load_json_file(COOKIES_PATH, {})
    return d if isinstance(d, dict) else {}

def save_cookies(data):
    _atomic_write(COOKIES_PATH, data)

FAV_PATH = os.path.join(DATA_DIR, 'favorites.json')

def load_favs():
    d = _load_json_file(FAV_PATH, [])
    return d if isinstance(d, list) else []

def save_favs(favs):
    _atomic_write(FAV_PATH, favs, indent=2)

CATBOX_PATH = os.path.join(DATA_DIR, 'catbox_map.json')

def _load_catbox_map():
    d = _load_json_file(CATBOX_PATH, {})
    return d if isinstance(d, dict) else {}

def _save_catbox_map(m):
    try:
        _atomic_write(CATBOX_PATH, m)
    except Exception as e:
        print(f"[warn] catbox_map save: {e}", flush=True)

def _catbox_upload(data, filename):
    """匿名上传图片到 catbox.moe，返回 https 直链；失败抛异常。"""
    boundary = '----nx' + hashlib.md5(str(len(data)).encode()).hexdigest()[:12]
    head = (
        '--%s\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n'
        '--%s\r\nContent-Disposition: form-data; name="fileToUpload"; filename="%s"\r\n'
        'Content-Type: application/octet-stream\r\n\r\n' % (boundary, boundary, filename)
    ).encode('latin-1')
    tail = ('\r\n--%s--\r\n' % boundary).encode('latin-1')
    body = head + data + tail
    req = urllib.request.Request(
        'https://catbox.moe/user/api.php', data=body,
        headers={'Content-Type': 'multipart/form-data; boundary=' + boundary,
                 'User-Agent': 'Mozilla/5.0 (dashboard)'},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        resp = r.read().decode('utf-8', errors='ignore').strip()
    if resp.startswith('http'):
        return resp
    raise RuntimeError('catbox upload failed: ' + resp[:120])

def update_mp_sites_from_cookies(cookie_data):
    """收到浏览器 CookieCloud 推送后，自动更新 MP site 表"""
    updated = 0
    try:
        conn = sqlite3.connect(MP_DB)
        for domain, cookies in cookie_data.items():
            # cookies 是该域名下的 cookie 字符串列表
            cookie_str = '; '.join([c if isinstance(c, str) else c.get('name','')+'='+c.get('value','') for c in cookies])
            if not cookie_str or len(cookie_str) < 10:
                continue
            cur = conn.execute(
                "UPDATE site SET cookie=?, lst_mod_date=datetime('now','localtime') WHERE is_active=1 AND domain LIKE ?",
                (cookie_str, '%' + domain.replace('www.', '') + '%')
            )
            updated += cur.rowcount
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[CookieCloud] update MP sites error: {e}")
    return updated

def load_config():
    cfg = {
        'emby_host': '', 'emby_api_key': '',
        'qb_host': '', 'qb_user': '', 'qb_pass': '', 'qb_api_key': '',
        'mp_db': '',
        'port': 28080,
        'proxy_url': '',
        'share_base_url': '',
        'svc_ports': {},
        'svc_aliases': {},
        'svc_favs': {},
        'svc_order': {},
        'device_titles': {},
        'ui_health_hidden': [],
        'ui_svc_hidden': [],
        'ui_health_flex': True,
        'ui_health_net_min': 244,
        'ui_health_net_max': 276,
        'ui_health_card_min': 190,
        'volume_aliases': {},
        'monitor_services': [],
        'favicon': '',
        'auth_enabled': True,
        'auth_username': 'admin',
        'auth_password_hash': '',
        'rbac': {
            'enabled': True,
            'roles': {},
            'users': [],
        },
    }
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            file_cfg = json.load(f)
        svc = file_cfg.get('services', {})
        cfg['services'] = svc  # 保留原始 services 子结构（pansou/online 等搜索源配置读取用）
        cfg['emby_host'] = svc.get('emby', {}).get('host', '')
        cfg['emby_api_key'] = svc.get('emby', {}).get('api_key', '')
        cfg['qb_host'] = svc.get('qbittorrent', {}).get('host', '')
        cfg['qb_user'] = svc.get('qbittorrent', {}).get('username', '')
        cfg['qb_pass'] = svc.get('qbittorrent', {}).get('password', '')
        cfg['qb_api_key'] = svc.get('qbittorrent', {}).get('api_key', '')
        cfg['tr_user'] = svc.get('transmission', {}).get('username', '')
        cfg['tr_pass'] = svc.get('transmission', {}).get('password', '')
        cfg['mp_db'] = svc.get('moviepilot', {}).get('db_path', cfg['mp_db'])
        cfg['mp_enabled'] = svc.get('moviepilot', {}).get('enabled', True)
        cfg['mp_script'] = svc.get('moviepilot', {}).get('script', '')
        cfg['mp_api_key'] = svc.get('moviepilot', {}).get('api_key', '')
        cfg['port'] = file_cfg.get('ports', {}).get('api', 28080)
        cfg['proxy_url'] = file_cfg.get('proxy_url', '')
        cfg['share_base_url'] = file_cfg.get('share_base_url', '') or ''
        cfg['svc_ports'] = file_cfg.get('svc_ports', {})
        cfg['svc_aliases'] = file_cfg.get('svc_aliases', {})
        cfg['svc_favs'] = file_cfg.get('svc_favs', {})
        cfg['svc_order'] = file_cfg.get('svc_order', {})
        cfg['device_titles'] = file_cfg.get('device_titles', {}) or {}
        cfg['ui_health_hidden'] = file_cfg.get('ui_health_hidden', []) or []
        cfg['ui_svc_hidden'] = file_cfg.get('ui_svc_hidden', []) or []
        cfg['ui_health_flex'] = file_cfg.get('ui_health_flex', True)
        cfg['ui_health_net_min'] = int(file_cfg.get('ui_health_net_min', 244) or 244)
        cfg['ui_health_net_max'] = int(file_cfg.get('ui_health_net_max', 276) or 276)
        cfg['ui_health_card_min'] = int(file_cfg.get('ui_health_card_min', 190) or 190)
        cfg['volume_aliases'] = file_cfg.get('volume_aliases', {})
        cfg['monitor_services'] = file_cfg.get('monitor_services', []) or []
        auth = file_cfg.get('auth', {})
        cfg['auth_enabled'] = auth.get('enabled', True)
        cfg['auth_username'] = auth.get('username', 'admin')
        cfg['auth_password_hash'] = auth.get('password_hash', '')
        rbac = file_cfg.get('rbac', {})
        cfg['rbac'] = {
            'enabled': rbac.get('enabled', True),
            'roles': rbac.get('roles', {}) or {},
            'users': rbac.get('users', []) or [],
        }
    except Exception as e:
        if os.path.exists(CONFIG_PATH):
            # P0-5: config.json 存在但损坏 → 拒绝启动，绝不静默回退 admin123
            print(f'[CRITICAL] {CONFIG_PATH} 损坏: {e}', flush=True)
            print('[CRITICAL] 为避免以弱口令 admin123 静默启动，服务拒绝运行。请备份修复 config.json 后重启。', flush=True)
            sys.exit(1)
        file_cfg = {}
    # 透传设置页可配置的自定义段（TMDB API Key 等）
    cfg['tmdb'] = file_cfg.get('tmdb', {}) or {}
    cfg['webhook'] = file_cfg.get('webhook', {}) or {}
    cfg['journey'] = file_cfg.get('journey', {}) or {}
    # 默认密码 hash (admin123)：仅在【首次安装】（config.json 尚不存在）时回填；
    # config 已存在但口令为空视为历史遗留（auth_enabled=False 或 RBAC 用户表在用），仅告警不拒绝启动。
    if not cfg['auth_password_hash']:
        if not os.path.exists(CONFIG_PATH):
            # R-05 修复：首装不再默认 admin123，改为随机初始口令（仅打印一次到日志），防止默认口令被爆破
            _init_pw = secrets.token_urlsafe(9)
            cfg['auth_password_hash'] = hashlib.sha256(_init_pw.encode()).hexdigest()
            print(f'[warn] 首次安装：已生成随机初始口令（仅本次打印，请登录后立即修改）: {_init_pw}', flush=True)
        else:
            print('[warn] config.json 存在但 auth_password_hash 为空，跳过弱口令回退（如已关闭认证或使用 RBAC 用户表则属正常）', flush=True)
    return cfg

CONFIG = load_config()
# 连接凭证：环境变量 > config.json（设置页 GUI 可改）；代码不内置任何本地配置，容器化部署全部经环境变量/挂载注入
EMBY_HOST = os.environ.get('DASH_EMBY_HOST', '') or (CONFIG['emby_host'] or '').rstrip('/')
EMBY_API_KEY = os.environ.get('DASH_EMBY_API_KEY', '') or CONFIG['emby_api_key']
QB_HOST = os.environ.get('DASH_QB_HOST', '') or (CONFIG['qb_host'] or '').rstrip('/')
QB_USER = os.environ.get('DASH_QB_USER', '') or CONFIG['qb_user']
QB_PASS = os.environ.get('DASH_QB_PASS', '') or CONFIG['qb_pass']
QB_API_KEY = os.environ.get('DASH_QB_API_KEY', '') or (CONFIG.get('qb_api_key') or '')

# ========== 认证与会话 ==========
SESSIONS = {}  # token -> {username, role, expires}
SESSION_LOCK = threading.Lock()
LOGIN_ATTEMPTS = {}  # ip -> {count, first_attempt}
SESSION_TTL = 30 * 24 * 3600  # 30 天，后端重启后从磁盘恢复
RATE_LIMIT_MAX = 5
RATE_LIMIT_WINDOW = 300  # 5 分钟

def _load_sessions():
    try:
        with open(SESSIONS_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        now = time.time()
        loaded = {}
        for tok, rec in data.items():
            if isinstance(rec, dict) and rec.get('expires', 0) > now:
                loaded[tok] = rec
        return loaded
    except Exception:
        return {}

def _save_sessions():
    try:
        with SESSION_LOCK:
            data = {tok: rec for tok, rec in SESSIONS.items() if rec.get('expires', 0) > time.time()}
        tmp = SESSIONS_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f)
        os.replace(tmp, SESSIONS_PATH)
    except Exception as e:
        print(f"[warn] save_sessions: {e}")

# 启动时恢复会话
SESSIONS = _load_sessions()

def create_session(username, role):
    token = secrets.token_urlsafe(32)
    with SESSION_LOCK:
        SESSIONS[token] = {'username': username, 'role': role, 'expires': time.time() + SESSION_TTL}
    _save_sessions()
    return token

def check_session(token):
    if not token:
        return None
    with SESSION_LOCK:
        s = SESSIONS.get(token)
        if not s:
            return None
        if time.time() > s['expires']:
            del SESSIONS[token]
            _save_sessions()
            return None
        # 滑动续期：每次使用延长有效期
        s['expires'] = time.time() + SESSION_TTL
        return s

def destroy_session(token):
    with SESSION_LOCK:
        SESSIONS.pop(token, None)
    _save_sessions()

def check_rate_limit(ip):
    now = time.time()
    rec = LOGIN_ATTEMPTS.get(ip)
    if rec and now - rec['first_attempt'] > RATE_LIMIT_WINDOW:
        LOGIN_ATTEMPTS.pop(ip, None)
        rec = None
    if rec and rec['count'] >= RATE_LIMIT_MAX:
        return False
    return True

def record_failed_attempt(ip):
    now = time.time()
    rec = LOGIN_ATTEMPTS.get(ip)
    if not rec or now - rec['first_attempt'] > RATE_LIMIT_WINDOW:
        LOGIN_ATTEMPTS[ip] = {'count': 1, 'first_attempt': now}
    else:
        rec['count'] += 1

def clear_attempts(ip):
    LOGIN_ATTEMPTS.pop(ip, None)

def verify_password(password):
    return hashlib.sha256(password.encode()).hexdigest() == CONFIG['auth_password_hash']

# ========== 脚本索引与运行状态 ==========
SCRIPTS_DIR = os.environ.get('DASH_SCRIPTS_DIR', '')
SCRIPT_RUNS_PATH = os.path.join(DATA_DIR, 'script_runs.json')
SCRIPT_EXTS = ('.py', '.sh', '.bash')
SCRIPT_SKIP_DIRS = {'__pycache__', '_archive', 'backup', '.git', '.ipynb_checkpoints'}

# ========== 通知聚合端点 ==========
INCOMING_PATH = os.path.join(DATA_DIR, 'incoming.json')
INCOMING_MAX = 200  # 最多保留 200 条消息

def _load_incoming():
    try:
        with open(INCOMING_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []

def _save_incoming(data):
    try:
        tmp = INCOMING_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, INCOMING_PATH)
    except Exception as e:
        print(f"[warn] save_incoming: {e}")

def _load_script_runs():
    try:
        with open(SCRIPT_RUNS_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

def _save_script_runs(data):
    try:
        tmp = SCRIPT_RUNS_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, SCRIPT_RUNS_PATH)
    except Exception as e:
        print(f"[warn] save_script_runs: {e}")

def scan_scripts():
    """扫描 SCRIPTS_DIR 下所有脚本文件，返回索引列表"""
    results = []
    if not os.path.isdir(SCRIPTS_DIR):
        return results
    for name in sorted(os.listdir(SCRIPTS_DIR)):
        if name.startswith('.') or name.endswith('.bak') or '.bak.' in name:
            continue
        full = os.path.join(SCRIPTS_DIR, name)
        if os.path.isdir(full):
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext not in SCRIPT_EXTS:
            continue
        try:
            st = os.stat(full)
        except Exception:
            continue
        # 读取首行 shebang
        shebang = ''
        try:
            with open(full, 'r', encoding='utf-8', errors='ignore') as f:
                first = f.readline().strip()
                if first.startswith('#!'):
                    shebang = first[:120]
        except Exception:
            pass
        results.append({
            'name': name,
            'ext': ext,
            'size': st.st_size,
            'mtime': st.st_mtime,
            'executable': bool(st.st_mode & 0o111),
            'shebang': shebang,
        })
    return results

# 运行中脚本集合（删除/保存防护：正在运行的脚本不允许被删除或覆盖）
RUNNING_SCRIPTS = set()

def _script_safe_name(name):
    """校验脚本名安全：非空、basename 一致（禁止路径穿越）、扩展名合法。返回 (safe, err)"""
    if not name or not isinstance(name, str):
        return '', '非法脚本名'
    safe = os.path.basename(name)
    if safe != name or not safe:
        return '', '非法脚本名'
    ext = os.path.splitext(safe)[1].lower()
    if ext not in SCRIPT_EXTS:
        return '', f'不支持的扩展名（仅允许 {" / ".join(SCRIPT_EXTS)}）'
    return safe, ''

def read_script(name):
    """读取脚本内容（任务15：查看脚本源码）"""
    safe, err = _script_safe_name(name)
    if err:
        return {'ok': False, 'error': err}
    full = os.path.join(SCRIPTS_DIR, safe)
    if not os.path.isfile(full):
        return {'ok': False, 'error': '脚本不存在'}
    try:
        with open(full, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
        return {'ok': True, 'name': safe, 'content': content}
    except Exception as e:
        return {'ok': False, 'error': '读取失败: ' + str(e)}

def save_script(name, content):
    """新建或编辑脚本（任务15）。返回保存后的扫描条目（含 last_run 字段拼接）。"""
    safe, err = _script_safe_name(name)
    if err:
        return {'ok': False, 'error': err}
    if safe in RUNNING_SCRIPTS:
        return {'ok': False, 'error': f'脚本 {safe} 正在运行，无法保存，请等待运行结束后再试'}
    if content is None or not isinstance(content, str):
        return {'ok': False, 'error': '脚本内容不能为空'}
    if len(content) > 512 * 1024:
        return {'ok': False, 'error': '脚本内容超过 512KB 限制'}
    full = os.path.join(SCRIPTS_DIR, safe)
    try:
        tmp = full + '.tmp'
        with open(tmp, 'w', encoding='utf-8', newline='') as f:
            f.write(content)
        os.replace(tmp, full)
        try:
            os.chmod(full, 0o755)
        except Exception:
            pass
        # 删除旧运行记录（内容已变，状态不再可信）
        runs = _load_script_runs()
        if safe in runs:
            del runs[safe]
            _save_script_runs(runs)
        return {'ok': True, 'name': safe}
    except Exception as e:
        try:
            if os.path.exists(full + '.tmp'):
                os.remove(full + '.tmp')
        except Exception:
            pass
        return {'ok': False, 'error': '保存失败: ' + str(e)}

def delete_script(name):
    """删除脚本（任务15）。防护：正在运行中的脚本不可删除。"""
    safe, err = _script_safe_name(name)
    if err:
        return {'ok': False, 'error': err}
    if safe in RUNNING_SCRIPTS:
        return {'ok': False, 'error': f'脚本 {safe} 正在运行，无法删除，请等待运行结束后再试'}
    full = os.path.join(SCRIPTS_DIR, safe)
    if not os.path.isfile(full):
        return {'ok': False, 'error': '脚本不存在'}
    try:
        os.remove(full)
        runs = _load_script_runs()
        if safe in runs:
            del runs[safe]
            _save_script_runs(runs)
        return {'ok': True, 'name': safe}
    except Exception as e:
        return {'ok': False, 'error': '删除失败: ' + str(e)}

def run_script(name):
    """手动运行脚本，记录退出码和输出尾部"""
    # 安全：只允许 SCRIPTS_DIR 下的文件名，禁止路径穿越
    safe = os.path.basename(name)
    if safe != name or not safe:
        return {'ok': False, 'error': '非法脚本名'}
    full = os.path.join(SCRIPTS_DIR, safe)
    if not os.path.isfile(full):
        return {'ok': False, 'error': '脚本不存在'}
    ext = os.path.splitext(safe)[1].lower()
    if ext == '.py':
        cmd = ['python3', full]
    elif ext in ('.sh', '.bash'):
        cmd = ['bash', full]
    else:
        return {'ok': False, 'error': f'不支持的扩展名 {ext}'}
    started = time.time()
    RUNNING_SCRIPTS.add(safe)
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300, cwd=SCRIPTS_DIR)
        rc = proc.returncode
        out = (proc.stdout or '')[-4000:]
        err = (proc.stderr or '')[-4000:]
    except subprocess.TimeoutExpired:
        rc = -1
        out = ''
        err = '运行超时（300 秒）'
    except Exception as e:
        rc = -2
        out = ''
        err = str(e)
    finally:
        RUNNING_SCRIPTS.discard(safe)
    duration = time.time() - started
    runs = _load_script_runs()
    runs[safe] = {
        'last_run': started,
        'exit_code': rc,
        'duration': round(duration, 2),
        'output_tail': out[-2000:],
        'error_tail': err[-2000:],
    }
    _save_script_runs(runs)
    return {'ok': rc == 0, 'exit_code': rc, 'duration': round(duration, 2),
            'output_tail': out[-2000:], 'error_tail': err[-2000:]}

PUBLIC_PATHS = {'/api/login', '/cookiecloud/sync', '/'}
STATIC_EXT = ('.html', '.css', '.js', '.png', '.jpg', '.ico', '.svg', '.woff', '.woff2', '.ttf')
MP_DB = os.environ.get('DASH_MP_DB', '') or (CONFIG.get('mp_db') or '')  # MP user.db 路径（环境变量 > GUI 配置）
_mp_cfg = (CONFIG.get('services') or {}).get('moviepilot') or {}
MP_SUB_SCRIPT = os.environ.get('DASH_MP_SUB_SCRIPT', '') or (_mp_cfg.get('script') or '')  # 写库脚本（环境变量 > GUI 配置）
MP_ENABLED = bool(_mp_cfg.get('enabled', True))  # MP 接入开关

# 动态读取（POST /api/config 保存后立即生效，无需重启）
def _mp_enabled():
    return bool(CONFIG.get('mp_enabled', True))
def _mp_db():
    return CONFIG.get('mp_db') or MP_DB
def _mp_script():
    return CONFIG.get('mp_script') or MP_SUB_SCRIPT
API_PORT = int(os.environ.get('DASH_API_PORT', CONFIG['port']))

SA_HOST = os.environ.get('DASH_SA_HOST', '127.0.0.1')
DS_HOST = os.environ.get('DASH_DS_HOST', '')
EMBY_USER_ID = os.environ.get('DASH_EMBY_USER_ID', '') or ((CONFIG.get('services') or {}).get('emby') or {}).get('user_id', '')  # 用户 ID（环境变量/GUI 注入）

# ========== RBAC（角色权限 + 媒体范围） ==========
# 权限树：大类 + 子权限。权限键 = 'page'（全开该页所有子权限）或 'page:sub'（单子权限）。
PERM_TREE = {
    'overview':     {'label': '总览',     'subs': ['view']},
    'applications': {'label': '服务',     'subs': ['view', 'config']},
    'media':        {'label': '媒体库',   'subs': ['view', 'detail']},
    'search':       {'label': '搜索',     'subs': ['all', 'bing', 'pansou', 'tmdb', 'douban']},
    'trending':     {'label': '流行趋势', 'subs': ['view']},
    'transfers':    {'label': '下载活动', 'subs': ['view', 'limit', 'manage']},
    'storage':      {'label': '存储',     'subs': ['view']},
    'scripts':      {'label': '脚本',     'subs': ['view', 'run', 'manage']},
    'events':       {'label': '活动日志', 'subs': ['view']},
    'settings':     {'label': '设置',     'subs': ['view', 'manage', 'rbac']},
}
ALL_PERMS = list(PERM_TREE.keys())
ALL_PERM_KEYS = [p + ':' + s for p, t in PERM_TREE.items() for s in t['subs']]

def _has_perm(perms, perm):
    """判断角色权限是否包含 perm（可为 'page' 或 'page:sub'）。
    - 权限数组为空 = 全放开（RBAC 关闭 / 旧后端兼容）
    - 拥有大类键 'page' = 该页全部子权限
    - 页面级检查（无冒号）：拥有该页任一子权限即放行"""
    if not perms:
        return True
    if perm in perms:
        return True
    page = perm.split(':')[0]
    if page in perms:
        return True
    if ':' not in perm:
        return any(x.startswith(page + ':') for x in perms)
    return False

# 各 API 端点需要的最小权限（可精确到子权限）
PATH_PERM = {
    '/api/status': 'overview',
    '/api/storage': 'storage',
    '/api/torrents': 'transfers',
    '/api/limits': 'transfers:limit',
    '/api/media': 'media',
    '/api/recent': 'media',
    '/api/carousel': 'media',
    '/api/search/emby': 'media',
    '/api/search/pt': 'search',
    '/api/search/pansou': 'search',
    '/api/search/online': 'search',
    '/api/tmdb/detail': 'media',
    '/api/trending': 'trending',
    '/api/apps': 'applications',
    '/api/test-service': 'applications:config',
    '/api/scripts': 'scripts',
    '/api/scripts/read': 'scripts:view',
    '/api/scripts/save': 'scripts:manage',
    '/api/scripts/delete': 'scripts:manage',
    '/api/events': 'events',
    '/api/incoming': None,  # 公开端点，外部服务/脚本推消息用
    '/api/config': 'settings',
    '/api/restart': 'settings:manage',
}

def endpoint_perm(path):
    if path.startswith('/api/detail/'):
        return 'media:detail'
    return PATH_PERM.get(path)

def _mask_secret(v):
    """R-09：敏感配置脱敏（非空值一律掩码，避免 /api/config 明文回传凭据）"""
    return '******' if v else ''

def get_role(role_name):
    """返回角色定义。admin 角色内置全权限 + 默认媒体范围(空=用户m)。"""
    if role_name == 'admin':
        return {'permissions': list(ALL_PERMS), 'emby_user': '', 'name': 'admin'}
    roles = (CONFIG.get('rbac') or {}).get('roles', {}) or {}
    r = roles.get(role_name) or {}
    return {
        'permissions': list(r.get('permissions', [])),
        'emby_user': r.get('emby_user', '') or '',
        'name': role_name,
    }

def find_user(username):
    """按用户名找账号：管理员(auth) 或 rbac.users 普通账号。返回 None 表示不存在。"""
    if not username:
        return None
    if username == CONFIG.get('auth_username', 'admin'):
        return {'username': username, 'role': 'admin', 'is_admin': True}
    for u in (CONFIG.get('rbac') or {}).get('users', []) or []:
        if u.get('username') == username:
            return {'username': username, 'role': u.get('role', 'member'), 'is_admin': False}
    return None

def user_password_hash(username):
    if not username:
        return ''
    if username == CONFIG.get('auth_username', 'admin'):
        return CONFIG.get('auth_password_hash', '')
    for u in (CONFIG.get('rbac') or {}).get('users', []) or []:
        if u.get('username') == username:
            return u.get('password_hash', '')
    return ''



# ========== 工具 ==========
def run_cmd(cmd, timeout=5):
    try:
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception:
        return ''

def http_get(url, timeout=5, headers=None):
    try:
        req = urllib.request.Request(url)
        if headers:
            for k, v in headers.items():
                req.add_header(k, v)
        # 强制直连：NAS 若有失效的 http_proxy 环境变量，urllib 默认走代理会全部失败；curl 实测直连可用
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        resp = opener.open(req, timeout=timeout)
        return resp.read().decode()
    except Exception as e:
        return None

def _current_proxy_url():
    """实时读取当前外网代理 URL（支持设置页热更新，无需重启）：环境变量 DASH_PROXY_URL > config.json proxy_url；空则直连"""
    return (os.environ.get('DASH_PROXY_URL', '') or (CONFIG.get('proxy_url') or '')).strip()

def _proxy_opener():
    """经代理网关访问外网（未配置代理时直接连接）"""
    import ssl
    ctx = ssl.create_default_context()
    _px = _current_proxy_url()
    if not _px:
        return urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))
    proxy = {'http': _px, 'https': _px}
    return urllib.request.build_opener(urllib.request.ProxyHandler(proxy))

def http_get_proxy(url, timeout=10, headers=None):
    try:
        req = urllib.request.Request(url)
        if headers:
            for k, v in headers.items():
                req.add_header(k, v)
        resp = _proxy_opener().open(req, timeout=timeout)
        return resp.read().decode('utf-8', 'ignore')
    except Exception as e:
        return None

def _search_ddrk(keyword, base='https://ddrk.one'):
    """搜索低端影视（ddrk.one 或 GUI 配置的在线源），返回结构化结果列表（代理网关偶发不通，最多重试 3 次）"""
    enc = urllib.parse.quote(keyword)
    base = (base or 'https://ddrk.one').rstrip('/')
    url = base + '/?s=' + enc
    html = None
    for t in (12, 12, 15):
        html = http_get_proxy(url, timeout=t, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        if html:
            break
    if not html:
        return []
    results = []
    # 解析 <h2 class="post-box-title"><a href="/vod/ID/" rel="bookmark">标题 (更新至 XXX)</a></h2>
    import re
    pattern = r'<h2[^>]*post-box-title[^>]*>\s*<a\s+href="([^"]+)"[^>]*>([^<]+)</a>'
    for m in re.finditer(pattern, html):
        href = m.group(1)
        title_raw = m.group(2).strip()
        # 分离标题和更新状态
        quality = ''
        name = title_raw
        if '(' in title_raw and title_raw.endswith(')'):
            lp = title_raw.rfind('(')
            name = title_raw[:lp].strip()
            quality = title_raw[lp+1:-1].strip()
        full_url = base + href if href.startswith('/') else href
        results.append({
            'title': name,
            'quality': quality,
            'url': full_url,
            'source': '低端影视',
            'icon': '🎬',
        })
    return results

def _to_punycode(domain):
    """将中文域名转为 punycode"""
    import encodings.idna
    parts = domain.split('.')
    out = []
    for p in parts:
        try:
            if p.isascii():
                out.append(p)
            else:
                out.append(encodings.idna.ToASCII(p).decode('ascii'))
        except Exception:
            out.append(p)
    return '.'.join(out)

def _online_bases():
    """在线观影源列表（支持多源；兼容旧单值 url）"""
    try:
        ov = (CONFIG.get('services', {}) or {}).get('online', {}) or {}
    except Exception:
        ov = {}
    urls = ov.get('urls') or []
    if not urls and ov.get('url'):
        urls = [ov.get('url')]
    return [u.strip().rstrip('/') for u in urls if u and u.strip()]

def _search_online(keyword):
    """在线观影搜索：GUI 可配置多个在线源（默认 ddrk.one）+ 影片名域名兜底"""
    results = []
    for base in _online_bases():
        try:
            results.extend(_search_ddrk(keyword, base))
        except Exception:
            continue
    # 兜底：影片名域名（www.电影名.com，自动 punycode + /tv 路径）
    clean_name = re.sub(r'\(\d{4}\)|\d{4}$', '', keyword).strip()
    if clean_name:
        domain = 'www.' + clean_name + '.com'
        puny_domain = _to_punycode(domain)
        results.append({
            'title': clean_name,
            'quality': '在线观影',
            'url': 'https://' + puny_domain + '/tv',
            'source': '域名直连',
            'icon': '🌐',
        })
    return results

def _iqiyi_rank(limit=10):
    """爱奇艺风云榜·电视剧（页面 title 交替：剧名 / 年份题材主演）。"""
    import re as _re
    try:
        html = http_get_proxy('https://www.iqiyi.com/ranks1PCW/2/-6', timeout=15,
                       headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.iqiyi.com/'})
        if not html:
            return []
        # 提取封面图：榜单条目里的 img src
        imgs = _re.findall(r'<img[^>]+(?:data-src|src)="(https?://[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"', html, _re.I)
        ts = _re.findall(r'title="([^"]{2,60})"', html)
        out = []
        img_idx = 0
        for i in range(len(ts) - 1):
            if len(out) >= limit:
                break
            if '/' not in ts[i] and '/' in ts[i + 1]:
                name = ts[i].strip()
                m = _re.match(r'(\d{4})\s*/\s*([^/]+)', ts[i + 1])
                # 取一张未用过的封面（跳过前几张非封面图）
                cover = ''
                while img_idx < len(imgs):
                    cand = imgs[img_idx]
                    img_idx += 1
                    if 'logo' not in cand.lower() and 'icon' not in cand.lower() and 'avatar' not in cand.lower():
                        cover = cand
                        break
                out.append({
                    'title': name, 'year': m.group(1) if m else '',
                    'genres': (m.group(2).strip() if m else '').replace('  ', ' '),
                    'extra': '剧集', 'rate': '', 'cover': cover,
                    'country': '中国大陆',
                })
        return out
    except Exception:
        return []

def _get_trending(platform='all'):
    """获取各平台热门影视"""
    result = {}
    # B站热门
    if platform in ('all', 'bilibili'):
        try:
            html = http_get_proxy('https://api.bilibili.com/x/web-interface/popular?ps=10&pn=1', timeout=10,
                           headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com'})
            if html:
                data = json.loads(html)
                items = data.get('data', {}).get('list', [])
                result['bilibili'] = [{
                    'title': it.get('title', ''),
                    'owner': (it.get('owner', {}).get('name', '') or '').replace('UP ', '').replace('up ', ''),
                    'play': it.get('stat', {}).get('view', 0),
                    'cover': it.get('pic', ''),
                    'url': 'https://www.bilibili.com/video/' + it.get('bvid', ''),
                } for it in items[:10]]
        except Exception:
            result['bilibili'] = []
    # 豆瓣热门电影（公开榜）
    if platform in ('all', 'douban'):
        result['douban'] = _douban_subjects('movie')
        result['douban_tv'] = _douban_subjects('tv')
    # 爱奇艺风云榜·电视剧
    if platform in ('all', 'iqiyi'):
        result['iqiyi'] = _iqiyi_rank()
    return result

_TMDB_GMAP = None
def _tmdb_genre_name(gid):
    """TMDB genre id → 中文名（模块级缓存，避免每次富化重复请求 genre/list）"""
    global _TMDB_GMAP
    if _TMDB_GMAP is None:
        _TMDB_GMAP = {}
        for m in ('movie', 'tv'):
            try:
                gd = _tmdb_get('3/genre/%s/list' % m)
                for g in (gd or {}).get('genres', []):
                    _TMDB_GMAP[g['id']] = g['name']
            except Exception:
                pass
    return _TMDB_GMAP.get(gid, '')

def _tmdb_poster_by_title(title, is_tv):
    """按标题查 TMDB 拿高清海报（w500）+ 官方简介（overview）+ 年份 + 题材；返回 dict{poster, overview, year, genres}。豆瓣富化接口失效时用于补全卡片字段。"""
    try:
        t = (title or '').strip()
        if not t:
            return {'poster': '', 'overview': '', 'year': '', 'genres': '', 'country': '', 'duration': ''}
        data = _tmdb_get("search/%s?query=%s&page=1" % ('tv' if is_tv else 'movie', urllib.parse.quote(t)))
        for it in (data.get('results') or [])[:5]:
            if not (it.get('name') or it.get('title')):
                continue
            genres = '、'.join([_tmdb_genre_name(gid) for gid in (it.get('genre_ids') or [])[:3]])
            return {
                'poster': "https://image.tmdb.org/t/p/w500" + it['poster_path'] if it.get('poster_path') else '',
                'overview': (it.get('overview') or '').strip()[:140],
                'year': str(it.get('release_date') or it.get('first_air_date') or '')[:4],
                'genres': genres,
                'country': '',
                'duration': '',
            }
        return {'poster': '', 'overview': '', 'year': '', 'genres': '', 'country': '', 'duration': ''}
    except Exception:
        return {'poster': '', 'overview': '', 'year': '', 'genres': '', 'country': '', 'duration': ''}

# ===== 影视卡季集信息（趋势=内存缓存30日TTL，媒体库=持久化存储）=====
_TMDB_SEASON_MEM = {}               # key -> [ts, data]，趋势内存缓存（30日未访问清除）
_MEDIA_SEASON_FILE = os.path.join(DATA_DIR, 'media_season_cache.json')
_MEDIA_SEASON_CACHE = {}            # key -> data，媒体库持久化缓存

def _load_media_season_cache():
    try:
        if os.path.exists(_MEDIA_SEASON_FILE):
            with open(_MEDIA_SEASON_FILE, 'r', encoding='utf-8') as f:
                _MEDIA_SEASON_CACHE.update(json.load(f) or {})
    except Exception:
        pass

def _save_media_season_cache():
    try:
        tmp = _MEDIA_SEASON_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(_MEDIA_SEASON_CACHE, f, ensure_ascii=False)
        os.replace(tmp, _MEDIA_SEASON_FILE)
    except Exception:
        pass

_load_media_season_cache()

def _tmdb_season_info(title, year, is_tv, persist=False):
    """按标题+年份查 TMDB 补齐剧集季集字段。
    persist=True 走持久化（媒体库卡）；False 走内存缓存、30 日未访问清除（趋势卡）。
    返回 {total_seasons, total_episodes, status, current_season, eps_done, eps_in_season}；匹配不到返回 {}。"""
    title = (title or '').strip()
    if not title:
        return {}
    key = ('tv' if is_tv else 'movie') + '|' + title + '|' + (str(year or ''))
    now = time.time()
    if persist:
        hit = _MEDIA_SEASON_CACHE.get(key)
        if hit is not None:
            return hit
    else:
        ent = _TMDB_SEASON_MEM.get(key)
        if ent and now - ent[0] < 30 * 86400:
            return ent[1]
        if ent:
            del _TMDB_SEASON_MEM[key]
    try:
        mt = 'tv' if is_tv else 'movie'
        data = _tmdb_get('search/%s?query=%s&page=1&include_adult=false' % (mt, urllib.parse.quote(title)))
        best = None
        for it in (data or {}).get('results') or []:
            y = str(it.get('release_date') or it.get('first_air_date') or '')[:4]
            if year and y and y != str(year):
                continue
            if best is None or (it.get('vote_count') or 0) > (best.get('vote_count') or 0):
                best = it
        if not best:
            r = {}
        else:
            det = _tmdb_get('%s/%s?append_to_response=seasons' % (mt, best.get('id'))) or {}
            st = det.get('status', '')
            out = {
                'total_seasons': det.get('number_of_seasons') or 0,
                'total_episodes': det.get('number_of_episodes') or 0,
                'status': _STATUS_CN.get(st, st),
                'current_season': 0,
                'eps_done': 0,
                'eps_in_season': 0,
            }
            nea = det.get('next_episode_to_air') or {}
            lea = det.get('last_episode_to_air') or {}
            cur = nea.get('season_number') or lea.get('season_number') or 0
            out['current_season'] = cur
            if cur:
                if (lea.get('season_number') or 0) == cur:
                    out['eps_done'] = lea.get('episode_number') or 0
                for s in (det.get('seasons') or []):
                    if s.get('season_number') == cur:
                        out['eps_in_season'] = s.get('episode_count') or 0
                        break
            r = out
    except Exception:
        r = {}
    if persist:
        _MEDIA_SEASON_CACHE[key] = r
        _save_media_season_cache()
    else:
        _TMDB_SEASON_MEM[key] = (now, r)
    return r

def clear_season_cache(persist=False):
    """清理季集缓存。persist=True 清媒体库持久化文件；False 清趋势内存缓存。返回清理条数。"""
    if persist:
        cleared = len(_MEDIA_SEASON_CACHE)
        _MEDIA_SEASON_CACHE.clear()
        try:
            if os.path.exists(_MEDIA_SEASON_FILE):
                os.remove(_MEDIA_SEASON_FILE)
        except Exception:
            pass
    else:
        cleared = len(_TMDB_SEASON_MEM)
        _TMDB_SEASON_MEM.clear()
    return cleared

def _tmdb_trend_fallback(dtype):
    """豆瓣热门被风控（列表接口返回 200+空 subjects）时用 TMDB 每日流行兜底，字段与豆瓣富化结构一致（title/year/rate/cover/url/extra/genres/country/duration/intro）"""
    import concurrent.futures as _cf
    media = 'tv' if dtype == 'tv' else 'movie'
    data = _tmdb_get('3/trending/%s/day?page=1' % media)
    results = (data or {}).get('results', [])[:10]
    if not results:
        return []
    gmap = {}
    try:
        gd = _tmdb_get('3/genre/%s/list' % media)
        gmap = {g['id']: g['name'] for g in (gd or {}).get('genres', [])}
    except Exception:
        pass

    def _detail(it):
        try:
            return _tmdb_get('3/%s/%s' % (media, it.get('id'))) or {}
        except Exception:
            return {}

    details = {}
    try:
        with _cf.ThreadPoolExecutor(max_workers=4) as ex:
            for it, d in zip(results, ex.map(_detail, results)):
                if d:
                    details[it.get('id')] = d
    except Exception:
        pass
    out = []
    for it in results:
        d = details.get(it.get('id'), {}) or {}
        rel = it.get('release_date') or it.get('first_air_date') or d.get('release_date') or d.get('first_air_date') or ''
        countries = [c.get('name', '') for c in (d.get('production_countries') or []) if c.get('name')]
        runtime = ''
        if media == 'movie':
            runtime = str(d.get('runtime') or '')
        else:
            er = d.get('episode_run_time') or []
            runtime = str(er[0]) if er else ''
        out.append({
            'title': it.get('title') or it.get('name') or '',
            'year': str(rel)[:4],
            'rate': str(round(float(it.get('vote_average') or 0), 1)),
            'cover': ("https://image.tmdb.org/t/p/w500" + it['poster_path']) if it.get('poster_path') else '',
            'url': 'https://www.themoviedb.org/%s/%s' % (media, it.get('id')),
            'extra': '剧集' if dtype == 'tv' else '电影',
            'genres': '、'.join([gmap.get(gid, '') for gid in it.get('genre_ids', []) if gmap.get(gid)]),
            'country': '、'.join([c for c in countries if c]),
            'duration': runtime,
            'intro': (it.get('overview') or '').strip()[:140],
        })
    return out

def _douban_subjects(dtype):
    """豆瓣热门榜。补齐与媒体库搜索卡一致的字段：year / extra(电影|剧集) / genres / duration / intro"""
    import re as _re
    import concurrent.futures as _cf
    import time as _time

    if not hasattr(_douban_subjects, '_cache'):
        _douban_subjects._cache = {}
    _ENRICH_CACHE = _douban_subjects._cache  # url -> [ts, result]，进程内缓存，缓解豆瓣限流
    _CACHE_TTL = 1800
    if not hasattr(_douban_subjects, '_result_cache'):
        _douban_subjects._result_cache = {}
    _RESULT_CACHE = _douban_subjects._result_cache  # dtype -> [ts, out]，榜单结果缓存 15min，大幅降频
    _RESULT_TTL = 900
    _ckey = dtype
    _chit = _RESULT_CACHE.get(_ckey)
    if _chit and _time.time() - _chit[0] < _RESULT_TTL:
        return _chit[1]

    def _enrich(url):
        """豆瓣条目富化：年份 + 题材 + 国家 + 时长（subject_abstract 内嵌接口，免抓条目页被反爬）"""
        try:
            hit = _ENRICH_CACHE.get(url)
            if hit and _time.time() - hit[0] < _CACHE_TTL:
                return hit[1]
            m = _re.search(r'/subject/(\d+)/', url or '')
            if not m:
                return {'year': '', 'genres': '', 'country': '', 'duration': ''}
            for attempt in (0, 1):  # 失败重试一次，间隔 0.6s，缓解瞬时限流
                try:
                    h = http_get('https://movie.douban.com/j/subject_abstract?subject_id=' + m.group(1), timeout=6,
                                 headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://movie.douban.com/'})
                    if h:
                        data = json.loads(h)
                        s = data.get('subject', {}) or {}
                        regions = s.get('regions') or []
                        res = {
                            'year': str(s.get('release_year') or ''),
                            'genres': '、'.join(g for g in (s.get('types') or []) if g),
                            'country': '、'.join(r for r in regions if r),
                            'duration': (s.get('duration') or '').strip(),
                        }
                        _ENRICH_CACHE[url] = [_time.time(), res]
                        return res
                except Exception:
                    pass
                if attempt == 0:
                    _time.sleep(0.6)
            return {'year': '', 'genres': '', 'country': '', 'duration': ''}
        except Exception:
            return {'year': '', 'genres': '', 'country': '', 'duration': ''}

    try:
        html = http_get('https://movie.douban.com/j/search_subjects?type=' + dtype + '&tag=%E7%83%AD%E9%97%A8&page_limit=10&page_start=0',
                       timeout=10, headers={'User-Agent': 'Mozilla/5.0'})
        if not html:
            print(f"[warn] douban_list empty: {dtype}", flush=True)
        if html:
            data = json.loads(html)
            out = []
            subjects = data.get('subjects', [])[:10]
            if not subjects:
                # 豆瓣列表接口被 NAS IP 风控时返回 200+空 subjects：TMDB 每日流行兜底，保证卡片字段完整；空结果不写缓存，避免 15min 空缓存
                print("[warn] douban subjects empty, fallback tmdb", flush=True)
                fb = _tmdb_trend_fallback(dtype)
                if fb:
                    _RESULT_CACHE[_ckey] = [_time.time(), fb]
                    return fb
                return []
            enriched = {}
            posters = {}
            intros = {}
            try:
                with _cf.ThreadPoolExecutor(max_workers=4) as ex:
                    urls = [it.get('url', '') for it in subjects]
                    for u, e, tm in zip(urls,
                                       ex.map(_enrich, urls),
                                       ex.map(lambda s: _tmdb_poster_by_title(s.get('title', ''), dtype == 'tv'), subjects)):
                        if u:
                            # 豆瓣 subject_abstract 富化接口已失效（返回 {"r":"error"}）：缺失字段用 TMDB 补全
                            merged = dict(e)
                            for k in ('year', 'genres', 'country', 'duration'):
                                if not merged.get(k) and tm.get(k):
                                    merged[k] = tm[k]
                            enriched[u] = merged
                        if u and tm and tm.get('poster'):
                            posters[u] = tm['poster']
                        if u and tm and tm.get('overview'):
                            intros[u] = tm['overview']
            except Exception:
                pass
            for it in subjects:
                title = it.get('title', '')
                url = it.get('url', '')
                en = enriched.get(url, {})
                title_clean = _re.sub(r'\s*[（(]?(19|20)\d{2}[）)]?\s*$', '', title).strip()
                out.append({
                    'title': title_clean,
                    'year': en.get('year', ''),
                    'rate': it.get('rate', ''),
                    'cover': posters.get(url) or it.get('cover', ''),
                    'url': url,
                    'extra': '剧集' if dtype == 'tv' else '电影',
                    'genres': en.get('genres', ''),
                    'country': en.get('country', ''),
                    'duration': en.get('duration', ''),
                    'intro': intros.get(url, ''),
                })
            _RESULT_CACHE[_ckey] = [_time.time(), out]
            return out
    except Exception as e:
        print(f"[warn] douban_list err: {e}", flush=True)
        _old = _RESULT_CACHE.get(_ckey)
        if _old:
            return _old[1]
        return []

    _old = _RESULT_CACHE.get(_ckey)
    if _old:
        return _old[1]
    return []
    return []

def get_cpu_usage():
    try:
        with open('/proc/stat') as f:
            l1 = f.readline().split()
        time.sleep(0.1)
        with open('/proc/stat') as f:
            l2 = f.readline().split()
        idle1, total1 = int(l1[4]), sum(int(x) for x in l1[1:])
        idle2, total2 = int(l2[4]), sum(int(x) for x in l2[1:])
        dt, di = total2 - total1, idle2 - idle1
        return round((1 - di / dt) * 100, 1) if dt else None
    except Exception:
        return None

def get_memory_usage():
    try:
        info = {}
        with open('/proc/meminfo') as f:
            for line in f:
                p = line.split(':')
                if len(p) == 2:
                    info[p[0]] = int(p[1].strip().split()[0])
        total, avail = info.get('MemTotal', 0), info.get('MemAvailable', 0)
        return round((1 - avail / total) * 100, 1) if total else None
    except Exception:
        return None

def _storage_cfg():
    """storage 可配置段（volume_pattern / devices）。从 config.json 读，缺省用内建默认。"""
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f).get('storage', {})
    except Exception:
        return {}

def _storage_devices():
    """存储设备定义：[{name, match:[source 子串]}]。可 GUI 配置；缺省按当前设备。"""
    devs = _storage_cfg().get('devices')
    if devs:
        return [d for d in devs if d.get('name')]
    return [{'name': 'SA', 'match': ['/dev/mapper']},
            {'name': 'DS', 'match': []}]

def _volume_pattern():
    """df 过滤的挂载路径模式，可 GUI 配置（可含业务目录 /qb /tr 等）。"""
    return _storage_cfg().get('volume_pattern') or '/m[0-9]|/volume[0-9]|/md/'

def _classify_device(source):
    """按挂载源匹配设备；未命中归「本地」。"""
    for d in _storage_devices():
        for m in (d.get('match') or []):
            if m and m in source:
                return d.get('name', '本地')
    return '本地'

def get_disk_usage():
    # 用 df -Pk（而非 -B1）：df -B1 会在 SMB/极空间这类远程卷上阻塞数秒，导致 /api/storage 超时
    result = run_cmd(f"df -Pk | grep -E '{_volume_pattern()}'")
    pools = []
    aliases = CONFIG.get('volume_aliases', {})
    sc = _storage_cfg()
    vols = sc.get('volumes') or {}
    for line in result.split('\n'):
        if not line: continue
        parts = line.split()
        if len(parts) >= 6:
            try:
                mount = parts[5]
                # 过滤容器自身 overlay 内部挂载（@docker/btrfs/subvolumes 下的 dev/shm/cgroup 等），避免 df 展示噪音
                if '/subvolumes/' in mount:
                    continue
                vcfg = vols.get(mount, {})
                if vcfg.get('show') is False:
                    continue
                pools.append({
                    'mount': mount,
                    'alias': vcfg.get('alias') or aliases.get(mount, '') or aliases.get(parts[0], ''),
                    'source': parts[0],
                    'device': vcfg.get('device') or _classify_device(parts[0]),
                    'size_bytes': int(parts[1]) * 1024,
                    'used_bytes': int(parts[2]) * 1024,
                    'avail_bytes': int(parts[3]) * 1024,
                    'percent': int(parts[4].replace('%', '')),
                })
            except ValueError:
                continue
    # 同一物理卷（相同挂载源 source）只统计一次：优先保留 /m 开头的业务卷别名
    seen_src = {}
    pools_dedup = []
    for p in pools:
        s = p['source']
        if s in seen_src:
            # 已有记录，比较哪个挂载点更"业务"（/m1-/m8 优先于 /qb /tr /qbvt 等下载器目录）
            old = seen_src[s]
            old_is_biz = old['mount'].startswith('/m') and len(old['mount']) <= 3
            new_is_biz = p['mount'].startswith('/m') and len(p['mount']) <= 3
            if new_is_biz and not old_is_biz:
                # 替换为业务卷
                pools_dedup.remove(old)
                seen_src[s] = p
                pools_dedup.append(p)
            continue
        seen_src[s] = p
        pools_dedup.append(p)
    pools = pools_dedup
    # 按设备分组（设备定义可 GUI 配置；未匹配源归「本地」）
    dev_map = {}
    for p in pools:
        dev_map.setdefault(p['device'], []).append(p)
    devices = []
    dev_names = [d.get('name', '本地') for d in _storage_devices()]
    if '本地' not in dev_names:
        dev_names.append('本地')
    for dev in dev_names:
        plist = dev_map.get(dev)
        if not plist:
            continue
        total = sum(p['size_bytes'] for p in plist)
        used = sum(p['used_bytes'] for p in plist)
        avail = sum(p['avail_bytes'] for p in plist)
        devices.append({
            'name': dev,
            'size_bytes': total,
            'used_bytes': used,
            'avail_bytes': avail,
            'percent': round(used / total * 100) if total else 0,
            'pools': plist,
        })
    return {'pools': pools, 'devices': devices}

# 网络采样
_net_cache = {'down': 0.0, 'up': 0.0}
_DAY_FILE = os.path.join(DATA_DIR, 'net_day_base.json')

def _read_net_counters():
    rx = tx = 0
    with open('/proc/net/dev') as f:
        for line in f.readlines()[2:]:
            p = line.split(':')
            if len(p) != 2:
                continue
            iface = p[0].strip()
            # 只统计物理主接口 eth0，排除 docker bridge / veth / lo
            if iface == 'eth0':
                s = p[1].split()
                rx += int(s[0]); tx += int(s[8])
    return rx, tx

def _get_day_traffic():
    rx, tx = _read_net_counters()
    today = time.strftime('%Y-%m-%d')
    try:
        with open(_DAY_FILE) as f:
            saved = json.load(f)
        if saved.get('date') == today:
            # 如果计数器比基线小，说明重启后计数器清零了，重置基线
            if rx < saved['rx'] or tx < saved['tx']:
                saved['rx'] = rx
                saved['tx'] = tx
                with open(_DAY_FILE, 'w') as f:
                    json.dump(saved, f)
            return max(0, rx - saved['rx']), max(0, tx - saved['tx'])
    except Exception:
        pass
    # 新的一天或首次运行，记录基线
    base = {'date': today, 'rx': rx, 'tx': tx}
    try:
        with open(_DAY_FILE, 'w') as f:
            json.dump(base, f)
    except Exception:
        pass
    return 0, 0

def _downloader_speeds():
    """聚合 QB + TR(SA/DS) 下载器实时上传下载速率 bytes/s，
    用于补充容器内 eth0 计数器看不到的下载器流量。"""
    dl = up = 0
    try:
        tr = qb_transfer()
        dl += int(tr.get('dl_info_speed', 0) or 0)
        up += int(tr.get('up_info_speed', 0) or 0)
    except Exception:
        pass
    for host, port in ((SA_HOST, 16062), (DS_HOST, 16666)):
        if not host:
            continue
        try:
            items = tr_torrents(host, port)
            dl += sum(int(t.get('rateDownload', 0) or 0) for t in items)
            up += sum(int(t.get('rateUpload', 0) or 0) for t in items)
        except Exception:
            pass
    return dl, up

def _net_sampler():
    global _net_cache
    while True:
        try:
            rx1, tx1 = _read_net_counters()
            time.sleep(2)
            rx2, tx2 = _read_net_counters()
            # 容器自身 eth0 速率 KB/s
            own_down = max(0, (rx2 - rx1) / 1024 / 2)
            own_up = max(0, (tx2 - tx1) / 1024 / 2)
            # 加上下载器（QB/TR）速率，bytes/s -> KB/s
            d_dl, d_up = _downloader_speeds()
            _net_cache['down'] = round(own_down + d_dl / 1024, 1)
            _net_cache['up'] = round(own_up + d_up / 1024, 1)
        except Exception:
            pass
        time.sleep(3)
threading.Thread(target=_net_sampler, daemon=True).start()

def get_cpu_temp():
    try:
        with open('/sys/class/hwmon/hwmon0/temp1_input') as f:
            return round(int(f.read().strip()) / 1000)
    except Exception:
        return None

def get_uptime():
    """系统运行时长（秒）"""
    try:
        with open('/proc/uptime') as f:
            return int(float(f.read().split()[0]))
    except Exception:
        return None

# ========== Emby ==========
def _uid(user_id):
    """媒体查询作用域：返回角色绑定的 Emby 用户，空则默认用户 m。"""
    return user_id or EMBY_USER_ID

def emby_get(path, timeout=5):
    try:
        sep = '&' if '?' in path else '?'
        url = f"{EMBY_HOST}{path}{sep}api_key={EMBY_API_KEY}"
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"[warn] emby {path}: {e}")
        return {}

def emby_poster(item_id, image_tag, width=300, img_type='Primary'):
    if not image_tag:
        return ''
    # img_type 支持 Primary（竖版海报）与 Backdrop（横版剧照）；传入 Backdrop tag 时必须用 Backdrop 端点，否则取不到图
    # R-02 修复：不再把 api_key 拼进外发 image URL（journey/wall/share 会外发导致凭据泄漏），改走本面板 /api/img 代理
    emby_url = f"{EMBY_HOST}/Items/{item_id}/Images/{img_type}?tag={image_tag}&maxWidth={width}"
    return "/api/img?url=" + urllib.parse.quote(emby_url, safe='')

def _series_season_episode(item_id, user_id):
    """遍历 Series 的 Season 列表，返回 (季数, 总集数)。Emby 的 Series 不返回 RecursiveChildCount，需逐季求和。"""
    try:
        seas = emby_get(f"/Users/{_uid(user_id)}/Items?ParentId={item_id}&IncludeItemTypes=Season&Recursive=false&Fields=ChildCount")
        items = seas.get('Items') or []
        eps = 0
        for s in items:
            eps += s.get('ChildCount', 0) or 0
        return len(items), eps
    except Exception:
        return 0, 0

def _series_episode_count(item_id, user_id):
    """总集数（兼容旧调用）"""
    return _series_season_episode(item_id, user_id)[1]

# ===== 观影历程海报墙 =====
JOURNEY_PATH = os.path.join(DATA_DIR, 'journey.json')

def _journey_load():
    try:
        with open(JOURNEY_PATH, 'r', encoding='utf-8') as f:
            d = json.load(f)
        if isinstance(d, dict) and 'cards' in d:
            d.setdefault('last_claim', '')
            d.setdefault('claimed_today', 0)
            return d
    except Exception as e:
        print(f'[warn] journey load: {e}', flush=True)
        _mark_corrupt(JOURNEY_PATH)
    return {'cards': [], 'last_claim': '', 'claimed_today': 0}

def _journey_save(d):
    try:
        _atomic_write(JOURNEY_PATH, d, indent=2)
    except Exception as e:
        print(f"[warn] journey save: {e}", flush=True)

def _journey_notes(c):
    """归一返回某卡的多条感想（迁移旧 note 单条）。每条 {text, ts}。"""
    notes = c.get('notes')
    if isinstance(notes, list):
        out = [{'text': n.get('text', ''), 'ts': n.get('ts', '') or (c.get('completed_date') or '')}
               for n in notes if isinstance(n, dict) and n.get('text')]
        if not out and c.get('note'):
            out = [{'text': c.get('note', ''), 'ts': c.get('completed_date') or ''}]
        return out
    if c.get('note'):
        return [{'text': c.get('note', ''), 'ts': c.get('completed_date') or ''}]
    return []

def _jtoday():
    import time as _t
    return _t.strftime('%Y-%m-%d')

def _journey_uid():
    import uuid
    return uuid.uuid4().hex[:12]

def _emby_item_played(item_id, user_id=None):
    """查 Emby 条目是否已看完（Played + PlayedDate）。"""
    it = emby_get(f"/Users/{_uid(user_id)}/Items/{item_id}?Fields=Played,PlayedDate")
    return bool(it.get('Played')), it.get('PlayedDate', '')

def journey_sync(d):
    """同步每张卡的 Emby 播放状态：已看完 → watched + completed_date（变原色）。"""
    uid = _uid(None)
    for c in d.get('cards', []):
        if c.get('status') == 'claimed' and c.get('item_id'):
            played, pdate = _emby_item_played(c['item_id'], uid)
            if played:
                c['status'] = 'watched'
                c['completed_date'] = c.get('completed_date') or pdate or _jtoday()
    return d

def _journey_sources():
    """卡片池来源：设置页可配，默认仅媒体库。"""
    return (CONFIG.get('journey') or {}).get('sources') or ['media']

def _journey_daily_limit():
    """是否启用「每日认领一次」限制；关闭则开发/调试可连续抽卡"""
    return (CONFIG.get('journey') or {}).get('daily_limit', True)

def _journey_tmdb_cards(taken, n):
    """从 TMDB 周榜随机抽 n 张（电影+剧集混合）；item_id 用 'tmdb:<id>' 前缀防与 Emby ID 冲突。"""
    import random
    cards = []
    for mt in ('movie', 'tv'):
        if len(cards) >= n:
            break
        try:
            data = _tmdb_get('trending/%s/week?page=%d' % (mt, random.randint(1, 3)))
        except Exception:
            continue
        for it in data.get('results') or []:
            tid = 'tmdb:' + str(it.get('id'))
            if not it.get('id') or tid in taken:
                continue
            cards.append({
                'item_id': tid,
                'title': it.get('name') or it.get('title') or '',
                'type': 'series' if mt == 'tv' else 'movie',
                'year': (it.get('first_air_date') or it.get('release_date') or '')[:4],
                'rating': round((it.get('vote_average') or 0) / 2, 1),
                'genres': [_tmdb_genre_name(g) for g in (it.get('genre_ids') or [])[:3]],
                'image': ("https://image.tmdb.org/t/p/w300" + it['poster_path']) if it.get('poster_path') else '',
                'overview': it.get('overview', ''),
                'region': '',
                'source': 'tmdb',
            })
            if len(cards) >= n:
                break
    random.shuffle(cards)
    return cards[:n]

def journey_pick(user_id=None):
    """按卡片池来源（媒体库/TMDB/混合，设置页可配）随机抽 3 张候选卡（排除已认领/已看的片）。"""
    import random
    uid = _uid(user_id)
    d = _journey_load()
    taken = {c.get('item_id') for c in d.get('cards', []) if c.get('status') in ('claimed', 'watched') and c.get('item_id')}
    sources = _journey_sources()
    if not sources:
        sources = ['media']
    pool = []
    if 'media' in sources:
        it = emby_get(f"/Users/{uid}/Items?IncludeItemTypes=Movie,Series&Recursive=true&Limit=300&Fields=ProductionYear,CommunityRating,Genres,Overview,PrimaryImageAspectRatio")
        for i in it.get('Items') or []:
            iid = str(i.get('Id', ''))
            if not iid or iid in taken:
                continue
            tags = i.get('ImageTags') or {}
            pool.append({
                'item_id': iid,
                'title': i.get('Name', ''),
                'type': 'series' if i.get('Type') == 'Series' else 'movie',
                'year': i.get('ProductionYear', ''),
                'rating': round((i.get('CommunityRating') or 0) / 2, 1),
                'genres': (i.get('Genres') or [])[:3],
                'image': emby_poster(iid, tags.get('Primary', ''), 300, 'Primary') if tags.get('Primary') else '',
                'overview': i.get('Overview', ''),
                'region': '',
                'source': 'media',
            })
    if 'tmdb' in sources:
        pool += _journey_tmdb_cards(taken, 6)
    random.shuffle(pool)
    # 混合多源时尽量两源都出现（首轮各源至少各 1 张）
    if len(sources) > 1 and len(pool) > 1:
        by_src = {}
        for c in pool:
            by_src.setdefault(c.get('source'), []).append(c)
        if len(by_src) >= 2:
            res = []
            for k in by_src:
                if by_src[k]:
                    res.append(by_src[k].pop(0))
            for k in by_src:
                while len(res) < 3 and by_src[k]:
                    res.append(by_src[k].pop(0))
            return _journey_enrich(res[:3])
    return _journey_enrich(pool[:3])

_REGION_CN = {'US':'美国','CN':'中国大陆','GB':'英国','UK':'英国','JP':'日本','KR':'韩国','HK':'中国香港','TW':'中国台湾','FR':'法国','DE':'德国','IT':'意大利','ES':'西班牙','IN':'印度','RU':'俄罗斯','CA':'加拿大','AU':'澳大利亚','TH':'泰国','SG':'新加坡','NZ':'新西兰','SE':'瑞典','NO':'挪威','DK':'丹麦','NL':'荷兰','CH':'瑞士','BE':'比利时','MX':'墨西哥','BR':'巴西','AR':'阿根廷','PL':'波兰','CZ':'捷克','HU':'匈牙利','GR':'希腊','TR':'土耳其','AE':'阿联酋','SA':'沙特阿拉伯','EG':'埃及','ZA':'南非','ID':'印尼','MY':'马来西亚','PH':'菲律宾','VN':'越南','IE':'爱尔兰','PT':'葡萄牙','FI':'芬兰','AT':'奥地利'}

def _journey_enrich(cards):
    """为抽卡返回的卡片补地区(region)/简介(overview)：tmdb 源走轻量 detail，media 源已带 emby Overview"""
    out = []
    for c in cards:
        c = dict(c)
        if c.get('source') == 'tmdb':
            tid = str(c.get('item_id', '')).replace('tmdb:', '')
            mt = 'tv' if c.get('type') == 'series' else 'movie'
            try:
                d = _tmdb_get(f"{mt}/{tid}")
                if d and d.get('overview') and not c.get('overview'):
                    c['overview'] = d.get('overview')
                if not c.get('region'):
                    pc = [x for x in (d.get('production_countries') or []) if x.get('iso_3166_1')]
                    c['region'] = (_REGION_CN.get(pc[0]['iso_3166_1'], pc[0].get('name', ''))) if pc else ''
            except Exception:
                pass
        out.append(c)
    return out

def _journey_share_html(c):
    """游客分享落地页：渲染影片信息 + 观后感的深色卡片（无鉴权可访问，仅暴露分享字段）。"""
    _e = lambda s: str(s if s is not None else '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
    title = _e(c.get('title', ''))
    _notes = _journey_notes(c)
    image = _e(c.get('image', ''))
    year = _e(c.get('year', ''))
    type_label = '剧集' if c.get('type') == 'series' else '电影'
    genres = ' · '.join(_e(g) for g in (c.get('genres') or [])[:3])
    completed = _e(c.get('completed_date', ''))
    try:
        rating = float(c.get('rating') or 0)
    except Exception:
        rating = 0
    rate_html = ('<div class="rate">★ ' + ('%.1f' % rating) + '</div>') if rating else ''
    note_html = ''.join('<div class="note">✍ ' + _e(n.get('text', '')) + '</div>' for n in _notes) if _notes else ''
    done_html = ('<div class="done">✔ 已观看完成 · ' + completed + '</div>') if completed else ''
    poster = ('<div class="poster" style="background-image:url(\'' + image + '\')"></div>') if image else '<div class="poster noimg">🎬</div>'
    return ('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
            '<title>' + title + ' · 来自 NEXUS 观影历程</title></head><body><div class="wrap">'
            '<div class="brand">🎴 NEXUS · 观影历程分享</div>'
            '<div class="card">' + poster +
            '<div class="info"><div class="title">' + title + '</div>'
            '<div class="sub">' + type_label + ((' · ' + year) if year else '') + '</div>'
            + rate_html + (('<div class="genres">' + genres + '</div>') if genres else '') +
            note_html + done_html +
            '</div></div>'
            '<div class="foot">来自 <b>NEXUS</b> 家庭媒体中心 · 该链接仅展示此影片的分享内容</div></div>'
            '<style>'
            '*{margin:0;padding:0;box-sizing:border-box}'
            'body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif;background:#0d0f17;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}'
            '.wrap{width:100%;max-width:420px}'
            '.brand{font-size:13px;color:rgba(255,255,255,0.55);text-align:center;margin-bottom:18px;letter-spacing:1px}'
            '.card{background:linear-gradient(160deg,rgba(255,255,255,0.10),rgba(255,255,255,0.04));border:1px solid rgba(255,255,255,0.12);border-radius:22px;overflow:hidden;backdrop-filter:blur(24px)}'
            '.poster{width:100%;aspect-ratio:2/3;background-size:cover;background-position:center}'
            '.poster.noimg{display:flex;align-items:center;justify-content:center;font-size:56px;background:linear-gradient(135deg,#33384d,#20243a)}'
            '.info{padding:20px}'
            '.title{font-size:21px;font-weight:800;line-height:1.3;margin-bottom:6px}'
            '.sub{font-size:13px;color:rgba(255,255,255,0.7);margin-bottom:12px}'
            '.rate{color:#FFD60A;font-size:17px;font-weight:700;margin-bottom:8px}'
            '.genres{font-size:12px;color:rgba(255,255,255,0.6);margin-bottom:12px}'
            '.note{margin-top:14px;padding:14px;background:rgba(255,220,140,0.08);border:1px solid rgba(255,220,140,0.25);border-radius:12px;font-size:14px;color:#ffe3a0;line-height:1.7}'
            '.done{margin-top:12px;font-size:12px;color:rgba(140,200,255,0.9)}'
            '.foot{margin-top:16px;text-align:center;font-size:12px;color:rgba(255,255,255,0.4)}'
            '.foot b{color:rgba(255,255,255,0.7)}'
            '</style></body></html>')

def _journey_current_playing(user_id=None):
    """Emby 活动会话里当前用户在看的片（NowPlayingItem.Id），用于自主观看灰态入墙。"""
    try:
        for s in emby_get('/Sessions') or []:
            if s.get('UserId') == _uid(user_id) and s.get('NowPlayingItem'):
                np = s['NowPlayingItem']
                return str(np.get('Id', ''))
    except Exception:
        pass
    return ''

def journey_apply_auto(d, user_id=None):
    """自主观看同步：用户在播放某片（未在墙）→ 灰态入墙(source=auto)；在墙 → 标记 playing。"""
    uid = _uid(user_id)
    cur = _journey_current_playing(uid)
    if not cur:
        return d
    cards = d.get('cards', [])
    existing = next((c for c in cards if c.get('item_id') == cur), None)
    if existing:
        existing['playing'] = True
        return d
    # 不在墙：从媒体库取该片信息加入（灰态）
    it = emby_get(f"/Users/{uid}/Items?Ids={cur}&Fields=ProductionYear,CommunityRating,Genres,PrimaryImageAspectRatio")
    i = (it.get('Items') or [{}])[0]
    iid = str(i.get('Id', ''))
    if not iid:
        return d
    tags = i.get('ImageTags') or {}
    cards.append({
        'id': _journey_uid(), 'item_id': iid,
        'title': i.get('Name', ''), 'type': 'series' if i.get('Type') == 'Series' else 'movie',
        'year': i.get('ProductionYear', ''), 'rating': round((i.get('CommunityRating') or 0) / 2, 1),
        'genres': (i.get('Genres') or [])[:3],
        'image': emby_poster(iid, tags.get('Primary', ''), 300, 'Primary') if tags.get('Primary') else '',
        'status': 'claimed', 'claimed_date': _jtoday(), 'completed_date': '',
        'note': '', 'group': '', 'source': 'auto', 'playing': True,
    })
    d['cards'] = cards
    return d

def emby_search(query, user_id=None):
    result = emby_get(f"/Users/{_uid(user_id)}/Items?searchTerm={urllib.parse.quote(query)}&IncludeItemTypes=Movie,Series&Recursive=true&Limit=24&Fields=Overview,Runtime,ProductionYear,CommunityRating,Genres,Studios")
    items = result.get('Items', [])
    out = []
    for it in items:
        tags = it.get('ImageTags', {})
        runtime = it.get('RunTimeTicks', 0)
        runtime_min = int(runtime / 600000000) if runtime else 0
        if it.get('Type') == 'Series':
            seasons, episodes = _series_season_episode(it.get('Id', ''), user_id)
            extra = f"{seasons}季" + (f" · {episodes}集" if episodes else "")
            _sm = _tmdb_season_info(it.get('Name', ''), it.get('ProductionYear', ''), True, True)
        else:
            extra = f"{runtime_min}分钟" if runtime_min else ""
            _sm = {}
        out.append({
            'name': it.get('Name', ''),
            'year': it.get('ProductionYear', ''),
            'rating': round(it.get('CommunityRating', 0) or 0, 1),
            'id': it.get('Id', ''),
            'type': it.get('Type', ''),
            'poster': emby_poster(it.get('Id', ''), tags.get('Primary')),
            'overview': it.get('Overview', '')[:120],
            'runtime': runtime_min,
            'genres': ', '.join(it.get('Genres',[])[:3]),
            'studios': ', '.join([s if isinstance(s, str) else s.get('Name','') for s in it.get('Studios',[])[:2]]),
            'extra': extra,
            'seasonMeta': _sm,
        })
    return out

_ANIME_SUB = {'动漫', '国漫', '日番'}  # 剧集「动漫」父分类下的子分类（来自物理目录）

def _media_cat_from_path(path, kind):
    """从物理路径解析媒体库分类：kind='tv' 找 /电视剧/<分类>，kind='movie' 找 /电影/<分类>。
    动漫子分类(动漫/国漫/日番)归入父分类「动漫」并保留 subcat；未匹配/未分类归「其他」。"""
    if not path:
        return '其他', ''
    parts = path.replace('\\', '/').split('/')
    key = '电视剧' if kind == 'tv' else '电影'
    try:
        idx = parts.index(key)
        cat = parts[idx + 1] if idx + 1 < len(parts) else ''
    except ValueError:
        cat = ''
    if not cat:
        return '其他', ''
    if kind == 'tv' and cat in _ANIME_SUB:
        return '动漫', cat
    if cat in ('未分类', 'other'):
        return '其他', ''
    return cat, ''

def media_wall(type='all', user_id=None, limit=2000):
    """媒体库独立内页数据：按类型返回媒体库全量（Movie/Series），供海报墙展示。
    每条附带 category（物理目录分类）/subcat（动漫子分类）/dateCreated（排序用）。"""
    uid = _uid(user_id)
    itypes = {'movie': 'Movie', 'series': 'Series', 'tv': 'Series'}.get(type or 'all', 'Movie,Series')
    kind = 'tv' if type in ('series', 'tv') else ('movie' if type == 'movie' else '')
    url = (f"/Users/{uid}/Items?IncludeItemTypes={itypes}&Recursive=true"
           f"&SortBy=SortName&SortOrder=Ascending&Limit={limit}"
           f"&Fields=Overview,Runtime,ProductionYear,CommunityRating,Genres,Studios,Path,DateCreated,RecursiveItemCount,Status,ProductionLocations,ChildCount")
    result = emby_get(url, timeout=30)
    items = result.get('Items', [])
    out = []
    for it in items:
        tags = it.get('ImageTags', {})
        runtime = it.get('RunTimeTicks', 0)
        runtime_min = int(runtime / 600000000) if runtime else 0
        if it.get('Type') == 'Series':
            seasons = it.get('ChildCount') or 0
            extra = f"{seasons}季" if seasons else ""
            # Emby Series 无 Status，统一按「共N季·M集」展示（RecursiveItemCount=已入库总集数）
            _sm = {'total_seasons': seasons, 'total_episodes': it.get('RecursiveItemCount') or 0}
        else:
            extra = f"{runtime_min}分钟" if runtime_min else ""
            _sm = {}
        # kind 为空时（all/recent），根据影片类型自动判断电影/剧集，再解析分类路径
        _eff_kind = kind or ('tv' if it.get('Type') == 'Series' else 'movie')
        _cat, _sub = _media_cat_from_path(it.get('Path', ''), _eff_kind)
        _pl = it.get('ProductionLocations')
        _country = _pl[0] if isinstance(_pl, list) and _pl and _pl[0] else ''
        out.append({
            'name': it.get('Name', ''),
            'year': it.get('ProductionYear', ''),
            'rating': round(it.get('CommunityRating', 0) or 0, 1),
            'id': it.get('Id', ''),
            'type': it.get('Type', ''),
            'poster': emby_poster(it.get('Id', ''), tags.get('Primary')),
            'overview': it.get('Overview', '')[:120],
            'runtime': runtime_min,
            'genres': ', '.join(it.get('Genres', [])[:3]),
            'studios': ', '.join([s if isinstance(s, str) else s.get('Name', '') for s in it.get('Studios', [])[:2]]),
            'extra': extra,
            'seasonMeta': _sm,
            'category': _cat,
            'subcat': _sub,
            'dateCreated': it.get('DateCreated', '') or '',
            'country': _country,
        })
    return out

def pt_search(query, exclude=''):
    """PT 站串行搜索：逐站请求，站间间隔 1.5s 限速"""
    import time
    sites = []
    try:
        conn = sqlite3.connect(MP_DB)
        conn.row_factory = sqlite3.Row
        cur = conn.execute("SELECT name, url, cookie, ua, proxy FROM site WHERE is_active=1 AND cookie != ''")
        for row in cur:
            sites.append({
                'name': row['name'],
                'url': row['url'].rstrip('/'),
                'cookie': row['cookie'] or '',
                'ua': row['ua'] or 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'proxy': row['proxy'] or 0,
            })
        conn.close()
    except Exception:
        return []

    exclude_terms = [e.strip().lower() for e in (exclude or '').split() if e.strip()]
    results = []

    import concurrent.futures
    def _search_site(site):
        try:
            search_url = site['url'] + '/torrents.php?search=' + urllib.parse.quote(query)
            req = urllib.request.Request(search_url)
            req.add_header('Cookie', site['cookie'])
            req.add_header('User-Agent', site['ua'])
            req.add_header('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
            req.add_header('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8')
            req.add_header('Referer', site['url'] + '/')
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            if site['proxy']:
                opener = urllib.request.build_opener(
                    urllib.request.ProxyHandler({'https': _current_proxy_url(), 'http': _current_proxy_url()}),
                    urllib.request.HTTPSHandler(context=ctx))
            else:
                opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx))
            resp = opener.open(req, timeout=3.5)
            html = resp.read().decode('utf-8', errors='ignore')
            final_url = resp.geturl()
            if resp.status == 403 or 'login' in final_url.lower():
                return []
            links = re.findall(r'href="(details\.php\?id=\d+[^"]*)"[^>]*>(.*?)</a>', html, re.DOTALL)
            partial = []
            for href, title_html in links:
                title = re.sub(r'<[^>]+>', '', title_html).strip()
                if not title or len(title) < 3:
                    continue
                # 排除关键词过滤
                tl = title.lower()
                if any(term in tl for term in exclude_terms):
                    continue
                detail_url = site['url'] + '/' + href
                idx = html.find(href)
                context = html[max(0,idx-2000):idx+2000]
                m_size = re.search(r'([\d.]+\s*(?:GB|MB|TB))', context, re.IGNORECASE)
                size = m_size.group(1) if m_size else ''
                m_seed = re.search(r'>(\d+)</a>', context[context.find(href):])
                seeders = m_seed.group(1) if m_seed else '0'
                partial.append({
                    'title': title, 'site': site['name'], 'url': detail_url,
                    'size': size, 'seeders': seeders, 'leechers': '0',
                })
            return partial
        except Exception:
            return []
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
        for partial in ex.map(_search_site, sites[:20]):  # 并发查最多20站
            results.extend(partial)

    # 按做种数排序，去重
    seen = set()
    unique = []
    for r in sorted(results, key=lambda x: int(x.get('seeders', 0) or 0), reverse=True):
        key = r['title'][:50]
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique[:100]

def _cjk(s):
    return bool(re.search(r'[\u4e00-\u9fff]', s or ''))

def _official_name(name, orig, tmdb_id, itype):
    """计算「官方名/别名」：显示名是中文→官方英文名(原语名)；显示名非中文→反向查 TMDB 取官方中文名"""
    if _cjk(name):
        return orig if orig and orig != name else ''
    # 显示名非中文：优先 TMDB 中文名
    if tmdb_id:
        try:
            if itype == 'Series':
                d = _tmdb_get('tv/%s' % tmdb_id)
            else:
                d = _tmdb_get('movie/%s' % tmdb_id)
            zh = ((d or {}).get('name') if itype == 'Series' else (d or {}).get('title')) or ''
            if zh and zh != name and zh != orig:
                return zh
        except Exception:
            pass
    return orig if orig and orig != name else ''

_LANG_CN = {'en':'英语','zh':'中文','ja':'日语','ko':'韩语','fr':'法语','de':'德语','es':'西班牙语','ru':'俄语','it':'意大利语','pt':'葡萄牙语','hi':'印地语','th':'泰语','vi':'越南语','ar':'阿拉伯语','tr':'土耳其语','nl':'荷兰语','pl':'波兰语','sv':'瑞典语','da':'丹麦语','no':'挪威语','fi':'芬兰语','cs':'捷克语','el':'希腊语','he':'希伯来语','id':'印尼语','ms':'马来语','uk':'乌克兰语','hu':'匈牙利语','ro':'罗马尼亚语','bg':'保加利亚语','sr':'塞尔维亚语','hr':'克罗地亚语','sk':'斯洛伐克语','sl':'斯洛文尼亚语','lt':'立陶宛语','lv':'拉脱维亚语','et':'爱沙尼亚语','is':'冰岛语','ga':'爱尔兰语','fa':'波斯语','bn':'孟加拉语','ta':'泰米尔语','te':'泰卢固语','ml':'马拉雅拉姆语','kn':'卡纳达语','mr':'马拉地语','pa':'旁遮普语','ne':'尼泊尔语','my':'缅甸语','km':'高棉语','mn':'蒙古语','ka':'格鲁吉亚语','hy':'亚美尼亚语','az':'阿塞拜疆语','uz':'乌兹别克语','kk':'哈萨克语','sw':'斯瓦希里语','af':'南非荷兰语','tl':'他加禄语'}
_COUNTRY_CN = {'US':'美国','CN':'中国大陆','HK':'中国香港','TW':'中国台湾','MO':'中国澳门','JP':'日本','KR':'韩国','GB':'英国','FR':'法国','DE':'德国','ES':'西班牙','IT':'意大利','RU':'俄罗斯','CA':'加拿大','AU':'澳大利亚','IN':'印度','TH':'泰国','VN':'越南','MY':'马来西亚','SG':'新加坡','ID':'印尼','PH':'菲律宾','BR':'巴西','MX':'墨西哥','AR':'阿根廷','TR':'土耳其','NL':'荷兰','SE':'瑞典','NO':'挪威','DK':'丹麦','FI':'芬兰','PL':'波兰','CZ':'捷克','IE':'爱尔兰','NZ':'新西兰','BE':'比利时','CH':'瑞士','AT':'奥地利','PT':'葡萄牙','GR':'希腊','IL':'以色列','EG':'埃及','SA':'沙特','AE':'阿联酋','ZA':'南非','UA':'乌克兰','RO':'罗马尼亚','HU':'匈牙利','BG':'保加利亚','HR':'克罗地亚','RS':'塞尔维亚','SK':'斯洛伐克','SI':'斯洛文尼亚','LT':'立陶宛','LV':'拉脱维亚','EE':'爱沙尼亚','IS':'冰岛','LU':'卢森堡','MT':'马耳他','CY':'塞浦路斯'}
_STATUS_CN = {'Rumored':'传闻中','Planned':'计划中','In Production':'制作中','Post Production':'后期制作','Released':'已上映','Canceled':'已取消','Returning Series':'回归中','Ended':'已完结','Pilot':'试播'}

def _tmdb_enrich(tmdb_id, media_type):
    """TMDB 富化：status / 原始语言(中文) / 出品国家(中文) / 制作公司"""
    if not tmdb_id:
        return {}
    try:
        data = _tmdb_get(f"{media_type}/{tmdb_id}?append_to_response=release_dates")
        if not data or 'id' not in data:
            return {}
        countries = []
        for c in data.get('production_countries', [])[:3]:
            code = c.get('iso_3166_1', '')
            countries.append(_COUNTRY_CN.get(code, c.get('name', '') or code))
        return {
            'status': _STATUS_CN.get(data.get('status', ''), data.get('status', '')),
            'originalLanguage': _LANG_CN.get(data.get('original_language', ''), data.get('original_language', '')),
            'productionCountry': '、'.join(x for x in countries if x),
            'studios': [s.get('name', '') for s in data.get('production_companies', [])[:3]],
        }
    except Exception:
        return {}

def _tmdb_crew(tmdb_id, media_type):
    """TMDB credits 按 job 分类导演/编剧/制片/剪辑（纯 name 字符串，去重保序）。Emby 的 People 常缺制片/编剧或标注不准（如制片人标成 Director），此函数供 emby_detail 以 TMDB 分类兜底/覆盖。"""
    if not tmdb_id:
        return {}
    try:
        data = _tmdb_get(f"{media_type}/{tmdb_id}?append_to_response=credits")
        if not data or 'id' not in data:
            return {}
        out = {'directors': [], 'writers': [], 'producers': [], 'editors': []}
        seen = {k: set() for k in out}
        for c in (data.get('credits', {}).get('crew', []) or []):
            job = (c.get('job') or '').strip()
            n = (c.get('name') or '').strip()
            key = None
            if job == 'Director':
                key = 'directors'
            elif job in ('Writer', 'Screenplay', 'Screenwriter', 'Novel'):
                key = 'writers'
            elif job in ('Producer', 'Executive Producer', 'ExecutiveProducer', 'Co-Executive Producer', 'Co-Executive Producer'):
                key = 'producers'
            elif job == 'Editor':
                key = 'editors'
            if key and n and n not in seen[key]:
                seen[key].add(n)
                out[key].append(n)
        return out
    except Exception:
        return {}

def emby_detail(item_id, user_id=None):
    """获取影片详情"""
    try:
        r = emby_get(f"/Users/{_uid(user_id)}/Items/{item_id}?Fields=Overview,Runtime,ProductionYear,CommunityRating,Genres,Studios,People,OfficialRating,DisplayOrder,Tags,Bitrate,Path,ChildCount,RecursiveChildCount")
        it = r
        if not it or 'Id' not in it:
            return tmdb_detail(item_id)
        tags = it.get('ImageTags', {})
        bdt = (it.get('BackdropImageTags') or [])
        runtime = it.get('RunTimeTicks', 0)
        runtime_min = int(runtime / 600000000) if runtime else 0
        people = [p for p in it.get('People', []) if isinstance(p, dict)]
        directors = [p for p in people if p.get('Type') == 'Director']
        writers = [p for p in people if p.get('Type') == 'Writer']
        producers = [p for p in people if p.get('Type') == 'Producer'][:4]
        editors = [p for p in people if p.get('Type') == 'Editor'][:3]
        actors = [p for p in people if p.get('Type') == 'Actor'][:8]
        itype = it.get('Type', '')
        name = it.get('Name', '') or ''
        orig = it.get('OriginalTitle', '') or ''
        tmdb_id = (it.get('ProviderIds', {}) or {}).get('Tmdb', '') or ''
        path = it.get('Path', '') or ''
        enr = _tmdb_enrich(tmdb_id, 'tv' if itype == 'Series' else 'movie') if tmdb_id else {}
        # TMDB credits 优先：Emby 的制片/编剧/剪辑常缺失或标注不准（如制片人标成 Director），TMDB 按 job 分类更可靠；导演用 TMDB 则自动剔除混入的制片人
        _cr = _tmdb_crew(tmdb_id, 'tv' if itype == 'Series' else 'movie') if tmdb_id else {}
        if _cr.get('directors'): directors = _cr['directors']
        if _cr.get('writers'): writers = _cr['writers']
        if _cr.get('producers'): producers = _cr['producers']
        if _cr.get('editors'): editors = _cr['editors']
        def _crew_names(plist, lim):
            out = []
            for _p in (plist or [])[:lim]:
                out.append(_p if isinstance(_p, str) else (((_p.get('Name', '') or '') if _p else '')))
            return out
        dir_names = _crew_names(directors, 3)
        wrt_names = _crew_names(writers, 3)
        prd_names = _crew_names(producers, 4)
        edt_names = _crew_names(editors, 3)
        return {
            'id': str(item_id),
            'name': name,
            'originalTitle': orig,
            'officialName': _official_name(name, orig, tmdb_id, itype),
            'fileName': os.path.basename(path) if path else '',
            'path': path,
            'year': it.get('ProductionYear', ''),
            'rating': round(it.get('CommunityRating', 0) or 0, 1),
            'officialRating': it.get('OfficialRating', ''),
            'runtime': runtime_min,
            'overview': it.get('Overview', ''),
            'genres': it.get('Genres',[]),
            'studios': ([s if isinstance(s, str) else s.get('Name','') for s in it.get('Studios',[])[:3]] or enr.get('studios', [])),
            'directors': dir_names,
            'writers': wrt_names,
            'producers': prd_names,
            'editors': edt_names,
            'actors': [{'name': p.get('Name',''), 'role': p.get('Role',''), 'image': emby_poster(p.get('Id',''), p.get('PrimaryImageTag',''), 200) if p.get('PrimaryImageTag') else ''} for p in actors],
            'poster': emby_poster(item_id, tags.get('Primary'), 600),
            'logo': emby_poster(item_id, tags.get('Logo'), 600, 'Logo'),
            'backdrop': (emby_poster(item_id, bdt[0], 1280, 'Backdrop') if bdt
                         else emby_poster(item_id, tags.get('Primary'), 600)),
            'type': it.get('Type', ''),
            'status': it.get('Status', '') or enr.get('status', ''),
            'originalLanguage': enr.get('originalLanguage', ''),
            'productionCountry': enr.get('productionCountry', ''),
            'premiereDate': it.get('PremiereDate', '')[:10] if it.get('PremiereDate') else '',
            'digitalRelease': '',
            'inLibrary': True,
            'tmdbId': it.get('ProviderIds', {}).get('Tmdb', ''),
            'imdbId': it.get('ProviderIds', {}).get('Imdb', ''),
            'tvdbId': it.get('ProviderIds', {}).get('Tvdb', ''),
            'seriesCount': _series_season_episode(item_id, user_id)[0] if it.get('Type') == 'Series' else (it.get('ChildCount', 0) or 0),
            'episodeCount': _series_episode_count(item_id, user_id) if (it.get('Type') == 'Series' and not (it.get('RecursiveChildCount') or 0)) else (it.get('RecursiveChildCount', 0) or 0),
            'episodeRunTime': (_ep_rt_min(item_id, user_id) if it.get('Type') == 'Series' else 0),
        }
    except Exception as e:
        return tmdb_detail(item_id)

def _ep_rt_min(item_id, user_id=None):
    """剧集单集时长（分钟）：取 Emby 该剧第一集 RuntimeTicks"""
    try:
        sd = _emby_series_detail(item_id, user_id)
        if sd and sd.get('firstEpRuntimeSecs'):
            return round(sd['firstEpRuntimeSecs'] / 60)
    except Exception:
        pass
    return 0

def _person_cn_name(pid):
    """TMDB person 详情取中文名（also_known_as 或 name 中第一个 CJK 名）"""
    if not pid:
        return ''
    try:
        p = _tmdb_get(f"person/{pid}?language=zh-CN")
        for aka in p.get('also_known_as', []):
            s = str(aka).strip()
            if s and any('\u4e00' <= ch <= '\u9fff' for ch in s):
                return s
        n = p.get('name', '')
        if n and any('\u4e00' <= ch <= '\u9fff' for ch in n):
            return n
    except Exception:
        pass
    return ''

def tmdb_detail(tmdb_id):
    """TMDB 详情兜底（非 Emby 库内项目），导演/演员返回双语 {name, nameZh}"""
    try:
        data = _tmdb_get(f"movie/{tmdb_id}?append_to_response=credits,external_ids")
        is_tv = False
        if not data or 'id' not in data:
            data = _tmdb_get(f"tv/{tmdb_id}?append_to_response=credits,external_ids")
            if not data or 'id' not in data:
                return {'error': 'not found'}
            is_tv = True
        # 中文人名：zh-CN 请求补中文名（TMDB 人名默认 zh-CN 亦多为罗马化，需 zh 与 en 合并）
        zh = _tmdb_get(f"movie/{tmdb_id}?language=zh-CN&append_to_response=credits")
        if not zh or 'id' not in zh:
            zh = _tmdb_get(f"tv/{tmdb_id}?language=zh-CN&append_to_response=credits")
        zh_cast = {}
        zh_crew = {}
        if zh and 'id' in zh:
            for c in zh.get('credits', {}).get('cast', []):
                if c.get('id'):
                    zh_cast[c['id']] = c.get('name', '')
            for c in zh.get('credits', {}).get('crew', []):
                if c.get('id'):
                    zh_crew[c['id']] = c.get('name', '')
        credits = data.get('credits', {})
        directors = []
        for c in credits.get('crew', []):
            if c.get('job') != 'Director':
                continue
            en_name = c.get('name', '')
            zh_name = zh_crew.get(c.get('id'), '') or ''
            if not zh_name or zh_name == en_name or not any('\u4e00' <= ch <= '\u9fff' for ch in zh_name):
                zh_name = _person_cn_name(c.get('id')) or zh_name or en_name
            directors.append({'name': en_name, 'nameZh': zh_name if zh_name != en_name else ''})
            if len(directors) >= 3:
                break
        actors = []
        for c in credits.get('cast', [])[:8]:
            en_name = c.get('name', '')
            zh_name = zh_cast.get(c.get('id'), '') or ''
            actors.append({'name': en_name,
                           'nameZh': zh_name if (zh_name and zh_name != en_name and any('\u4e00' <= ch <= '\u9fff' for ch in zh_name)) else '',
                           'role': c.get('character', ''),
                           'image': 'https://image.tmdb.org/t/p/w200' + (c.get('profile_path') or '')})
        ext = data.get('external_ids', {})
        countries = []
        for c in data.get('production_countries', [])[:3]:
            code = c.get('iso_3166_1', '')
            countries.append(_COUNTRY_CN.get(code, c.get('name', '') or code))
        name = data.get('name', '') if is_tv else data.get('title', '')
        _fyear = ((data.get('first_air_date', '') if is_tv else data.get('release_date', '')) or '')[:4]
        _fname = ((data.get('original_name', '') if is_tv else data.get('original_title', '')) or name) + (('（' + _fyear + '）') if _fyear else '')
        return {
            'id': str(tmdb_id),
            'name': name,
            'originalTitle': (data.get('original_name', '') if is_tv else data.get('original_title', '')),
            'officialName': (data.get('original_name', '') if is_tv else data.get('original_title', '')),
            'fileName': _fname,
            'path': '',
            'year': ((data.get('first_air_date', '') if is_tv else data.get('release_date', '')) or '')[:4],
            'rating': round(data.get('vote_average', 0) or 0, 1),
            'runtime': data.get('runtime', 0),
            'overview': data.get('overview', ''),
            'genres': [g['name'] for g in data.get('genres', [])],
            'studios': [s['name'] for s in data.get('production_companies', [])[:3]],
            'directors': directors,
            'writers': [],
            'actors': actors,
            'poster': 'https://image.tmdb.org/t/p/w600' + (data.get('poster_path') or ''),
            'backdrop': 'https://image.tmdb.org/t/p/original' + (data.get('backdrop_path') or ''),
            'type': 'Series' if is_tv else 'Movie',
            'status': _STATUS_CN.get(data.get('status', ''), data.get('status', '')),
            'originalLanguage': _LANG_CN.get(data.get('original_language', ''), data.get('original_language', '')),
            'productionCountry': '、'.join(x for x in countries if x),
            'premiereDate': (data.get('first_air_date', '') if is_tv else data.get('release_date', '')),
            'digitalRelease': '',
            'inLibrary': False,
            'tmdbId': str(data.get('id', '')),
            'imdbId': ext.get('imdb_id', ''),
            'tvdbId': ext.get('tvdb_id', ''),
            'totalSeasons': data.get('number_of_seasons', 0) if is_tv else 0,
            'totalEpisodes': data.get('number_of_episodes', 0) if is_tv else 0,
            'episodeRunTime': (data.get('episode_run_time') or [0])[0] if is_tv else 0,
            'aliases': (data.get('original_name', '') if is_tv else data.get('original_title', '')),
            'fileName': _fname,
        }
    except Exception as e:
        return {'error': str(e)}

_TMDB_POSTER_CACHE = {}
def _tmdb_poster(tmdbid):
    """按 tmdbid 查 TMDB 海报，带内存缓存（避免订阅列表重复查 API）"""
    if not tmdbid:
        return ''
    key = str(tmdbid)
    if key in _TMDB_POSTER_CACHE:
        return _TMDB_POSTER_CACHE[key]
    try:
        d = tmdb_detail(key)
        p = (d or {}).get('poster') or ''
    except Exception:
        p = ''
    _TMDB_POSTER_CACHE[key] = p
    return p

_SUB_POSTER_CACHE = {}
def _emby_poster_by_name(name):
    """Emby 按名称搜索匹配条目取 Primary 海报（名称匹配正确，优先于 tmdbid 直取）。
    订阅库的 tmdbid 存在错位（如律界战争→Status Quo、牧神记→INKI and the LION），
    名称匹配 Emby 是本机媒体库内的真实海报，最可靠。"""
    t = (name or '').strip()
    if not t:
        return ''
    if t in _SUB_POSTER_CACHE:
        return _SUB_POSTER_CACHE[t]
    p = ''
    try:
        r = emby_get(f"/Items?SearchTerm={urllib.parse.quote(t)}&IncludeItemTypes=Movie,Series&Recursive=true&Limit=3&UserId={_uid(None)}")
        for it in ((r or {}).get('Items') or [])[:3]:
            tag = (it.get('ImageTags') or {}).get('Primary')
            if tag:
                p = emby_poster(it.get('Id'), tag, 1280)
                break
    except Exception as e:
        print(f"[warn] emby poster by name {t}: {e}")
    _SUB_POSTER_CACHE[t] = p
    return p

def _sub_poster(name, is_tv, tmdbid):
    """订阅卡海报解析优先级：Emby 名称匹配（正确）→ TMDB 标题搜索 → tmdbid 直取（最后兜底）"""
    p = _emby_poster_by_name(name)
    if p:
        return p
    try:
        d = tmdb_by_title(name, is_tv=is_tv)
        p = (d or {}).get('poster') or ''
    except Exception:
        p = ''
    if p:
        return p
    return _tmdb_poster(tmdbid)

def _emby_item_by_name(name):
    """Emby 按名称搜索匹配条目，返回 {poster, tmdb}（tmdb=ProviderIds.Tmdb 正确 tmdbid）。
    订阅库 tmdbid 存在错位（§8.11 已确认），Emby 名称匹配拿到的 provider id 最可靠，
    用于进度富化时定位正确影片。"""
    t = (name or '').strip()
    if not t:
        return {}
    try:
        r = emby_get(f"/Items?SearchTerm={urllib.parse.quote(t)}&IncludeItemTypes=Movie,Series&Recursive=true&Limit=3&UserId={_uid(None)}")
        for it in ((r or {}).get('Items') or [])[:3]:
            if not it:
                continue
            out = {}
            tag = (it.get('ImageTags') or {}).get('Primary')
            if tag:
                out['poster'] = emby_poster(it.get('Id'), tag, 1280)
            pids = it.get('ProviderIds') or {}
            if pids.get('Tmdb'):
                out['tmdb'] = pids['Tmdb']
            if out.get('poster') or out.get('tmdb'):
                return out
    except Exception as e:
        print(f"[warn] emby item by name {t}: {e}")
    return {}

def _tmdb_progress(tmdbid, is_tv):
    """TMDB 进度富化：剧集返回集数/下一集时间，电影返回确认的最早流媒体(Digital type=4)上线日期。"""
    if not tmdbid:
        return {}
    try:
        if is_tv:
            d = _tmdb_get("tv/%s" % tmdbid)
            if not d or 'error' in d or not d.get('id'):
                return {}
            out = {}
            out['eps_total'] = d.get('number_of_episodes') or 0
            le = d.get('last_episode_to_air') or {}
            ne = d.get('next_episode_to_air') or {}
            out['eps_done'] = (le.get('episode_number') or 0)
            out['next_ep'] = (ne.get('episode_number') or 0)
            out['next_air'] = (ne.get('air_date') or '')
            return out
        else:
            d = _tmdb_get("movie/%s/release_dates" % tmdbid)
            if not d or 'error' in d or not d.get('results'):
                return {}
            best = ''
            for r in (d.get('results') or []):
                for rd in (r.get('release_dates') or []):
                    if rd.get('type') == 4 and rd.get('release_date'):
                        dt = str(rd['release_date'])[:10]
                        if not best or dt < best:
                            best = dt
            return {'release_date': best}
    except Exception as e:
        print(f"[warn] tmdb progress {tmdbid}: {e}")
        return {}

_SUB_ENRICH_CACHE = {}
def _sub_enrich(name, is_tv, tmdbid):
    """订阅卡富化：海报 + 剧集进度/电影流媒体上线时间（与海报同一解析链，一次 Emby+TMDB 完成）。
    解析链：Emby 名称匹配(拿正确 tmdbid+海报) → TMDB 标题搜索 → 传入 tmdbid 兜底。"""
    t = (name or '').strip()
    key = t + '|' + str(tmdbid or '') + '|' + ('1' if is_tv else '0')
    if key in _SUB_ENRICH_CACHE:
        return _SUB_ENRICH_CACHE[key]
    out = {'poster': '', 'eps_done': 0, 'eps_total': 0, 'next_ep': 0, 'next_air': '', 'release_date': ''}
    tid = tmdbid or ''
    try:
        item = _emby_item_by_name(t)
        if item:
            out['poster'] = item.get('poster') or ''
            if item.get('tmdb'):
                tid = item['tmdb']
        if not out['poster']:
            d = tmdb_by_title(t, is_tv=is_tv)
            out['poster'] = (d or {}).get('poster') or ''
            if (d or {}).get('id'):
                tid = d['id']
        if not out['poster']:
            out['poster'] = _tmdb_poster(tmdbid)
        meta = _tmdb_progress(tid, is_tv)
        out.update(meta)
    except Exception as e:
        print(f"[warn] sub enrich {t}: {e}")
    _SUB_ENRICH_CACHE[key] = out
    return out

def tmdb_by_title(title, is_tv=False):
    """按标题查 TMDB 详情，用于豆瓣等无 tmdb_id 的趋势数据补全（演职员/简介/时长等）。
    先按标题搜索取首个有 ID 的条目，再走 tmdb_detail 拿完整富化数据。"""
    t = (title or '').strip()
    if not t:
        return {}
    mt = 'tv' if is_tv else 'movie'
    try:
        data = _tmdb_get("search/%s?query=%s&page=1" % (mt, urllib.parse.quote(t)))
        for it in (data.get('results') or [])[:6]:
            tid = it.get('id')
            if not tid:
                continue
            d = tmdb_detail(tid)
            if d and 'error' not in d and d.get('name'):
                return d
        # 电影没搜到再试剧集，反之亦然
        alt = 'movie' if is_tv else 'tv'
        data2 = _tmdb_get("search/%s?query=%s&page=1" % (alt, urllib.parse.quote(t)))
        for it in (data2.get('results') or [])[:6]:
            tid = it.get('id')
            if not tid:
                continue
            d = tmdb_detail(tid)
            if d and 'error' not in d and d.get('name'):
                return d
    except Exception as e:
        return {'error': str(e)}
    return {}

def _emby_count(parent_id, include_types='', user_id=None):
    """查某个库下指定类型的总数"""
    url = f"/Items?ParentId={parent_id}&Recursive=true&Limit=0"
    if include_types:
        url += f"&IncludeItemTypes={include_types}"
    url += f"&UserId={_uid(user_id)}"
    try:
        r = emby_get(url)
        return r.get('TotalRecordCount', 0)
    except Exception:
        return 0

def emby_library_stats(user_id=None):
    """层级化媒体库统计：电影/电视剧/音频 三大类"""
    try:
        views = emby_get(f"/Users/{_uid(user_id)}/Views")
        raw = []
        for v in views.get('Items', []):
            name = v.get('Name', '')
            ctype = v.get('CollectionType', '')
            item_id = v.get('ItemId', v.get('Id', ''))
            if not item_id or ctype == 'playlists':
                continue
            raw.append({'name': name, 'type': ctype, 'id': item_id})

        # ---- 电影大类 ----
        movie_libs = [l for l in raw if l['type'] == 'movies']
        movie_total = sum(_emby_count(l['id'], 'Movie', user_id) for l in movie_libs)
        movie_subs = [{'name': l['name'], 'count': _emby_count(l['id'], 'Movie', user_id)} for l in movie_libs]

        # ---- 电视剧大类：部数/季数/集数 ----
        # CollectionType=tvshows 的库，以及无类型但实际含 Series 的库（如纪录片）
        tv_libs = [l for l in raw if l['type'] == 'tvshows']
        for l in raw:
            if l['type'] == 'tvshows':
                continue
            if l['type'] in ('movies', 'music', 'audiobooks', 'homevideos', 'boxsets', 'playlists'):
                continue
            # 无类型的库，探一下是否有 Series
            if _emby_count(l['id'], 'Series', user_id) > 0:
                tv_libs.append(l)
        tv_subs = []
        tv_shows_total = 0
        tv_seasons_total = 0
        tv_episodes_total = 0
        for l in tv_libs:
            shows = _emby_count(l['id'], 'Series', user_id)
            seasons = _emby_count(l['id'], 'Season', user_id)
            episodes = _emby_count(l['id'], 'Episode', user_id)
            if shows == 0 and seasons == 0 and episodes == 0:
                continue
            tv_subs.append({'name': l['name'], 'shows': shows, 'seasons': seasons, 'episodes': episodes})
            tv_shows_total += shows
            tv_seasons_total += seasons
            tv_episodes_total += episodes

        # ---- 音频大类 ----
        music_libs = [l for l in raw if l['type'] == 'music']
        audio_total_songs = sum(_emby_count(l['id'], 'Audio', user_id) for l in music_libs)
        audio_albums = sum(_emby_count(l['id'], 'MusicAlbum', user_id) for l in music_libs)
        # 艺术家：全局 Artists
        try:
            artists_r = emby_get(f"/Artists?Recursive=true&Limit=0&UserId={_uid(user_id)}")
            audio_artists = artists_r.get('TotalRecordCount', 0)
        except Exception:
            audio_artists = 0

        audio_book_libs = [l for l in raw if l['type'] == 'audiobooks']
        ab_books = sum(_emby_count(l['id'], 'AudioBook', user_id) for l in audio_book_libs)
        ab_episodes = sum(_emby_count(l['id'], 'AudioBookChapter', user_id) for l in audio_book_libs)

        return {
            'libraries': [
                {
                    'category': '电影',
                    'icon': '🎥',
                    'total': movie_total,
                    'total_label': '部',
                    'subs': [{'name': s['name'], 'count': s['count'], 'unit': '部'} for s in movie_subs],
                },
                {
                    'category': '电视剧',
                    'icon': '📺',
                    'total': tv_shows_total,
                    'total_label': '部',
                    'extra': f'{tv_seasons_total} 季 · {tv_episodes_total} 集',
                    'subs': [{'name': s['name'], 'shows': s['shows'], 'seasons': s['seasons'], 'episodes': s['episodes']} for s in tv_subs],
                },
                {
                    'category': '音频',
                    'icon': '🎵',
                    'subs': [
                        {
                            'name': '音乐',
                            'songs': audio_total_songs,
                            'albums': audio_albums,
                            'artists': audio_artists,
                        },
                        {
                            'name': '有声书/剧',
                            'books': ab_books,
                            'chapters': ab_episodes,
                        },
                    ],
                },
            ],
        }
    except Exception as e:
        print(f"[warn] library_stats: {e}")
        return {'libraries': []}

# ========== qBittorrent ==========
qb_cookies = None
def qb_login():
    global qb_cookies
    try:
        data = urllib.parse.urlencode({'username': QB_USER, 'password': QB_PASS}).encode()
        req = urllib.request.Request(f"{QB_HOST}/api/v2/auth/login", data=data, method='POST')
        resp = urllib.request.urlopen(req, timeout=5)
        sc = resp.headers.get_all('Set-Cookie')
        if sc:
            qb_cookies = '; '.join([c.split(';')[0] for c in sc])
            return True
    except Exception as e:
        print(f"[warn] qb login: {e}")
    return False

# PT 站点 tracker 域名 → 站点名（种子表「站点标签」列用；未收录域名回退显示主域名）
SITE_MAP = {
    'm-team.cc': '馒头', 'hdsky.me': 'HDSky', 'pter.club': 'PTer', 'u2.dmhy.org': 'U2',
    'chdbits.co': 'CHD', 'hdchina.org': 'HDChina', 'keepfrds.com': '猫站',
    'springtour.info': '樱花', 'beyondeyes.org': 'BYR', 'ourbits.club': 'OB',
    '52pt.site': '52PT', 'hdtime.org': 'HDTime', 'tjupt.org': '北洋', 'npupt.com': 'NPUPT',
    'zhuixinfan.org': '追新番', 'lemonhd.org': '柠檬', '1ptba.com': '1PTBA',
    'audiences.me': '观众', 'pthome.net': 'PT站', 'hdarea.co': '海带',
}
def site_name_from_domains(urls):
    for u in urls:
        if not u: continue
        d = u.split('://')[-1].split('/')[0].lower()
        if d.startswith('www.'): d = d[4:]
        for dom, name in SITE_MAP.items():
            if dom in d:
                return name
        parts = d.split('.')
        if len(parts) >= 2:
            return parts[-2]
    return ''

def qb_request(path, retry=True):
    global qb_cookies
    # qBittorrent v5.2+：配置了 API Key 时用 Bearer 认证，免登录
    if QB_API_KEY:
        try:
            req = urllib.request.Request(f"{QB_HOST}{path}")
            req.add_header('Authorization', f'Bearer {QB_API_KEY}')
            with urllib.request.urlopen(req, timeout=5) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 401 and retry:
                return qb_request(path, retry=False)
        except Exception as e:
            print(f"[warn] qb {path}: {e}")
        return None
    # 用户名/密码：登录拿 SID cookie
    if not qb_cookies and not qb_login():
        return None
    try:
        req = urllib.request.Request(f"{QB_HOST}{path}")
        req.add_header('Cookie', qb_cookies)
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 401 and retry:
            qb_cookies = None
            return qb_request(path, retry=False)
    except Exception as e:
        print(f"[warn] qb {path}: {e}")
    return None

def qb_torrents():
    data = qb_request('/api/v2/torrents/info')
    if not data: return []
    # 按实时速率降序排序，确保有数据传输的活跃种子排在前面（qBittorrent 默认顺序不定）
    data.sort(key=lambda t: (t.get('dlspeed', 0) + t.get('upspeed', 0)), reverse=True)
    tops = data[:30]
    # 并发取前30个种子的文件数与站点标签（qBittorrent 单种子 files / trackers 接口）
    import concurrent.futures
    def _fc(t):
        try:
            fl = qb_request('/api/v2/torrents/files?hash=' + urllib.parse.quote(t.get('hash', '')))
            return len(fl) if isinstance(fl, list) else 0
        except Exception:
            return 0
    def _site(t):
        try:
            # 优先用 tracker 域名解析真实站点名（qB 的 tags 常是"5"/"P"等非站点标签，不能当作站点名）
            tr = qb_request('/api/v2/torrents/trackers?hash=' + urllib.parse.quote(t.get('hash', '')))
            if isinstance(tr, list):
                nm = site_name_from_domains([(x.get('url') or '') for x in tr if isinstance(x, dict)])
                if nm:
                    return nm
            # tracker 未收录时回退 tags：跳过纯数字/单字母等明显非站点标签，取有意义的名字
            for tag in (t.get('tags') or []):
                s = str(tag).strip()
                if s and not s.isdigit() and len(s) > 1:
                    return s
            return ''
        except Exception:
            return ''
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        fcs = list(ex.map(_fc, tops))
        sites = list(ex.map(_site, tops))
    return [{
        'name': t.get('name', ''),
        'state': t.get('state', ''),
        'progress': round(t.get('progress', 0) * 100, 1),
        'dlspeed': t.get('dlspeed', 0),
        'upspeed': t.get('upspeed', 0),
        'num_seeds': t.get('num_seeds', 0),
        'num_leechs': t.get('num_leechs', 0),
        'size': t.get('size', 0),
        'fileCount': fcs[i] if i < len(fcs) else 0,
        'site': sites[i] if i < len(sites) else '',
    } for i, t in enumerate(tops)]

def qb_transfer():
    return qb_request('/api/v2/transfer/info') or {}

# ========== Transmission ==========
def _tr_cred():
    """TR RPC 凭据：config services.transmission > services.qbittorrent（SA/DS 共用同一套）。"""
    tr = (CONFIG.get('services') or {}).get('transmission') or {}
    return (tr.get('username') or QB_USER or '', tr.get('password') or QB_PASS or '')

def tr_torrents(host, port, username=None, password=None):
    """Transmission RPC"""
    if username is None or password is None:
        username, password = _tr_cred()
    import base64
    try:
        url = f"http://{host}:{port}/transmission/rpc"
        auth = base64.b64encode(f"{username}:{password}".encode()).decode()
        # 获取 session id
        req = urllib.request.Request(url)
        req.add_header('Authorization', f'Basic {auth}')
        try:
            urllib.request.urlopen(req, timeout=3)
        except urllib.error.HTTPError as e:
            sid = e.headers.get('X-Transmission-Session-Id', '')
        else:
            sid = ''
        def _call(args):
            body = json.dumps({'method': 'torrent-get', 'arguments': args}).encode()
            r = urllib.request.Request(url, data=body, method='POST')
            r.add_header('Content-Type', 'application/json')
            r.add_header('Authorization', f'Basic {auth}')
            if sid: r.add_header('X-Transmission-Session-Id', sid)
            with urllib.request.urlopen(r, timeout=5) as rr:
                return json.loads(rr.read().decode())
        # 第一段：快速取列表（不带 files，避免 19s 大响应拖慢 /api/torrents）
        base = _call({'fields': ['id', 'name', 'percentDone', 'rateDownload', 'rateUpload', 'seeders', 'leechers', 'sizeWhenDone', 'status', 'trackerStats']})
        # 按速率降序排列，确保活跃种子排前面；取前30个展示（覆盖活跃+部分排队）
        torrents = (base.get('arguments') or {}).get('torrents', [])
        torrents.sort(key=lambda t: (t.get('rateDownload',0) + t.get('rateUpload',0)), reverse=True)
        tops = torrents[:30]
        fmap = {}
        ids = [t.get('id') for t in tops if t.get('id') is not None][:8]
        if ids:
            try:
                fd = _call({'ids': ids, 'fields': ['id', 'files']})
                for t in (fd.get('arguments') or {}).get('torrents', []):
                    fmap[t.get('id')] = len(t.get('files') or [])
            except Exception as fe:
                print(f"[warn] tr files {host}:{port}: {fe!r}")
        return [{
            'name': t.get('name', ''),
            'progress': round(t.get('percentDone', 0) * 100, 1),
            'dlspeed': t.get('rateDownload', 0),
            'upspeed': t.get('rateUpload', 0),
            'num_seeds': t.get('seeders', 0),
            'num_leechs': t.get('leechers', 0),
            'size': t.get('sizeWhenDone', 0),
            'fileCount': fmap.get(t.get('id'), 0),
            'site': site_name_from_domains([(x.get('announce') or '') for x in (t.get('trackerStats') or [])]),
        } for t in tops]
    except Exception as e:
        print(f"[warn] tr {host}:{port}: {e}")
        return []

def qb_global_limits():
    """qBittorrent 全局限速，单位 KiB/s（与 setDownloadLimit 一致）"""
    d = qb_request('/api/v2/transfer/globalLimit') or {}
    try:
        return {'dl': int(d.get('dl_limit', 0)), 'up': int(d.get('up_limit', 0))}
    except Exception:
        return {'dl': 0, 'up': 0}

def qb_set_limits(dl_kb=None, up_kb=None):
    """设置 qBittorrent 全局限速（KiB/s，0=不限）"""
    if dl_kb is not None:
        qb_request('/api/v2/transfer/setDownloadLimit?limit=' + str(int(dl_kb)))
    if up_kb is not None:
        qb_request('/api/v2/transfer/setUploadLimit?limit=' + str(int(up_kb)))

def _tr_rpc(host, port, method, arguments, username=None, password=None):
    if username is None or password is None:
        username, password = _tr_cred()
    import base64
    try:
        url = f"http://{host}:{port}/transmission/rpc"
        auth = base64.b64encode(f"{username}:{password}".encode()).decode()
        req = urllib.request.Request(url)
        req.add_header('Authorization', f'Basic {auth}')
        try:
            urllib.request.urlopen(req, timeout=3)
        except urllib.error.HTTPError as e:
            sid = e.headers.get('X-Transmission-Session-Id', '')
        else:
            sid = ''
        body = json.dumps({'method': method, 'arguments': arguments}).encode()
        req = urllib.request.Request(url, data=body, method='POST')
        req.add_header('Content-Type', 'application/json')
        req.add_header('Authorization', f'Basic {auth}')
        if sid:
            req.add_header('X-Transmission-Session-Id', sid)
        with urllib.request.urlopen(req, timeout=5) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"[warn] tr rpc {host}:{port} {method}: {e}")
        return {}

def tr_session_limits(host, port, username=None, password=None):
    """Transmission 会话限速，单位 KiB/s，附启用开关"""
    r = _tr_rpc(host, port, 'session-get',
                {'fields': ['speed-limit-down', 'speed-limit-up',
                            'speed-limit-down-enabled', 'speed-limit-up-enabled']},
                username, password)
    a = r.get('arguments', {})
    return {
        'dl': int(a.get('speed-limit-down', 0)),
        'up': int(a.get('speed-limit-up', 0)),
        'dl_en': bool(a.get('speed-limit-down-enabled', False)),
        'up_en': bool(a.get('speed-limit-up-enabled', False)),
    }

def tr_set_limits(host, port, dl_kb=None, up_kb=None, username=None, password=None):
    """设置 Transmission 会话限速（KiB/s，0=不限）"""
    args = {}
    if dl_kb is not None:
        args['speed-limit-down'] = int(dl_kb)
        args['speed-limit-down-enabled'] = int(dl_kb) > 0
    if up_kb is not None:
        args['speed-limit-up'] = int(up_kb)
        args['speed-limit-up-enabled'] = int(up_kb) > 0
    if args:
        _tr_rpc(host, port, 'session-set', args, username, password)

# ========== 轮播源 ==========
_SERIES_CACHE = {}
_SERIES_TTL = 600  # 剧集详情缓存 10 分钟（auto 循环切源频繁，避免每轮重查 Emby）

def _emby_series_detail(sid, user_id=None):
    """剧集轮播详情：一次拉全集 Episode，本地聚合出 当前季/已更集数/最新集号/第一集时长。"""
    if not sid:
        return None
    now = time.time()
    c = _SERIES_CACHE.get(sid)
    if c and now - c[0] < _SERIES_TTL:
        return c[1]
    try:
        r = emby_get(f"/Users/{_uid(user_id)}/Items?ParentId={sid}&Recursive=true&IncludeItemTypes=Episode&Fields=RunTimeTicks,IndexNumber,ParentIndexNumber&SortBy=ParentIndexNumber,IndexNumber&Limit=500")
        eps = []
        for e in r.get('Items', []):
            sn = e.get('ParentIndexNumber', 0)
            if sn > 0:  # 排除 Season 0 / 特别篇
                eps.append({'sn': sn, 'en': e.get('IndexNumber', 0) or 0, 'rt': int((e.get('RunTimeTicks', 0) or 0) / 10_000_000)})
        if not eps:
            return None
        seasons = sorted({e['sn'] for e in eps})
        cur_season = seasons[-1]
        season_eps = [e for e in eps if e['sn'] == cur_season]
        first = min(eps, key=lambda e: (e['sn'], e['en']))
        data = {
            'totalSeasons': len(seasons),
            'totalEpisodes': len(eps),
            'curSeason': cur_season,
            'curEps': len(season_eps),
            'curEpIdx': max(e['en'] for e in season_eps),
            'firstEpRuntimeSecs': first['rt'],
        }
        _SERIES_CACHE[sid] = (now, data)
        return data
    except Exception as e:
        print(f"[warn] series_detail {sid}: {e}")
        return None

def _tmdb_backdrop(title, itype, tmdb_id=''):
    """媒体库无 Backdrop 时用 TMDB 宽幅 backdrop 兜底（仅当 Emby 已关联 TMDB id 时按 id 直取）"""
    try:
        mt = 'tv' if itype == 'Series' else 'movie'
        if tmdb_id:
            d = _tmdb_get('%s/%s' % (mt, tmdb_id))
            if d.get('backdrop_path'):
                return 'https://image.tmdb.org/t/p/original' + d['backdrop_path']
    except Exception:
        pass
    return ''

def _emby_carousel_items(r, user_id=None):
    """统一从 Emby Items 响应提取轮播字段"""
    out = []
    _tmdb_fill = [0]
    for it in r.get('Items', []):
        tags = it.get('ImageTags', {})
        bdt = (it.get('BackdropImageTags') or [])
        genres = it.get('Genres', [])
        extra = ''
        series = None
        if it.get('Type') == 'Series':
            se = it.get('ChildCount', 0)
            ec = it.get('RecursiveItemCount', 0)
            if se: extra = f"{se}季" + (f" · {ec}集" if ec else '')
            detail = _emby_series_detail(it.get('Id', ''), user_id)
            if detail:
                series = {
                    'status': (it.get('Status') or '').lower(),
                    'totalSeasons': detail['totalSeasons'] or se,
                    'totalEpisodes': detail['totalEpisodes'] or ec,
                    'curSeason': detail['curSeason'],
                    'curEps': detail['curEps'],
                    'curEpIdx': detail['curEpIdx'],
                    'firstEpRuntimeSecs': detail['firstEpRuntimeSecs'],
                    'episodeRunTime': round((detail['firstEpRuntimeSecs'] or 0) / 60) or 0,
                }
        elif it.get('Type') == 'Episode':
            sn = it.get('ParentIndexNumber', 0)
            en = it.get('IndexNumber', 0)
            if sn: extra = f"S{sn:02d}E{en:02d}" if en else f"第{sn}季"
        bdurl = emby_poster(it.get('Id', ''), bdt[0], 1280, 'Backdrop') if bdt else ''
        if not bdurl and _tmdb_fill[0] < 6:
            bdurl = _tmdb_backdrop(it.get('Name', '') or '', it.get('Type', ''), str((it.get('ProviderIds') or {}).get('Tmdb') or ''))
            if bdurl:
                _tmdb_fill[0] += 1
        bdurl = bdurl or (emby_poster(it.get('Id', ''), tags.get('Primary'), 1280) if tags.get('Primary') else '')
        out.append({
            'id': it.get('Id', ''),
            'title': it.get('Name', ''),
            'year': str(it.get('ProductionYear', '')),
            'type': '电影' if it.get('Type') == 'Movie' else '剧集',
            'image': (emby_poster(it.get('Id', ''), tags.get('Primary'), 1280) if tags.get('Primary')
                      else (emby_poster(it.get('Id', ''), bdt[0], 1280, 'Backdrop') if bdt else '')),
            'backdrop': bdurl,
            'rating': round(it.get('CommunityRating', 0) or 0, 1),
            'genres': ' / '.join(genres[:3]) if genres else '',
            'overview': (it.get('Overview', '') or '')[:150],
            'runtime': it.get('RunTimeTicks', 0) and int(it.get('RunTimeTicks', 0) / 600000000) or 0,
            'runtimeSecs': int((it.get('RunTimeTicks', 0) or 0) / 10_000_000),
            'officialRating': it.get('OfficialRating', ''),
            'extra': extra,
            'series': series,
            'source': 'media',
        })
    return out

def carousel_recent(user_id=None):
    r = emby_get(f"/Items?SortBy=DateCreated&SortOrder=Descending&IncludeItemTypes=Movie,Series&Recursive=true&Limit=20&Fields=Overview,Genres,RunTimeTicks,OfficialRating,CommunityRating,Status,ChildCount,RecursiveItemCount&UserId={_uid(user_id)}")
    return _emby_carousel_items(r, user_id)

def carousel_random(user_id=None):
    r = emby_get(f"/Items?SortBy=Random&SortOrder=Ascending&IncludeItemTypes=Movie,Series&Recursive=true&Limit=20&Fields=Overview,Genres,RunTimeTicks,OfficialRating,CommunityRating,Status,ChildCount,RecursiveItemCount&UserId={_uid(user_id)}")
    return _emby_carousel_items(r, user_id)

def carousel_trending(user_id=None):
    r = emby_get(f"/Items?SortBy=CommunityRating&SortOrder=Descending&IncludeItemTypes=Movie,Series&Recursive=true&Limit=20&Fields=Overview,Genres,RunTimeTicks,OfficialRating,CommunityRating,Status,ChildCount,RecursiveItemCount&UserId={_uid(user_id)}")
    return _emby_carousel_items(r, user_id)

TMDB_API_KEY = os.environ.get('DASH_TMDB_API_KEY', '')  # 无内置默认，须经环境变量或设置页注入

def _tmdb_key():
    """TMDB key：环境变量 > 设置页 config.tmdb.api_key。"""
    try:
        return TMDB_API_KEY or (((CONFIG or {}).get('tmdb', {}) or {}).get('api_key') or '')
    except Exception:
        return TMDB_API_KEY

def _tmdb_get(path):
    sep = '&' if '?' in path else '?'
    url = f"https://api.themoviedb.org/3/{path}{sep}api_key={_tmdb_key()}&language=zh-CN"
    req = urllib.request.Request(url, headers={'User-Agent': 'NEXUS/1.0'})
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        # 代理：容器内直连被墙时走 config 的 proxy（如 mihomo http://host:9090）；未配置则直连
        _px = (CONFIG.get('proxy_url') or CONFIG.get('proxy') or '').strip()
        if not _px:
            _px = str(((CONFIG.get('services') or {}).get('proxy') or {}).get('mihomo') or '').strip()
        _ph = urllib.request.ProxyHandler({'http': _px, 'https': _px}) if _px else urllib.request.ProxyHandler({})
        opener = urllib.request.build_opener(_ph,
                                             urllib.request.HTTPSHandler(context=ctx))
        with opener.open(req, timeout=10) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"[warn] tmdb: {e}", flush=True)
        return {"results": []}

def carousel_tmdb():
    """TMDB 流行电影"""
    data = _tmdb_get("movie/popular")
    # genre id map
    gdata = _tmdb_get("genre/movie/list")
    gmap = {g['id']: g['name'] for g in gdata.get('genres', [])}
    out = []
    for it in data.get('results', [])[:20]:
        poster = "https://image.tmdb.org/t/p/original" + (it.get('poster_path') or it.get('backdrop_path') or '')
        backdrop = "https://image.tmdb.org/t/p/original" + (it.get('backdrop_path') or it.get('poster_path') or '')
        genres = [gmap.get(gid, '') for gid in it.get('genre_ids', [])[:3]]
        out.append({
            'id': str(it.get('id', '')),
            'title': it.get('title', ''),
            'year': it.get('release_date', '')[:4],
            'type': '电影',
            'image': poster,
            'backdrop': backdrop,
            'rating': round(it.get('vote_average', 0) or 0, 1),
            'overview': (it.get('overview', '') or '')[:150],
            'genres': ' / '.join([g for g in genres if g]),
            'runtime': 0,
            'source': 'external',
        })
    return out

def carousel_douban():
    """豆瓣正在热映（爬豆瓣 nowplaying 页面）"""
    try:
        url = "https://movie.douban.com/cinema/nowplaying/liuzhou/"
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        })
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        html = urllib.request.urlopen(req, timeout=10, context=ctx).read().decode("utf-8")
        # 解析每个 list-item
        items = re.findall(r'<li[^>]*data-title="([^"]*)"[^>]*data-score="([^"]*)"[^>]*data-release="([^"]*)"[^>]*data-subject="([^"]*)"', html)
        # 匹配对应图片
        imgs = re.findall(r'data-subject="(\d+)".*?<img[^>]*src="([^"]+)"', html, re.DOTALL)
        img_map = dict(imgs)
        out = []
        for title, score, year, sid in items[:20]:
            poster = img_map.get(sid, "")
            s = float(score) if score and score != "0" else 0
            out.append({
                'id': str(sid),
                'title': title,
                'year': year,
                'type': '电影',
                'image': poster,
                'backdrop': poster,
                'rating': s,
                'source': 'external',
            })
        if out:
            return out
    except Exception as e:
        print(f"[warn] douban scrape: {e}")
    # fallback: TMDB 中文
    try:
        data = _tmdb_get("discover/movie?sort_by=popularity.desc&with_original_language=zh")
        out = []
        for it in data.get('results', [])[:20]:
            poster = "https://image.tmdb.org/t/p/original" + (it.get('poster_path') or it.get('backdrop_path') or '')
            backdrop = "https://image.tmdb.org/t/p/original" + (it.get('backdrop_path') or it.get('poster_path') or '')
            out.append({
                'id': str(it.get('id', '')),
                'title': it.get('title', ''),
                'year': it.get('release_date', '')[:4],
                'type': '电影',
                'image': poster,
                'backdrop': backdrop,
                'rating': round(it.get('vote_average', 0) or 0, 1),
                'source': 'external',
            })
        return out
    except Exception:
        return []

# ========== 最近入库 ==========
_HEALTH_POOL = [
    '每天喝够 1500-1700ml 水，少量多次，比一次猛灌更利健康。',
    '成年人每天睡 7-9 小时为宜；长期睡眠不足会增加代谢与心血管风险。',
    '久坐每 45-60 分钟起身活动 3 分钟，可显著缓解腰椎与颈椎压力。',
    '早餐补足蛋白质（蛋/奶/豆），有助于稳定全天血糖与精力。',
    '每日 30 分钟中等强度运动（快走/骑车）即可获得多数运动收益。',
    '屏幕每 20 分钟远眺 6 米外物体 20 秒，可有效缓解视疲劳。',
    '控盐是关键：成人每日食盐建议不超过 5 克，重口要克制。',
    '每餐先吃蔬菜再吃主食，餐后血糖更平稳，更易控制体重。',
    '鲜榨果汁含糖不低，直接吃整果更好——多纤维、少糖负担。',
    '洗澡水温 38-40℃ 为宜，过热会破坏皮肤屏障，加剧干燥。',
    '晒太阳每日 10-20 分钟（避开正午暴晒）助维生素 D 合成。',
    '用腹式深呼吸 5 分钟可快速平复情绪、降低心率与血压。',
    '饭后不立即剧烈运动，散步 15 分钟有助消化与血糖管理。',
    '久坐人群每小时起身，比集中大运动更能抵消久坐危害。',
    '咖啡因摄入建议：每天不超过 3 杯咖啡，下午 2 点后少喝防失眠。',
    '刷牙采用巴氏刷牙法，每次不少于 2 分钟，别遗漏牙龈沟。',
    '减重以每周 0.5-1 公斤为宜，过快反弹风险更高、肌肉流失更多。',
    '电子产品睡前 1 小时调低亮度，蓝光会抑制褪黑素分泌。',
    '感冒喝热水有效：热饮可缓解鼻塞，注意别烫到。',
    '冷萃≠低糖，含糖饮料无论冷热，对血糖影响都需留意。',
    '每日吃够 300-500g 蔬菜，深色蔬菜占一半，补足膳食纤维。',
    '步行是最被低估的运动：每天 8000 步，长期心血管获益明显。',
    '情绪与肠道相关：压力大时多吃发酵食品，有助菌群稳定。',
    '干眼人群可用 20-20-20 法则＋人工泪液，勿频繁揉眼。',
    '献血前要进食、补水，避免空腹；献血后不立即剧烈运动。',
    '睡前一小时放下手机，纸质阅读或轻拉伸有助更快入睡。',
    '喝茶别喝太烫：65℃ 以上热饮被列为可能致癌物，放温再喝。',
    '久站工作者可定时踮脚，促进下肢血液回流，缓解腿肿。',
    '坚果每天一小把（约 30g），不饱和脂肪酸有益心血管。',
    '膝盖保养：下蹲发力用臀腿肌肉，避免膝内扣，循序渐进运动。',
]

def daily_tips():
    """健康小知识：随机取 3 条轮播。注：丁香医生每日推送无公开接口（App 动态/签名），
    面板内置通用健康知识池保证稳定可用；如需丁香品牌内容请另行提供可访问来源。"""
    import random
    pick = random.sample(_HEALTH_POOL, 3)
    return [{'title': '今日健康小知识', 'content': t} for t in pick]

def recent_transfers(limit=12, user_id=None):
    try:
        conn = sqlite3.connect(MP_DB, timeout=3)
        c = conn.cursor()
        c.execute("SELECT title, year, type, category, image, date FROM transferhistory WHERE status=1 ORDER BY date DESC LIMIT ?", (limit,))
        rows = c.fetchall()
        conn.close()
        out = []
        for row in rows:
            title, year, typ, cat, image, date = row
            # 过滤音乐
            if cat and '音乐' in str(cat):
                continue
            if typ and '音乐' in str(typ):
                continue
            # 获取评分和Emby ID
            rating = 0
            emby_id = ''
            try:
                s = emby_get(f"/Users/{_uid(user_id)}/Items?searchTerm={urllib.parse.quote(title or '')}&IncludeItemTypes=Movie,Series&Recursive=true&Limit=1&Fields=CommunityRating,PrimaryImageAspectRatio")
                if s.get('Items'):
                    rating = round(s['Items'][0].get('CommunityRating', 0) or 0, 1)
                    emby_id = s['Items'][0].get('Id', '')
            except Exception:
                pass
            out.append({
                'title': title or '',
                'year': year or '',
                'type': typ or '',
                'date': date or '',
                'rating': rating,
                'image': image or '',
                'id': emby_id,
            })
        return out[:10]
    except Exception as e:
        print(f"[warn] recent: {e}")
        return []

# ========== 服务状态 ==========
def check_service(host, port, use_https=False, path='/'):
    """探测服务在线。不跟随重定向：任何 <500 的 HTTP 响应（200/301/302/401/403）都视为在线。
    优先内网直连（hairpin 通常不通且慢）；直连失败后走代理网关兜底。"""
    import http.client, ssl
    def _direct(h, u):
        ctx = None
        if u:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        if u:
            conn = http.client.HTTPSConnection(h, port, timeout=3, context=ctx)
        else:
            conn = http.client.HTTPConnection(h, port, timeout=3)
        conn.request('GET', path or '/', headers={'User-Agent': 'NexusDash/1.0'})
        resp = conn.getresponse()
        code = resp.status
        conn.close()
        return code < 500
    # 直接用用户配置的 host:port:proto 探测（内网 DNS 已将公网域名解析到内网 IP）
    candidates = [(host, use_https)]
    for h, u in candidates:
        try:
            if _direct(h, u):
                return True
        except Exception as e:
            print(f"[check_service] direct fail host={h} port={port} https={u}: {e!r}", flush=True)
    # 兜底：走代理网关（公网/境外域名）
    scheme = 'https' if use_https else 'http'
    url = f"{scheme}://{host}:{port}{path}"
    try:
        req = urllib.request.Request(url)
        req.add_header('User-Agent', 'NexusDash/1.0')
        with _proxy_opener().open(req, timeout=5) as r:
            return r.status < 500
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False

def get_services():
    """内置服务清单（端口/协议可由 config.json 与「监控服务」覆盖，可自行增删）"""
    services = [
        {'name': 'Emby', 'host': SA_HOST, 'port': 16880, 'use_https': False, 'device': 'SA', 'desc': '媒体串流', 'icon': '🎬', 'public': ''},
        {'name': 'MP', 'host': SA_HOST, 'port': 16995, 'use_https': False, 'device': 'SA', 'desc': '自动化整理', 'icon': '🤖', 'public': ''},
        {'name': 'QB', 'host': SA_HOST, 'port': 16058, 'use_https': False, 'device': 'SA', 'desc': '下载客户端', 'icon': '⬇️', 'public': ''},
        {'name': 'TR', 'host': SA_HOST, 'port': 16062, 'use_https': False, 'device': 'SA', 'desc': '下载客户端', 'icon': '📡', 'public': ''},
        {'name': '代理', 'host': SA_HOST, 'port': 16001, 'use_https': False, 'device': 'SA', 'desc': '代理网关', 'icon': '🌐', 'public': ''},
        {'name': 'Metacubexd', 'host': SA_HOST, 'port': 16003, 'use_https': False, 'device': 'SA', 'desc': 'mihomo 管理面板', 'icon': '🛠️', 'public': ''},
        {'name': '网盘搜索', 'host': SA_HOST, 'port': 18666, 'use_https': False, 'device': 'SA', 'desc': '网盘搜索', 'icon': '📦', 'public': ''},
        {'name': '面板', 'host': '127.0.0.1', 'port': 28080, 'use_https': False, 'device': 'SA', 'desc': '本面板', 'icon': '🖥️', 'public': ''},
        {'name': '云盘挂载', 'host': SA_HOST, 'port': 16057, 'use_https': False, 'device': 'SA', 'desc': '网盘挂载', 'icon': '💾', 'public': ''},
        {'name': 'AdGuard', 'host': SA_HOST, 'port': 18080, 'use_https': False, 'device': 'SA', 'desc': 'DNS 过滤', 'icon': '🛡️', 'public': ''},
        {'name': 'IYUU', 'host': SA_HOST, 'port': 11311, 'use_https': False, 'device': 'SA', 'desc': '辅种', 'icon': '🌱', 'public': ''},
        {'name': '有声书', 'host': SA_HOST, 'port': 16887, 'use_https': False, 'device': 'SA', 'desc': '有声书', 'icon': '📚', 'public': ''},
        {'name': 'TR-DS', 'host': DS_HOST, 'port': 16666, 'use_https': False, 'device': 'DS', 'desc': '下载客户端', 'icon': '🖥️', 'public': ''},
    ]
    # 用户自定义监控服务（config monitor_services，可增删改查）
    for cs in (CONFIG.get('monitor_services', []) or []):
        if not cs.get('name'):
            continue
        services.append({
            'name': cs.get('name', ''),
            'host': cs.get('host', SA_HOST),
            'port': int(cs.get('port', 80) or 80),
            'use_https': (cs.get('proto', 'http') == 'https'),
            'device': cs.get('device', 'SA'),
            'desc': cs.get('desc', ''),
            'icon': cs.get('icon', '📦'),
            'public': cs.get('public', ''),
            'ext_host': cs.get('ext_host', ''),
            'ext_port': int(cs.get('ext_port', 0) or 0),
            'ext_proto': cs.get('ext_proto', 'http'),
            'custom': True,
        })
    # 应用前端配置覆盖（端口 + 协议 + 别名）——仅用于前端显示/跳转，健康检查仍用内置内网地址
    overrides = CONFIG.get('svc_ports', {})
    aliases = CONFIG.get('svc_aliases', {})
    for s in services:
        ov = overrides.get(s['name'])
        if ov:
            s['public'] = f"{'https' if ov.get('proto','http')=='https' else 'http'}://{ov.get('host', s['host'])}:{ov.get('port', s['port'])}"
            # 不覆盖 host/port/use_https，保持内置内网直连配置
    result = []
    # 并行健康检查：串行 3s×N 曾达 34s 超过前端 30s 超时（服务监控卡片空白根因），改为并发，总耗时≈最慢服务
    ok_map = {}
    def _probe(s):
        if s['name'] == '面板':
            ok_map[s['name']] = True
        else:
            try:
                ok_map[s['name']] = check_service(s['host'], s['port'], s['use_https'])
            except Exception:
                ok_map[s['name']] = False
    _ths = [threading.Thread(target=_probe, args=(s,)) for s in services]
    for _t in _ths:
        _t.start()
    for _t in _ths:
        _t.join()
    for s in services:
        ok = ok_map.get(s['name'], False)
        # 状态变化写入运行日志（首轮只记录基线）
        try:
            _track_svc_state(s['name'], ok)
        except Exception:
            pass
        public_url = s.get('public', '')
        if s['name'] == '面板':
            public_url = ''
        _DISPLAY_FIX = {'MP': 'MoviePilot', 'QB': 'qBittorrent', 'TR': 'Transmission', 'TR-DS': 'Transmission', '代理': 'mihomo', 'AdGuard': 'AdGuard Home'}
        # 显示名优先级：设置页别名 > 官方名（§8.12 登录门禁后改官方名）> 原始名
        display_name = aliases.get(s['name']) or _DISPLAY_FIX.get(s['name'], s['name'])
        proto = 'https' if s['use_https'] else 'http'
        result.append({
            'name': display_name,
            'key': s['name'],
            'device': s['device'],
            'group': s['device'],
            'desc': s['desc'],
            'port': s['port'],
            'icon': s.get('icon', '📦'),
            'url': public_url or f"{proto}://{s['host']}:{s['port']}",
            'status': 'online' if ok else 'offline',
        })
    return result

# ========== 脚本与活动日志 ==========
def get_crontab_scripts():
    """读取 /etc/cron.d/ 下的定时脚本"""
    scripts = []
    try:
        import os, glob
        for f in glob.glob('/etc/cron.d/*'):
            if f.endswith('.bak') or 'synosched' in f or 'spacereclaim' in f:
                continue
            with open(f) as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    parts = line.split()
                    if len(parts) >= 6:
                        schedule = ' '.join(parts[:5])
                        cmd = ' '.join(parts[5:])
                        name = os.path.basename(f)
                        scripts.append({'name': name, 'schedule': schedule, 'command': cmd[:120]})
    except Exception:
        pass
    return scripts[:30]

def get_recent_events():
    """从 MP user.db 读最近整理入库记录（MoviePilot transferhistory）"""
    events = []
    try:
        import sqlite3
        db = _mp_db()  # MP user.db 路径（GUI 可配置）
        conn = sqlite3.connect(f'file:{db}?mode=ro', uri=True, timeout=3)
        cur = conn.cursor()
        cur.execute("SELECT title, type, category, date FROM transferhistory ORDER BY date DESC LIMIT 15")
        for row in cur.fetchall():
            events.append({
                'title': row[0], 'type': row[1],
                'category': row[2], 'date': row[3]
            })
        conn.close()
    except Exception:
        pass
    return events

# ========== HTTP Handler ==========
class Handler(BaseHTTPRequestHandler):
    def _security_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-XSS-Protection', '1; mode=block')

    def send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self._security_headers()
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, body, code=200):
        if isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self._security_headers()
        self.end_headers()
        self.wfile.write(body)

    def _get_client_ip(self):
        return self.client_address[0]

    def _extract_token(self):
        auth = self.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            return auth[7:]
        cookie = self.headers.get('Cookie', '')
        for part in cookie.split(';'):
            part = part.strip()
            if part.startswith('nexus_token='):
                return part[len('nexus_token='):]
        return None

    def _require_auth(self):
        """Returns session dict if authenticated, None otherwise."""
        if not CONFIG.get('auth_enabled', True):
            return {'username': CONFIG.get('auth_username', 'admin')}
        token = self._extract_token()
        s = check_session(token)
        if s:
            return s
        return None

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_POST(self):
        path = self.path.split('?')[0]

        # 登录（公开）
        if path == '/api/login':
            ip = self._get_client_ip()
            if not check_rate_limit(ip):
                self.send_json({'error': '尝试次数过多，请 5 分钟后再试'}, code=429)
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8') if length else '{}'
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'error': '无效请求'}, code=400)
                return
            username = data.get('username', '')
            password = data.get('password', '')
            uinfo = find_user(username)
            phash = user_password_hash(username)
            if uinfo and phash and hashlib.sha256(password.encode()).hexdigest() == phash:
                clear_attempts(ip)
                role = uinfo['role']
                token = create_session(username, role)
                _log('INFO', 'auth', '登录成功 user=%s role=%s ip=%s' % (username, role, ip))
                self.send_json({
                    'ok': True, 'token': token, 'username': username,
                    'role': role, 'is_admin': uinfo['is_admin'],
                    'permissions': get_role(role)['permissions'],
                })
            else:
                record_failed_attempt(ip)
                _log('WARN', 'auth', '登录失败 user=%s ip=%s（剩余失败次数受限）' % (username, ip))
                self.send_json({'error': '用户名或密码错误'}, code=401)
            return

        # 登出
        if path == '/api/logout':
            token = self._extract_token()
            if token:
                destroy_session(token)
            self.send_json({'ok': True})
            return

        if path == '/cookiecloud/sync':
            # P0-2: 匿名投毒防护。CookieCloud 浏览器插件推送带 password，必须恒定时间比对。
            _cc_cfg = {}
            try:
                with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                    _cc_cfg = json.load(f).get('cookiecloud', {})
            except Exception:
                pass
            if not _cc_cfg.get('enabled', True):
                self.send_json({'success': False, 'error': 'CookieCloud 接收已在设置中关闭'}, code=403)
                return
            expected_pw = _cc_cfg.get('password', '') or ''
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8', errors='ignore') if length else ''
            post_data = urllib.parse.parse_qs(body)
            password = post_data.get('password', [''])[0]
            # 未配置密码时拒绝任何同步（强制先在设置里设密码）；配置后恒定时间比对
            if not expected_pw or not hmac.compare_digest(password, expected_pw):
                ip = self._get_client_ip()
                _hint = '（⑦ 待办：cookiecloud.password 未配置，请先在设置页填写 CookieCloud 密码）' if not expected_pw else '（密码错误）'
                print(f'[CookieCloud] 拒绝同步: {_hint} from {ip}', flush=True)
                self.send_json({'success': False, 'error': 'unauthorized'}, code=401)
                return
            cookie_raw = post_data.get('cookie_data', [''])[0]
            try:
                cookie_data = json.loads(cookie_raw) if cookie_raw else {}
            except Exception:
                cookie_data = {}
            existing = load_cookies()
            existing.update(cookie_data)
            save_cookies(existing)
            updated = update_mp_sites_from_cookies(cookie_data)
            ip = self._get_client_ip()
            _log('INFO', 'cookiecloud', '同步成功 ip=%s domains=%d mp_updated=%d' % (ip, len(cookie_data), updated))
            print(f'[CookieCloud] 同步成功 from {ip}: domains={len(cookie_data)} mp_updated={updated}', flush=True)
            self.send_json({'success': True, 'domains': len(cookie_data), 'mp_updated': updated})
        elif path.startswith('/api/journey/claim'):
            s = self._require_auth()
            if not s:
                self.send_json({'error': '未授权'}, code=401)
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8', errors='ignore') if length else '{}'
            try:
                data = json.loads(body) if body else {}
            except Exception:
                data = {}
            item = data.get('item') or {}
            d = _journey_load()
            today = _jtoday()
            if _journey_daily_limit() and d.get('last_claim') == today and d.get('claimed_today', 0) >= 1:
                self.send_json({'error': '今天已认领过一张，明日再来'}, code=400)
                return
            card = {
                'id': _journey_uid(), 'item_id': str(item.get('item_id', '')),
                'title': item.get('title', ''), 'type': item.get('type', 'movie'),
                'year': item.get('year', ''), 'rating': item.get('rating', 0),
                'genres': item.get('genres', []), 'image': item.get('image', ''),
                'status': 'claimed', 'claimed_date': today, 'completed_date': '',
                'note': '', 'group': '', 'source': item.get('source', 'media'),
            }
            d.setdefault('cards', []).append(card)
            d['last_claim'] = today
            d['claimed_today'] = d.get('claimed_today', 0) + 1
            _journey_save(d)
            self.send_json({'ok': True, 'card': card, 'can_claim': False})

        elif path.startswith('/api/journey/note/del'):
            s = self._require_auth()
            if not s:
                self.send_json({'error': '未授权'}, code=401)
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8', errors='ignore') if length else '{}'
            try:
                data = json.loads(body) if body else {}
            except Exception:
                data = {}
            d = _journey_load()
            for c in d.get('cards', []):
                if c.get('id') == data.get('id'):
                    notes = _journey_notes(c)
                    idx = data.get('index')
                    if isinstance(idx, int) and 0 <= idx < len(notes):
                        del notes[idx]
                    c['notes'] = notes
                    c['note'] = notes[-1]['text'] if notes else ''
                    break
            _journey_save(d)
            self.send_json({'ok': True})

        elif path.startswith('/api/journey/note'):
            s = self._require_auth()
            if not s:
                self.send_json({'error': '未授权'}, code=401)
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8', errors='ignore') if length else '{}'
            try:
                data = json.loads(body) if body else {}
            except Exception:
                data = {}
            txt = data.get('text', data.get('note', ''))
            d = _journey_load()
            for c in d.get('cards', []):
                if c.get('id') == data.get('id'):
                    notes = _journey_notes(c)
                    idx = data.get('index')
                    if isinstance(idx, int) and 0 <= idx < len(notes):
                        notes[idx]['text'] = txt
                    elif txt:
                        import time as _t
                        notes.append({'text': txt, 'ts': _t.strftime('%Y-%m-%d %H:%M:%S')})
                    c['notes'] = notes
                    c['note'] = notes[-1]['text'] if notes else ''
                    break
            _journey_save(d)
            self.send_json({'ok': True})

        elif path.startswith('/api/journey/group'):
            s = self._require_auth()
            if not s:
                self.send_json({'error': '未授权'}, code=401)
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8', errors='ignore') if length else '{}'
            try:
                data = json.loads(body) if body else {}
            except Exception:
                data = {}
            d = _journey_load()
            for c in d.get('cards', []):
                if c.get('id') == data.get('id'):
                    c['group'] = data.get('group', '')
            _journey_save(d)
            self.send_json({'ok': True})

        elif path.startswith('/api/journey/share'):
            s = self._require_auth()
            if not s:
                self.send_json({'error': '未授权'}, code=401)
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8', errors='ignore') if length else '{}'
            try:
                data = json.loads(body) if body else {}
            except Exception:
                data = {}
            cid = data.get('id')
            token = data.get('token') or _journey_uid()
            d = _journey_load()
            for c in d.get('cards', []):
                if c.get('id') == cid:
                    c['share_token'] = token
                    c['shared'] = True
            _journey_save(d)
            self.send_json({'ok': True, 'token': token, 'url': '/api/journey/share/' + token})

        elif path == '/api/favorites':
            s = self._require_auth()
            if not s:
                self.send_json({'error': '未授权'}, code=401)
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8', errors='ignore') if length else '{}'
            try:
                data = json.loads(body) if body else {}
            except Exception:
                data = {}
            favs = load_favs()
            action = data.get('action')
            if action == 'add':
                item = data.get('item') or {}
                if item.get('id') and not any(f.get('id') == item.get('id') for f in favs):
                    favs.insert(0, item)
                    save_favs(favs)
            elif action == 'remove':
                fid = data.get('id')
                favs = [f for f in favs if f.get('id') != fid]
                save_favs(favs)
            self.send_json({'ok': True, 'favorites': favs})
        elif path == '/api/config':
            # 设置保存需要认证 + settings 权限
            s = self._require_auth()
            if not s:
                self.send_json({'error': '未授权'}, code=401)
                return
            role = s.get('role', 'admin')
            if not _has_perm(get_role(role)['permissions'], 'settings:manage') and not _has_perm(get_role(role)['permissions'], 'settings:rbac'):
                self.send_json({'error': '无权限修改配置'}, code=403)
                return
            self._handle_config_post()
            _log('INFO', 'config', '设置已保存 role=%s' % role)
        elif path == '/api/limits':
            # 修改下载器限速：需要 transfers 权限
            s = self._require_auth()
            if not s:
                self.send_json({'error': '未授权'}, code=401)
                return
            role = s.get('role', 'admin')
            if not _has_perm(get_role(role)['permissions'], 'transfers:limit'):
                self.send_json({'error': '无权限修改限速'}, code=403)
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8') if length else '{}'
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'error': '无效请求'}, code=400)
                return
            engine = data.get('engine', 'qb')
            dl_kb = data.get('dl_kb')
            up_kb = data.get('up_kb')
            if dl_kb is not None: dl_kb = round(float(dl_kb))
            if up_kb is not None: up_kb = round(float(up_kb))
            try:
                if engine == 'qb':
                    qb_set_limits(dl_kb, up_kb)
                elif engine == 'tr_sa':
                    tr_set_limits(SA_HOST, 16062, dl_kb, up_kb)
                elif engine == 'tr_ds':
                    tr_set_limits(DS_HOST, 16666, dl_kb, up_kb)
                else:
                    self.send_json({'error': '未知引擎'}, code=400)
                    return
            except Exception as e:
                self.send_json({'error': '设置限速失败: ' + str(e)}, code=500)
                return
            self.send_json({'ok': True})

        elif path == '/api/scripts/run':
            s = self._require_auth()
            if not s:
                self.send_json({'error': '未授权'}, code=401)
                return
            # P0-7: 运行脚本与 save/delete 一致，需要 scripts:manage 权限（原仅 _require_auth，低权可执行）
            role = s.get('role', 'admin')
            if not _has_perm(get_role(role)['permissions'], 'scripts:manage'):
                self.send_json({'error': '无权限运行脚本'}, code=403)
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8') if length else '{}'
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'error': '无效请求'}, code=400)
                return
            name = data.get('name', '')
            result = run_script(name)
            self.send_json(result)

        elif path == '/api/scripts/save':
            s = self._require_auth()
            if not s:
                self.send_json({'error': '未授权'}, code=401)
                return
            role = s.get('role', 'admin')
            if not _has_perm(get_role(role)['permissions'], 'scripts:manage'):
                self.send_json({'error': '无权限管理脚本'}, code=403)
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8') if length else '{}'
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'error': '无效请求'}, code=400)
                return
            name = data.get('name', '')
            content = data.get('content', '')
            self.send_json(save_script(name, content))

        elif path == '/api/scripts/delete':
            s = self._require_auth()
            if not s:
                self.send_json({'error': '未授权'}, code=401)
                return
            role = s.get('role', 'admin')
            if not _has_perm(get_role(role)['permissions'], 'scripts:manage'):
                self.send_json({'error': '无权限管理脚本'}, code=403)
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8') if length else '{}'
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'error': '无效请求'}, code=400)
                return
            name = data.get('name', '')
            self.send_json(delete_script(name))

        elif path == '/api/subscribe':
            # 向 MoviePilot 添加订阅：写 subscribe 表(state=N 触发 MP 订阅搜索)
            s = self._require_auth()
            if not s:
                self.send_json({'error': '未授权'}, code=401)
                return
            if not _mp_enabled():
                self.send_json({'ok': False, 'error': 'MoviePilot 未启用，请先在设置中开启 MoviePilot 接入'}, code=400)
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8') if length else '{}'
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'error': '无效请求'}, code=400)
                return
            name = str(data.get('name') or '').strip()
            tmdbid = str(data.get('tmdbid') or '').strip()
            if not name or not tmdbid:
                self.send_json({'ok': False, 'error': '缺少 name 或 tmdbid'}, code=400)
                return
            mtype = data.get('type', 'movie')
            if mtype not in ('movie', 'tv'):
                mtype = 'movie'
            action = data.get('action', 'add')
            if action == 'remove':
                # 取消订阅：删 MP subscribe 记录
                cmd = ['python3', _mp_script(), '--name', name, '--tmdbid', tmdbid, '--remove']
                try:
                    out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                    res = json.loads(out.stdout.strip() or '{}')
                    if res.get('ok'):
                        self.send_json({'ok': True, 'removed': res.get('removed', False), 'id': res.get('id')})
                    else:
                        self.send_json({'ok': False, 'error': res.get('error') or (out.stderr or '脚本执行失败').strip()}, code=500)
                except subprocess.TimeoutExpired:
                    self.send_json({'ok': False, 'error': '订阅脚本超时'}, code=500)
                except Exception as e:
                    self.send_json({'ok': False, 'error': str(e)}, code=500)
                return
            if action in ('pause', 'resume'):
                # 暂停/恢复订阅：改 MP subscribe 表 state（N=正常，S=暂停）
                cmd = ['python3', _mp_script(), '--name', name, '--tmdbid', tmdbid,
                       '--pause' if action == 'pause' else '--resume']
                try:
                    out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                    res = json.loads(out.stdout.strip() or '{}')
                    if res.get('ok'):
                        self.send_json({'ok': True, 'paused': res.get('paused', action == 'pause'),
                                        'state': res.get('state'), 'id': res.get('id')})
                    else:
                        self.send_json({'ok': False, 'error': res.get('error') or (out.stderr or '脚本执行失败').strip()}, code=500)
                except subprocess.TimeoutExpired:
                    self.send_json({'ok': False, 'error': '订阅脚本超时'}, code=500)
                except Exception as e:
                    self.send_json({'ok': False, 'error': str(e)}, code=500)
                return
            cmd = ['python3', _mp_script(),
                   '--name', name, '--type', mtype,
                   '--year', str(data.get('year') or ''),
                   '--tmdbid', tmdbid,
                   '--poster', str(data.get('poster') or ''),
                   '--rating', str(data.get('rating') or 0),
                   '--desc', str(data.get('description') or '')]
            try:
                out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
                res = json.loads(out.stdout.strip() or '{}')
                if res.get('ok'):
                    self.send_json({'ok': True, 'already': res.get('already', False), 'id': res.get('id')})
                else:
                    self.send_json({'ok': False, 'error': res.get('error') or (out.stderr or '脚本执行失败').strip()}, code=500)
            except subprocess.TimeoutExpired:
                self.send_json({'ok': False, 'error': '订阅脚本超时'}, code=500)
            except Exception as e:
                self.send_json({'ok': False, 'error': str(e)}, code=500)

        elif path == '/api/incoming':
            # R-10 修复：POST 推消息改为可选共享密钥校验。config.json 配置 incoming_secret 后必须携带
            # X-Incoming-Secret 请求头（或 body.secret）且恒定时间比对；未配置时保持公开（兼容旧脚本）+ 启动告警。
            _inc_secret = str(CONFIG.get('incoming_secret') or '')
            if _inc_secret:
                _hdr_secret = self.headers.get('X-Incoming-Secret', '') or ''
                length = int(self.headers.get('Content-Length', 0))
                _body_raw = self.rfile.read(length).decode('utf-8', errors='ignore') if length else ''
                _body_secret = ''
                try:
                    _body_secret = json.loads(_body_raw).get('secret', '') if _body_raw else ''
                except Exception:
                    _body_secret = ''
                if not (_hdr_secret and hmac.compare_digest(_hdr_secret, _inc_secret)) and not (_body_secret and hmac.compare_digest(str(_body_secret), _inc_secret)):
                    self.send_json({'error': 'unauthorized'}, code=401)
                    return
            else:
                length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(length).decode('utf-8', errors='ignore') if length else ''
            try:
                data = json.loads(body) if body else {}
            except Exception:
                data = {}
            msg = {
                'id': int(time.time() * 1000),
                'source': data.get('source', 'unknown'),
                'title': data.get('title', ''),
                'content': data.get('content', ''),
                'level': data.get('level', 'info'),  # info/success/warning/error
                'actions': data.get('actions', []),  # [{label, api, method, body}]
                'ts': time.time(),
                'read': False,
            }
            msgs = _load_incoming()
            msgs.insert(0, msg)
            msgs = msgs[:INCOMING_MAX]
            _save_incoming(msgs)
            self.send_json({'ok': True, 'id': msg['id']})

        elif path == '/api/play-history':
            # 收藏中心「播放历史」：POST 记录（在线观影打开影片时前端上报）
            s = self._require_auth()
            if not s:
                self.send_json({'error': '未授权'}, code=401)
                return
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8') if length else '{}'
            try:
                data = json.loads(body)
            except Exception:
                self.send_json({'error': '无效请求'}, code=400)
                return
            entry = {
                'title': str(data.get('title') or '').strip(),
                'url': str(data.get('url') or '').strip(),
                'source': str(data.get('source') or '在线观影').strip(),
                'ts': int(data.get('ts') or time.time()),
            }
            if not entry['title'] or not entry['url']:
                self.send_json({'error': '缺少 title 或 url'}, code=400)
                return
            history = _load_play_history()
            # 相同 title+url 去重置顶（重复打开视为一次新的播放，更新时间戳）
            history = [h for h in history if not (h.get('title') == entry['title'] and h.get('url') == entry['url'])]
            history.insert(0, entry)
            _save_play_history(history)
            self.send_json({'ok': True})

        else:
            self.send_json({'error': 'not found'}, code=404)

    def do_GET(self):
        path = self.path.split('?')[0]
        params = urllib.parse.parse_qs(self.path.split('?')[1]) if '?' in self.path else {}

        # 认证门禁：除登录接口、静态文件、图片代理、版本指纹和通知聚合外，所有 API 需要会话
        if path.startswith('/api/') and path not in ('/api/login', '/api/img', '/api/version') and not path.startswith('/api/journey/share/'):
            s = self._require_auth()
            if not s:
                self.send_json({'error': 'unauthorized'}, code=401)
                return
            role = s.get('role', 'admin')
            rdef = get_role(role)
            self._current_user = s.get('username', '')
            self._current_role = role
            # RBAC 关闭时放开全部权限与默认媒体范围
            rbac_on = bool((CONFIG.get('rbac') or {}).get('enabled', True))
            if rbac_on:
                self._current_perms = rdef['permissions']
                self._current_emby_user = rdef['emby_user'] or EMBY_USER_ID
            else:
                self._current_perms = list(ALL_PERMS)
                self._current_emby_user = EMBY_USER_ID
            # 权限门禁
            perm = endpoint_perm(path)
            if perm and not _has_perm(self._current_perms, perm):
                self.send_json({'error': '无权限访问此功能', 'required': perm}, code=403)
                return

        if path == '/api/scripts/run':
            # P0-1: 此端点仅接受 POST；GET 明确返回 405，避免被门禁 401 吞掉难以排查
            self.send_json({'error': 'Method Not Allowed, use POST'}, code=405)
            return

        if path == '/api/status':
            day_rx, day_tx = _get_day_traffic()
            self.send_json({
                'cpu': get_cpu_usage(),
                'memory': get_memory_usage(),
                'net_down': _net_cache['down'],
                'net_up': _net_cache['up'],
                'cpu_temp': get_cpu_temp(),
                'day_down': round(day_rx / (1024**3), 1),
                'day_up': round(day_tx / (1024**3), 1),
                'uptime': get_uptime(),
            })
            return
        if path == '/api/version':
            # 部署指纹（公开）：api/dashboard/index 双文件哈希 + 启动时间，多会话协作对账基线
            self.send_json(get_version_info())

        elif path == '/api/scripts':
            scripts = scan_scripts()
            runs = _load_script_runs()
            for s in scripts:
                r = runs.get(s['name'], {})
                s['last_run'] = r.get('last_run')
                s['exit_code'] = r.get('exit_code')
                s['duration'] = r.get('duration')
                s['output_tail'] = r.get('output_tail', '')
                s['error_tail'] = r.get('error_tail', '')
                s['running'] = s['name'] in RUNNING_SCRIPTS
            self.send_json({'scripts': scripts, 'dir': SCRIPTS_DIR, 'total': len(scripts)})

        elif path == '/api/scripts/read':
            name = params.get('name', [''])[0]
            self.send_json(read_script(name))

        elif path == '/api/storage':
            du = get_disk_usage()
            self.send_json({'pools': du['pools'], 'devices': du['devices']})

        elif path == '/api/journey/pick':
            self.send_json({'cards': journey_pick(), 'today': _jtoday()})

        elif path == '/api/journey/wall':
            try:
                d = _journey_load()
                d = journey_apply_auto(d)
                d = journey_sync(d)
                _journey_save(d)
                can_claim = not (_journey_daily_limit() and d.get('last_claim') == _jtoday() and d.get('claimed_today', 0) >= 1)
                for _c in d['cards']:
                    _ns = _journey_notes(_c)
                    _c['notes'] = _ns
                    _c['note'] = _ns[-1]['text'] if _ns else _c.get('note', '')
                self.send_json({'cards': d['cards'], 'today': _jtoday(), 'can_claim': can_claim})
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_json({'error': 'wall: %r' % e}, code=500)

        elif path == '/api/journey/tmdb-status':
            _px = str(((CONFIG.get('services') or {}).get('proxy') or {}).get('mihomo') or '').strip()
            t0 = time.time()
            try:
                data = _tmdb_get('trending/movie/week?page=1')
                ok = bool(data.get('results'))
            except Exception:
                ok = False
            ms = int((time.time() - t0) * 1000)
            self.send_json({'ok': ok, 'ms': ms, 'proxy': _px})
        elif path.startswith('/api/journey/share/'):
            token = path.split('/api/journey/share/')[-1]
            card = None
            for c in _journey_load().get('cards', []):
                if c.get('share_token') == token:
                    card = c
                    break
            if not card:
                self.send_json({'error': '分享链接不存在或已失效'}, code=404)
            else:
                accept = self.headers.get('Accept', '') or ''
                if 'application/json' in accept:
                    self.send_json({'title': card.get('title', ''), 'type': card.get('type', 'movie'),
                                    'year': card.get('year', ''), 'image': card.get('image', ''),
                                    'rating': card.get('rating'), 'genres': card.get('genres', []),
                                    'note': card.get('note', ''), 'completed_date': card.get('completed_date', ''),
                                    'shared_from': 'NEXUS 观影历程'})
                else:
                    self.send_html(_journey_share_html(card))

        elif path == '/api/torrents':
            torrents = qb_torrents()
            transfer = qb_transfer()
            tr_sa = tr_torrents(SA_HOST, 16062)
            tr_ds = tr_torrents(DS_HOST, 16666)
            qb_lim = qb_global_limits()
            sa_lim = tr_session_limits(SA_HOST, 16062)
            ds_lim = tr_session_limits(DS_HOST, 16666)
            def _sum(field, items):
                return sum((t.get(field) or 0) for t in items)
            # 活跃聚合：只保留有数据传输（下载或上传速率>0）的种子，带引擎标识，按速率降序
            def _active(items, engine):
                return [{**t, 'engine': engine} for t in items
                        if ((t.get('dlspeed') or 0) + (t.get('upspeed') or 0)) > 0]
            active = _active(torrents, 'QB') + _active(tr_sa, 'SA·TR') + _active(tr_ds, 'DS·TR')
            active.sort(key=lambda t: (t.get('dlspeed') or 0) + (t.get('upspeed') or 0), reverse=True)
            self.send_json({
                'qb': {
                    'torrents': torrents,
                    'agg_dl': transfer.get('dl_info_speed', 0),
                    'agg_up': transfer.get('up_info_speed', 0),
                    'dl_limit': qb_lim['dl'], 'up_limit': qb_lim['up'],
                },
                'tr_sa': {
                    'torrents': tr_sa,
                    'agg_dl': _sum('dlspeed', tr_sa), 'agg_up': _sum('upspeed', tr_sa),
                    'dl_limit': sa_lim['dl'], 'up_limit': sa_lim['up'],
                },
                'tr_ds': {
                    'torrents': tr_ds,
                    'agg_dl': _sum('dlspeed', tr_ds), 'agg_up': _sum('upspeed', tr_ds),
                    'dl_limit': ds_lim['dl'], 'up_limit': ds_lim['up'],
                },
                'active': active,
            })

        elif path == '/api/media':
            self.send_json(emby_library_stats(self._current_emby_user))

        elif path == '/api/recent':
            self.send_json({'items': recent_transfers(12, self._current_emby_user)})

        elif path == '/api/daily_tips':
            self.send_json({'tips': daily_tips()})

        elif path == '/api/carousel':
            src = params.get('src', ['random'])[0]
            eu = self._current_emby_user
            if src == 'recent':
                items = carousel_recent(eu)
            elif src == 'trending':
                items = carousel_trending(eu)
            elif src == 'tmdb':
                items = carousel_tmdb()
            elif src == 'douban':
                items = carousel_douban()
            else:
                items = carousel_random(eu)
            self.send_json({'items': items, 'source': src})

        elif path == '/api/cache/season':
            # 清理媒体库季集缓存（设置页触发）
            self.send_json({'cleared': clear_season_cache(True)})

        elif path == '/api/season':
            # 单部剧集季集信息（趋势卡前端异步补，内存缓存 30 日 TTL）
            q = params.get('title', [''])[0]
            yr = params.get('year', [''])[0]
            self.send_json({'data': _tmdb_season_info(q, yr, True, False)})

        elif path == '/api/tmdb/detail':
            # 豆瓣等趋势数据缺演职员/简介时，按标题走 TMDB 补全；有 tmdbid 时按 id 直查（更准）
            tmdbid = params.get('tmdbid', [''])[0]
            if tmdbid:
                self.send_json({'data': tmdb_detail(tmdbid)})
                return
            q = params.get('q', [''])[0]
            is_tv = params.get('type', ['movie'])[0] == 'tv'
            self.send_json({'data': tmdb_by_title(q, is_tv)})

        elif path == '/api/search/emby':
            q = params.get('q', [''])[0]
            self.send_json({'results': emby_search(q, self._current_emby_user) if q else []})

        elif path == '/api/media/wall':
            t = params.get('type', ['all'])[0]
            self.send_json({'results': media_wall(t, self._current_emby_user)})

        elif path == '/api/search/pt':
            q = params.get('q', [''])[0]
            ex = params.get('exclude', [''])[0]
            if not q:
                self.send_json({'results': []})
            else:
                results = pt_search(q, ex)
                self.send_json({'results': results})

        elif path == '/api/search/pansou':
            q = params.get('q', [''])[0]
            if not q:
                self.send_json({'results': []})
            else:
                try:
                    url_base = (CONFIG.get('services', {}).get('pansou', {}) or {}).get('url', '') or 'http://127.0.0.1:18666'
                    url = url_base.rstrip('/') + '/api/search?keyword=' + urllib.parse.quote(q)
                    req = urllib.request.Request(url, headers={'Accept': 'application/json'})
                    with urllib.request.urlopen(req, timeout=45) as r:
                        data = json.loads(r.read().decode('utf-8'))
                    # 扁平化 merged_by_type：先按关键词过滤（18666 返回模糊大列表），再每类截断，避免无关条目挤占
                    results = []
                    merged = data.get('data', {}).get('merged_by_type', {})
                    PER = 30
                    ql = q.lower()
                    for ptype, items in merged.items():
                        matched = [it for it in (items or []) if ql in (it.get('note', '') or '').lower()]
                        if not matched:
                            matched = (items or [])[:3]  # 关键词无精确命中时保留少量该类结果兜底
                        for item in matched[:PER]:
                            results.append({
                                'title': item.get('note', ''),
                                'url': item.get('url', ''),
                                'password': item.get('password', ''),
                                'source': item.get('source', ptype),
                                'date': item.get('datetime', '')[:10],
                                'type': ptype,
                            })
                        if len(results) >= 300:
                            break
                    self.send_json({'results': results[:300]})
                except Exception as e:
                    self.send_json({'results': [], 'error': str(e)})

        elif path == '/api/search/online':
            q = params.get('q', [''])[0]
            if not q:
                self.send_json({'results': []})
            else:
                results = _search_online(q)
                self.send_json({'results': results})

        elif path == '/api/subscribe':
            # 返回 MoviePilot 当前订阅列表（供前端判断订阅状态）
            s = self._require_auth()
            if not s:
                self.send_json({'error': '未授权'}, code=401)
                return
            if not _mp_enabled():
                self.send_json({'ok': True, 'enabled': False, 'subscriptions': []})
                return
            try:
                conn = sqlite3.connect(_mp_db(), timeout=5)
                rows = conn.execute(
                    "select name,type,state,media_source,media_id,username from subscribe order by date desc").fetchall()
                conn.close()
                subs = [{'name': r[0], 'type': r[1], 'state': r[2], 'media_source': r[3],
                         'tmdbid': r[4], 'username': r[5], 'poster': ''} for r in rows]
                # 并发补海报+进度富化（Emby 名称匹配优先 → TMDB 标题搜索 → tmdbid 兜底；带缓存）
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor(max_workers=4) as _ex:
                    _meta = list(_ex.map(lambda s: _sub_enrich(s['name'], s['type'] == '电视剧', s['tmdbid']), subs))
                for _i, _s in enumerate(subs):
                    _s['poster'] = _meta[_i].get('poster') or ''
                    for _k in ('eps_done', 'eps_total', 'next_ep', 'next_air', 'release_date'):
                        _s[_k] = _meta[_i].get(_k, '')
                self.send_json({'ok': True, 'subscriptions': subs})
            except Exception as e:
                self.send_json({'ok': False, 'error': str(e)}, code=500)

        elif path == '/api/trending':
            platform = params.get('p', ['all'])[0]
            self.send_json({'data': _get_trending(platform)})

        elif path == '/api/play-history':
            # 收藏中心「播放历史」：GET 列表
            s = self._require_auth()
            if not s:
                self.send_json({'error': '未授权'}, code=401)
                return
            self.send_json({'history': _load_play_history()})

        elif path.startswith('/api/detail/'):
            item_id = path.split('/api/detail/')[1]
            self.send_json(emby_detail(item_id, self._current_emby_user))

        elif path == '/api/favorites':
            self.send_json({'favorites': load_favs()})
            return
        elif path == '/api/features':
            feats = {}
            try:
                with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                    raw = json.load(f)
                feats = raw.get('features', {}) or {}
            except Exception:
                pass
            self.send_json({'features': feats})

        elif path == '/api/apps':
            self.send_json({'apps': get_services()})

        elif path == '/api/test-service':
            host = params.get('host', [''])[0]
            port = int(params.get('port', ['80'])[0])
            proto = params.get('proto', ['http'])[0]
            ok = check_service(host, port, proto == 'https')
            print(f"[ts] host={host} port={port} proto={proto} -> {ok}", flush=True)
            self.send_json({'ok': ok, 'host': host, 'port': port, 'proto': proto})

        elif path == '/api/scripts':
            self.send_json({'scripts': get_crontab_scripts()})

        elif path == '/api/events':
            self.send_json({'events': get_recent_events()})

        elif path == '/api/logs':
            # 多源日志查阅（鉴权）：category=all|system|service、source=<服务源>、level、search、limit
            s = self._require_auth()
            if not s:
                self.send_json({'error': 'unauthorized'}, code=401)
                return
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if self.command == 'DELETE' or (qs.get('clear') or [''])[0] == '1':
                clear_logs()
                _log('INFO', 'system', '运行日志已清空')
                self.send_json({'ok': True})
                return
            level = (qs.get('level') or ['ALL'])[0]
            category = (qs.get('category') or ['all'])[0].lower()
            source = (qs.get('source') or [''])[0].strip()
            search = (qs.get('search') or [''])[0].strip()
            try:
                limit = int((qs.get('limit') or ['300'])[0])
            except ValueError:
                limit = 300
            limit = max(10, min(limit, 1000))
            merged = []
            if category in ('all', 'system'):
                merged += get_logs('ALL', limit * 3)
            if category in ('all', 'service') and source:
                merged += read_service_log(source, tail=limit * 3, search=search or None)
            # 有 ts 的按 ts 倒序（最新在前）；无 ts 的按源顺序垫底
            merged.sort(key=lambda e: e.get('ts') or '', reverse=True)
            if search:
                merged = [e for e in merged if search.lower() in e.get('msg', '').lower()]
            if level and level.upper() != 'ALL':
                merged = [e for e in merged if e.get('level', '').upper() == level.upper()]
            self.send_json({'logs': merged[:limit]})

        elif path == '/api/logs/sources':
            s = self._require_auth()
            if not s:
                self.send_json({'error': 'unauthorized'}, code=401)
                return
            self.send_json({'sources': get_service_log_sources()})

        elif path == '/api/incoming':
            # 前端拉取通知聚合消息（公开端点）
            msgs = _load_incoming()
            self.send_json({'messages': msgs})

        elif path == '/cookiecloud/cookies':
            # P0-2: Cookie 拉取必须鉴权（MP 插件拉取需带登录 token，不再匿名可读）
            s = self._require_auth()
            if not s:
                self.send_json({'error': 'unauthorized'}, code=401)
                return
            self.send_json(load_cookies())

        elif path == '/cookiecloud/status':
            s = self._require_auth()
            if not s:
                self.send_json({'error': 'unauthorized'}, code=401)
                return
            cookies = load_cookies()
            self.send_json({'domains': len(cookies), 'last_sync': os.path.getmtime(COOKIES_PATH) if os.path.exists(COOKIES_PATH) else 0})

        elif path == '/api/config':
            if self.command == 'GET':
                # 脱敏返回
                cfg_out = {
                    'features': {
                        'trending': True, 'online_search': True, 'pt_search': True,
                        'pansou_search': True, 'carousel': True,
                    },
                }
                try:
                    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                        raw = json.load(f)
                    svc = raw.get('services', {})
                    cfg_out.update({
                        'emby_host': svc.get('emby',{}).get('host',''),
                        'emby_api_key': _mask_secret(svc.get('emby',{}).get('api_key','')),
                        'qb_host': svc.get('qbittorrent',{}).get('host',''),
                        'qb_user': svc.get('qbittorrent',{}).get('username',''),
                        'qb_pass': _mask_secret(svc.get('qbittorrent',{}).get('password','')),
                        'qb_api_key': _mask_secret(svc.get('qbittorrent',{}).get('api_key','')),
                        'mp_db': svc.get('moviepilot',{}).get('db_path',''),
                        'pansou_url': svc.get('pansou',{}).get('url',''),
                        'online_url': svc.get('online',{}).get('url',''),
                        'online_urls': svc.get('online',{}).get('urls', []),
                        'mihomo_proxy': svc.get('proxy',{}).get('mihomo',''),
                        'proxy_url': raw.get('proxy_url', ''),
                        'cookiecloud_password': _mask_secret(raw.get('cookiecloud',{}).get('password','')),
                        'cookiecloud_enabled': raw.get('cookiecloud',{}).get('enabled', True),
                    })
                    if 'features' in raw:
                        cfg_out['features'] = raw['features']
                    cfg_out['trend_sources'] = raw.get('trend_sources', {})
                    cfg_out['volume_aliases'] = raw.get('volume_aliases', {})
                    cfg_out['journey'] = raw.get('journey', {}) or {}
                    cfg_out['storage'] = raw.get('storage', {})
                    cfg_out['svc_aliases'] = raw.get('svc_aliases', {})
                    cfg_out['svc_favs'] = raw.get('svc_favs', {})
                    cfg_out['svc_order'] = raw.get('svc_order', {})
                    cfg_out['device_titles'] = raw.get('device_titles', {}) or {}
                    cfg_out['ui_health_hidden'] = raw.get('ui_health_hidden', []) or []
                    cfg_out['ui_svc_hidden'] = raw.get('ui_svc_hidden', []) or []
                    cfg_out['ui_health_flex'] = raw.get('ui_health_flex', True)
                    cfg_out['ui_health_net_min'] = int(raw.get('ui_health_net_min', 244) or 244)
                    cfg_out['ui_health_net_max'] = int(raw.get('ui_health_net_max', 276) or 276)
                    cfg_out['ui_health_card_min'] = int(raw.get('ui_health_card_min', 190) or 190)
                    cfg_out['share_base_url'] = raw.get('share_base_url', '') or ''
                    cfg_out['favicon'] = raw.get('favicon', '')
                    cfg_out['monitor_services'] = raw.get('monitor_services', [])
                except Exception:
                    pass
                cfg_out['auth_enabled'] = CONFIG.get('auth_enabled', True)
                cfg_out['auth_username'] = CONFIG.get('auth_username', 'admin')
                # RBAC 配置（脱敏：不含任何密码）
                rbac = CONFIG.get('rbac', {}) or {}
                cfg_out['rbac_enabled'] = bool(rbac.get('enabled', True))
                cfg_out['rbac_roles'] = rbac.get('roles', {}) or {}
                cfg_out['rbac_users'] = [
                    {'username': u.get('username', ''), 'role': u.get('role', 'member')}
                    for u in (rbac.get('users', []) or [])
                ]
                # MoviePilot 接入配置（不含敏感信息；db_path 为 MP user.db 路径）
                cfg_out['mp_enabled'] = _mp_enabled()
                cfg_out['mp_db'] = _mp_db()
                cfg_out['mp_script'] = _mp_script()
                cfg_out['mp_api_key'] = _mask_secret(CONFIG.get('mp_api_key', ''))
                self.send_json(cfg_out)

        elif path == '/api/me':
            token = self._extract_token()
            s = check_session(token) if token else None
            if s:
                role = s.get('role', 'admin')
                rdef = get_role(role)
                self.send_json({
                    'username': s['username'], 'authenticated': True,
                    'role': role, 'is_admin': role == 'admin',
                    'permissions': rdef['permissions'],
                    'rbac_enabled': bool((CONFIG.get('rbac') or {}).get('enabled', True)),
                })
            else:
                self.send_json({'authenticated': False}, code=401)

        elif path == '/api/restart':
            import sys
            _log('INFO', 'system', '收到重启指令，服务即将重启')
            self.send_json({'ok': True, 'msg': 'restarting'})
            self.wfile.flush()
            def _do_restart():
                time.sleep(0.5)
                os.execv(sys.executable, [sys.executable] + sys.argv)
            threading.Thread(target=_do_restart, daemon=True).start()

        elif path == '/api/img':
            url = params.get('url', [''])[0]
            # tmdb 尺寸归一化：w600 非有效档位（tmdb 仅 w92/154/185/300/500/780/1280/original），无效尺寸会 400
            url = re.sub(r'(/t/p/)w600(?=/)', r'\1w500', url)
            # P0-6: SSRF 加固——urlparse 后精确校验，拒绝 userinfo / file: / 字面 IP（白名单域名除外）
            def _img_allowed(u):
                try:
                    pr = urllib.parse.urlparse(u)
                except Exception:
                    return False
                if pr.scheme not in ('http', 'https'):
                    return False
                if pr.username or pr.password:  # 拒绝 http://host@evil.com 形式
                    return False
                host = (pr.hostname or '').lower()
                if not host:
                    return False
                _hosts = ['doubanio.com', 'hdslb.com', 'douban.com', 'tmdb.org', 'image.tmdb.org']
                emb_host = ''
                if EMBY_HOST:
                    try:
                        emb_host = (urllib.parse.urlparse(EMBY_HOST).hostname or '').lower()
                        if emb_host:
                            _hosts.append(emb_host)
                    except Exception:
                        pass
                if not any(host == h or host.endswith('.' + h) for h in _hosts):
                    return False
                # 字面 IP 仅当等于 EMBY_HOST 解析出的 host 时放行（内网 Emby 图片代理仍可用）
                import ipaddress
                try:
                    ipaddress.ip_address(host)
                    if host == emb_host:
                        return True
                    return False
                except ValueError:
                    pass  # 域名，OK
                return True
            if not url or not _img_allowed(url):
                self.send_json({'error': 'bad url'}, code=400)
                return
            # catbox 图床缓存：同一图片只上传一次，命中直接 302 到稳定直链（不占本地、避免第三方图床 403）
            key = 'cat:' + hashlib.md5(url.encode()).hexdigest()
            cmap = _load_catbox_map()
            if key in cmap and cmap[key]:
                self.send_response(302)
                self.send_header('Location', cmap[key])
                self.send_header('Cache-Control', 'public, max-age=86400')
                self._security_headers()
                self.end_headers()
                return
            try:
                # R-02 联动：emby_poster 已改走 /api/img 代理（URL 不带 key），代理层对内网 Emby 目标补 key（key 仅面板侧使用，不随任何外发 URL 暴露）
                if EMBY_HOST and url.startswith(EMBY_HOST):
                    _sep = '&' if '?' in url else '?'
                    url = url + _sep + 'api_key=' + urllib.parse.quote(EMBY_API_KEY or '', safe='')
                req = urllib.request.Request(url)
                req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
                # 豆瓣/tmdb 防盗链需要 Referer；内网 emby 直连，外部图床走代理网关（tmdb 境外被墙必须走网关）
                if 'douban' in url:
                    req.add_header('Referer', 'https://movie.douban.com/')
                    opener = _proxy_opener()
                elif 'tmdb' in url:
                    req.add_header('Referer', 'https://www.themoviedb.org/')
                    opener = _proxy_opener()
                else:
                    # P0-6: 显式只挂 HTTP(S)Handler，禁用默认 build_opener() 自带的 FileHandler
                    _ctx = ssl.create_default_context()
                    opener = urllib.request.build_opener(
                        urllib.request.HTTPSHandler(context=_ctx),
                        urllib.request.HTTPHandler())
                with opener.open(req, timeout=10) as r:
                    data = r.read()
                    ct = r.headers.get('Content-Type', 'image/jpeg')
                print(f'[img] OK {len(data)}B {url[:80]}', flush=True)
                # 尝试上传到 catbox 并缓存直链
                try:
                    fname = 'n' + key[4:14] + '.jpg'
                    cu = _catbox_upload(data, fname)
                    if cu.startswith('http'):
                        cmap[key] = cu
                        _save_catbox_map(cmap)
                        self.send_response(302)
                        self.send_header('Location', cu)
                        self.send_header('Cache-Control', 'public, max-age=86400')
                        self._security_headers()
                        self.end_headers()
                        return
                except Exception:
                    pass  # 上传失败则退回原图流
                self.send_response(200)
                self.send_header('Content-Type', ct)
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Cache-Control', 'public, max-age=86400')
                self._security_headers()
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                print(f'[img] FAIL {type(e).__name__}: {e} url={url[:100]}', flush=True)
                self.send_json({'error': str(e)}, code=502)

        else:
            if path.startswith('/api/'):
                self.send_json({'error': 'API endpoint not found', 'path': path}, code=404)
                return
            _MIME = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon','.css':'text/css','.js':'application/javascript','.txt':'text/plain','.html':'text/html'}
            # P0-3: .json 数据文件不通过静态分支匿名流出（请求 .json 会落到下方返回 SPA index.html）
            _base = os.path.normpath(BASE_DIR)
            _fpath = os.path.normpath(os.path.join(_base, path.lstrip('/')))
            _ext = os.path.splitext(_fpath)[1].lower()
            if os.path.isfile(_fpath) and _fpath.startswith(_base) and _ext in _MIME:
                with open(_fpath, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', _MIME[_ext])
                self.send_header('Content-Length', str(len(content)))
                if _ext in ('.html', '.js'):
                    self.send_header('Cache-Control', 'no-store, must-revalidate')
                self._security_headers()
                self.end_headers()
                self.wfile.write(content)
                return
            try:
                with open(os.path.join(BASE_DIR, 'index.html'), 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(content)))
                self.send_header('Cache-Control', 'no-store, must-revalidate')
                self._security_headers()
                self.end_headers()
                self.wfile.write(content)
            except Exception:
                self.send_json({'error': 'Not found'}, code=404)

    def _handle_config_post(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8') if length else '{}'
        try:
            data = json.loads(body)
            try:
                with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                    raw = json.load(f)
            except Exception:
                # config.json 尚不存在或损坏：从空配置开始
                raw = {}
            if 'services' not in raw: raw['services'] = {}
            raw['services'].setdefault('emby', {})
            raw['services'].setdefault('qbittorrent', {})
            raw['services'].setdefault('transmission', {})
            raw['services'].setdefault('moviepilot', {})
            raw['services'].setdefault('pansou', {})
            raw['services'].setdefault('online', {})
            raw['services'].setdefault('proxy', {})
            raw.setdefault('cookiecloud', {})
            raw.setdefault('auth', {})
            if 'emby_host' in data: raw['services']['emby']['host'] = data['emby_host']
            if 'emby_api_key' in data and data['emby_api_key'] != '******': raw['services']['emby']['api_key'] = data['emby_api_key']
            if 'qb_host' in data: raw['services']['qbittorrent']['host'] = data['qb_host']
            if 'qb_user' in data: raw['services']['qbittorrent']['username'] = data['qb_user']
            if 'qb_pass' in data and data['qb_pass'] != '******': raw['services']['qbittorrent']['password'] = data['qb_pass']
            if 'qb_api_key' in data and data['qb_api_key'] != '******': raw['services']['qbittorrent']['api_key'] = str(data['qb_api_key']).strip()
            if 'tr_user' in data: raw['services']['transmission']['username'] = str(data['tr_user']).strip()
            if 'tr_pass' in data and data['tr_pass'] != '******': raw['services']['transmission']['password'] = str(data['tr_pass'])
            if 'mp_db' in data: raw['services']['moviepilot']['db_path'] = data['mp_db']
            if 'mp_script' in data: raw['services']['moviepilot']['script'] = data['mp_script']
            if 'mp_enabled' in data: raw['services']['moviepilot']['enabled'] = bool(data['mp_enabled'])
            if 'mp_api_key' in data and data['mp_api_key'] != '******': raw['services']['moviepilot']['api_key'] = str(data['mp_api_key']).strip()
            if 'trend_sources' in data:
                raw['trend_sources'] = {k: bool(v) for k, v in data['trend_sources'].items()}
            if 'pansou_url' in data: raw['services']['pansou']['url'] = data['pansou_url']
            if 'online_url' in data: raw['services']['online']['url'] = data['online_url']
            if 'online_urls' in data and isinstance(data['online_urls'], list):
                raw['services']['online']['urls'] = [u.strip() for u in data['online_urls'] if u and u.strip()]
            if 'mihomo_proxy' in data: raw['services']['proxy']['mihomo'] = data['mihomo_proxy']
            if 'proxy_url' in data: raw['proxy_url'] = str(data['proxy_url']).strip()
            if 'cookiecloud_password' in data and data['cookiecloud_password'] != '******': raw['cookiecloud']['password'] = data['cookiecloud_password']
            if 'cookiecloud_enabled' in data: raw['cookiecloud']['enabled'] = bool(data['cookiecloud_enabled'])
            if 'features' in data:
                raw.setdefault('features', {})
                for k, v in data['features'].items():
                    raw['features'][k] = bool(v)
            if 'volume_aliases' in data:
                raw['volume_aliases'] = data['volume_aliases']
            if 'storage' in data and isinstance(data['storage'], dict):
                raw['storage'] = data['storage']
            if 'svc_aliases' in data:
                raw['svc_aliases'] = data['svc_aliases']
            if 'svc_ports' in data: raw['svc_ports'] = data['svc_ports']
            if 'svc_favs' in data and isinstance(data['svc_favs'], dict):
                raw['svc_favs'] = data['svc_favs']
            if 'svc_order' in data and isinstance(data['svc_order'], dict):
                raw['svc_order'] = data['svc_order']
            if 'device_titles' in data and isinstance(data['device_titles'], dict):
                raw['device_titles'] = {str(k)[:40]: str(v).strip()[:60] for k, v in data['device_titles'].items() if str(v).strip()}
            if 'ui_health_hidden' in data and isinstance(data['ui_health_hidden'], list):
                raw['ui_health_hidden'] = data['ui_health_hidden']
            if 'ui_svc_hidden' in data and isinstance(data['ui_svc_hidden'], list):
                raw['ui_svc_hidden'] = data['ui_svc_hidden']
            if 'ui_health_flex' in data:
                raw['ui_health_flex'] = bool(data['ui_health_flex'])
            if 'ui_health_net_min' in data:
                raw['ui_health_net_min'] = int(data['ui_health_net_min'] or 244)
            if 'ui_health_net_max' in data:
                raw['ui_health_net_max'] = int(data['ui_health_net_max'] or 276)
            if 'ui_health_card_min' in data:
                raw['ui_health_card_min'] = int(data['ui_health_card_min'] or 190)
            if 'share_base_url' in data:
                raw['share_base_url'] = str(data['share_base_url'] or '').strip()
            if 'favicon' in data: raw['favicon'] = data['favicon']
            if 'monitor_services' in data: raw['monitor_services'] = data['monitor_services']
            if 'journey' in data and isinstance(data['journey'], dict):
                raw['journey'] = data['journey']
            # 认证设置
            if 'auth_username' in data:
                raw['auth']['username'] = data['auth_username']
            if 'auth_enabled' in data:
                raw['auth']['enabled'] = bool(data['auth_enabled'])
            if 'auth_password' in data and data['auth_password']:
                raw['auth']['password_hash'] = hashlib.sha256(data['auth_password'].encode()).hexdigest()
            elif 'auth_password' in data:
                # 空口令：保留现有 hash，避免设置页保存把认证锁死
                raw['auth'].setdefault('password_hash', '')
            # RBAC 设置
            if any(k in data for k in ('rbac_enabled', 'rbac_roles', 'rbac_users')):
                raw.setdefault('rbac', {})
                if 'rbac_enabled' in data:
                    raw['rbac']['enabled'] = bool(data['rbac_enabled'])
                if 'rbac_roles' in data:
                    raw['rbac']['roles'] = data['rbac_roles'] or {}
                if 'rbac_users' in data:
                    old_users = raw['rbac'].get('users', []) or []
                    users = []
                    for u in data['rbac_users']:
                        uname = (u.get('username') or '').strip()
                        if not uname:
                            continue
                        nu = {'username': uname, 'role': u.get('role', 'member')}
                        if u.get('password'):
                            nu['password_hash'] = hashlib.sha256(u['password'].encode()).hexdigest()
                        else:
                            old = next((o for o in old_users if o.get('username') == uname), None)
                            if old and old.get('password_hash'):
                                nu['password_hash'] = old['password_hash']
                        users.append(nu)
                    raw['rbac']['users'] = users
            _atomic_write(CONFIG_PATH, raw, indent=2)
            global CONFIG
            CONFIG = load_config()
            self.send_json({'ok': True})
        except Exception as e:
            self.send_json({'error': str(e)}, code=500)

    def log_message(self, *args):
        pass

if __name__ == '__main__':
    import socket
    import socketserver
    # P0 修复：原 class S 继承 socketserver.TCPServer 是【单线程】服务器，
    # 任意慢上游请求（PT 120s / 在线搜索 90s / trending 30s）都会阻塞整个服务
    # → backlog 满、全站冻结。现改为顶部导入的 ThreadingHTTPServer（每请求一线程）
    # + 并发信号量限流（超限连接立即关闭，快速失败，防止慢请求无限堆积线程耗尽）。
    _sem = threading.BoundedSemaphore(24)
    class S(HTTPServer):
        allow_reuse_address = True
        daemon_threads = True
        request_queue_size = 64
        def process_request(self, request, client_address):
            if _sem.acquire(blocking=False):
                threading.Thread(target=self._handle, args=(request, client_address), daemon=True).start()
            else:
                try:
                    request.shutdown(socket.SHUT_RDWR)
                except Exception:
                    pass
                try:
                    request.close()
                except Exception:
                    pass
        def _handle(self, request, client_address):
            try:
                self.finish_request(request, client_address)
            except Exception as e:
                _log('ERROR', 'server', '请求处理异常: %s' % e)
            finally:
                try:
                    self.shutdown_request(request)
                except Exception:
                    pass
                _sem.release()
    _log('INFO', 'system', 'NEXUS API 服务启动 port=%d data_dir=%s' % (API_PORT, DATA_DIR))
    print(f"NEXUS API on :{API_PORT}")
    try:
        S(('0.0.0.0', API_PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        _log('INFO', 'system', 'NEXUS API 服务停止')
