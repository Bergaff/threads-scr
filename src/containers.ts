/**
 * Cloudflare Containers — только ffmpeg-рендерер Shorts (+ Piper TTS внутри).
 *
 * Один Docker-образ (containers/renderer), одна роль: RENDERER (standard-2).
 * Спит через 5 минут простоя (scale-to-zero) — платится только за время рендера
 * (1–2 Shorts/день ≈ пара минут CPU/день, в лимитах Paid).
 *
 * Прокси-контейнер НАМЕРЕННО не используется: cron сборщика бьёт каждые 5 минут,
 * поэтому такой контейнер не засыпал бы и биллился круглосуточно. Прокси идёт
 * напрямую через HTTP-шлюз провайдера (PROXY_GATEWAY_URL) из Worker'а.
 *
 * Вызов: env.RENDERER.getByName("main").fetch(new Request("http://container/render", ...))
 * См. docs/COST.md.
 */

import { Container } from "@cloudflare/containers";
import type { Env } from "./env.js";

export class RendererContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";
  enableInternet = true;
}
