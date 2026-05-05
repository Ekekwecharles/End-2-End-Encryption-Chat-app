"use client";

import { AuthProvider } from "@/lib/auth/session";

export function Providers({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

