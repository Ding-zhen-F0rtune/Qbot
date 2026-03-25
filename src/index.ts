import { config } from "./config";
import { OneBotClient } from "./clinet";
import { LLMService } from "./llm";
import { MessageHandler } from "./handler";
import { PluginManager, searchPlugin } from "./plugins";
import type { OneBotEvent } from "./type";

// ── 初始化 ────────────────────────────────────────────────────────────

const client = new OneBotClient({
  wsUrl: config.wsUrl,
  assessToken: config.accessToken,
});

const llm = new LLMService();
const handler = new MessageHandler(client, llm);

// ── 注册插件 ──────────────────────────────────────────────────────────

const pluginManager = new PluginManager();
pluginManager.register(searchPlugin);
// 在这里注册更多插件: pluginManager.register(otherPlugin);
llm.setPluginManager(pluginManager);
// ── 连接事件 ──────────────────────────────────────────────────────────

client.on("connected", async () => {
  console.log("[Bot] ✅ 已连接 OneBot 服务器");
  try {
    const info = await client.getLogininfo();
    if (info?.user_id) {
      client.setSelfId(info.user_id);
      console.log(`[Bot] 🤖 登录账号: ${info.nickname} (${info.user_id})`);
    }
  } catch (e) {
    console.warn("[Bot] ⚠️ 获取登录信息失败:", e);
  }
});

client.on("disconnected", () => {
  console.log("[Bot] ❌ 连接断开，等待重连...");
});

// ── 消息事件 ──────────────────────────────────────────────────────────

client.on("message", async (event: OneBotEvent) => {
  try {
    // 补充 selfId
    if (!client.getSelfId() && event.self_id) {
      client.setSelfId(event.self_id);
    }

    // 生命周期事件
    if (event.post_type === "meta_event") {
      if (
        event.meta_event_type === "lifecycle" &&
        event.sub_type === "connect" &&
        event.self_id
      ) {
        client.setSelfId(event.self_id);
      }
      return;
    }

    // 好友/群请求
    if (event.post_type === "request") {
      handler.handleRequest(event);
      return;
    }

    // 戳一戳转为消息
    if (
      event.post_type === "notice" &&
      event.notice_type === "notify" &&
      event.sub_type === "poke" &&
      event.target_id &&
      String(event.target_id) === String(client.getSelfId())
    ) {
      event.post_type = "message";
      event.message_type = event.group_id ? "group" : "private";
      event.raw_message = "你好呀~ 你戳了我一下！";
      event.message = [
        { type: "text", data: { text: event.raw_message } },
      ];
    }

    // 处理消息
    if (event.post_type === "message") {
      await handler.handleMessage(event);
    }
  } catch (err) {
    console.error("[Bot] 处理消息异常:", err);
  }
});

// ── 启动 ──────────────────────────────────────────────────────────────

client.connect();
console.log(`[Bot] 🚀 启动中... 连接 ${config.wsUrl}`);
