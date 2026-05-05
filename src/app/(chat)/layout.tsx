"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ChatAppShell } from "@/components/chat/chat-app-shell";
import { useAuth } from "@/lib/auth/session";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const showChat = auth.status === "authenticated" || auth.status === "locked";

  useEffect(() => {
    if (!showChat) router.replace("/login");
  }, [router, showChat]);

  if (!showChat) return null;

  return <ChatAppShell>{children}</ChatAppShell>;
}
