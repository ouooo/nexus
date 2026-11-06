#!/usr/bin/env python3
"""NEXUS 站点搜索引擎 v1 —— 声明式站点定义 + 引擎族解析 + 并发执行

设计目标（对标 PT-depiler / MoviePilot）：
1. 站点定义声明化：一个站点 = 一段配置（站点存在 /data/sites.json），加站不改代码、不发镜像
2. 引擎族解析：NexusPHP / Unit3D / Gazelle / Discuz / JSON-API / 通用 HTML，覆盖绝大多数站型
3. 多重回退：每个字段的 selector 支持数组，站点改版只改一条配置即可恢复
4. 并发 + 独立超时 + 熔断：慢站不拖累整体，连续失败的站自动降级，健康度落盘
5. 高级搜索：imdb|tt123 / douban|123 / tmdb|123 前缀
6. 纯标准库：不引入任何第三方依赖（与 api.py 一致）

对外主入口：
    search_all(query, exclude='', mp_db_path='', data_dir='', proxy_url='') -> list[dict]
返回字段与旧 pt_search 完全一致：title, site, url, size, seeders, leechers, date, category, subcat
"""

import os
import re
import json
import time
import gzip
import ssl
import sqlite3
import threading
import urllib.parse
import urllib.request
import urllib.error
import concurrent.futures
from html.parser import HTMLParser

# ---------------------------------------------------------------- 常量

SITES_FILE = 'sites.json'          # 站点定义（位于数据卷，运行时可改）
HEALTH_FILE = 'site_health.json'    # 站点健康度
CACHE_TTL = 60                      # 同 query 缓存秒数
SITE_TIMEOUT = 3.5                  # 单站超时（秒），并发执行不阻塞其他站
MAX_WORKERS = 32                    # 并发上限
FAIL_THRESHOLD = 3                  # 连续失败次数 → 熔断
COOLOFF_SEC = 600                   # 熔断冷却时间
TOTAL_BUDGET = 4.0                  # 首次响应预算：到点先返已拿到的，慢站后台补进缓存
RESULT_CAP = 200                    # 单次搜索最大返回条数

_vacuous = object()

# ---------------------------------------------------------------- 迷你 DOM
# 纯标准库实现一个够用的 DOM + 选择器引擎，替代 bs4。
# 支持：tag / .class / #id / [attr] / [attr=v] / [attr*=v] / [attr^=v] / 后代空格 /
#      子代 > / 逗号分组 / :first / :nth(n) / :nth-child(n) / :self

VOID_TAGS = {'br', 'img', 'input', 'meta', 'link', 'hr', 'source', 'area', 'base',
             'embed', 'param', 'track', 'col', 'wbr'}
RAW_TEXT_TAGS = {'script', 'style'}


class Node:
    __slots__ = ('tag', 'attrs', 'children', 'parent', 'text')

    def __init__(self, tag, attrs=None, parent=None):
        self.tag = tag
        self.attrs = attrs or {}
        self.children = []
        self.parent = parent
        self.text = ''

    # ---- 文本 / 属性
    def get_text(self):
        parts = []
        stack = [self]
        while stack:
            n = stack.pop()
            if n.tag == '#text':
                parts.append(n.text)
            else:
                stack.extend(reversed(n.children))
        return re.sub(r'\s+', ' ', ''.join(parts)).strip()

    def get(self, name, default=''):
        return self.attrs.get(name, default)

    def classes(self):
        return (self.attrs.get('class') or '').split()

    def __repr__(self):
        return '<%s%s>' % (self.tag, ''.join(' %s' % k for k in self.attrs))


