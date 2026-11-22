/**
 * Нейросеть — раздел 5 ТЗ.
 * Провайдер меняется в конфиге: Workers AI (по умолчанию на Cloudflare),
 * OpenAI-совместимый API (OpenAI, DeepSeek, YandexGPT-совместимые шлюзы и т.п.),
 * mock (тесты/разработка без ключей).
 * Все промпты лежат в prompts/*.md, а не в коде.
 */

import type { Env } from "../env.js";

export type AiTask = "safety" | "translate" | "tg_post" | "shorts_script" | "youtube_meta";

export interface LlmResult {
  text: string;
  model: string;
  promptVersion: string;
}

export interface LlmProvider {
  name: string;
  complete(task: AiTask, systemPrompt: string, userInput: string): Promise<LlmResult>;
}

export const PROMPT_VERSION = "v1";

export class MockProvider implements LlmProvider {
  name = "mock";
  async complete(task: AiTask, _system: string, input: string): Promise<LlmResult> {
    const snippet = input.slice(0, 200);
    const texts: Record<AiTask, string> = {
      safety: JSON.stringify({ safe: true, reason: "mock" }),
      translate: snippet,
      tg_post: JSON.stringify({ headline: "Mock headline", recap: snippet, replies: [] }),
      shorts_script: JSON.stringify({ segments: [{ type: "post", text: snippet }] }),
      youtube_meta: JSON.stringify({ title: "Mock title", description: snippet, hashtags: ["shorts"] }),
    };
    return { text: texts[task], model: "mock", promptVersion: PROMPT_VERSION };
  }
}

export class WorkersAiProvider implements LlmProvider {
  name = "workers-ai";
  constructor(private ai: Ai, private model: string) {}
  async complete(task: AiTask, system: string, input: string): Promise<LlmResult> {
    const res = (await this.ai.run(this.model as never, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
    })) as { response?: string };
    return { text: res.response ?? "", model: this.model, promptVersion: PROMPT_VERSION };
  }
}

export class OpenAiCompatibleProvider implements LlmProvider {
  name = "openai-compatible";
  constructor(private apiKey: string, private baseUrl: string, private model: string) {}
  async complete(_task: AiTask, system: string, input: string): Promise<LlmResult> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: input },
        ],
        temperature: 0.7,
      }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return {
      text: json.choices?.[0]?.message?.content ?? "",
      model: this.model,
      promptVersion: PROMPT_VERSION,
    };
  }
}

export function createProvider(env: Env): LlmProvider {
  const kind = (env.LLM_PROVIDER ?? "workers-ai").toLowerCase();
  if (kind === "mock") return new MockProvider();
  if (kind === "openai-compatible" && env.OPENAI_API_KEY) {
    return new OpenAiCompatibleProvider(env.OPENAI_API_KEY, env.OPENAI_BASE_URL ?? "https://api.openai.com/v1", env.LLM_MODEL);
  }
  return new WorkersAiProvider(env.AI, env.LLM_MODEL || "@cf/meta/llama-3.1-8b-instruct");
}

/** Безопасный разбор JSON от нейросети (может вернуть markdown-обёртку). */
export function parseJsonOutput<T>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
