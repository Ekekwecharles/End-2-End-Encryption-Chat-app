"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getApiErrorMessage } from "@/lib/api/whisperbox";
import { useAuth } from "@/lib/auth/session";

export default function RegisterPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const auth = useAuth();
  const router = useRouter();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create account</CardTitle>
        <CardDescription>
          Your keys are generated on this device. The server never sees plaintext.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setIsLoading(true);
            try {
              const form = new FormData(e.currentTarget);
              const displayName = String(form.get("displayName") ?? "").trim();
              const username = String(form.get("username") ?? "").trim();
              const password = String(form.get("password") ?? "");

              if (displayName.length < 1) throw new Error("Display name is required.");
              if (username.length < 3) throw new Error("Username must be at least 3 characters.");
              if (password.length < 8) throw new Error("Password must be at least 8 characters.");

              await auth.register({ displayName, username, password });
              router.push("/conversations");
            } catch (err) {
              setError(getApiErrorMessage(err));
            } finally {
              setIsLoading(false);
            }
          }}
        >
          <Input name="displayName" label="Display name" autoComplete="name" required />
          <Input name="username" label="Username" autoComplete="username" required />
          <Input
            name="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters."
            required
          />

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          ) : null}

          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Creating…" : "Create account"}
          </Button>

          <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
            Already have an account?{" "}
            <Link className="font-medium text-zinc-900 dark:text-zinc-50" href="/login">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

