/**
 * HTTP-клиент сборщика — раздел 4.1 ТЗ.
 *
 * Cloudflare-ограничение: Workers fetch не поддерживает per-request proxy.
 * Поэтому аккаунт→IP привязка делается через PROXY_GATEWAY_URL — HTTP-шлюз,
 * который принимает запрос + заголовок X-Account-Id и ходит в сеть с нужного
 * IP (мобильный/резидентный прокси). См. docs/ARCHITECTURE.md.
 * Если шлюз не задан — запросы идут напрямую (для локальной разработки).
 */

export interface CollectorAccount {
  id: string;
  label: string;
  lang: "ru" | "en";
  cookies: Record<string, string>;
  userAgent: string;
  locale: string;
  timezone: string;
  /** Per-account прокси (http://user:pass@host:port). Привязка аккаунт↔IP навсегда. */
  proxy?: string;
}

export class CollectorError extends Error {
  kind: "auth" | "checkpoint" | "rate_limit" | "network" | "unknown";
  constructor(kind: CollectorError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

export function cookiesToHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/** Пауза аккаунта при ошибках: 15 минут → 1 час → 6 часов (раздел 4.8). */
export function backoffMinutes(level: number): number {
  const steps = [15, 60, 360];
  return steps[Math.min(level, steps.length - 1)];
}

export function classifyError(status: number, body: string): CollectorError["kind"] {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (/checkpoint|login_required|challenge/i.test(body)) return "checkpoint";
  if (status >= 500) return "network";
  return "unknown";
}

export interface FetchOptions {
  gatewayUrl?: string;
  /** Cloudflare Container (PROXY): fetch через per-account прокси внутри контейнера. */
  viaContainer?: (url: string, headers: Record<string, string>, proxyUrl?: string) => Promise<{ status: number; body: string }>;
  proxyUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function collectorFetch(
  account: CollectorAccount,
  url: string,
  opts: FetchOptions = {},
): Promise<{ status: number; body: string; json: unknown | null }> {
  const headers: Record<string, string> = {
    Cookie: cookiesToHeader(account.cookies),
    "User-Agent": account.userAgent,
    "Accept-Language": account.locale,
    Accept: "application/json, text/html;q=0.9, */*;q=0.8",
    "X-IG-App-ID": "238260118697367",
    "X-Account-Id": account.id,
  };

  // Путь 1: контейнер-шлюз (рекомендуется) — прокси per-account внутри контейнера.
  if (opts.viaContainer) {
    const { status, body } = await opts.viaContainer(url, headers, opts.proxyUrl);
    let json: unknown = null;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    if (status === 401 || status === 403 || status === 429) {
      throw new CollectorError(classifyError(status, body), `HTTP ${status} for ${account.label}`);
    }
    if (/checkpoint|login_required/i.test(body.slice(0, 2000))) {
      throw new CollectorError("checkpoint", `Checkpoint for ${account.label}`);
    }
    return { status, body, json };
  }

  // Путь 2: внешний HTTP-шлюз (PROXY_GATEWAY_URL).
  const target = opts.gatewayUrl
    ? `${opts.gatewayUrl.replace(/\/$/, "")}/fetch?url=${encodeURIComponent(url)}`
    : url;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(target, { headers, signal: opts.signal ?? controller.signal });
    const body = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      throw new CollectorError(classifyError(res.status, body), `HTTP ${res.status} for ${account.label}`);
    }
    if (/checkpoint|login_required/i.test(body.slice(0, 2000))) {
      throw new CollectorError("checkpoint", `Checkpoint for ${account.label}`);
    }
    return { status: res.status, body, json };
  } catch (err) {
    if (err instanceof CollectorError) throw err;
    throw new CollectorError("network", err instanceof Error ? err.message : "network error");
  } finally {
    clearTimeout(timer);
  }
}

/** «Человеческая» пауза при прокрутке: 1–4 с (раздел 4.1). В Workers не спим —
 * возвращаем задержку, вызывающий код решает (Queue delay / cron). */
export function humanScrollPauseMs(random = Math.random): number {
  return 1000 + Math.floor(random() * 3000);
}
