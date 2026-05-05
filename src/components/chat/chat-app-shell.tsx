"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ConversationSummary, UserPublicInfo } from "@/lib/api/whisperbox";
import { whisperbox } from "@/lib/api/whisperbox";
import { Avatar } from "@/components/chat/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth/session";

function formatListTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const weekAgo = Date.now() - 7 * 86400000;
  if (d.getTime() > weekAgo) {
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ChatAppShell({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockLoading, setUnlockLoading] = useState(false);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<UserPublicInfo[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const showUnlock = auth.status === "locked";

  const identity = useMemo(() => {
    if (!auth.user) return null;
    return {
      display: auth.user.display_name,
      handle: `@${auth.user.username}`,
      seed: auth.user.username,
    };
  }, [auth.user]);

  const isThreadRoute = /^\/conversations\/[^/]+$/.test(pathname);

  useEffect(() => {
    const run = async () => {
      if (auth.status !== "authenticated" && auth.status !== "locked") return;
      setConvLoading(true);
      setConvError(null);
      try {
        const items = await auth.withAccessToken((accessToken) =>
          whisperbox.listConversations({ accessToken }),
        );
        setConversations(items);
      } catch {
        setConvError("Could not sync chats.");
      } finally {
        setConvLoading(false);
      }
    };
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.accessToken]);

  const onSearch = async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const trimmed = q.trim();
      if (!trimmed) {
        setResults([]);
        return;
      }
      const users = await auth.withAccessToken((accessToken) =>
        whisperbox.searchUsers(trimmed, { accessToken }),
      );
      setResults(users);
    } catch {
      setSearchError("Search failed.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="relative min-h-dvh bg-[var(--app-canvas)] dark:bg-[var(--app-canvas-dark)]">
      <div className="mx-auto grid h-dvh min-h-0 w-full max-w-[1500px] grid-cols-1 shadow-2xl shadow-black/10 ring-1 ring-black/5 md:grid-cols-[minmax(300px,388px)_1fr] dark:shadow-black/40 dark:ring-white/10">
        <aside
          className={[
            "flex min-h-0 flex-col overflow-hidden border-zinc-300/80 bg-[#f8f9fa] dark:border-zinc-800 dark:bg-[#111b21]",
            isThreadRoute ? "hidden md:flex" : "flex",
            "border-e",
          ].join(" ")}
        >
          <div className="flex items-center gap-3 px-3 py-3.5">
            {identity ? (
              <>
                <Avatar name={identity.display} seed={identity.seed} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    {identity.display}
                  </p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{identity.handle}</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await auth.logout();
                    router.push("/login");
                  }}
                  className="shrink-0 rounded-full px-2.5 py-1.5 text-[12px] font-medium text-teal-700 hover:bg-zinc-200/80 dark:text-teal-400 dark:hover:bg-white/10"
                >
                  Log out
                </button>
              </>
            ) : (
              <div className="flex-1 px-1">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">WhisperBox</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Encrypted messenger</p>
              </div>
            )}
          </div>

          <div className="mx-2 mb-2 rounded-xl bg-white/80 px-3 py-2 text-[11px] leading-snug text-zinc-600 shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-900/60 dark:text-zinc-400 dark:ring-white/10">
            Messages are encrypted on your device before they leave it.
          </div>

          <div className="flex flex-col gap-2 px-2 pb-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onSearch();
              }}
              placeholder="Search or start a new chat…"
              aria-label="Search users or start a new chat"
              className="h-9 rounded-full border-zinc-200/90 bg-white text-[14px] shadow-sm dark:border-zinc-700 dark:bg-zinc-800/80"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full rounded-full text-[13px] font-medium"
              onClick={() => void onSearch()}
              disabled={searching}
            >
              {searching ? "Searching…" : "Search users"}
            </Button>
            {searchError ? (
              <p className="px-1 text-xs text-red-600 dark:text-red-400">{searchError}</p>
            ) : null}
            {results.length ? (
              <div className="max-h-40 overflow-y-auto rounded-xl bg-white p-1 shadow-sm ring-1 ring-zinc-900/5 dark:bg-zinc-900/50 dark:ring-white/10">
                {results.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setResults([]);
                      setQ("");
                      router.push(`/conversations/${u.id}`);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
                  >
                    <Avatar name={u.display_name} seed={u.username} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
                        {u.display_name}
                      </p>
                      <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">@{u.username}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
            {convError ? (
              <p className="px-2 py-2 text-center text-xs text-red-600 dark:text-red-400">{convError}</p>
            ) : null}

            {convLoading ? (
              <p className="py-12 text-center text-[13px] text-zinc-500 dark:text-zinc-400">Loading chats…</p>
            ) : conversations.length ? (
              <ul className="flex flex-col gap-px">
                {conversations.map((c) => {
                  const active = pathname === `/conversations/${c.user_id}`;
                  return (
                    <li key={c.user_id}>
                      <Link
                        href={`/conversations/${c.user_id}`}
                        className={[
                          "flex items-center gap-2.5 rounded-xl px-2 py-2.5 transition-colors",
                          active
                            ? "bg-zinc-200/95 dark:bg-zinc-700/55"
                            : "hover:bg-zinc-200/55 dark:hover:bg-zinc-800/55",
                        ].join(" ")}
                      >
                        <Avatar name={c.display_name} seed={c.username} size="md" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[15px] font-medium text-zinc-900 dark:text-zinc-100">
                              {c.display_name}
                            </span>
                            <span className="shrink-0 text-[11px] text-teal-700 tabular-nums dark:text-teal-400/90">
                              {formatListTime(c.last_message_at)}
                            </span>
                          </div>
                          <p className="truncate text-[12px] text-zinc-500 dark:text-zinc-400">@{c.username}</p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-3 py-14 text-center text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                No chats yet.
                <br />
                Search for someone to begin.
              </p>
            )}
          </div>

          <div className="mt-auto shrink-0 border-t border-zinc-200/80 px-4 py-2.5 dark:border-zinc-800">
            <p className="text-center text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              End-to-end encrypted
            </p>
          </div>
        </aside>

        <main
          className={[
            "flex h-full min-h-0 w-full min-w-0 flex-col bg-white dark:bg-[#0c1318]",
            isThreadRoute ? "" : "hidden md:flex",
          ].join(" ")}
        >
          {children}
        </main>
      </div>

      {showUnlock ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5 backdrop-blur-[2px]">
          <Card className="w-full max-w-md border-zinc-200/80 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <CardHeader>
              <CardTitle>Unlock your keys</CardTitle>
              <CardDescription>
                Your private key is stored wrapped locally. Enter your password to decrypt it on this device.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setUnlockError(null);
                  setUnlockLoading(true);
                  try {
                    const form = new FormData(e.currentTarget);
                    const password = String(form.get("password") ?? "");
                    await auth.unlock(password);
                  } catch {
                    setUnlockError("Could not unlock keys. Check your password.");
                  } finally {
                    setUnlockLoading(false);
                  }
                }}
              >
                <Input
                  name="password"
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
                {unlockError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
                    {unlockError}
                  </div>
                ) : null}
                <Button type="submit" disabled={unlockLoading}>
                  {unlockLoading ? "Unlocking…" : "Unlock"}
                </Button>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Sessions can be restored; decryption stays on this device after you unlock.
                </p>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
