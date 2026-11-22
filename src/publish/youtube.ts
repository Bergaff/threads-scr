/**
 * Публикация в YouTube — раздел 7.7 ТЗ.
 *
 * Ограничения (важно!):
 *  - YouTube Data API v3: 10 000 единиц/сутки, одна загрузка = 1 600 единиц → ~6 загрузок/сутки на проект.
 *  - Новые проекты без аудита Google: все ролики закрыты (private).
 *  Поэтому до аудита: загрузка private + ручное открытие заказчиком,
 *  или ручная загрузка готового файла из бота-редактора (кнопка ⬇️ Скачать).
 *  Параллельно подаётся заявка на аудит API-проекта.
 */

export interface YoutubeMeta {
  title: string; // до 70 символов
  description: string;
  hashtags: string[];
  privacyStatus: "private" | "unlisted" | "public";
}

export function buildYoutubeMeta(input: {
  title: string;
  description: string;
  hashtags: string[];
  lang: "ru" | "en";
  auditPassed: boolean;
}): YoutubeMeta {
  const tags = [...new Set([...input.hashtags, "shorts"])].slice(0, 5);
  const footer =
    input.lang === "ru"
      ? "\n\nЧитай Threads без VPN: threadsviewer.online\nБот: @threadsreaderbot"
      : "\n\nRead Threads without VPN: threadsviewer.online\nBot: @threadsreaderbot";
  return {
    title: input.title.slice(0, 70),
    description: (input.description + footer + "\n\n" + tags.map((t) => `#${t}`).join(" ")).slice(0, 5000),
    hashtags: tags,
    privacyStatus: input.auditPassed ? "public" : "private",
  };
}

export async function uploadToYoutube(input: {
  accessToken: string;
  video: ArrayBuffer;
  meta: YoutubeMeta;
  categoryId?: string;
}): Promise<{ videoId: string }> {
  const metadata = {
    snippet: {
      title: input.meta.title,
      description: input.meta.description,
      categoryId: input.categoryId ?? "22", // People & Blogs
    },
    status: { privacyStatus: input.meta.privacyStatus, selfDeclaredMadeForKids: false },
  };
  const boundary = `----digest${Date.now()}`;
  const body = new Blob([
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
    new Blob([input.video], { type: "video/mp4" }),
  ]);
  void boundary;
  const res = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "multipart/related; boundary=----digest" },
      body,
    },
  );
  if (!res.ok) throw new Error(`YouTube upload HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("YouTube upload: no video id");
  return { videoId: json.id };
}
