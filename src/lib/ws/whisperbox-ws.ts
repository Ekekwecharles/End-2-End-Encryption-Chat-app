import type { EncryptedPayload, MessageResponse, UUID } from "@/lib/api/whisperbox";

export type WhisperBoxWsReceiveFrame =
  | { type: "message.receive"; message: MessageResponse }
  | { type: "message.receive"; data: MessageResponse }
  | { type: string; [k: string]: unknown };

export type WhisperBoxWsSendFrame =
  | { type: "message.send"; to: UUID; payload: EncryptedPayload }
  | { type: string; [k: string]: unknown };

type Options = {
  token: string;
  url?: string;
  onReceiveMessage?: (msg: MessageResponse) => void;
  onStatusChange?: (status: WhisperBoxWsStatus) => void;
};

export type WhisperBoxWsStatus = "idle" | "connecting" | "open" | "closed" | "error" | "reconnecting";

const DEFAULT_WS_URL = "wss://whisperbox.koyeb.app/ws";

export class WhisperBoxWS {
  #ws: WebSocket | null = null;
  #token: string;
  #url: string;
  #closedByUser = false;
  #reconnectAttempt = 0;
  #onReceiveMessage?: (msg: MessageResponse) => void;
  #onStatusChange?: (status: WhisperBoxWsStatus) => void;

  status: WhisperBoxWsStatus = "idle";

  constructor(opts: Options) {
    this.#token = opts.token;
    this.#url = opts.url ?? DEFAULT_WS_URL;
    this.#onReceiveMessage = opts.onReceiveMessage;
    this.#onStatusChange = opts.onStatusChange;
  }

  setToken(token: string) {
    this.#token = token;
  }

  connect() {
    this.#closedByUser = false;
    this.#setStatus(this.#reconnectAttempt > 0 ? "reconnecting" : "connecting");

    const wsUrl = new URL(this.#url);
    wsUrl.searchParams.set("token", this.#token);

    const ws = new WebSocket(wsUrl.toString());
    this.#ws = ws;

    ws.onopen = () => {
      this.#reconnectAttempt = 0;
      this.#setStatus("open");
    };

    ws.onmessage = (evt) => {
      const text = typeof evt.data === "string" ? evt.data : null;
      if (!text) return;

      let frame: WhisperBoxWsReceiveFrame | null = null;
      try {
        frame = JSON.parse(text);
      } catch {
        return;
      }

      if (!frame || typeof frame !== "object") return;

      if (frame.type === "message.receive") {
        const msg = "message" in frame ? (frame as any).message : "data" in frame ? (frame as any).data : null;
        if (msg && typeof msg === "object") {
          this.#onReceiveMessage?.(msg as MessageResponse);
        }
      }
    };

    ws.onerror = () => {
      this.#setStatus("error");
    };

    ws.onclose = () => {
      this.#ws = null;
      this.#setStatus("closed");
      if (!this.#closedByUser) this.#scheduleReconnect();
    };
  }

  disconnect() {
    this.#closedByUser = true;
    this.#ws?.close();
    this.#ws = null;
    this.#setStatus("closed");
  }

  send(frame: WhisperBoxWsSendFrame) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return false;
    this.#ws.send(JSON.stringify(frame));
    return true;
  }

  sendMessage(to: UUID, payload: EncryptedPayload) {
    return this.send({ type: "message.send", to, payload });
  }

  #setStatus(s: WhisperBoxWsStatus) {
    this.status = s;
    this.#onStatusChange?.(s);
  }

  #scheduleReconnect() {
    this.#reconnectAttempt += 1;
    const base = Math.min(30_000, 500 * 2 ** Math.min(this.#reconnectAttempt, 7));
    const jitter = Math.floor(Math.random() * 250);
    const delay = base + jitter;
    setTimeout(() => {
      if (this.#closedByUser) return;
      this.connect();
    }, delay);
  }
}

