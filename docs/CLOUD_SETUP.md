# Что создать на Cloudflare (чеклист развёртывания)

Проект живёт на Клауде минимально: **Worker + D1 + R2 + Queues + Workers AI**.
Тяжёлое (ffmpeg/прокси) крутится локально (см. `local/`), поэтому Cloudflare платит
только за лёгкое. Ниже — что создать и какими командами.

> Перед началом: `wrangler login` (или уже залогинен). Workers Paid ($5/мес) на аккаунте
> уже должен быть включён (нужен для cron раз в 5 мин и Queues).

## 1. D1 — база (раздел 13 ТЗ)
База уже создана, `database_id` прописан в `wrangler.toml` (`21e58e47-3387-45a5-a846-5345d1852033`).
Осталось накатить миграцию (схема из `src/db/migrations/`):
```bash
wrangler d1 migrations apply threads-digest --remote
```

## 2. R2 — медиа (карточки, ролики, аудио)
```bash
wrangler r2 bucket create threads-digest-media
```
Также создай **R2 API-токен** для локального рендерера:
Dashboard → R2 → Manage R2 API Tokens → Create API token (права Read/Write на этот бакет).
Полученные `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` впиши в `local/.env`
(либо через `wrangler secret put`, тогда Worker сам передаст их в `/render`).

## 3. Queues — очередь задач планировщика
```bash
wrangler queues create threads-digest-jobs
```
Producer- и consumer-биндинги (`JOBS`) прописаны в `wrangler.toml`, создадутся при деплое.

## 4. Workers AI
Ничего создавать не надо — биндинг `AI` включается директивой `[ai]` в `wrangler.toml`.
Доступно в рамках плана (бесплатная квота нейронов).

## 5. Worker + Cron-триггеры
```bash
wrangler deploy
```
Создаёт Worker `threads-digest`, биндинги (D1/R2/AI/Queues) и Cron-триггеры
(`*/5 * * * *` и `0 6 * * *` из `wrangler.toml`). Worker получит адрес
`https://threads-digest.<твой-subdomain>.workers.dev` (subdomain виден после `wrangler deploy`
или `wrangler subdomain`); он нужен для webhook Telegram и админки.

## 6. Секреты — массово одним файлом (`wrangler secret bulk`)
Вместо поштучных `wrangler secret put` заполни один JSON и залей всё сразу.

1. Скопируй шаблон и заполни значения (реальный файл называй `secrets.json`, он в `.gitignore`):
   ```bash
   cp secrets.example.json secrets.json
   # открой secrets.json, впиши токены; VIDEO_RENDERER_URL и PROXY_GATEWAY_URL —
   # туда позже вставь URL туннеля (см. шаг 7)
   ```
2. Залей все секреты одной командой:
   ```bash
   wrangler secret bulk secrets.json
   ```
   (Команда обновляет/создаёт все ключи из файла разом.)

Список ключей в `secrets.example.json`:
`TELEGRAM_EDITOR_BOT_TOKEN`, `TELEGRAM_CHANNEL_BOT_TOKEN`, `TG_CHANNEL_RU`, `TG_CHANNEL_EN`,
`ADMIN_IDS`, `ADMIN_API_KEY`, `COOKIE_ENCRYPTION_KEY`, `YOUTUBE_OAUTH_TOKEN_RU`,
`YOUTUBE_OAUTH_TOKEN_EN`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`VIDEO_RENDERER_URL`, `PROXY_GATEWAY_URL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`.

Переменные `ENVIRONMENT`, `SITE_URL`, `BOT_USERNAME`, `LLM_PROVIDER`, `LLM_MODEL`,
`TTS_PROVIDER`, `R2_BUCKET` уже заданы в `[vars]` `wrangler.toml` — их менять не надо.

## 7. Туннель к локальному сервису (VIDEO_RENDERER_URL / PROXY_GATEWAY_URL)
Локальный сервис (`local/`) доступен Worker'у только через туннель. URL туннеля
меняется при каждом перезапуске.

1. На ПК запусти `local/run-all.bat` — в окне туннеля появится `https://****.trycloudflare.com`.
2. Впиши этот URL в `VIDEO_RENDERER_URL` и `PROXY_GATEWAY_URL` файла `secrets.json`
   (на Клауде) и обнови секреты:
   ```bash
   wrangler secret bulk secrets.json
   ```
Сам туннель поднимается на ПК через `local/run-all.bat` (или `tunnel.bat`).

## 8. Telegram-бот (редактор + публикация)
1. @BotFather → `/newbot` → получи токен → вставь в `TELEGRAM_EDITOR_BOT_TOKEN`
   (и `TELEGRAM_CHANNEL_BOT_TOKEN`, если публикует тот же бот).
2. Добавь бота в каналы и сделай админом. `TG_CHANNEL_RU`/`TG_CHANNEL_EN` — `chat_id` каналов
   (со знаком минус, напр. `-1001234567890`).
3. Укажи webhook (замени URL на свой):
```bash
curl -F "url=https://threads-digest.<subdomain>.workers.dev/webhook/telegram" \
     https://api.telegram.org/bot<TELEGRAM_EDITOR_BOT_TOKEN>/setWebhook
```

## 9. (Опционально) Cloudflare Access перед админкой
`/admin/*` защищён `X-Admin-Key`, но лучше навесить Cloudflare Access (Zero Trust) —
это отсекёт лишний трафик до Worker'а.

## Итог: что создано на Клауде
- ✅ Worker `threads-digest` (+ 2 cron-триггера)
- ✅ D1 `threads-digest` (с миграцией)
- ✅ R2 `threads-digest-media` (+ API-токен для локального рендерера)
- ✅ Queue `threads-digest-jobs`
- ✅ Workers AI (биндинг `AI`)
- ✅ Секреты (список выше) + 2 URL туннеля
- ✅ Telegram-бот + webhook

Доп. плата за этот проект — **≈ $0** поверх уже оплаченного $5 Paid (Worker/D1/R2/Queues/AI
здесь мизерны). Всё тяжёлое — на твоём ПК.
