# Что создать на Cloudflare (чеклист развёртывания)

Проект живёт на Клауде минимально: **Worker + D1 + R2 + Queues + Workers AI**.
Тяжёлое (ffmpeg/прокси) крутится локально (см. `local/`), поэтому Cloudflare платит
только за лёгкое. Ниже — что создать и какими командами.

> Перед началом: `wrangler login` (или уже залогинен). Workers Paid ($5/мес) на аккаунте
> уже должен быть включён (нужен для cron раз в 5 мин и Queues).

## 1. D1 — база (раздел 13 ТЗ)
```bash
wrangler d1 create threads-digest
```
Скопируй `database_id` из ответа и впиши в `wrangler.toml` вместо
`REPLACE_WITH_D1_ID_AFTER_db_create`. Затем накати миграцию (схема из `src/db/migrations/`):
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

## 6. Секреты (`wrangler secret put <NAME>`)
Не коммить их. Вводи каждый интерактивно:
```bash
wrangler secret put TELEGRAM_EDITOR_BOT_TOKEN
wrangler secret put TELEGRAM_CHANNEL_BOT_TOKEN
wrangler secret put TG_CHANNEL_RU
wrangler secret put TG_CHANNEL_EN
wrangler secret put ADMIN_IDS          # "123456789,987654321"
wrangler secret put ADMIN_API_KEY
wrangler secret put COOKIE_ENCRYPTION_KEY   # base64, 32 байта
wrangler secret put YOUTUBE_OAUTH_TOKEN_RU
wrangler secret put YOUTUBE_OAUTH_TOKEN_EN
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
# Только если LLM_PROVIDER="openai-compatible":
wrangler secret put OPENAI_API_KEY
wrangler secret put OPENAI_BASE_URL
```
Переменные `ENVIRONMENT`, `SITE_URL`, `BOT_USERNAME`, `LLM_PROVIDER`, `LLM_MODEL`,
`TTS_PROVIDER`, `R2_BUCKET` уже заданы в `[vars]` `wrangler.toml` — их менять не надо.

## 7. Туннель к локальному сервису (VIDEO_RENDERER_URL / PROXY_GATEWAY_URL)
Локальный сервис (`local/`) доступен Worker'у только через туннель. URL туннеля
меняется при каждом перезапуске, поэтому задаём его секретом (не в `[vars]`):
```bash
wrangler secret put VIDEO_RENDERER_URL   # вставь https://****.trycloudflare.com
wrangler secret put PROXY_GATEWAY_URL    # тот же URL
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
