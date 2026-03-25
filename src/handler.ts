import { OneBotClient } from "./clinet";
import { LLMService } from "./llm";
import { config } from "./config";
import type { OneBotEvent } from "./type";
import {
  extractText,
  isBotMentioned,
  isReplyToBot,
  splitLongText,
  stripMarkdown,
  cleanCQCodes,
} from "./utils";

// ── 去重 Set ──────────────────────────────────────────────────────────
const processedMsgIds = new Set<string>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    if (processedMsgIds.size > 5000) processedMsgIds.clear();
  }, 3600_000);
}

// ── Session Key 生成 ──────────────────────────────────────────────────

function buildSessionKey(event: OneBotEvent): string {
  if (event.message_type === "group") {
    return `group:${event.group_id}`;
  }
  return `user:${event.user_id}`;
}

// ── 消息处理器 ────────────────────────────────────────────────────────

export class MessageHandler {
  constructor(
    private client: OneBotClient,
    private llm: LLMService,
  ) {}

  /** 处理好友/群请求 */
  handleRequest(event: OneBotEvent) {
    if (!config.autoApproveRequests) return;
    if (event.request_type === "friend" && event.flag) {
      this.client.setFriendAddRequest(event.flag, true);
      console.log(`[Bot] 自动通过好友申请: flag=${event.flag}`);
    } else if (event.request_type === "group" && event.flag) {
      this.client.setGroupAddRequest(
        event.flag,
        event.sub_type || "invite",
        true,
      );
      console.log(`[Bot] 自动通过群邀请: flag=${event.flag}`);
    }
  }

  /** 主消息处理入口 */
  async handleMessage(event: OneBotEvent) {
    if (event.post_type !== "message") return;

    const selfId = this.client.getSelfId();
    const userId = event.user_id;
    const groupId = event.group_id;
    const isGroup = event.message_type === "group";

    // ── 1. 过滤自身消息 ──
    if (selfId && userId && String(userId) === String(selfId)) return;

    // ── 2. 去重 ──
    if (config.enableDeduplication && event.message_id) {
      ensureCleanupTimer();
      const dedupKey = `${event.message_type}:${groupId ?? ""}:${userId}:${event.message_id}`;
      if (processedMsgIds.has(dedupKey)) return;
      processedMsgIds.add(dedupKey);
    }

    // ── 3. 黑名单 ──
    if (userId && config.blockedUsers.includes(userId)) return;

    // ── 4. 群白名单 ──
    if (
      isGroup &&
      config.allowedGroups.length > 0 &&
      groupId &&
      !config.allowedGroups.includes(groupId)
    )
      return;

    // ── 5. 提取文本 ──
    const text = extractText(event.message);

    // ── 6. 斜杠命令 ──
    const slashHandled = await this.handleSlashCommand(
      text,
      event,
      isGroup,
      userId!,
      groupId,
    );
    if (slashHandled) return;

    // ── 7. 触发条件检查 ──
    if (isGroup) {
      const triggered = this.checkGroupTrigger(event, selfId);
      if (!triggered) return;
    }

    // ── 8. 管理员限制 ──
    if (config.adminOnlyChat && userId && !config.admins.includes(userId)) {
      if (isGroup && groupId) {
        this.client.sendGroupMsg(groupId, [
          { type: "at", data: { qq: String(userId) } },
          {
            type: "text",
            data: { text: " 当前仅管理员可触发机器人。" },
          },
        ]);
      }
      return;
    }

    // ── 9. 调用 LLM ──
    if (!text) return;

    const sessionKey = buildSessionKey(event);
    console.log(
      `[Bot] ${isGroup ? `群${groupId}` : "私聊"} 用户${userId}: ${text.slice(0, 100)}`,
    );

    const reply = await this.llm.chat(sessionKey, text);

    // ── 10. 发送回复 ──
    await this.sendReply(reply, event, isGroup, userId!, groupId);
  }

  // ── 群触发检查 ──────────────────────────────────────────────────────

  private checkGroupTrigger(
    event: OneBotEvent,
    selfId: number | null,
  ): boolean {
    // 不需要 @：总是触发
    if (!config.requireMention) return true;

    // 检查 @bot
    if (selfId && isBotMentioned(event.message, selfId)) return true;

    // 检查关键词
    if (config.keywordTriggers.length > 0) {
      const rawText = event.raw_message || extractText(event.message);
      for (const kw of config.keywordTriggers) {
        if (rawText.includes(kw)) return true;
      }
    }

    // 检查 reply-to-bot：回复了机器人的消息也触发
    // 注意：仅当消息中包含 reply 段时有效；回复对象是否为 bot 需要额外 getMsg 查询
    // 此处简化为：有 reply 段时也触发
    if (isReplyToBot(event.message)) return true;

    return false;
  }

