# Локальный сервис Threads Digest (на ПК пользователя)

Тяжёлые задачи крутим **локально**, чтобы не тратить бюджет Cloudflare-контейнеров
аккаунта (там уже жрёт другой проект). Worker в Клауде дёргает этот сервис по туннелю.

## Что делает

- `POST /render` — монтаж Shorts: ffmpeg + Piper TTS (офлайн) + karaoke-субтитры.
  Читает SVG-карточку/фон/музыку из R2, кладёт готовый mp4 + превью обратно в R2.
- `POST /tts` — Piper TTS: `{ text, lang }` → `{ audioBase64, durationSec }`.
- `GET /fetch?url=...` — прозрачный прокси сборщика. Per-account прокси берётся из
  заголовка `X-Proxy-Url` (его ставит Worker из `account.proxy`).
- `GET /health` — проверка живости.

## Требования

- Node.js ≥ 20
- **ffmpeg** в PATH (для монтажа)
- **Piper** TTS — скачается автоматически при первом `/tts` с huggingface
  (нужен доступ в инет). Можно поставить вручную: `pip install piper-tts` или
  скачать бинарь с github.com/rhasspy/piper.
- Ключи R2 (см. `.env.example`) — либо в `local/.env`, либо Worker передаёт в теле `/render`.

## Запуск

```bash
cd local
npm install
cp .env.example .env   # заполнить R2_*
npm start
# → listening on 8080
```

Проверить:
```bash
curl http://localhost:8080/health
```

## Как Worker видит этот сервис

Локальный ПК за NAT, поэтому поднимаем туннель (бесплатно):

```bash
# вариант 1: cloudflared (рекомендуется)
cloudflared tunnel --url http://localhost:8080
# даст, напр., https://xyz.trycloudflare.com

# вариант 2: ngrok
ngrok http 8080
```

Полученный URL прописать в `.dev.vars` (или `wrangler secret put`):

```
VIDEO_RENDERER_URL=https://xyz.trycloudflare.com
PROXY_GATEWAY_URL=https://xyz.trycloudflare.com
```

Worker будет слать:
- `POST {VIDEO_RENDERER_URL}/render` — для монтажа Shorts
- `GET  {PROXY_GATEWAY_URL}/fetch?url=...` — для сборщика через прокси

Готово — ffmpeg и прокси крутятся на твоём ПК бесплатно, а Клауд платит только
за Worker/D1/R2/Queues/Workers AI (копейки, вне бюджета контейнеров).

## Примечание про IP прокси

Если `account.proxy` не задан, `/fetch` ходит с реального IP твоего ПК
(часто резидентный/домашний — это даже плюс для Threads, реже банят).
Если нужен привязанный прокси — укажи `account.proxy` в таблице `accounts`
(формат `http://user:pass@host:port`), и Worker передаст его в `X-Proxy-Url`.
