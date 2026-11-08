# syntax=docker/dockerfile:1
# NEXUS 家庭服务器仪表盘 —— 唯一构建定义（替代历史上分叉的两份 Dockerfile）
# 基础镜像以 digest 锁定，保证任意时间重建得到同一底座。
FROM python:3.12-alpine@sha256:4c47124a8391cb7a9f571164147d154777cf012a4ece5f86097130d7a4478111

ARG GIT_REVISION=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.title="NEXUS" \
      org.opencontainers.image.description="NEXUS 家庭服务器仪表盘（dashboard.html + api.py，纯标准库，无第三方依赖）" \
      org.opencontainers.image.version="2.2.10" \
      org.opencontainers.image.revision="${GIT_REVISION}" \
      org.opencontainers.image.created="${BUILD_DATE}"

WORKDIR /app

# 应用本体：api.py + dashboard.html + search_engine.py（站点搜索/解析引擎）；index.html 为 dashboard.html 的同字节副本
COPY api.py dashboard.html search_engine.py ./
COPY dashboard.html ./index.html

ENV DASH_API_PORT=28080 \
    DASH_DATA_DIR=/data \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 28080
VOLUME ["/data"]

# 健康检查：容器内自探，不依赖外网；按 DASH_TLS_CERT 是否设置自动选 https / http。
# 之前写死 http，容器一开原生 TLS 就永远探不通 —— 显示 unhealthy 但服务其实正常，
# 只能每次重建时手工补 --health-cmd 绕过，属于必然踩的坑，这里收进镜像。
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python3 -c "import os,ssl,urllib.request;t=bool(os.environ.get('DASH_TLS_CERT'));u='https://127.0.0.1:28080/' if t else 'http://127.0.0.1:28080/';c=ssl._create_unverified_context() if t else None;urllib.request.urlopen(u,timeout=3,context=c)" || exit 1

CMD ["python3", "api.py"]
