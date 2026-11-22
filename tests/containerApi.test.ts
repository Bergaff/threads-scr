import { describe, it, expect } from "vitest";
import { buildRenderRequest } from "../src/lib/containerApi.js";
import { buildScript } from "../src/shorts/script.js";

describe("container API (RENDERER-контейнер)", () => {
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
});
