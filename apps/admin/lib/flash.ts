import { cookies } from "next/headers";

const FLASH_COOKIE = "gk_admin_flash";

export async function setFlash(message: string) {
  const jar = await cookies();
  jar.set(FLASH_COOKIE, message, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 30,
  });
}

export async function consumeFlash(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(FLASH_COOKIE)?.value ?? null;
  if (value) jar.delete(FLASH_COOKIE);
  return value;
}