  // ── 斜杠命令处理 ────────────────────────────────────────────────────

  private async handleSlashCommand(
    text: string,
    event: OneBotEvent,
    isGroup: boolean,
    userId: number,
    groupId: number | undefined,
  ): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) return false;

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    const isAdmin = config.admins.includes(userId);

    const sendMsg = (msg: string) => {
      if (isGroup && groupId) {
        this.client.sendGroupMsg(groupId, msg);
      } else {
        this.client.sendPrivateMs(userId, msg);
      }
    };

    switch (cmd) {
      case "/help": {
        const helpText = `🤖 QBot 帮助
/help - 显示帮助
/status - 查看状态
/newsession - 重置当前会话
${isAdmin ? "/mute @用户 [分钟数] - 禁言\n/kick @用户 - 踢出" : ""}`;
        sendMsg(helpText);
        return true;
      }

      case "/status": {
        const selfId = this.client.getSelfId();
        const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        sendMsg(
          `🤖 QBot 状态\nSelf ID: ${selfId}\n连接: ${this.client.isConnected() ? "✅" : "❌"}\n内存: ${mem} MB`,
        );
        return true;
      }

      case "/newsession": {
        const sessionKey = buildSessionKey(event);
        const cleared = this.llm.clearSession(sessionKey);
        const notice = cleared
          ? "✅ 当前会话已重置，请继续发送你的问题。"
          : "ℹ️ 当前会话本就为空。";
        if (isGroup && groupId) {
          this.client.sendGroupMsg(groupId, [
            { type: "at", data: { qq: String(userId) } },
            { type: "text", data: { text: ` ${notice}` } },
          ]);
        } else {
          this.client.sendPrivateMs(userId, notice);
        }
        return true;
      }

      case "/mute":
      case "/ban": {
        if (!isAdmin || !isGroup || !groupId) return true;
        const targetId = this.extractAtTarget(event);
        if (targetId) {
          const duration = parts[2] ? parseInt(parts[2]) * 60 : 1800;
          this.client.setGroupBan(groupId, targetId, duration);
          sendMsg(`✅ 已禁言用户 ${targetId}。`);
        }
        return true;
      }

      case "/kick": {
        if (!isAdmin || !isGroup || !groupId) return true;
        const targetId = this.extractAtTarget(event);
        if (targetId) {
          this.client.setGroupKick(groupId, targetId);
          sendMsg(`✅ 已踢出用户 ${targetId}。`);
        }
        return true;
      }

      default:
        return false;
    }
  }

  // ── 提取 @目标 ──────────────────────────────────────────────────────

  private extractAtTarget(event: OneBotEvent): number | null {
    if (Array.isArray(event.message)) {
      for (const seg of event.message) {
        if (
          seg.type === "at" &&
          (seg as any).data?.qq &&
          String((seg as any).data.qq) !== String(this.client.getSelfId())
        ) {
          return Number((seg as any).data.qq);
        }
      }
    }
    return null;
  }

  // ── 统一回复 ────────────────────────────────────────────────────────

  private async sendReply(
    reply: string,
    event: OneBotEvent,
    isGroup: boolean,
    userId: number,
    groupId: number | undefined,
  ) {
    let processed = reply;

    // Markdown 转纯文本
    if (config.formatMarkdown) {
      processed = stripMarkdown(processed);
    }

    // 长文本分割
    const chunks = splitLongText(processed, config.maxMessageLength);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      if (isGroup && groupId) {
        if (i === 0) {
          // 首条带 @发送者
          this.client.sendGroupMsg(groupId, [
            { type: "at", data: { qq: String(userId) } },
            { type: "text", data: { text: " " + chunk } },
          ]);
        } else {
          this.client.sendGroupMsg(groupId, chunk);
        }
      } else {
        this.client.sendPrivateMs(userId, chunk);
      }

      // 多段之间间隔
      if (chunks.length > 1 && i < chunks.length - 1) {
        await sleep(1000);
      }
    }

    console.log(
      `[Bot] 回复 ${isGroup ? `群${groupId}` : `用户${userId}`}: ${reply.slice(0, 80)}...`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
