"use client";

import { MessageSquareText } from "@/components/chat/empty-chat-hero";

export default function ConversationsPage() {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-6 bg-gradient-to-b from-zinc-50 to-[#dce8ec] px-8 py-16 dark:from-[#0c1318] dark:to-[#0a171d] md:py-24">
      <MessageSquareText className="h-28 w-28 text-teal-600/35 dark:text-teal-400/25" aria-hidden />
      <div className="max-w-sm text-center">
        <h1 className="text-[22px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          WhisperBox desktop
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          Choose a conversation on the left to read and send encrypted messages. On a small screen, pick a contact in the list to open the thread full width.
        </p>
      </div>
    </div>
  );
}
