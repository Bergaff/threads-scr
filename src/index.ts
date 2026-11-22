/**
 * Threads Digest — Cloudflare Worker.
 *
 * Маршруты:
 *  GET  /health              — проверка живости
 *  POST /webhook/telegram    — бот-редактор (только ADMIN_IDS)
 *  *    /admin/*             — веб-админка (X-Admin-Key)
 *  GET  /media/*             — карточки/ассеты из R2 (публичный доступ по ключу)
 *
 * Cron (каждые 5 минут) → планировщик → Queue → обработчики.
 * См. docs/ARCHITECTURE.md — как ТЗ ложится на Cloudflare.
 */

import type { Env, JobMessage } from "./env.js";
import { handleEditorUpdate, type TgUpdate } from "./bot/editor.js";
import { handleAdmin } from "./admin/api.js";
import { handleCron } from "./cron.js";
import { handleJob } from "./jobs/handlers.js";

export { RendererContainer } from "./containers.js";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "threads-digest", time: new Date().toISOString() });
    }

    if (url.pathname === "/webhook/telegram" && req.method === "POST") {
      const update = (await req.json()) as TgUpdate;
      // Webhook должен отвечать быстро — тяжёлая работа уходит в Queue.
      await handleEditorUpdate(env, update);
      return Response.json({ ok: true });
    }

    if (url.pathname.startsWith("/admin/")) {
      return handleAdmin(env, req, url.pathname);
    }

    if (url.pathname.startsWith("/media/")) {
      const key = url.pathname.slice("/media/".length);
      const obj = await env.MEDIA.get(key);
      if (!obj) return new Response("not found", { status: 404 });
      return new Response(obj.body, {
        headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream" },
      });
    }

    return new Response("Threads Digest — see README", { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleCron(env, controller.scheduledTime));
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const job = msg.body as JobMessage;
      try {
        await handleJob(env, job);
        msg.ack();
      } catch (err) {
        // Повтор через Queue retry (max_retries в wrangler.toml / дашборде).
        msg.retry();
        await env.DB.prepare("INSERT INTO logs (level, message) VALUES ('error', ?)").bind(
          `Job ${job.type} failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 2000),
        ).run();
      }
    }
  },
} satisfies ExportedHandler<Env>;
