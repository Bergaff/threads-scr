import { describe, it, expect } from "vitest";
import { parseThreadsPayload, parseRepliesPayload } from "../src/collector/threads.js";

const feedPayload = {
  data: {
    xdt_api__v1__feed__timeline__connection: {
      edges: [
        {
          node: {
            thread_items: [
              {
                post: {
                  code: "ABC123",
                  taken_at: 1763800000,
                  like_count: 500,
                  direct_reply_count: 42,
                  repost_count: 10,
                  quote_count: 3,
                  user: { username: "alice", full_name: "Alice", follower_count: 12000, is_verified: true, profile_pic_url: "https://example.com/a.jpg" },
                  caption: { text: "Вопрос дня: что вы делаете, когда нет мотивации?" },
                },
              },
            ],
          },
        },
        {
          node: {
            thread_items: [
              {
                post: {
                  code: "DEF456",
                  taken_at: 1763801000,
                  like_count: 50,
                  direct_reply_count: 5,
                  repost_count: 1,
                  quote_count: 0,
                  user: { username: "bob", full_name: "Bob", follower_count: 800 },
                  caption: { text: "Короткий пост" },
                  image_versions2: { candidates: [{ url: "https://example.com/p.jpg" }] },
                },
              },
            ],
          },
        },
      ],
    },
  },
};

describe("parser Threads JSON (раздел 4.3 ТЗ)", () => {
  it("разбирает ленту «Для вас»", () => {
    const posts = parseThreadsPayload(feedPayload);
    expect(posts).toHaveLength(2);
    expect(posts[0].code).toBe("ABC123");
    expect(posts[0].authorUsername).toBe("alice");
    expect(posts[0].likes).toBe(500);
    expect(posts[0].replies).toBe(42);
    expect(posts[0].url).toContain("/@alice/post/ABC123");
    expect(posts[1].mediaType).toBe("photo");
  });

  it("дедуплицирует по code", () => {
    const dup = { a: feedPayload.data, b: feedPayload.data };
    expect(parseThreadsPayload(dup)).toHaveLength(2);
  });

  it("parseRepliesPayload сортирует по лайкам и ограничивает 10–30", () => {
    const replies = parseRepliesPayload(feedPayload, 30);
    expect(replies[0].likes).toBeGreaterThanOrEqual(replies[replies.length - 1].likes);
    expect(replies.length).toBeLessThanOrEqual(30);
  });

  it("пустой payload даёт пустой список", () => {
    expect(parseThreadsPayload({})).toEqual([]);
    expect(parseThreadsPayload(null)).toEqual([]);
  });
});
