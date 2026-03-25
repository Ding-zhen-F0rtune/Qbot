import webSocket from "ws";
import { EventEmitter } from "events";
import type { OneBotEvent, OneBotMessage } from "./type";
interface OneBotClientOptions {
  wsUrl: string;
  assessToken?: string;
}
export class OneBotClient extends EventEmitter {
  private ws: webSocket | null = null;
  private options: OneBotClientOptions;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000;
  private selfId: number | null = null;
  private isAlive = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pendingMessages: Array<{ action: string; params?: any }> = [];
  private LastMessageAt = 0;
  constructor(options: OneBotClientOptions) {
    super();
    this.options = options;
  }
  getSelfId(): number | null {
    return this.selfId;
  }
  isConnected(): boolean {
    return this.ws?.readyState === webSocket.OPEN;
  }
  setSelfId(id: number) {
    this.selfId = id;
  }
  connect() {
    this.cleanup();
    const headers: Record<string, string> = {};
    if (this.options.assessToken) {
      headers["Authorization"] = `Bearer ${this.options.assessToken}`;
    }
    try {
      this.ws = new webSocket(this.options.wsUrl, { headers });
      this.ws.on("open", () => {
        this.isAlive = true;
        this.reconnectAttempts = 0;
        this.LastMessageAt = Date.now();
        this.emit("connected");
        console.log("[QQ] connected OneBot server");

        if (this.pendingMessages.length > 0) {
          const toFrush = this.pendingMessages.splice(
            0,
            this.pendingMessages.length,
          );
          let sent = 0;
          for (const msg of toFrush) {
            if (this.safeSend(msg.action, msg.params)) {
              sent++;
            }
          }
          console.log(`[QQ] sent ${sent}/${toFrush.length} pending messages`);
        }
      });
      this.ws.on("message", (data) => {
        this.isAlive = true;
        this.LastMessageAt = Date.now();
        try {
          const payload = JSON.parse(data.toString()) as OneBotEvent;
          if (
            payload.post_type === "meta_event" &&
            payload.meta_event_type === "heartbeat"
          ) {
            this.emit("heartbeat", payload);
            return;
          }
          this.emit("message", payload);
        } catch (err) {
          // 解析消息失败，记录错误但不抛出
          // Ignore non-JSON or parse error
        }
      });
      this.ws.on("close", () => {
        this.handleDisconnect();
      });
      this.ws.on("error", (err) => {
        console.error("[QQ] WebSocket error:", err);
        this.handleDisconnect();
      });
    } catch (err) {
      console.error("[QQ] Failed to connect:", err);
      this.scheduleReconnect();
    }
  }
  private cleanup() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      if (
        this.ws.readyState === webSocket.OPEN ||
        this.ws.readyState === webSocket.CONNECTING
      ) {
        this.ws.terminate();
      }
      this.ws = null;
    }
  }
  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    // check heartbeat every 30 seconds;tolerate idle links and reconnect when stale for too long
    this.heartbeatTimer = setInterval(() => {
      const staleMs = Date.now() - this.LastMessageAt;
      if (staleMs > 180000) {
        console.warn(
          "[QQ] No inbound traffic for ${Math.round(staleMs/1000)} seconds, reconnecting...",
        );
        this.handleDisconnect();
      }
      this.isAlive = true;
    }, 30000);
  }
  private handleDisconnect() {
    this.cleanup();
    this.emit("disconnected");
    this.scheduleReconnect();
  }
  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay,
    );
    console.log(
      `[QQ] Attempting to reconnect in ${delay / 1000}s (Attempt ${this.reconnectAttempts + 1})`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }
  sendPrivateMs(userId: number, message: OneBotMessage | string) {
    this.send("send_private_msg", { user_id: userId, message });
  }
  sendGroupMsg(groupId: number, message: OneBotMessage | string) {
    this.send("send_group_msg", { group_id: groupId, message });
  }
  async sendGroupMsgAck(
    groupId: number,
    message: OneBotMessage | string,
  ): Promise<number> {
    return this.sendWithResponse(
      "send_group_msg",
      { group_id: groupId, message },
      15000,
    );
  }
  deleteMsg(messageId: number | string) {
    this.send("delete_msg", { message_id: messageId });
  }
  setGroupAddRequest(
    flag: string,
    subType: string,
    approve: boolean = true,
    reason: string = " ",
  ) {
    this.send("set_group_add_request", {
      flag,
      sub_type: subType,
      approve,
      reason,
    });
  }
  setFriendAddRequest(
    flag: string,
    approve: boolean = true,
    remark: string = " ",
  ) {
    this.send("set_friend_add_request", { flag, approve, remark });
  }
  async getLogininfo(): Promise<any> {
    return this.sendWithResponse("get_login_info", {});
  }
  async getMsg(messageId: number | string): Promise<any> {
    const raw =
      typeof messageId === "number"
        ? String(messageId)
        : String(messageId || "").trim();
    const trise: Array<Record<string, any>> = [
      { message_id: raw },
      { id: raw },
    ];
    if (/^\d+$/.test(raw)) {
      const n = Number.parseInt(raw, 10);
      trise.unshift({ message_id: n });
      trise.push({ id: n });
    }
    let lastErr: unknown;
    for (const param of trise) {
      try {
        return await this.sendWithResponse("get_msg", param);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error("get_msg_failed");
  }
  async getGroupMsgHistory(groupId: number): Promise<any> {
    return this.sendWithResponse("get_group_msg_history", {
      group_id: groupId,
    });
  }
  async getForwardMsg(id: string): Promise<any> {
    const raw = String(id || "").trim();
    const tries: Array<Record<string, any>> = [
      { id: raw },
      { message_id: raw },
      { forward_id: raw },
    ];
    if (/^\d+$/.test(raw)) {
      const n = Number.parseInt(raw, 10);
      tries.unshift({ id: n });
      tries.unshift({ message_id: n }, { forward_id: n });
    }
    let lastErr: unknown;
    for (const param of tries) {
      try {
        return await this.sendWithResponse("get_forward_msg", param);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error("get_forward_msg_failed");
  }
  async getFriendList(): Promise<any[]> {
    return this.sendWithResponse("get_friend_list", {});
  }
  sendGuildChannelMsg(
    guildId: number,
    channelId: number,
    message: OneBotMessage | string,
  ) {
    this.send("send_guild_channel_msg", {
      guild_id: guildId,
      channel_id: channelId,
      message,
    });
  }
  async sendGuildChannelMsgAck(
    guildId: number,
    channelId: number,
    message: OneBotMessage | string,
  ): Promise<any> {
    return this.sendWithResponse(
      "send_guild_channel_msg",
      { guild_id: guildId, channel_id: channelId, message },
      15000,
    );
  }
  async getGuildlist(): Promise<any[]> {
    try {
      return await this.sendWithResponse("get_guild_list", {});
    } catch (err) {
      return [];
    }
  }
  sendGroupPoke(groupId: number, userId: number) {
    this.send("group_poke", { group_id: groupId, user_id: userId });
  }
  setGroupBan(groupId: number, userId: number, duration: number = 1800) {
    this.send("set_group_ban", {
      group_id: groupId,
      user_id: userId,
      duration,
    });
  }
  setGroupKick(
    groupId: number,
    userId: number,
    rejectAddRequest: boolean = false,
  ) {
    this.send("set_group_kick", {
      group_id: groupId,
      user_id: userId,
      reject_add_request: rejectAddRequest,
    });
  }
  setGroupCard(groupId: number, userId: number, card: string) {
    this.send("set_group_card", { group_id: groupId, user_id: userId, card });
  }
  private sendWithResponse(
    action: string,
    params?: any,
    timeout: number = 5000,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== webSocket.OPEN) {
        reject(new Error("WebSocket is not connected"));
        return;
      }
      const echo = Math.random().toString(36).substring(2, 15);
      const handler = (data: webSocket.RawData) => {
        try {
          const resp = JSON.parse(data.toString());
          if (resp.echo === echo) {
            this.ws?.off("message", handler);
            if (resp.status === "ok") {
              resolve(resp.data);
            } else {
              reject(new Error(resp.msg || "API request failed"));
            }
          }
        } catch (err) {
          // Ignore non-JSON or parse error
        }
      };
      this.ws.on("message", handler);
      this.ws.send(JSON.stringify({ action, params, echo }), (err) => {
        setTimeout(() => {
          this.ws?.off("message", handler);
          reject(new Error("API request timeout"));
        }, timeout);
      });
    });
  }
  private send(action: string, params: any) {
    if (this.ws?.readyState === webSocket.OPEN) {
      this.safeSend(action, params);
    } else {
      if (this.pendingMessages.length < 100) {
        this.pendingMessages.push({ action, params });
      }
      console.warn(
        "[QQ] WebSocket not open, queued outbound action=${action} queue=${this.pendingMessages.length}",
      );
      if (!this.reconnectTimer) {
        this.scheduleReconnect();
      }
    }
  }
  private safeSend(action: string, params: any): boolean {
    if (this.ws?.readyState !== webSocket.OPEN) {
      return false;
    }
    try {
      this.ws.send(JSON.stringify({ action, params }), (err) => {
        if (!err) return;
        if (this.pendingMessages.length < 200) {
          this.pendingMessages.push({ action, params });
        }
        console.warn(
          "[QQ] Failed to send message, queued action=${action} queue=${this.pendingMessages.length}",
        );
        if (!this.reconnectTimer) {
          this.scheduleReconnect();
        }
      });
      return true;
    } catch (err) {
      if (this.pendingMessages.length < 200) {
        this.pendingMessages.push({ action, params });
      }
      if (!this.reconnectTimer) {
        this.scheduleReconnect();
      }
      return false;
    }
  }
  disconnect() {
    this.cleanup();
  }
}
