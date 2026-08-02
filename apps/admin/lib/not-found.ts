import { redirect } from "next/navigation";

import { captureAdminNotFound } from "@/lib/sentry";

export async function redirectAdminNotFound(
  context: Record<string, unknown> = {},
): Promise<never> {
  await captureAdminNotFound(context);
  redirect("/");
}
