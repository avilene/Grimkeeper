"use client";

import { useFormStatus } from "react-dom";

import type { SaveResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";

export function SaveStatus({ result }: { result: SaveResult | null }) {
  if (!result) return null;
  return (
    <p
      className={
        result.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"
      }
      role="status"
      aria-live="polite"
    >
      {result.message}
    </p>
  );
}

export function SubmitButton({
  children,
  variant = "default",
  pendingLabel = "Saving…",
}: {
  children: React.ReactNode;
  variant?: "default" | "secondary" | "destructive" | "outline" | "ghost";
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
