import * as React from "react";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export function Input({ className, label, hint, error, id, ...props }: InputProps) {
  const fallbackId = React.useId();
  const inputId = id ?? fallbackId;

  return (
    <div className="grid gap-1.5">
      {label ? (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
        >
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        className={[
          "h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-zinc-700 dark:focus:ring-zinc-50/10",
          error ? "border-red-300 focus:border-red-400 focus:ring-red-500/10 dark:border-red-700" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      />
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      ) : null}
    </div>
  );
}

