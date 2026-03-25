import type OpenAI from "openai";

/**
 * 插件工具定义 —— 遵循 OpenAI Function Calling 格式
 */
export interface PluginTool {
  /** 工具名称（唯一标识） */
  name: string;
  /** 工具描述（给 LLM 看的） */
  description: string;
  /** JSON Schema 参数定义 */
  parameters: Record<string, any>;
  /** 执行函数 */
  execute: (args: Record<string, any>) => Promise<string>;
}

/**
 * 插件接口
 */
export interface Plugin {
  /** 插件名称 */
  name: string;
  /** 插件描述 */
  description: string;
  /** 该插件提供的工具列表 */
  tools: PluginTool[];
}

/**
 * 插件管理器
 */
export class PluginManager {
  private plugins: Plugin[] = [];
  private toolMap = new Map<string, PluginTool>();

  /** 注册插件 */
  register(plugin: Plugin) {
    this.plugins.push(plugin);
    for (const tool of plugin.tools) {
      this.toolMap.set(tool.name, tool);
      console.log(`[Plugin] ✅ 注册工具: ${tool.name} (${plugin.name})`);
    }
  }

  /** 获取所有工具定义（给 OpenAI API 用） */
  getToolDefinitions(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return Array.from(this.toolMap.values()).map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  /** 执行工具调用 */
  async executeTool(
    name: string,
    args: Record<string, any>,
  ): Promise<string> {
    const tool = this.toolMap.get(name);
    if (!tool) return `错误：未找到工具 "${name}"`;
    try {
      console.log(`[Plugin] 🔧 调用工具: ${name}`, JSON.stringify(args).slice(0, 200));
      const result = await tool.execute(args);
      console.log(`[Plugin] ✅ 工具 ${name} 返回 ${result.length} 字`);
      return result;
    } catch (err: any) {
      console.error(`[Plugin] ❌ 工具 ${name} 执行失败:`, err?.message || err);
      return `工具调用失败: ${err?.message || "未知错误"}`;
    }
  }

  /** 是否有注册的工具 */
  hasTools(): boolean {
    return this.toolMap.size > 0;
  }
}
