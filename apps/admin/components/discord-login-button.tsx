"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

import { Button } from "@/components/ui/button";

export function DiscordLoginButton({ callbackUrl }: { callbackUrl: string }) {
  const [pending, setPending] = useState(false);

  return (
    <Button
      type="button"
      className="w-full"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signIn("discord", { callbackUrl }).finally(() => {
          setPending(false);
        });
      }}
    >
      {pending ? "Redirecting…" : "Login with Discord"}
    </Button>
  );
}
