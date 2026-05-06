"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/chat/avatar";
import type { EncryptedPayload, MessageResponse, UUID } from "@/lib/api/whisperbox";
import { whisperbox } from "@/lib/api/whisperbox";
import { useAuth, useMyUserId } from "@/lib/auth/session";
import { decryptWhisperBoxPayloadTryBoth, encryptMessageForWhisperBox } from "@/lib/crypto/whisperbox-crypto";

type UiMessage = {
  id: string;
  direction: "in" | "out";
  createdAt: string;
  delivered?: boolean;
  plaintext?: string;
  decryptError?: string;
  pending?: boolean;
  fingerprint?: string;
};

function isEncryptedPayload(p: any): p is EncryptedPayload {
  return (
    p &&
    typeof p === "object" &&
    typeof p.ciphertext === "string" &&
    typeof p.iv === "string" &&
    typeof p.encryptedKey === "string" &&
    typeof p.encryptedKeyForSelf === "string"
  );
}

function fingerprintOfPayload(p: EncryptedPayload) {
  // Deterministic correlation so we can replace the optimistic temp bubble
  // when the real message arrives over WebSocket.
  return [p.ciphertext, p.iv, p.encryptedKey, p.encryptedKeyForSelf].join(".");
}

function formatMessageTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function ConversationThreadPage() {
  const { userId } = useParams<{ userId: string }>() as { userId: string };
  const auth = useAuth();
  const myUserId = useMyUserId();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [recipientPublicKey, setRecipientPublicKey] = useState<string | null>(null);
  const [peerName, setPeerName] = useState<string | null>(null);
  const [peerHandle, setPeerHandle] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const wsAckResolversRef = useRef<Map<string, () => void>>(new Map());

  const canDecrypt = auth.status === "authenticated" && !!auth.privateKey;

  const scrollToBottom = () => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });

  const toUi = async (m: MessageResponse): Promise<UiMessage> => {
    const direction: UiMessage["direction"] = myUserId && m.from_user_id === myUserId ? "out" : "in";
    const base: UiMessage = {
      id: m.id,
      direction,
      createdAt: m.created_at,
      delivered: m.delivered,
    };

    if (!canDecrypt || !auth.privateKey) {
      return { ...base, decryptError: "Unlock keys to decrypt." };
    }

    const payload = m.payload as any;
    if (!isEncryptedPayload(payload)) {
      return { ...base, decryptError: "Invalid encrypted payload." };
    }

    try {
      const { plaintext } = await decryptWhisperBoxPayloadTryBoth({
        payload,
        privateKey: auth.privateKey,
      });
      return { ...base, plaintext };
    } catch {
      return { ...base, decryptError: "Decryption failed." };
    }
  };

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const [pk, convs] = await Promise.all([
          auth.withAccessToken((accessToken) => whisperbox.getPublicKey(userId, { accessToken })),
          auth.withAccessToken((accessToken) => whisperbox.listConversations({ accessToken })),
        ]);
        setRecipientPublicKey(pk.public_key);
        const peer = convs.find((c) => c.user_id === userId);
        if (peer) {
          setPeerName(peer.display_name);
          setPeerHandle(peer.username);
        } else {
          setPeerName(null);
          setPeerHandle(null);
        }

        const items = await auth.withAccessToken((accessToken) =>
          whisperbox.getMessages(userId, { limit: 50 }, { accessToken }),
        );
        const ui = await Promise.all(items.slice().reverse().map(toUi));
        setMessages(ui);
        setTimeout(scrollToBottom, 50);
      } catch {
        setError("Could not load messages.");
      } finally {
        setLoading(false);
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken, auth.privateKey, userId]);

  useEffect(() => {
    const unsub = auth.subscribeIncoming(async (msg) => {
      const relevant =
        (msg.from_user_id === userId && msg.to_user_id === myUserId) ||
        (msg.from_user_id === myUserId && msg.to_user_id === userId);
      if (!relevant) return;

      const payload = msg.payload as any;
      const incomingFingerprint = isEncryptedPayload(payload)
        ? fingerprintOfPayload(payload)
        : null;

      const ui = await toUi(msg);
      setMessages((prev) => {
        // Replace optimistic temp message by payload fingerprint.
        if (incomingFingerprint) {
          wsAckResolversRef.current.get(incomingFingerprint)?.();
          wsAckResolversRef.current.delete(incomingFingerprint);
          const idx = prev.findIndex(
            (m) => m.id.startsWith("temp_") && m.fingerprint === incomingFingerprint,
          );
          if (idx !== -1) {
            const next = prev.slice();
            next[idx] = { ...ui, pending: false };
            return next;
          }
        }

        // Otherwise, dedupe by server message id.
        const existingIdx = prev.findIndex((m) => m.id === ui.id);
        if (existingIdx !== -1) {
          const existing = prev[existingIdx];
          const deliveredChanged = existing.delivered !== ui.delivered;
          const plaintextChanged = existing.plaintext !== ui.plaintext;
          const decryptErrorChanged = existing.decryptError !== ui.decryptError;
          if (!deliveredChanged && !plaintextChanged && !decryptErrorChanged) return prev;
          const next = prev.slice();
          next[existingIdx] = { ...existing, ...ui, pending: existing.pending && ui.pending };
          return next;
        }

        return [...prev, ui];
      });
      setTimeout(scrollToBottom, 50);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.privateKey, auth.accessToken, userId, myUserId]);

  useEffect(() => {
    let cancelled = false;

    const syncLatest = async () => {
      try {
        const items = await auth.withAccessToken((accessToken) =>
          whisperbox.getMessages(userId, { limit: 50 }, { accessToken }),
        );
        const ui = await Promise.all(items.slice().reverse().map(toUi));
        if (cancelled) return;

        setMessages((prev) => {
          const serverById = new Map(ui.map((m) => [m.id, m] as const));
          const next: UiMessage[] = [];

          // Keep optimistic messages that do not yet exist on server.
          for (const old of prev) {
            if (old.id.startsWith("temp_")) {
              next.push(old);
              continue;
            }
            const fresh = serverById.get(old.id);
            if (fresh) {
              next.push({ ...old, ...fresh, pending: false });
              serverById.delete(old.id);
            }
          }

          for (const fresh of ui) {
            if (!next.some((m) => m.id === fresh.id)) next.push(fresh);
          }

          next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          return next;
        });
      } catch {
        // Ignore periodic sync failures; websocket may still deliver.
      }
    };

    void syncLatest();
    const id = window.setInterval(() => {
      void syncLatest();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken, auth.privateKey, userId, myUserId]);

  const presenceLine = useMemo(() => {
    if (auth.wsStatus === "open") return "online · end-to-end encrypted";
    if (auth.wsStatus === "reconnecting") return "reconnecting…";
    if (auth.wsStatus === "connecting") return "connecting…";
    return "messages still encrypted offline";
  }, [auth.wsStatus]);

  const headerTitle = peerName ?? `Chat`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-1 border-b border-zinc-200/90 bg-[#f0f2f5] px-2 py-2.5 dark:border-zinc-800 dark:bg-[#202c33] md:gap-3 md:px-4 md:py-3">
        <Link
          href="/conversations"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-900/10 md:hidden dark:text-zinc-200 dark:hover:bg-white/10"
          aria-label="Back to chats"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <Avatar name={headerTitle} seed={peerHandle ?? userId} size="md" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {headerTitle}
          </h1>
          <p className="truncate text-[13px] text-teal-800/85 dark:text-teal-400/85">
            {peerHandle ? `@${peerHandle} · ${presenceLine}` : `${presenceLine}`}
          </p>
        </div>
      </header>

      <div className="chat-thread-pattern relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[680px] flex-col gap-1.5 px-3 py-5 md:gap-2 md:px-6 md:pb-8">
          {error ? (
            <div className="rounded-2xl border border-red-200/90 bg-red-50/95 px-4 py-3 text-[13px] text-red-800 shadow-sm backdrop-blur-sm dark:border-red-900/45 dark:bg-red-950/50 dark:text-red-200">
              {error}
            </div>
          ) : null}

          {loading ? (
            <p className="py-16 text-center text-[14px] text-zinc-600/85 dark:text-zinc-400/90">Loading secure messages…</p>
          ) : null}

          {!loading && !messages.length ? (
            <div className="mx-auto mt-6 max-w-sm rounded-xl bg-teal-50/95 px-4 py-4 text-center text-[13px] leading-relaxed text-teal-950 shadow-md ring-1 ring-teal-900/15 dark:bg-emerald-950/60 dark:text-emerald-100 dark:ring-white/15">
              <p>No messages yet.</p>
              <p className="mt-1 text-teal-800/95 dark:text-emerald-200/95">Say hello — everything you send stays encrypted.</p>
            </div>
          ) : null}

          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const showTailGap = prev && prev.direction !== m.direction;
            return (
              <div
                key={m.id}
                className={[
                  showTailGap ? "mt-2" : "",
                  "flex w-full flex-col",
                  m.direction === "out" ? "items-end ps-12" : "items-start pe-12",
                ].join(" ")}
              >
                <div
                  className={[
                    "max-w-[min(100%,24rem)] rounded-2xl px-3.5 pb-2 pt-2.5 shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]",
                    m.direction === "out"
                      ? "rounded-br-sm bg-[#d9fdd3] text-zinc-900 dark:bg-[#005c4b] dark:text-zinc-50"
                      : "rounded-bl-sm bg-white text-zinc-900 dark:bg-[#1f2c34] dark:text-zinc-50",
                    m.pending ? "opacity-75" : "",
                  ].join(" ")}
                >
                  {m.plaintext ? (
                    <p className="whitespace-pre-wrap break-words text-[14.5px] leading-snug">{m.plaintext}</p>
                  ) : (
                    <p className={`text-[14px] leading-snug ${m.decryptError ? "text-red-600 dark:text-red-400" : ""}`}>
                      {m.decryptError ?? "…"}
                    </p>
                  )}
                  <div
                    className={[
                      "mt-1 flex items-center justify-end gap-1.5 text-[11px] tabular-nums",
                      m.direction === "out"
                        ? "text-zinc-600/95 dark:text-zinc-300/95"
                        : "text-zinc-500 dark:text-zinc-400",
                    ].join(" ")}
                  >
                    <span>{formatMessageTime(m.createdAt)}</span>
                    {m.direction === "out" ? (
                      <span className="text-[11px]" title={m.pending ? "Sending" : m.delivered ? "Delivered" : "Queued"}>
                        {m.pending ? (
                          <span aria-hidden className="text-zinc-500 dark:text-zinc-400">⋯</span>
                        ) : m.delivered ? (
                          <span className="text-teal-600 dark:text-teal-300">✓✓</span>
                        ) : (
                          <span className="text-zinc-500 dark:text-zinc-400">✓</span>
                        )}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} className="h-px shrink-0" />
        </div>
      </div>

      <div className="shrink-0 border-t border-zinc-300/85 bg-[#f0f2f5] px-2 py-2 dark:border-zinc-800 dark:bg-[#1f272b] md:px-4 md:py-3">
        <form
          className="mx-auto flex max-w-[760px] items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!draft.trim() || sending) return;
            if (myUserId && myUserId === userId) {
              setError("You can’t send messages to yourself.");
              return;
            }
            if (!recipientPublicKey || !auth.publicKeyBase64) {
              setError("Missing recipient key.");
              return;
            }
            if (!canDecrypt || !auth.privateKey) {
              setError("Unlock your keys to send encrypted messages.");
              return;
            }

            setSending(true);
            setError(null);
            const plaintext = draft;
            setDraft("");

            const tempId = `temp_${Date.now()}`;
            setMessages((prev) => [
              ...prev,
              {
                id: tempId,
                direction: "out",
                createdAt: new Date().toISOString(),
                plaintext,
                delivered: false,
                pending: true,
              },
            ]);
            setTimeout(scrollToBottom, 20);

            try {
              const payload = await encryptMessageForWhisperBox({
                plaintext,
                recipientPublicKeyBase64: recipientPublicKey,
                senderPublicKeyBase64: auth.publicKeyBase64,
              });

              const tempFingerprint = fingerprintOfPayload(payload);
              setMessages((prev) =>
                prev.map((m) => (m.id === tempId ? { ...m, fingerprint: tempFingerprint } : m)),
              );

              // Prefer WS if connected; REST fallback otherwise.
              const sentViaWs = auth.wsStatus === "open" && auth.sendWsMessage(userId as UUID, payload);

              let msg: MessageResponse | null = null;
              if (sentViaWs) {
                // Wait briefly for WS echo/receive. If no confirmation arrives, fallback to REST.
                const acked = await new Promise<boolean>((resolve) => {
                  let done = false;
                  const finish = (v: boolean) => {
                    if (done) return;
                    done = true;
                    resolve(v);
                  };

                  wsAckResolversRef.current.set(tempFingerprint, () => finish(true));
                  window.setTimeout(() => {
                    wsAckResolversRef.current.delete(tempFingerprint);
                    finish(false);
                  }, 2500);
                });

                if (!acked) {
                  msg = await auth.withAccessToken((accessToken) =>
                    whisperbox.sendMessage({ to: userId as UUID, payload }, { accessToken }),
                  );
                }
              } else {
                msg = await auth.withAccessToken((accessToken) =>
                  whisperbox.sendMessage({ to: userId as UUID, payload }, { accessToken }),
                );
              }

              if (msg) {
                const ui = await toUi(msg);
                setMessages((prev) => prev.filter((m) => m.id !== tempId).concat(ui));
              }
              setTimeout(scrollToBottom, 20);
            } catch {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === tempId ? { ...m, pending: false, decryptError: "Send failed." } : m,
                ),
              );
              setError("Send failed. Please try again.");
            } finally {
              setSending(false);
            }
          }}
        >
          <div className="min-w-0 flex-1">
            <textarea
              rows={1}
              placeholder="Message"
              className="max-h-36 min-h-[44px] w-full resize-none rounded-3xl border-0 bg-white px-4 py-[11px] text-[15px] leading-snug text-zinc-900 shadow-inner outline-none ring-1 ring-zinc-300/80 transition-[box-shadow] placeholder:text-zinc-400 focus:ring-2 focus:ring-teal-600/55 dark:bg-[#2a3942] dark:text-zinc-50 dark:ring-white/18 dark:placeholder:text-zinc-500 dark:focus:ring-teal-500/55"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </div>
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            aria-label={sending ? "Sending message" : "Send message"}
            className="mb-px flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white shadow-md shadow-teal-900/12 transition-colors hover:bg-teal-700 disabled:pointer-events-none disabled:opacity-40 dark:bg-teal-500 dark:hover:bg-teal-400 dark:text-zinc-950"
          >
            {sending ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            )}
          </button>
        </form>
        <p className="mx-auto mt-1.5 max-w-[760px] text-center text-[11px] text-zinc-500 dark:text-zinc-500">
          {canDecrypt
            ? "End-to-end encrypted"
            : auth.status === "locked"
              ? "Unlock keys to send"
              : "Authenticating keys…"}
        </p>
      </div>
    </div>
  );
}

