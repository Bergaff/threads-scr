/**
 * Конструктор запроса к RENDERER-контейнеру (ffmpeg) — вынесен для тестов.
 * Прокси теперь идёт напрямую через PROXY_GATEWAY_URL (без контейнера),
 * поэтому здесь только сборка /render-запроса.
 */

import type { ScriptSegment } from "../shorts/script.js";

export interface ContainerRenderRequest {
  contentId: string;
  segments: Array<{ type: string; text: string }>;
  cardKey: string;
  backgroundKey: string;
  musicKey: string;
  audioKey?: string;
  lang: "ru" | "en";
  r2: { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string };
}

export function buildRenderRequest(input: {
  contentId: string;
  segments: ScriptSegment[];
  cardKey: string;
  backgroundKey: string;
  musicKey: string;
  audioKey?: string;
  lang: "ru" | "en";
  r2: ContainerRenderRequest["r2"];
}): ContainerRenderRequest {
  return {
    contentId: input.contentId,
    segments: input.segments.map((s) => ({ type: s.type, text: s.text })),
    cardKey: input.cardKey,
    backgroundKey: input.backgroundKey,
    musicKey: input.musicKey,
    audioKey: input.audioKey,
    lang: input.lang,
    r2: input.r2,
  };
}
