import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { auth } from "@/lib/auth";

/** Must match `FLASH_COOKIE` in lib/flash.ts (avoid importing that module on the edge). */
const FLASH_COOKIE = "gk_admin_flash";

function clearFlashCookie(req: NextRequest, res: NextResponse) {
  if (req.cookies.has(FLASH_COOKIE)) {
    res.cookies.delete(FLASH_COOKIE);
  }
  return res;
}

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = Boolean(req.auth);

  if (pathname.startsWith("/api/auth") || pathname === "/healthz") {
    return clearFlashCookie(req, NextResponse.next());
  }

  if (pathname === "/login") {
    if (isLoggedIn) {
      // Role-based home is resolved by `/` after session is available to RSC.
      return clearFlashCookie(req, NextResponse.redirect(new URL("/", req.nextUrl)));
    }
    return clearFlashCookie(req, NextResponse.next());
  }

  if (!isLoggedIn) {
    const login = new URL("/login", req.nextUrl);
    login.searchParams.set("callbackUrl", pathname);
    return clearFlashCookie(req, NextResponse.redirect(login));
  }

  return clearFlashCookie(req, NextResponse.next());
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
