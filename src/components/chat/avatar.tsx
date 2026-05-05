"use client";

import { useMemo } from "react";

const gradientPairs = [
  "from-teal-500 to-emerald-700",
  "from-sky-500 to-indigo-600",
  "from-violet-500 to-purple-700",
  "from-rose-500 to-orange-600",
  "from-cyan-500 to-blue-700",
  "from-fuchsia-500 to-pink-600",
];

function hueClass(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = seed.charCodeAt(i) + ((h << 5) - h);
  }
  return gradientPairs[Math.abs(h) % gradientPairs.length];
}

type AvatarProps = {
  name: string;
  seed?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizes: Record<NonNullable<AvatarProps["size"]>, string> = {
  sm: "h-9 w-9 text-[11px]",
  md: "h-11 w-11 text-xs",
  lg: "h-14 w-14 text-lg",
};

export function Avatar({ name, seed, size = "md", className }: AvatarProps) {
  const initials = useMemo(() => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? "?";
    const b = parts[1]?.[0];
    return (a + (b ?? "")).toUpperCase().slice(0, 2);
  }, [name]);

  const g = hueClass(seed ?? name);

  return (
    <div
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${g} font-semibold text-white shadow-inner ring-2 ring-black/10 dark:ring-white/15 ${sizes[size]} ${className ?? ""}`}
    >
      {initials}
    </div>
  );
}
