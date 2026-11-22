/**
 * Конструктор запроса к локальному рендереру (ffmpeg) — вынесен для тестов.
 * Рендер и прокси крутятся локально на ПК пользователя (local/server.js),
 * поэтому здесь только сборка тела POST-запроса на VIDEO_RENDERER_URL.
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
  // R2-ключи опциональны: если не переданы, локальный рендерер берёт их из своего .env.
  r2?: { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string };
}

export function buildRenderRequest(input: {
  contentId: string;
  segments: ScriptSegment[];
  cardKey: string;
  backgroundKey: string;
  musicKey: string;
  audioKey?: string;
  lang: "ru" | "en";
  r2?: ContainerRenderRequest["r2"];
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
