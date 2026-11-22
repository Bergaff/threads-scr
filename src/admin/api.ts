/**
 * Веб-админка (минимум) — раздел 12 ТЗ.
 * Защита: заголовок X-Admin-Key == ADMIN_API_KEY. Пароль + лимит попыток —
 * на уровне Cloudflare Access / Rate Limiting (см. docs/ARCHITECTURE.md).
 */

import type { Env } from "../env.js";

function authorized(env: Env, req: Request): boolean {
  const key = req.headers.get("X-Admin-Key");
  return Boolean(env.ADMIN_API_KEY) && key === env.ADMIN_API_KEY;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function handleAdmin(env: Env, req: Request, path: string): Promise<Response> {
  if (!authorized(env, req)) return json({ error: "unauthorized" }, 401);

  if (path === "/admin/accounts" && req.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id, label, lang, status, pause_until, last_error, last_ok_at, pages_today FROM accounts",
    ).all();
    return json(rows.results);
  }

  if (path === "/admin/accounts" && req.method === "POST") {
    const body = (await req.json()) as Record<string, unknown>;
    const id = `acc_${Date.now()}`;
    await env.DB.prepare(
      `INSERT INTO accounts (id, label, lang, cookies_enc, proxy, user_agent, locale, timezone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, String(body.label ?? id), String(body.lang ?? "ru"),
      JSON.stringify(body.cookies ?? {}), String(body.proxy ?? ""),
      String(body.user_agent ?? "Mozilla/5.0"), String(body.locale ?? "ru-RU"),
      String(body.timezone ?? "Europe/Moscow"),
    ).run();
    return json({ id }, 201);
  }

  if (path === "/admin/authors" && req.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT username, followers, lang, in_seed, in_stoplist, is_hot FROM authors ORDER BY followers DESC LIMIT 500",
    ).all();
    return json(rows.results);
  }

  if (path === "/admin/top" && req.method === "GET") {
    const url = new URL(req.url);
    const lang = url.searchParams.get("lang") === "en" ? "en" : "ru";
    const rows = await env.DB.prepare(
      `SELECT c.score, c.status, p.code, p.author_username, substr(p.text,1,120) AS snippet
       FROM candidates c JOIN posts p ON p.code = c.post_code
       WHERE c.lang = ? ORDER BY c.score DESC LIMIT 50`,
    ).bind(lang).all();
    return json(rows.results);
  }

  if (path === "/admin/config" && req.method === "GET") {
    const rows = await env.DB.prepare("SELECT key, value FROM app_config").all();
    return json(rows.results);
  }

  return json({ error: "not found" }, 404);
}
