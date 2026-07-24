import { cookies } from "next/headers";

/** Shared with middleware — do not import this module from middleware (pulls in next/headers). */
export const FLASH_COOKIE = "gk_admin_flash";

export async function setFlash(message: string) {
  const jar = await cookies();
  jar.set(FLASH_COOKIE, message, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30,
  });
}

/** Read-only — cookie is cleared by middleware on the response. */
export async function consumeFlash(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(FLASH_COOKIE)?.value ?? null;
}
