"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { signIn } from "@/lib/auth";

export async function loginWithDiscord(formData?: FormData) {
  const callbackUrl = String(formData?.get("callbackUrl") ?? "/games");
  try {
    await signIn("discord", { redirectTo: callbackUrl });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/login?error=${encodeURIComponent(error.type)}`);
    }
    throw error;
  }
}
