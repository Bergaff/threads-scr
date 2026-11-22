# Архитектура Threads Digest на Cloudflare

ТЗ (раздел 14) рекомендует VPS + Docker из-за ffmpeg и постоянного браузера.
Заказчик попросил Cloudflare — ниже, как каждый модуль ТЗ ложится на Workers,
и где нужны внешние сервисы.

## Что работает полностью в Workers

| Модуль ТЗ | Cloudflare-реализация |
|---|---|
| Сборщик (4.1–4.3) | Worker + `fetch` с cookies аккаунта, через **локальный** прокси-шлюз (`PROXY_GATEWAY_URL`, см. `local/`). JSON из GraphQL разбирается в `src/collector/threads.ts`. |
| Оценка и фильтры (4.4–4.6) | Чистые функции `src/lib/scoring.ts`, `filters.ts`, `language.ts` — покрыты тестами. |
| Планировщик (4.8) | Cron Trigger (каждые 5 мин) → `src/cron.ts` → Queues. Приоритеты и бюджет страниц — в `src/scheduler/planner.ts`. |
| Нейросеть (5) | Workers AI по умолчанию (`@cf/meta/llama-3.1-8b-instruct`), или OpenAI-совместимый API. Промпты — `prompts/*.md`. |
| Карточки (6.2) | SVG 1080×1350 (`src/cards/card.ts`) → PNG через Browser Rendering API или внешний resvg. SVG хранится в R2. |
| Бот-редактор (8) | Webhook `POST /webhook/telegram`, только `ADMIN_IDS`. Кнопки и команды — `src/bot/editor.ts`. |
| Публикация TG (6, 9) | Bot API из Worker'а. Идемпотентность — UNIQUE в D1. |
| YouTube метаданные (7.7) | `src/publish/youtube.ts`: заголовок/описание/хэштеги, загрузка через Data API v3. |
| Статистика (10) | D1 + UTM в ссылках; веса — `src/stats/weights.ts`. |
| Хранилище (13) | D1 (SQLite) + R2 для медиа. Схема — `src/db/migrations/0001_init.sql`. |
| Админка (12) | `GET /admin/*` с `X-Admin-Key`. Рекомендуется повесить Cloudflare Access. |

## Что НЕ работает в Workers и как решается

### 1. Per-account proxy (4.1)
Workers `fetch` не умеет ходить через прокси. Решение — **локальный прокси-шлюз**
(`PROXY_GATEWAY_URL`): это `local/server.js`, который крутится **на ПК пользователя**,
а Worker дёргает его по туннелю (cloudflared/ngrok). Шлюз делает `GET /fetch?url=...`
и ходит через per-account прокси (`account.proxy`, передаётся заголовком `X-Proxy-Url`).
Без прокси — с реального IP ПК (часто резидентный, что хорошо для Threads).

**Почему НЕ в Cloudflare и не у провайдера:** бюджет контейнеров аккаунта уже забит
другим проектом, а внешний прокси-провайдер — отдельная плата. Локальный шлюз бесплатен
и вообще не трогает бюджет Cloudflare. Код: `src/collector/client.ts` (путь `gatewayUrl`),
`local/server.js` (`/fetch`).

### 2. ffmpeg / монтаж Shorts (7.6)
В Workers нет ffmpeg и долгих CPU-задач. Решение — **локальный рендерер**
(`VIDEO_RENDERER_URL` → `local/server.js` на ПК пользователя): ffmpeg + Piper TTS
(офлайн, без API-оплат). Worker кладёт SVG-карточку, фон и музыку в R2, шлёт `POST /render`
с сегментами сценария → локальный сервис собирает mp4 + karaoke-субтитры + loudnorm −14 LUFS
и кладёт результат обратно в R2.

**Почему локально, а не Cloudflare Container:** бюджет контейнеров аккаунта уже maxed
другим проектом — любой контейнер здесь увеличил бы оверхед сверх $5. Локальный ПК
делает тяжёлую работу бесплатно (см. `docs/COST.md`). Код: `local/server.js`, `local/README.md`,
`src/lib/containerApi.ts` (`buildRenderRequest`), `src/jobs/handlers.ts` (`renderShorts`).
Пока локальный рендерер не подключён, ролик можно скачать из бота-редактора (⬇️) — режим
«до аудита Google» из раздела 7.7.

### 3. Playwright / скриншоты (6.2)
Не нужны: карточка рисуется из данных в SVG. Конвертация SVG→PNG:
Cloudflare Browser Rendering API (`/screenshot` с `html` = SVG) или resvg в рендерере.

### 4. TTS (7.4)
Workers AI не даёт TTS. Варианты: внешний TTS API (Yandex SpeechKit / OpenAI TTS /
ElevenLabs) — Worker вызывает его по HTTP и кладёт аудио в R2; или бесплатные
Silero/Piper на том же контейнере, что и рендерер. Нормализация текста для TTS —
`src/lib/text.ts` (`normalizeNumbersForTts`, `stripMentions`).

### 5. Статистика TG через MTProto (10)
Telethon/GramJS не живут в Workers. Сбор просмотров — отдельным скриптом
(на VPS/контейнере) с записью в D1 через HTTP API или прямым доступом к D1.
YouTube Analytics API — обычный OAuth + fetch, можно делать из Worker'а.

### 6. Лимиты Workers
- CPU: 10 мс (free) / 5 мин (paid) на запрос — тяжёлое уносится в Queues.
- Cron: минимум 1 раз в минуту — у нас 5 минут, этого достаточно для интервалов 90+ мин.
- D1: 5 млн строк/чтений в день на free — для старта хватает; при росте — Paid.
- Queues: бесплатны в разумных пределах, ретраи из коробки.

## Схема данных

Все таблицы из раздела 13 ТЗ + `bot_states` (состояние правок в боте).
Медиа — в R2 (`cards/`, `shorts/`), TTL 30 дней на уровне жизненного цикла бакета.

## Безопасность (раздел 15)

- Секреты — только `wrangler secret put` / `.dev.vars`, никогда в git.
- Cookies аккаунтов хранятся в D1; шифрование — на уровне приложения
  (ключ `COOKIE_ENCRYPTION_KEY`) или через Cloudflare Secrets Store.
- Админка — `X-Admin-Key` + Cloudflare Access + Rate Limiting.
- Бот-редактор отвечает только `ADMIN_IDS`.
- Логи без cookies и токенов (см. `src/db/client.ts: log`).
