# Локальный сервис Threads Digest (на ПК пользователя)

Тяжёлые задачи крутим **локально**, чтобы не тратить бюджет Cloudflare-контейнеров
аккаунта (там уже жрёт другой проект). Worker в Клауде дёргает этот сервис по туннелю.

Работает на **Windows и Linux/macOS**. На Windows запуск — **только через `.bat`-файлы**
(см. ниже).

## Что делает

- `POST /render` — монтаж Shorts: ffmpeg + Piper TTS (офлайн) + karaoke-субтитры.
  Читает SVG-карточку/фон/музыку из R2, кладёт готовый mp4 + превью обратно в R2.
- `POST /tts` — Piper TTS: `{ text, lang }` → `{ audioBase64, durationSec }`.
- `GET /fetch?url=...` — прозрачный прокси сборщика. Per-account прокси берётся из
  заголовка `X-Proxy-Url` (его ставит Worker из `account.proxy`).
- `GET /health` — проверка живости.

## Запуск на Windows (через .bat)

Открой папку `local/` в проводнике и запускай батники двойным кликом:

1. **`install.bat`** — проверяет Node.js и ffmpeg, ставит npm-зависимости.
   Кэш npm пишется в `local/.npm-cache` (рядом, а не на `C:\Users\...`).
2. **`run-all.bat`** — запускает сервер (порт 8080) и туннель cloudflared в двух окнах.
   В окне туннеля появится URL вида `https://****.trycloudflare.com`.
3. Скопируй этот URL и на Клауде выполни (см. `docs/CLOUD_SETUP.md`):
   ```
   wrangler secret bulk secrets.json
   ```
   (впиши URL в `VIDEO_RENDERER_URL` и `PROXY_GATEWAY_URL` файла `secrets.json`).
   URL меняется при каждом перезапуске туннеля — тогда повтори `wrangler secret bulk`.

Отдельные батники: `start.bat` (только сервер), `tunnel.bat` (только туннель).

### Портативный режим (всё в папке `local/`, ничего лишнего на C:)
- `node_modules`, `.npm-cache`, `.cache` (Piper+голоса), `.tmp` (рендер), `.env` —
  создаются **внутри папки `local/`**, рядом с батниками.
- Можно положить прямо в папку `local/`:
  - `ffmpeg.exe` + его DLL (тогда `ffmpeg` не нужен в PATH),
  - `cloudflared.exe` (тогда `cloudflared` не нужен в PATH).
  Батники сначала ищут эти `.exe` в своей папке, потом в PATH.
- Исключение: сам **Node.js** и **системный PATH** — их ставим обычно (на C:), это рантайм,
  а не файлы проекта. Всё остальное проекта живёт в `local/`.

> Перед первым запуском создай `local/.env` из `local/.env.example` и впиши `R2_*`-ключи
> (нужны рендереру для чтения/записи в R2). `start.bat` создаст `.env` автоматически,
> если его нет, — просто допиши ключи в блокноте.

Проверить живость: открой `http://localhost:8080/health` в браузере.

## Запуск вручную (Linux/macOS) — опционально

```bash
cd local
npm install
cp .env.example .env   # заполнить R2_*
npm start              # → listening on 8080
cloudflared tunnel --url http://localhost:8080
```

## Требования

- Node.js ≥ 20 (проверяется в `install.bat`)
- **ffmpeg** в PATH (для монтажа; без него рендер упадёт)
- **Piper** TTS — скачается **автоматически** при первом `/tts` или `/render` под твою ОС
  (Windows/Linux/macOS) с GitHub Releases. Нужен доступ в интернет при первом запуске.
- Ключи R2 — в `local/.env` либо Worker передаёт их в теле `/render`.

## Как Worker видит этот сервис

Локальный ПК за NAT → поднимаем туннель (бесплатно, `cloudflared tunnel --url`).
Worker шлёт:
- `POST {VIDEO_RENDERER_URL}/render` — для монтажа Shorts
- `GET  {PROXY_GATEWAY_URL}/fetch?url=...` — для сборщика через прокси

Готово — ffmpeg и прокси крутятся на твоём ПК бесплатно, а Клауд платит только
за Worker/D1/R2/Queues/Workers AI (копейки, вне бюджета контейнеров).

## Примечание про IP прокси

Если `account.proxy` не задан, `/fetch` ходит с реального IP твоего ПК
(часто резидентный/домашний — это даже плюс для Threads, реже банят).
Если нужен привязанный прокси — укажи `account.proxy` в таблице `accounts`
(формат `http://user:pass@host:port`), и Worker передаст его в `X-Proxy-Url`.
