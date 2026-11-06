# -*- coding: utf-8 -*-
"""提取 dashboard.html 中所有内联 <script> 拼接为 _combined.js，供 node --check 校验语法。"""
import io, os, re, sys

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, "dashboard.html")
OUT = os.path.join(BASE, "_combined.js")

html = io.open(SRC, "r", encoding="utf-8", errors="replace").read()

# 去掉注释中的假 script 标签影响：按非贪婪抓取
blocks = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S | re.I)
print("script blocks:", len(blocks))
joined = "\n;\n".join(blocks)
with io.open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(joined)
print("combined chars:", len(joined))
