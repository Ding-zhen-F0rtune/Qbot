import type { Plugin } from "./base";

/**
 * 🔍 网络搜索插件
 *
 * 支持多种搜索后端：
 * - Bing Search API（需要 Azure Key）
 * - Google Custom Search（需要 API Key + CX）
 * - Tavily Search（推荐，注册即可免费用）
 *
 * 在 .env 中配置搜索 API
 */

// ── Bing Search ──────────────────────────────────────────────────────

async function bingSearch(query: string, count = 5): Promise<string> {
  const apiKey = process.env.BING_API_KEY;
  if (!apiKey) return "未配置 Bing Search API Key";

  const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=${count}&mkt=zh-CN`;
  const resp = await fetch(url, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
  });

  if (!resp.ok) return `Bing 搜索失败: HTTP ${resp.status}`;

  const data = (await resp.json()) as any;
  const results = data?.webPages?.value || [];

  if (results.length === 0) return "未找到相关结果";

  return results
    .slice(0, count)
    .map(
      (r: any, i: number) =>
        `${i + 1}. **${r.name}**\n   ${r.snippet}\n   ${r.url}`,
    )
    .join("\n\n");
}

// ── Google Custom Search ─────────────────────────────────────────────

async function googleSearch(query: string, count = 5): Promise<string> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  if (!apiKey || !cx) return "未配置 Google Search API Key 或 CX";

  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=${count}`;
  const resp = await fetch(url);

  if (!resp.ok) return `Google 搜索失败: HTTP ${resp.status}`;

  const data = (await resp.json()) as any;
  const results = data?.items || [];

  if (results.length === 0) return "未找到相关结果";

  return results
    .slice(0, count)
    .map(
      (r: any, i: number) =>
        `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.link}`,
    )
    .join("\n\n");
}

// ── Tavily Search（推荐，免费注册）──────────────────────────────────

async function tavilySearch(query: string, count = 5): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return "未配置 Tavily API Key";

  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: count,
      include_answer: true,
      search_depth: "basic",
    }),
  });

  if (!resp.ok) return `Tavily 搜索失败: HTTP ${resp.status}`;

  const data = (await resp.json()) as any;

  let output = "";
  if (data.answer) {
    output += `**摘要**: ${data.answer}\n\n`;
  }

  const results = data?.results || [];
  if (results.length > 0) {
    output += results
      .slice(0, count)
      .map(
        (r: any, i: number) =>
          `${i + 1}. **${r.title}**\n   ${r.content?.slice(0, 200)}\n   ${r.url}`,
      )
      .join("\n\n");
  }

  return output || "未找到相关结果";
}

// ── 自动选择搜索后端 ──────────────────────────────────────────────────

async function autoSearch(query: string, count = 5): Promise<string> {
  if (process.env.TAVILY_API_KEY) return tavilySearch(query, count);
  if (process.env.BING_API_KEY) return bingSearch(query, count);
  if (process.env.GOOGLE_SEARCH_API_KEY) return googleSearch(query, count);
  return "❌ 未配置任何搜索 API。请在 .env 中设置 TAVILY_API_KEY、BING_API_KEY 或 GOOGLE_SEARCH_API_KEY。";
}

// ── 导出插件 ──────────────────────────────────────────────────────────

export const searchPlugin: Plugin = {
  name: "web_search",
  description: "网络搜索插件，为机器人提供实时联网搜索能力",
  tools: [
    {
      name: "web_search",
      description:
        "搜索互联网获取实时信息。当用户询问最新的新闻、天气、实时数据、或你不确定的事实性问题时使用。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词",
          },
          count: {
            type: "number",
            description: "返回结果数量，默认 5",
          },
        },
        required: ["query"],
      },
      execute: async (args) => {
        return autoSearch(args.query, args.count || 5);
      },
    },
  ],
};
