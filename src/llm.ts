import OpenAI from "openai";
import { config } from "./config";
import type { PluginManager } from "./plugins/base";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
}

/**
 * LLM 服务 —— 支持多会话上下文记忆 + 插件工具调用
 */
export class LLMService {
  private openai: OpenAI;
  private model: string;
  private systemPrompt: string;
  private maxHistory: number;
  private pluginManager: PluginManager | null = null;

  /** sessionId → 最近 N 轮对话 */
  private histories = new Map<string, ChatMessage[]>();

  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
    });
    this.model = config.openaiModel;
    this.systemPrompt = config.systemPrompt;
    this.maxHistory = config.maxHistoryTurns;
  }

  /** 注入插件管理器 */
  setPluginManager(pm: PluginManager) {
    this.pluginManager = pm;
  }

  /** 生成回复并维护上下文，支持工具调用 */
  async chat(sessionId: string, userMessage: string): Promise<string> {
    const history = this.getHistory(sessionId);

    const messages: any[] = [
      { role: "system", content: this.systemPrompt },
      ...history,
      { role: "user", content: userMessage },
    ];

    try {
      // 构建请求参数
      const requestParams: any = {
        model: this.model,
        messages,
      };

      // 如果有插件工具，加入 tools 参数
      const hasTools =
        this.pluginManager && this.pluginManager.hasTools();
      if (hasTools) {
        requestParams.tools = this.pluginManager!.getToolDefinitions();
        requestParams.tool_choice = "auto";
      }

      let completion = await this.openai.chat.completions.create(requestParams);
      let assistantMessage = completion.choices[0]?.message;

      // ── 工具调用循环（最多 3 轮） ──
      let toolRound = 0;
      while (
        assistantMessage?.tool_calls &&
        assistantMessage.tool_calls.length > 0 &&
        toolRound < 3
      ) {
        toolRound++;

        // 把 assistant 的 tool_calls 消息加入上下文
        messages.push(assistantMessage);

        // 执行每个工具调用
        for (const toolCall of assistantMessage.tool_calls) {
          const tc = toolCall as any;
          const funcName = tc.function?.name;
          if (!funcName) continue;
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(tc.function?.arguments || "{}");
          } catch {
            args = {};
          }

          const result = await this.pluginManager!.executeTool(
            funcName,
            args,
          );

          // 把工具结果加入上下文
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          });
        }

        // 带着工具结果重新请求 LLM
        completion = await this.openai.chat.completions.create({
          model: this.model,
          messages,
        });
        assistantMessage = completion.choices[0]?.message;
      }

      const reply =
        assistantMessage?.content?.trim() ||
        "抱歉，我不知道该怎么回答。";

      // 保存到历史（简化版，只保存 user+assistant 文本）
      history.push({ role: "user", content: userMessage });
      history.push({ role: "assistant", content: reply });

      // 裁剪历史
      const maxItems = this.maxHistory * 2;
      if (history.length > maxItems) {
        history.splice(0, history.length - maxItems);
      }

      return reply;
    } catch (error: any) {
      console.error("[LLM] Error:", error?.message || error);
      return "⚠️ AI 服务暂时不可用，请稍后再试。";
    }
  }

  /** 清除指定会话的对话历史 */
  clearSession(sessionId: string): boolean {
    return this.histories.delete(sessionId);
  }

  /** 获取/创建会话历史 */
  private getHistory(sessionId: string): ChatMessage[] {
    let h = this.histories.get(sessionId);
    if (!h) {
      h = [];
      this.histories.set(sessionId, h);
    }
    return h;
  }
}
