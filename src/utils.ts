import type { OneBotMessageSegment } from "./type";

// ── 提取纯文本 ───────────────────────────────────────────────────────

/** 从 OneBot 消息段中提取纯文本（跳过 at/reply 等特殊段） */
export function extractText(
  message: string | OneBotMessageSegment[] | undefined,
): string {
  if (!message) return "";
  if (typeof message === "string") return cleanCQCodes(message);
  return message
    .filter((seg) => seg.type === "text")
    .map((seg) => (seg as any).data?.text || "")
    .join("")
    .trim();
}

// ── CQ 码清理 ────────────────────────────────────────────────────────

export function cleanCQCodes(text: string | undefined): string {
  if (!text) return "";
  let result = text;
  result = result.replace(/\[CQ:face,id=(\d+)\]/g, "[表情]");
  result = result.replace(/\[CQ:image[^\]]*\]/g, "[图片]");
  result = result.replace(/\[CQ:record[^\]]*\]/g, "[语音]");
  result = result.replace(/\[CQ:video[^\]]*\]/g, "[视频]");
  result = result.replace(/\[CQ:at,qq=(\d+)[^\]]*\]/g, "@$1");
  result = result.replace(/\[CQ:reply,id=[^\]]*\]/g, "");
  result = result.replace(/\[CQ:[^\]]+\]/g, "");
  return result.replace(/\s+/g, " ").trim();
}

// ── @检测 ─────────────────────────────────────────────────────────────

/** 判断消息中是否 @了指定 botId */
export function isBotMentioned(
  message: string | OneBotMessageSegment[] | undefined,
  botId: number,
): boolean {
  if (!message) return false;
  if (Array.isArray(message)) {
    return message.some(
      (seg) =>
        seg.type === "at" &&
        (String((seg as any).data?.qq) === String(botId) ||
          (seg as any).data?.qq === "all"),
    );
  }
  return typeof message === "string" && message.includes(`[CQ:at,qq=${botId}]`);
}

/** 判断消息是否是回复机器人的消息 */
export function isReplyToBot(
  message: string | OneBotMessageSegment[] | undefined,
): string | null {
  if (!message) return null;
  if (Array.isArray(message)) {
    for (const seg of message) {
      if (seg.type === "reply") {
        const id = (seg as any).data?.id;
        if (id !== undefined && id !== null) return String(id);
      }
    }
  }
  if (typeof message === "string") {
    const match = message.match(/\[CQ:reply,id=(\d+)\]/);
    if (match) return match[1];
  }
  return null;
}

// ── 图片 URL 提取 ────────────────────────────────────────────────────

export function extractImageUrls(
  message: string | OneBotMessageSegment[] | undefined,
  maxImages = 3,
): string[] {
  const urls: string[] = [];
  if (Array.isArray(message)) {
    for (const seg of message) {
      if (seg.type === "image") {
        const url =
          (seg as any).data?.url ||
          (typeof (seg as any).data?.file === "string" &&
          ((seg as any).data.file.startsWith("http") ||
            (seg as any).data.file.startsWith("base64://"))
            ? (seg as any).data.file
            : undefined);
        if (url) {
          urls.push(url);
          if (urls.length >= maxImages) break;
        }
      }
    }
  }
  return urls;
}

// ── 长文本智能分割 ────────────────────────────────────────────────────

export function splitLongText(input: string, maxLength = 2800): string[] {
  const text = (input || "").trim();
  if (!text) return [];
  const safeMax =
    Number.isFinite(maxLength) && maxLength > 0 ? Math.floor(maxLength) : 2800;
  if (text.length <= safeMax) return [text];

  const chunks: string[] = [];
  let rest = text;

  while (rest.length > safeMax) {
    let cut = safeMax;

    // 优先换行符截断
    const lastNewline = rest.lastIndexOf("\n", safeMax);
    if (lastNewline > Math.floor(safeMax * 0.5)) {
      cut = lastNewline;
    } else {
      // 句号/问号/感叹号等截断
      const sentencePattern = /[。！？；…\n!?;]/g;
      let bestCut = -1;
      let match;
      while (
        (match = sentencePattern.exec(rest.slice(0, safeMax + 50))) !== null
      ) {
        if (match.index > safeMax) break;
        if (match.index > Math.floor(safeMax * 0.5)) {
          bestCut = match.index + 1;
        }
      }
      if (bestCut > 0) {
        cut = bestCut;
      } else {
        const lastSpace = rest.lastIndexOf(" ", safeMax);
        if (lastSpace > Math.floor(safeMax * 0.7)) {
          cut = lastSpace;
        }
      }
    }

    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
  }

  if (rest.trim()) chunks.push(rest.trim());

  // 合并过短的尾块
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    const prev = chunks[chunks.length - 2];
    if (last.length < 20 && prev.length + last.length + 1 <= safeMax) {
      chunks[chunks.length - 2] = `${prev} ${last}`;
      chunks.pop();
    }
  }

  return chunks;
}

// ── Markdown 转纯文本 ─────────────────────────────────────────────────

export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/#+\s+(.*)/g, "$1")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/^\s*>\s+(.*)/gm, "▎$1")
    .replace(/```[\s\S]*?```/g, "[代码块]")
    .replace(/^[-*]\s+/gm, "• ");
}
