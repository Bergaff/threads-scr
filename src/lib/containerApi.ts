/**
 * Чистые конструкторы запросов к контейнеру — вынесены для тестов.
 * Сам вызов контейнера — в src/jobs/handlers.ts и src/collector/client.ts.
 */

import type { CollectorAccount } from "../collector/client.js";
import { cookiesToHeader } from "../collector/client.js";
import type { ScriptSegment } from "../shorts/script.js";

export interface ContainerFetchRequest {
  url: string;
  headers: Record<string, string>;
  proxyUrl?: string;
  timeoutMs: number;
}

export function buildContainerFetchRequest(account: CollectorAccount, url: string, proxyUrl?: string): ContainerFetchRequest {
  return {
    url,
    headers: {
      Cookie: cookiesToHeader(account.cookies),
      "User-Agent": account.userAgent,
      "Accept-Language": account.locale,
      Accept: "application/json, text/html;q=0.9, */*;q=0.8",
      "X-IG-App-ID": "238260118697367",
      "X-Account-Id": account.id,
    },
    proxyUrl: proxyUrl || undefined,
    timeoutMs: 20_000,
  };
}

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

export interface ContainerFetchResponse {
  status: number;
  body: string;
}

export function parseContainerFetchResponse(data: unknown): ContainerFetchResponse {
  const obj = (data ?? {}) as { status?: number; body?: string };
  return { status: Number(obj.status ?? 0), body: String(obj.body ?? "") };
}
