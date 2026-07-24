"use client";

import { useFormStatus } from "react-dom";

import type { SaveResult } from "@/actions/games";
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

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : children}
    </Button>
  );
}
