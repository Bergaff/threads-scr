# Threads Digest — контейнер: ffmpeg + Piper TTS + прокси-шлюз.
# Один образ, две роли (см. wrangler.toml):
#   RENDERER (standard-2) — монтаж Shorts, TTS, SVG→PNG
#   PROXY    (basic)       — fetch через per-account прокси для сборщика
FROM node:22-alpine

# ffmpeg (монтаж), curl (скачивание Piper), python3 (на всякий случай для скриптов)
RUN apk add --no-cache ffmpeg curl ca-certificates

# Piper TTS — автономный бинарь (статический, без Python-зависимостей).
# Голоса скачиваются при первом вызове /tts и кэшируются в /tmp (см. server.js).
RUN curl -fsSL https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_linux_x86_64.tar.gz \
  | tar xz -C /usr/local/bin --strip-components=1 \
  && chmod +x /usr/local/bin/piper \
  && piper --help >/dev/null 2>&1 || true

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server.js ./

EXPOSE 8080
CMD ["node", "server.js"]
