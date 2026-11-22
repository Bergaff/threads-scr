/**
 * Cloudflare Containers — ffmpeg-рендерер и прокси-шлюз.
 * Один Docker-образ (containers/renderer), две роли:
 *  - RENDERER (standard-2: 1 vCPU, 6 GiB): монтаж Shorts + Piper TTS.
 *    Спится через 5 минут простоя — платится только за время рендера.
 *  - PROXY (basic: 1/4 vCPU, 1 GiB): fetch через per-account прокси.
 *    Спится через 10 минут простоя.
 * Вызов: env.RENDERER.getByName("main").fetch(new Request("http://container/render", ...))
 * См. docs/COST.md — почему это укладывается в $5 Paid.
 */

import { Container } from "@cloudflare/containers";
import type { Env } from "./env.js";

export class RendererContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "5m";
  enableInternet = true;
}

export class ProxyContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "10m";
  enableInternet = true;
}
