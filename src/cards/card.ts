/**
 * Карточка поста PNG — раздел 6.2 ТЗ.
 * Собственная отрисовка из данных (не скриншот Threads).
 *
 * Cloudflare: Workers не умеют Playwright/satori. Поэтому карточка генерируется
 * как SVG (1080×1350), а в PNG конвертируется внешним сервисом:
 *  - Cloudflare Browser Rendering API (screenshot), или
 *  - resvg/sharp на отдельном контейнере, который Worker дёргает по webhook.
 * SVG — источник правды: его можно показать в боте-редакторе напрямую.
 */

import { escapeXml, truncate, formatCount } from "../lib/text.js";

export interface CardInput {
  authorName: string;
  username: string;
  avatarUrl?: string;
  isVerified?: boolean;
  text: string;
  likes: number;
  replies: number;
  reposts: number;
  dateLabel: string;
  anonymized?: boolean;
  theme?: "dark" | "light";
  siteLabel?: string;
  maxTextChars?: number;
}

const THEMES = {
  dark: { bg: "#0f0f12", card: "#1a1a1f", text: "#f5f5f7", sub: "#9a9aa3", accent: "#4c8dff", border: "#2a2a32" },
  light: { bg: "#f2f2f5", card: "#ffffff", text: "#111114", sub: "#6b6b73", accent: "#2563eb", border: "#e2e2e8" },
} as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

/** Разбить текст на строки по ширине ~52 символа (грубая эвристика для SVG). */
export function wrapText(text: string, maxCharsPerLine = 52, maxLines = 10): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if ((current + " " + w).trim().length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
      if (lines.length >= maxLines) break;
    } else {
      current = (current + " " + w).trim();
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

export function renderCardSvg(input: CardInput): string {
  const theme = THEMES[input.theme ?? "dark"];
  const maxChars = input.maxTextChars ?? 500;
  const displayName = input.anonymized ? "Пользователь Threads" : input.authorName;
  const displayNick = input.anonymized ? "" : `@${input.username}`;
  const body = truncate(input.text, maxChars);
  const lines = wrapText(body);
  const lineHeight = 44;
  const textStartY = 300;

  const avatar = input.anonymized || !input.avatarUrl
    ? `<circle cx="110" cy="150" r="52" fill="${theme.accent}"/><text x="110" y="168" font-size="40" fill="#fff" text-anchor="middle" font-family="Inter, sans-serif" font-weight="700">${escapeXml(initials(displayName))}</text>`
    : `<clipPath id="av"><circle cx="110" cy="150" r="52"/></clipPath><image href="${escapeXml(input.avatarUrl)}" x="58" y="98" width="104" height="104" clip-path="url(#av)"/>`;

  const verified = input.isVerified && !input.anonymized
    ? `<g transform="translate(470,128)"><circle r="14" fill="${theme.accent}"/><text y="6" font-size="16" fill="#fff" text-anchor="middle">✓</text></g>`
    : "";

  const textLines = lines
    .map((l, i) => `<text x="80" y="${textStartY + i * lineHeight}" font-size="36" fill="${theme.text}" font-family="Inter, sans-serif">${escapeXml(l)}</text>`)
    .join("\n");

  const countersY = 1080;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
<rect width="1080" height="1350" fill="${theme.bg}"/>
<rect x="40" y="40" width="1000" height="1270" rx="36" fill="${theme.card}" stroke="${theme.border}" stroke-width="2"/>
${avatar}
<text x="190" y="140" font-size="38" fill="${theme.text}" font-family="Inter, sans-serif" font-weight="700">${escapeXml(displayName)}</text>
${verified}
<text x="190" y="185" font-size="30" fill="${theme.sub}" font-family="Inter, sans-serif">${escapeXml(displayNick)}</text>
<text x="190" y="225" font-size="26" fill="${theme.sub}" font-family="Inter, sans-serif">${escapeXml(input.dateLabel)}</text>
${textLines}
<g font-size="32" fill="${theme.sub}" font-family="Inter, sans-serif">
<text x="80" y="${countersY}">♥ ${formatCount(input.likes)}</text>
<text x="300" y="${countersY}">💬 ${formatCount(input.replies)}</text>
<text x="520" y="${countersY}">🔁 ${formatCount(input.reposts)}</text>
</g>
<line x1="80" y1="1150" x2="1000" y2="1150" stroke="${theme.border}" stroke-width="2"/>
<text x="80" y="1210" font-size="28" fill="${theme.sub}" font-family="Inter, sans-serif">Threads Digest</text>
<text x="1000" y="1210" font-size="28" fill="${theme.accent}" font-family="Inter, sans-serif" text-anchor="end">${escapeXml(input.siteLabel ?? "threadsviewer.online")}</text>
</svg>`;
}
