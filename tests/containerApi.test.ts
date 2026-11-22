import { describe, it, expect } from "vitest";
import { buildContainerFetchRequest, buildRenderRequest, parseContainerFetchResponse } from "../src/lib/containerApi.js";
import { buildScript } from "../src/shorts/script.js";

describe("container API (прокси-шлюз + рендерер)", () => {
  it("buildContainerFetchRequest: cookies, UA и per-account прокси", () => {
    const req = buildContainerFetchRequest(
      { id: "acc1", label: "ru-1", lang: "ru", cookies: { sessionid: "abc" }, userAgent: "UA", locale: "ru-RU", timezone: "Europe/Moscow" },
      "https://www.threads.net/",
      "http://user:pass@proxy:8080",
    );
    expect(req.url).toBe("https://www.threads.net/");
    expect(req.headers.Cookie).toBe("sessionid=abc");
    expect(req.headers["X-Account-Id"]).toBe("acc1");
    expect(req.proxyUrl).toBe("http://user:pass@proxy:8080");
  });

  it("buildRenderRequest: сегменты и R2-ключи", () => {
    const script = buildScript({ hook: "Крючок", postText: "Текст поста", replies: [], outro: "Финал" });
    const req = buildRenderRequest({
      contentId: "ci1",
      segments: script.segments,
      cardKey: "cards/ci1.svg",
      backgroundKey: "assets/backgrounds/bg-0.mp4",
      musicKey: "assets/music/track-0.mp3",
      lang: "ru",
      r2: { accountId: "acc", bucket: "b", accessKeyId: "k", secretAccessKey: "s" },
    });
    expect(req.contentId).toBe("ci1");
    expect(req.segments[0].type).toBe("hook");
    expect(req.cardKey).toBe("cards/ci1.svg");
    expect(req.r2.bucket).toBe("b");
  });

  it("parseContainerFetchResponse: status и body", () => {
    expect(parseContainerFetchResponse({ status: 200, body: "{}" })).toEqual({ status: 200, body: "{}" });
    expect(parseContainerFetchResponse(null)).toEqual({ status: 0, body: "" });
  });
});
