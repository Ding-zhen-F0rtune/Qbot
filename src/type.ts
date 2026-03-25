// ── OneBot v11 Message Segment Types ──────────────────────────────────

export type OneBotMessageSegment =
  | { type: "text"; data: { text: string } }
  | { type: "image"; data: { file: string; url?: string } }
  | { type: "video"; data: { file: string; url?: string } }
  | { type: "audio"; data: { file: string; url?: string } }
  | { type: "record"; data: { file: string; url?: string; text?: string } }
  | {
      type: "file";
      data: {
        file?: string;
        name?: string;
        url?: string;
        file_id?: string;
        busid?: number | string;
        file_size?: number;
      };
    }
  | { type: "json"; data?: Record<string, unknown> }
  | { type: "forward"; data: { id: string } }
  | { type: "at"; data: { qq: string; text?: string } }
  | { type: "reply"; data: { id: string | number } }
  | { type: "face"; data: { id: number } };

export type OneBotMessage = string | OneBotMessageSegment[];

// ── OneBot v11 Event ──────────────────────────────────────────────────

export interface OneBotEvent {
  time: number;
  self_id: number;
  post_type: "message" | "message_sent" | "notice" | "request" | "meta_event";

  // ── Message fields ──
  message_type?: "private" | "group";
  sub_type?: string;
  message_id?: number;
  user_id?: number;
  group_id?: number;
  message?: OneBotMessageSegment[];
  raw_message?: string;
  font?: number;
  sender?: {
    user_id?: number;
    nickname?: string;
    card?: string;
    role?: "owner" | "admin" | "member";
  };

  // ── Meta event fields ──
  meta_event_type?: "heartbeat" | "lifecycle";
  status?: any;
  interval?: number;

  // ── Notice fields ──
  notice_type?: string;
  target_id?: number;

  // ── Request fields ──
  request_type?: string;
  flag?: string;
}