class _TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('#document')
        self.stack = [self.root]
        self._raw = None

    def handle_starttag(self, tag, attrs):
        node = Node(tag, {k: (v or '') for k, v in attrs}, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag in VOID_TAGS:
            return
        self.stack.append(node)
        if tag in RAW_TEXT_TAGS:
            self._raw = tag

    def handle_startendtag(self, tag, attrs):
        node = Node(tag, {k: (v or '') for k, v in attrs}, self.stack[-1])
        self.stack[-1].children.append(node)

    def handle_endtag(self, tag):
        if tag in RAW_TEXT_TAGS:
            self._raw = None
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        if self._raw:
            return
        if data and data.strip():
            self.stack[-1].children.append(Node('#text', None, self.stack[-1]))
            self.stack[-1].children[-1].text = data


def parse_html(html):
    b = _TreeBuilder()
    try:
        b.feed(html)
        b.close()
    except Exception:
        pass
    return b.root


# ---- 选择器解析（编译一次，缓存）

_SEL_CACHE = {}
_SEL_LOCK = threading.Lock()


def _parse_compound(txt):
    """解析单个复合选择器：div.a.b#id[attr=val]:nth(2)"""
    item = {'tag': None, 'classes': [], 'id': None, 'attrs': [], 'nth': None, 'first': False}
    i = 0
    if re.match(r'[\w*-]', txt):
        m = re.match(r'[a-zA-Z][\w-]*|\*', txt)
        if m:
            item['tag'] = m.group(0).lower()
            i = m.end()
    while i < len(txt):
        c = txt[i]
        if c == '.':
            m = re.match(r'\.([\w-]+)', txt[i:])
            if not m:
                break
            item['classes'].append(m.group(1))
            i += m.end()
        elif c == '#':
            m = re.match(r'#([\w-]+)', txt[i:])
            if not m:
                break
            item['id'] = m.group(1)
            i += m.end()
        elif c == '[':
            m = re.match(r'\[\s*([\w-]+)\s*(?:([*^$]?=)\s*(["\']?)([^"\'\]\s]*)\3\s*)?\]', txt[i:])
            if not m:
                break
            item['attrs'].append((m.group(1), m.group(2), m.group(4) or ''))
            i += m.end()
        elif c == ':':
            m = re.match(r':(first|last|nth-child|nth|self)(?:\((\d+)\))?', txt[i:])
            if not m:
                break
            name, arg = m.group(1), m.group(2)
            if name == 'first':
                item['first'] = True
            elif name in ('nth', 'nth-child'):
                item['nth'] = int(arg or 1)
            elif name == 'self':
                item['tag'] = ':self'
            i += m.end()
        else:
            break
    return item


def compile_selector(sel):
    if not isinstance(sel, str):
        return None
    with _SEL_LOCK:
        if sel in _SEL_CACHE:
            return _SEL_CACHE[sel]
    # 顶层逗号 = 分组（括号内的逗号不切）
    groups = []
    depth = 0
    cur = ''
    for ch in sel:
        if ch == '[':
            depth += 1
        elif ch == ']':
            depth -= 1
        if ch == ',' and depth == 0:
            groups.append(cur)
            cur = ''
        else:
            cur += ch
    groups.append(cur)

    compiled = []
    for g in groups:
        g = g.strip()
        if not g:
            continue
        parts = []  # [(combinator, compound)]
        comb = ' '
        buf = ''
        i = 0
        while i < len(g):
            ch = g[i]
            if ch in '> ':
                if buf.strip():
                    parts.append((comb, _parse_compound(buf.strip())))
                    buf = ''
                comb = ch if ch == '>' else ' '
                i += 1
                continue
            buf += ch
            i += 1
        if buf.strip():
            parts.append((comb, _parse_compound(buf.strip())))
        compiled.append(parts)
    with _SEL_LOCK:
        _SEL_CACHE[sel] = compiled
    return compiled


def _match_compound(node, comp):
    if node.tag == '#text':
        return False
    tag = comp['tag']
    if tag == ':self':
        return True
    if tag and tag != '*' and node.tag != tag:
        return False
    if comp['id'] and node.get('id') != comp['id']:
        return False
    if comp['classes']:
        cls = node.classes()
        for c in comp['classes']:
            if c not in cls:
                return False
    for name, op, val in comp['attrs']:
        actual = node.get(name)
        if actual is None or actual == '':
            return False
        if op is None:
            continue
        if op == '=' and actual != val:
            return False
        if op == '*=' and val not in actual:
            return False
        if op == '^=' and not actual.startswith(val):
            return False
        if op == '$=' and not actual.endswith(val):
            return False
    # :first / :nth-child(n)：按同级元素序号判定
    if comp['first'] or comp['nth']:
        idx = _sibling_index(node)
        want = 0 if comp['first'] else (comp['nth'] - 1)
        if idx != want:
            return False
    return True


def _descendants(node):
    """子树内所有后代，按文档序（前序）产出"""
    stack = list(reversed(node.children))
    while stack:
        n = stack.pop()
        yield n
        if n.children:
            stack.extend(reversed(n.children))


def select_all(root, sel):
    """按编译后的选择器在 root 子树内查询，返回节点列表（去重、文档序）。"""
    compiled = compile_selector(sel)
    if not compiled:
        return []
    found = []
    seen = set()
    for parts in compiled:
        if not parts:
            continue
        first_comb, first_comp = parts[0]
        if first_comp['tag'] == ':self':
            cur = [root]
        else:
            cur = [n for n in _descendants(root) if _match_compound(n, first_comp)]
        for comb, comp in parts[1:]:
            nxt = []
            for n in cur:
                pool = n.children if comb == '>' else list(_descendants(n))
                for c in pool:
                    if _match_compound(c, comp):
                        nxt.append(c)
            cur = nxt
            if not cur:
                break
        for n in cur:
            if id(n) not in seen:
                seen.add(id(n))
                found.append(n)
    return found


def _sibling_index(node):
    """同级元素序号（忽略文本节点），0 起"""
    if node.parent is None:
        return 0
    idx = 0
    for c in node.parent.children:
        if c.tag == '#text':
            continue
        if c is node:
            return idx
        idx += 1
    return idx


def select_first(root, sels):
    """sels 可以是字符串或数组：依次尝试，返回第一个非空结果"""
    if not sels:
        return None
    if isinstance(sels, str):
        sels = [sels]
    for s in sels:
        if s == ':self':
            return root
        if s.startswith('regex:'):
            continue
        got = select_all(root, s)
        if got:
            return got[0]
    return None


# ---------------------------------------------------------------- 字段取值


def field_text(node, spec):
    """按 IElementQuery 语义取值：text / attr / data / case / filters"""
    if node is None:
        return ''
    val = None
    if spec.get('attr'):
        val = node.get(spec['attr'])
    elif spec.get('data'):
        val = node.get('data-' + spec['data'])
    elif spec.get('text') not in (None, _vacuous):
        val = spec['text']
    else:
        val = node.get_text()
    for f in spec.get('filters') or []:
        val = _apply_filter(val, f)
    return val if val is not None else ''


def _apply_filter(val, name):
    s = '' if val is None else str(val)
    if name == 'trim':
        return s.strip()
    if name == 'int':
        m = re.search(r'-?\d+', s.replace(',', ''))
        return int(m.group(0)) if m else 0
    if name == 'size':
        return normalize_size(s)
    if name == 'lower':
        return s.lower()
    if name == 'strip_tags':
        return re.sub(r'<[^>]+>', '', s).strip()
    return s


_SIZE_RE = re.compile(r'([\d.]+)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB|B)', re.I)


def normalize_size(s):
    m = _SIZE_RE.search(s or '')
    if not m:
        return ''
    num, unit = m.group(1), m.group(2).upper().replace('IB', 'B')
    try:
        f = float(num)
    except ValueError:
        return ''
    order = {'B': 0, 'KB': 1, 'MB': 2, 'GB': 3, 'TB': 4}
    rank = order.get(unit, 2)
    # 统一输出成 GB / MB 两种观感（前端只展示文本）
    if rank >= 4:
        return '%.2f TB' % f
    if rank == 3:
        return '%.2f GB' % f
    if rank == 2:
        return '%.1f MB' % f
    if rank == 1:
        return '%.0f KB' % f
    return '%d B' % int(f)


# ---------------------------------------------------------------- 引擎族默认选择器
# 每个引擎 = 一组默认 spec；站点配置只需覆盖差异字段

ENGINES = {
    # 国内 PT 主流：NexusPHP
    'nexusphp': {
        'rows': [
            "table.torrents > tbody > tr",
            "table#torrenttable > tbody > tr",
            "table.torrenttable > tbody > tr",
            "table.torrents > tr",
            "table.torrents tr",
        ],
        'fields': {
            'title': {'selector': ["a[href*='details.php']", "td:nth-child(2) a", "td a[href*='details']"]},
            'detailUrl': {'selector': ["a[href*='details.php']"], 'attr': 'href'},
            # 大小：先按列取，取不到就在整行文本里按单位正则兜底（各站列序不一致）
            'size': {'selector': ["td:nth-child(5)", "td:nth-child(6)", "td.size", "td.torrent-size"],
                     'filters': ['size'],
                     'regex': r'[\d.]+\s*(?:TiB|GiB|MiB|TB|GB|MB|KB)'},
            'seeders': {'selector': ["a[href*='toseeders']", "a[href*='seeders']", "td.seeders", "span.seeders",
                                     "td.seed"],
                        'filters': ['int'], 'regex': None},
            'leechers': {'selector': ["a[href*='toleechers']", "a[href*='leechers']", "td.leechers",
                                      "span.leechers", "td.leech"],
                         'filters': ['int'], 'regex': None},
            'date': {'selector': ["span[title]", "td:nth-child(4)", "td.date"], 'attr': 'title',
                     'regex': r'\d{4}-\d{2}-\d{2}[^\s]*'},
            'category': {'selector': ["a[href*='cat=']", "td:nth-child(1) a"], 'filters': ['trim']},
        },
        'fallback_regex': True,
        'detail_pattern': 'details.php',
    },
    # Unit3D
    'unit3d': {
        'rows': ["table.table > tbody > tr", "table#torrents-table tbody tr", "table.torrent-list tbody tr"],
        'fields': {
            'title': {'selector': ["a.torrent-name", "h2 a", "a[href*='/torrents/']"]},
            'detailUrl': {'selector': ["a.torrent-name", "a[href*='/torrents/']"], 'attr': 'href'},
            'size': {'selector': ["td.size", "td:nth-child(5)"], 'filters': ['size']},
            'seeders': {'selector': ["td.seeders", "span.seeders"], 'filters': ['int']},
            'leechers': {'selector': ["td.leechers", "span.leechers"], 'filters': ['int']},
            'date': {'selector': ["span[title]", "time"], 'attr': 'title'},
            'category': {'selector': ["a[href*='category=']"]},
        },
    },
    # Gazelle 系（多为音乐/影视站）
    'gazelle': {
        'rows': ["table.torrent_table > tbody > tr", "table.torrent_table tr"],
        'fields': {
            'title': {'selector': ["a[href*='torrents.php?id=']"]},
            'detailUrl': {'selector': ["a[href*='torrents.php?id=']"], 'attr': 'href'},
            'size': {'selector': ["td.number_column", "td.size"], 'filters': ['size']},
            'seeders': {'selector': ["td.number_column:nth-child(5)"], 'filters': ['int']},
            'leechers': {'selector': ["td.number_column:nth-child(6)"], 'filters': ['int']},
            'date': {'selector': ["span[title]", "td:nth-child(4)"], 'attr': 'title'},
            'category': {'selector': ["a[href*='filter_cat']"]},
        },
    },
    # Discuz 系（论坛类资源站）
    'discuz': {
        'rows': ["table.tb-r > tbody > tr", "table.datatable tbody tr", "tr.list-row"],
        'fields': {
            'title': {'selector': ["a.xst", "td:nth-child(2) a"]},
            'detailUrl': {'selector': ["a.xst", "td:nth-child(2) a"], 'attr': 'href'},
            'size': {'selector': ["td:nth-child(4)", "div.small"], 'filters': ['size']},
            'seeders': {'selector': ["span.seed"], 'filters': ['int']},
            'leechers': {'selector': ["span.leech"], 'filters': ['int']},
            'date': {'selector': ["td:nth-child(3)"], 'filters': ['trim']},
            'category': {'selector': ["td:nth-child(1)"], 'filters': ['trim']},
        },
    },
    # 自带 JSON API 的站（如 M-Team）
    'json_api': {
        'format': 'json',
        'rows': 'data.data',
        'fields': {
            'title': {'path': 'name'},
            'size': {'path': 'size', 'filters': ['size']},
            'seeders': {'path': 'status.seeders', 'filters': ['int']},
            'leechers': {'path': 'status.leechers', 'filters': ['int']},
            'date': {'path': 'createdDate'},
            'category': {'path': 'category'},
            'detailUrl': {'path': 'id'},
        },
        'id_template': '{base}/detail/{value}',
    },
    # 兜底：全部由配置驱动
    'generic': {
        'rows': [],
        'fields': {},
    },
}


# ---------------------------------------------------------------- 站点定义


class SiteStore:
    """站点定义读写。首次启动时从 MoviePilot 的 user.db 导入。"""

    def __init__(self, data_dir):
        self.path = os.path.join(data_dir or '.', SITES_FILE)
        self.sites = []
        self._lock = threading.Lock()

    def load(self, mp_db_path=''):
        if os.path.exists(self.path):
            try:
                with open(self.path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                self.sites = data.get('sites') or []
                return self.sites
            except Exception as e:
                print('[sites] 读取 %s 失败: %s' % (self.path, e), flush=True)
        self.sites = []
        if mp_db_path:
            self.sites = self.import_from_mp(mp_db_path)
            if self.sites:
                self.save()
        return self.sites

    def save(self):
        with self._lock:
            tmp = self.path + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump({'version': 1, 'updated': int(time.time()), 'sites': self.sites},
                          f, ensure_ascii=False, indent=2)
            os.replace(tmp, self.path)

    @staticmethod
    def guess_engine(url, name=''):
        # 绝大多数国内 PT 站是 NexusPHP；M-Team 网页端同为 NexusPHP 表格结构。
        # 官方 JSON API 需要 API Key，等站点配置里显式写 engine=json_api 再启用。
        return 'nexusphp'

    def import_from_mp(self, mp_db_path):
        """从 MoviePilot 的 site 表导入站点（含 cookie），一次性迁移。"""
        out = []
        try:
            conn = sqlite3.connect('file:%s?mode=ro' % mp_db_path, uri=True)
            conn.row_factory = sqlite3.Row
            rows = conn.execute("SELECT name, url, cookie, ua, proxy, is_active FROM site").fetchall()
            conn.close()
        except Exception as e:
            print('[sites] 导入 MP 站点失败: %s' % e, flush=True)
            return out
        for r in rows:
            url = (r['url'] or '').rstrip('/')
            if not url:
                continue
            sid = _site_id(r['name'], url)
            if any(s['id'] == sid for s in out):   # MP 里同一站点可能重复录入
                continue
            out.append({
                'id': sid,
                'name': r['name'],
                'base_url': url,
                'engine': self.guess_engine(url, r['name']),
                'enabled': bool(r['is_active']),
                'cookie': r['cookie'] or '',
                'ua': r['ua'] or '',
                'proxy': bool(r['proxy']),
                'search': {'path': '/torrents.php', 'method': 'GET', 'keywordParam': 'search'},
            })
        print('[sites] 已从 MoviePilot 导入 %d 个站点' % len(out), flush=True)
        return out


def _site_id(name, url):
    host = urllib.parse.urlparse(url).netloc.replace('.', '-') or 'site'
    return re.sub(r'[^a-z0-9-]+', '-', host.lower())


# ---------------------------------------------------------------- HTTP


_UA_DEFAULT = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
               '(KHTML, like Gecko) Chrome/120.0 Safari/537.36')


def _http_fetch(url, method='GET', headers=None, data=None, timeout=SITE_TIMEOUT,
                proxy_url='', verify=True):
    req = urllib.request.Request(url, method=method, data=data)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    req.add_header('Accept-Encoding', 'identity')  # 避免手动处理 gzip 的兼容问题
    handlers = []
    if proxy_url:
        handlers.append(urllib.request.ProxyHandler({'http': proxy_url, 'https': proxy_url}))
    if verify:
        handlers.append(urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    else:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        handlers.append(urllib.request.HTTPSHandler(context=ctx))
    opener = urllib.request.build_opener(*handlers)
    resp = opener.open(req, timeout=timeout)
    raw = resp.read()
    enc = resp.headers.get('Content-Encoding', '')
    if enc == 'gzip':
        try:
            raw = gzip.decompress(raw)
        except Exception:
            pass
    ctype = resp.headers.get('Content-Type', '')
    charset = None
    m = re.search(r'charset=([\w-]+)', ctype, re.I)
    if m:
        charset = m.group(1)
    if not charset:
        m = re.search(rb'charset\s*=\s*["\']?([\w-]+)', raw[:2000], re.I)
        if m:
            charset = m.group(1).decode('ascii', 'ignore')
    for cs in ([charset] if charset else []) + ['utf-8', 'gbk', 'big5']:
        try:
            html = raw.decode(cs)
            break
        except Exception:
            continue
    else:
        html = raw.decode('utf-8', 'ignore')
    return resp.geturl(), resp.status, html


# ---------------------------------------------------------------- 解析


def _extract_rows(root, fmt, rows_sel):
    """行选择器：取命中数最多的那个候选（不是第一个非空）。
    否则像 hdarea 这种「外层表只有 4 行、真正列表在 205 行」的站会被外层杂项行误导。"""
    if fmt == 'json':
        return None  # json 分支单独处理
    best = []
    for s in (rows_sel if isinstance(rows_sel, list) else [rows_sel]):
        if not s:
            continue
        nodes = [n for n in select_all(root, s) if n.tag in ('tr', 'div', 'li')]
        if len(nodes) > len(best):
            best = nodes
    return best


def _extract_field(row, fspec, fmt='html'):
    """单字段取值：JSON 路径 / 选择器 / 整行正则兜底，最后统一过 filters"""
    if fmt == 'json':
        raw = _json_path(row, fspec.get('path'))
    else:
        q = {k: v for k, v in fspec.items() if k not in ('regex', 'filters')}
        node = select_first(row, fspec.get('selector'))
        raw = field_text(node, q) if node is not None else ''
        # 各站列序不一致：选择器取不到时，用整行文本正则兜底
        if (raw is None or str(raw).strip() == '') and fspec.get('regex') and row is not None:
            m = re.search(fspec['regex'], row.get_text(), re.I)
            raw = m.group(0) if m else ''
    for f in fspec.get('filters') or []:
        raw = _apply_filter(raw, f)
    # 过滤后仍然拿不到（例如取到了没有单位的单元格）→ 再用整行正则兜一次
    if (raw is None or str(raw).strip() == '') and fspec.get('regex') and row is not None and fmt != 'json':
        m = re.search(fspec['regex'], row.get_text(), re.I)
        if m:
            raw = m.group(0)
            for f in fspec.get('filters') or []:
                raw = _apply_filter(raw, f)
    return raw if raw is not None else ''


def _row_to_item(row, spec, base_url, fmt='html'):
    fields = spec.get('fields') or {}
    item = {}
    for key, fspec in fields.items():
        item[key] = _extract_field(row, fspec, fmt)
    # detailUrl：相对路径补全
    if item.get('detailUrl') and spec.get('id_template'):
        item['detailUrl'] = spec['id_template'].replace('{base}', base_url).replace('{value}', str(item['detailUrl']))
    elif item.get('detailUrl'):
        du = str(item['detailUrl'])
        if not re.match(r'https?://', du, re.I):
            item['detailUrl'] = (base_url or '').rstrip('/') + '/' + du.lstrip('/')
    # title 兜底：仅当这行确实指向一个详情页时才用整行文本（避免表头行被当成条目）
    if not item.get('title') and row is not None and fmt != 'json' and item.get('detailUrl'):
        item['title'] = row.get_text()[:200]
    return item


def _json_path(obj, path):
    if not path:
        return ''
    cur = obj
    for part in str(path).split('.'):
        if cur is None:
            return ''
        if isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except Exception:
                return ''
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return ''
    return '' if cur is None else cur


_NEXUS_FALLBACK = re.compile(r'href="(details\.php\?id=\d+[^"]*)"[^>]*>(.*?)</a>', re.DOTALL | re.I)


def _parse_with_fallback_regex(html, base_url):
    """NexusPHP 兜底：DOM 解析失败时用正则抠标题与详情链接（老实现的做法，但只作为最后一道）"""
    out = []
    for href, title_html in _NEXUS_FALLBACK.findall(html):
        title = re.sub(r'<[^>]+>', '', title_html)
        title = re.sub(r'\s+', ' ', title).strip()
        if not title or len(title) < 3:
            continue
        out.append({'title': title, 'detailUrl': base_url + '/' + href})
    return out


# ---- 锚点驱动提取：不依赖表格结构，div 型主题站（憨憨等）也能出结果
_SKIP_HREF = re.compile(r'(toseeders|toleechers|dllist=|#comment|comment\.php|userdetails|'
                        r'login|logout|usercp|takelogin|sendmessage|report\.php)', re.I)
_DATE_RE = re.compile(r'\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?|\d+\s*(?:分钟|小时|天|月)前')


def _neutral_row(node):
    """从详情锚点往上找「这一条」的容器：tr/li 直接认；div 取文本量仍很小的最内层锚框"""
    cur = node.parent
    best = cur
    for _ in range(8):
        if cur is None or cur.tag == '#document':
            break
        if cur.tag in ('tr', 'li'):
            return cur
        txt = cur.get_text()
        if len(txt) <= 400:
            best = cur
        else:
            break
        cur = cur.parent
    return best or node.parent


def _anchor_extract(root, base_url, spec):
    """以「详情链接」为锚点逐条提取：标题=链接文本，其余字段在该条容器文本里正则找。"""
    anchors = select_all(root, "a[href*='%s']" % (spec.get('detail_pattern') or 'details.php'))
    groups = {}
    for a in anchors:
        href = a.get('href') or ''
        if _SKIP_HREF.search(href):
            continue
        title = a.get_text().strip()
        row = _neutral_row(a)
        row_text = row.get_text() if row is not None else ''
        if len(title) < 4:
            # 链接文本太短（图片/图标），用容器文本兜底
            title = row_text[:160]
        if len(title) < 3:
            continue
        key = re.sub(r'[#&?]', '|', href)[:120]
        cand = {'title': title, 'detailUrl': href, 'row': row, 'row_text': row_text}
        old = groups.get(key)
        if old is None or len(cand['title']) > len(old['title']):
            groups[key] = cand

    items = []
    for key, c in groups.items():
        row_text = c['row_text']
        size = ''
        m = _SIZE_RE.search(row_text)
        if m:
            size = normalize_size(m.group(0))
        seeders = leechers = 0
        if c['row'] is not None:
            for name, pat in (('seed', 'seeders'), ('leechers', 'leechers')):
                node = select_first(c['row'], ["a[href*='to%s']" % pat,
                                               "div[class*='%s']" % name,
                                               "span[class*='%s']" % name,
                                               "td[class*='%s']" % name])
                if node is not None:
                    num = _apply_filter(node.get_text(), 'int')
                    if name == 'seed':
                        seeders = num
                    else:
                        leechers = num
            if not seeders:
                seeders = _apply_filter(select_first(c['row'], ["a[href*='seeders']"]) or 0, 'int')
        dm = _DATE_RE.search(row_text)
        date = dm.group(0) if dm else ''
        cat = ''
        if c['row'] is not None:
            cat_node = select_first(c['row'], ["a[href*='cat=']", "div[class*='categor']", "span[class*='categor']"])
            if cat_node is not None:
                cat = cat_node.get_text()[:20]
        du = c['detailUrl']
        if not re.match(r'https?://', du, re.I):
            du = (base_url or '').rstrip('/') + '/' + du.lstrip('/')
        items.append({'title': c['title'], 'detailUrl': du, 'size': size, 'seeders': seeders,
                      'leechers': leechers, 'date': date, 'category': cat})
    return items


# ---------------------------------------------------------------- 单站搜索


def _candidate_paths(site):
    """站点搜索路径候选：先声明的优先，404/403 时依次回退（抗改版/抗个别站路径差异）"""
    search = site.get('search') or {}
    cands = []
    if search.get('path'):
        cands.append(search['path'])
    for p in (search.get('paths') or []):
        if p:
            cands.append(p)
    if not cands:
        cands = ['/torrents.php']
    out = []
    for p in cands:
        if p not in out:
            out.append(p)
    return out[:3]


def _build_request(site, query, proxy_url='', path=None):
    spec = dict(ENGINES.get(site.get('engine') or 'generic', ENGINES['generic']))
    spec.update({k: v for k, v in (site.get('parse') or {}).items()})
    search = site.get('search') or {}
    path = path or search.get('path') or '/torrents.php'
    method = (search.get('method') or 'GET').upper()
    keyword_param = search.get('keywordParam') or 'search'
    params = dict(search.get('params') or {})
    extra = {}

    # 高级搜索前缀：imdb|tt123 / douban|123 / tmdb|123
    adv_key, adv_val = None, None
    m = re.match(r'^(imdb|douban|tmdb)\|(.+)$', query.strip(), re.I)
    if m:
        adv_key, adv_val = m.group(1).lower(), m.group(2).strip()

    base = (site.get('base_url') or '').rstrip('/')
    if adv_key:
        adv_spec = (search.get('advance') or {}).get(adv_key)
        if adv_spec is False:
            return None, None, None, '站点不支持该高级搜索'
        if isinstance(adv_spec, dict):
            params.update(adv_spec.get('params') or {})
            if adv_spec.get('keywordParam'):
                keyword_param = adv_spec['keywordParam']
            for k, v in (adv_spec.get('params') or {}).items():
                params[k] = str(v).replace('{keyword}', adv_val)
            if adv_spec.get('useKeywordParam'):
                params[keyword_param] = adv_val
        else:
            # NexusPHP 惯例：?imdb=tt123 / ?douban=123
            params[adv_key] = adv_val
    else:
        params[keyword_param] = query

    params = {k: str(v).replace('{keyword}', query) for k, v in params.items()}
    url = base + path
    if method == 'GET':
        url = url + ('&' if '?' in url else '?') + urllib.parse.urlencode(params, doseq=True)
        data = None
    else:
        form = dict(params)
        body = search.get('body') or {}
        form.update({k: str(v).replace('{keyword}', query) for k, v in body.items()})
        ct = search.get('contentType') or 'application/x-www-form-urlencoded'
        data = urllib.parse.urlencode(form, doseq=True).encode('utf-8')
        extra['Content-Type'] = ct

    headers = {
        'User-Agent': site.get('ua') or _UA_DEFAULT,
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': base + '/',
    }
    headers.update(extra)
    if site.get('cookie'):
        headers['Cookie'] = site['cookie']
    for k, v in (site.get('headers') or {}).items():
        headers[k] = v
    return url, method, {'headers': headers, 'data': data,
                         'proxy': proxy_url if site.get('proxy') else '',
                         'verify': not site.get('insecure')}, spec


def search_site(site, query, proxy_url=''):
    """单站搜索，返回 (items, meta)。异常不抛出，转成 meta.error。"""
    t0 = time.time()
    meta = {'site': site.get('name'), 'ok': False, 'count': 0, 'ms': 0, 'error': ''}
    if not site.get('enabled', True):
        meta['error'] = '已禁用'
        return [], meta
    paths = _candidate_paths(site)
    last_err = ''
    for pi, path in enumerate(paths):
        url, method, req, spec = _build_request(site, query, proxy_url, path=path)
        if url is None:
            meta['error'] = req or '不支持的查询'
            return [], meta
        try:
            final_url, status, body = _http_fetch(
                url, method=method,
                headers=req.get('headers') or {},
                data=req.get('data'),
                proxy_url=req.get('proxy') or '',
                verify=req.get('verify', True))
        except urllib.error.HTTPError as e:
            last_err = 'HTTP %d' % e.code
            if e.code in (403, 404) and pi < len(paths) - 1:
                continue   # 换下一个候选路径再试
            meta['error'] = last_err
            meta['ms'] = int((time.time() - t0) * 1000)
            return [], meta
        except Exception as e:
            meta['error'] = '%s: %s' % (type(e).__name__, e)
            meta['ms'] = int((time.time() - t0) * 1000)
            return [], meta
        if status == 403 or re.search(r'/login|login\.php|login_do', final_url, re.I):
            last_err = '登录态失效'
            if pi < len(paths) - 1:
                continue
            meta['error'] = last_err
            return [], meta
        fmt = spec.get('format', 'html')
        try:
            if fmt == 'json':
                doc = json.loads(body)
                rows = _json_path(doc, spec.get('rows'))
                if isinstance(rows, dict):
                    rows = list(rows.values())
                items = [_row_to_item(r, spec, site.get('base_url'), 'json') for r in (rows or [])]
            else:
                root = parse_html(body)
                rows = _extract_rows(root, fmt, spec.get('rows'))
                if rows:
                    items = [_row_to_item(r, spec, site.get('base_url')) for r in rows]
                elif spec.get('fallback_regex') or site.get('engine') == 'nexusphp':
                    items = _parse_with_fallback_regex(body, site.get('base_url'))
                else:
                    items = []
                # 表格/DOM 路径都没拿到条目时，走锚点驱动兜底（div 型主题站靠这个活）
                if not [it for it in items if it.get('title') and it.get('detailUrl')]:
                    items = _anchor_extract(root, site.get('base_url'), spec)
        except Exception as e:
            meta['error'] = '%s: %s' % (type(e).__name__, e)
            meta['ms'] = int((time.time() - t0) * 1000)
            return [], meta
        # 必须有标题且能指到详情页（表头/装饰行一律丢弃）
        items = [it for it in items if it.get('title') and it.get('detailUrl')]
        for it in items:
            it['site'] = site.get('name')
            it['url'] = it.get('detailUrl') or ''
            it.setdefault('size', '')
            it.setdefault('seeders', 0)
            it.setdefault('leechers', 0)
            it.setdefault('date', '')
            it.setdefault('category', '')
        meta.update({'ok': bool(items), 'count': len(items), 'ms': int((time.time() - t0) * 1000),
                     'path': path})
        if items or pi == len(paths) - 1:
            if not items and last_err:
                meta['error'] = last_err
            return items, meta
    return [], meta


# ---------------------------------------------------------------- 健康度 / 熔断


class Health:
    def __init__(self, data_dir):
        self.path = os.path.join(data_dir or '.', HEALTH_FILE)
        self.data = {}
        self._lock = threading.Lock()
        self._load()

    def _load(self):
        try:
            with open(self.path, 'r', encoding='utf-8') as f:
                self.data = json.load(f)
        except Exception:
            self.data = {}

    def _save(self):
        try:
            tmp = self.path + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(self.data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, self.path)
        except Exception:
            pass

    def get(self, sid):
        return self.data.get(sid) or {}

    def available(self, sid):
        h = self.get(sid)
        if h.get('fail_streak', 0) >= FAIL_THRESHOLD:
            last = h.get('last_fail_at') or 0
            if time.time() - last < COOLOFF_SEC:
                return False, '熔断中'
        return True, ''

    def record(self, sid, ok, ms, error=''):
        with self._lock:
            h = self.data.setdefault(sid, {})
            h['last_at'] = int(time.time())
            h['last_ms'] = ms
            if ok:
                h['fail_streak'] = 0
                h['last_ok_at'] = int(time.time())
                h['last_error'] = ''
                h['ok_total'] = h.get('ok_total', 0) + 1
            else:
                h['fail_streak'] = h.get('fail_streak', 0) + 1
                h['last_fail_at'] = int(time.time())
                h['last_error'] = (error or '')[:120]
                h['fail_total'] = h.get('fail_total', 0) + 1
            self._save()


# ---------------------------------------------------------------- 对外主入口

_CACHE = {}
_CACHE_LOCK = threading.Lock()
_STORE = {'store': None, 'health': None, 'key': None}


def _get_ctx(data_dir, mp_db_path):
    key = (os.path.abspath(data_dir or '.'), mp_db_path or '')
    if _STORE['key'] != key or _STORE['store'] is None:
        store = SiteStore(data_dir)
        store.load(mp_db_path)
        _STORE['store'] = store
        _STORE['health'] = Health(data_dir)
        _STORE['key'] = key
    return _STORE['store'], _STORE['health']


def _filter_exclude(items, exclude_terms):
    if not exclude_terms:
        return items
    out = []
    for it in items:
        tl = (it.get('title') or '').lower()
        if any(t in tl for t in exclude_terms):
            continue
        out.append(it)
    return out


def _rank_dedupe(collected):
    seen = set()
    unique = []
    for r in sorted(collected, key=lambda x: int(x.get('seeders') or 0), reverse=True):
        key = ((r.get('site') or '') + '|' + (r.get('title') or '')[:60]).lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(r)
    return unique[:RESULT_CAP]


def _merge_pending_into_cache(cache_key, pending, futures, health, exclude_terms):
    """总预算到点后，慢站的结果在后台继续收，收齐了合并进缓存（下次同 query 直接全量）。"""
    extra = []
    for fut in pending:
        s = futures.get(fut) or {}
        sid = s.get('id') or s.get('name')
        try:
            items, meta = fut.result(timeout=SITE_TIMEOUT + 5)
        except Exception as e:
            items, meta = [], {'ok': False, 'ms': 0, 'error': str(e)}
        if sid:
            health.record(sid, meta.get('ok', False), meta.get('ms', 0), meta.get('error', ''))
        extra.extend(_filter_exclude(items, exclude_terms))
    if not extra:
        return
    with _CACHE_LOCK:
        base = (_CACHE.get(cache_key) or (time.time(), []))[1]
        merged = _rank_dedupe(base + extra)
        _CACHE[cache_key] = (time.time(), merged)


def search_all(query, exclude='', mp_db_path='', data_dir='', proxy_url='', sites=None, timeout=None):
    """并发搜索所有启用站点，返回与旧 pt_search 兼容的结果列表。"""
    q = (query or '').strip()
    if not q:
        return []
    store, health = _get_ctx(data_dir, mp_db_path)
    site_list = sites if sites is not None else store.sites
    targets = []
    for s in site_list:
        if not s.get('enabled', True):
            continue
        sid = s.get('id') or s.get('name')
        ok, reason = health.available(sid)
        if not ok:
            continue
        targets.append(s)
    if not targets:
        return []

    # 缓存键只按 query：熔断/站点增删不应把同一 query 的缓存打散
    cache_key = (q,)
    with _CACHE_LOCK:
        hit = _CACHE.get(cache_key)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]

    exclude_terms = [e.strip().lower() for e in (exclude or '').split() if e.strip()]
    collected = []
    deadline = time.time() + (timeout or TOTAL_BUDGET)

    workers = min(MAX_WORKERS, max(4, len(targets)))
    ex = concurrent.futures.ThreadPoolExecutor(max_workers=workers)
    futures = {}
    try:
        futures = {ex.submit(search_site, s, q, proxy_url): s for s in targets}
        # as_completed：谁先返回谁先收，慢站不阻塞（旧实现 ex.map 会按提交顺序死等）
        try:
            for fut in concurrent.futures.as_completed(futures, timeout=max(0.1, deadline - time.time())):
                s = futures[fut]
                sid = s.get('id') or s.get('name')
                try:
                    items, meta = fut.result(timeout=0.1)
                except Exception as e:
                    items, meta = [], {'ok': False, 'ms': 0, 'error': str(e)}
                health.record(sid, meta.get('ok', False), meta.get('ms', 0), meta.get('error', ''))
                collected.extend(_filter_exclude(items, exclude_terms))
        except concurrent.futures.TimeoutError:
            pass   # 总预算到点：先返已拿到的，慢站交给后台补
    finally:
        pending = [f for f in futures if not f.done()]
        ex.shutdown(wait=False, cancel_futures=False)
    if pending:
        threading.Thread(target=_merge_pending_into_cache,
                         args=(cache_key, pending, futures, health, exclude_terms),
                         daemon=True).start()

    unique = _rank_dedupe(collected)
    with _CACHE_LOCK:
        _CACHE[cache_key] = (time.time(), unique)
    return unique


def search_one(site_id, query, mp_db_path='', data_dir='', proxy_url=''):
    """单站测试搜索（供站点管理页的「测试」按钮使用）"""
    store, health = _get_ctx(data_dir, mp_db_path)
    for s in store.sites:
        if (s.get('id') or '') == site_id:
            items, meta = search_site(s, query, proxy_url)
            health.record(site_id, meta.get('ok'), meta.get('ms'), meta.get('error', ''))
            return items, meta
    return [], {'ok': False, 'error': '站点不存在'}


def health_snapshot(data_dir='', mp_db_path=''):
    store, health = _get_ctx(data_dir, mp_db_path)
    out = []
    for s in store.sites:
        sid = s.get('id') or s.get('name')
        h = health.get(sid)
        out.append({
            'id': sid, 'name': s.get('name'), 'engine': s.get('engine'),
            'enabled': s.get('enabled', True), 'base_url': s.get('base_url'),
            'fail_streak': h.get('fail_streak', 0), 'last_error': h.get('last_error', ''),
            'last_ms': h.get('last_ms', 0), 'ok_total': h.get('ok_total', 0),
            'fail_total': h.get('fail_total', 0),
        })
    return out


def reload_sites(data_dir='', mp_db_path=''):
    _STORE['key'] = None
    store, _ = _get_ctx(data_dir, mp_db_path)
    return len(store.sites)
