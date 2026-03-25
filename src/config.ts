import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
dotenv.config();

// ── 加载 soul.md 人设文件 ─────────────────────────────────────────────

function loadSoulPrompt(): string {
  const soulPath = path.resolve(process.cwd(), "soul.md");
  try {
    const content = fs.readFileSync(soulPath, "utf-8").trim();
    if (content) {
      console.log(`[Config] ✅ 已加载人设文件: ${soulPath} (${content.length} 字)`);
      return content;
    }
  } catch {
    // soul.md 不存在，使用 .env 中的 SYSTEM_PROMPT
  }
  return (
    process.env.SYSTEM_PROMPT ||
    "你是一个基于QQ聊天的AI助手。你会用自然、友好的语气和用户交流。请使用简短、活泼的风格回答。"
  );
}

function parseIdList(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
}

function parseKeywords(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  // ── OneBot 连接 ──
  wsUrl: process.env.WS_URL || "ws://127.0.0.1:3001",
  accessToken: process.env.ACCESS_TOKEN || "",

  // ── LLM ──
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  systemPrompt: loadSoulPrompt(),

  // ── 触发与权限 ──
  requireMention: process.env.REQUIRE_MENTION !== "false", // 群聊默认需要@才触发
  admins: parseIdList(process.env.ADMINS),
  allowedGroups: parseIdList(process.env.ALLOWED_GROUPS),
  blockedUsers: parseIdList(process.env.BLOCKED_USERS),
  adminOnlyChat: process.env.ADMIN_ONLY_CHAT === "true",
  keywordTriggers: parseKeywords(process.env.KEYWORD_TRIGGERS),
  autoApproveRequests: process.env.AUTO_APPROVE_REQUESTS === "true",

  // ── 消息处理 ──
  maxMessageLength: Number(process.env.MAX_MESSAGE_LENGTH) || 4000,
  maxHistoryTurns: Number(process.env.MAX_HISTORY_TURNS) || 20,
  enableDeduplication: process.env.ENABLE_DEDUPLICATION !== "false",
  formatMarkdown: process.env.FORMAT_MARKDOWN === "true",
} as const;

export type BotConfig = typeof config;
