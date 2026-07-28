"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AppSidebarProps = {
  home: string;
  canListGames: boolean;
  isAdmin: boolean;
  canListGamesAsStoryteller: boolean;
  image: string | null;
  name: string | null;
  userId: string;
  signOutAction: () => Promise<void>;
};

const ADMIN_PREFIXES = ["/reminders", "/aliases", "/queues", "/stats/players"];

function isAdminPath(pathname: string): boolean {
  if (ADMIN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }
  // /stats/<discordUserId> but not /stats itself
  return pathname.startsWith("/stats/") && pathname !== "/stats/players";
}

function NavLink({
  href,
  children,
  active,
}: {
  href: string;
  children: ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-md px-2.5 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

export function AppSidebar({
  home,
  canListGames,
  isAdmin,
  canListGamesAsStoryteller,
  image,
  name,
  userId,
  signOutAction,
}: AppSidebarProps) {
  const pathname = usePathname();
  const adminActive = isAdmin && isAdminPath(pathname);
  const [adminOpen, setAdminOpen] = useState(adminActive);
  const displayName = name ?? "User";
  const fallbackInitial = displayName.charAt(0).toUpperCase() || "U";

  useEffect(() => {
    if (adminActive) setAdminOpen(true);
  }, [adminActive]);

  return (
    <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-border bg-card/80 backdrop-blur">
      <div className="border-b border-border px-4 py-4">
        <Link href={home} className="text-sm font-semibold tracking-tight hover:text-primary">
          Grimkeeper
        </Link>
        <p className="mt-0.5 text-xs text-muted-foreground">Admin panel</p>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {canListGames ? (
          <NavLink href="/games" active={pathname === "/games" || pathname.startsWith("/games/")}>
            Games
          </NavLink>
        ) : null}
        <NavLink href="/stats" active={pathname === "/stats"}>
          My stats
        </NavLink>

        {isAdmin ? (
          <div className="mt-2">
            <button
              type="button"
              aria-expanded={adminOpen}
              onClick={() => setAdminOpen((open) => !open)}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs font-semibold uppercase tracking-wide transition-colors",
                adminActive
                  ? "text-primary"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              Admin
              <ChevronDown
                className={cn("size-3.5 transition-transform", adminOpen ? "rotate-0" : "-rotate-90")}
                aria-hidden
              />
            </button>
            {adminOpen ? (
              <div className="mt-1 ml-1 flex flex-col gap-0.5 border-l border-border pl-2">
                <NavLink
                  href="/stats/players"
                  active={
                    pathname === "/stats/players" ||
                    (pathname.startsWith("/stats/") && pathname !== "/stats/players")
                  }
                >
                  Player stats
                </NavLink>
                <NavLink
                  href="/reminders"
                  active={pathname === "/reminders" || pathname.startsWith("/reminders/")}
                >
                  Reminders
                </NavLink>
                <NavLink
                  href="/aliases"
                  active={pathname === "/aliases" || pathname.startsWith("/aliases/")}
                >
                  Aliases
                </NavLink>
                <NavLink
                  href="/queues"
                  active={pathname === "/queues" || pathname.startsWith("/queues/")}
                >
                  Queue
                </NavLink>
              </div>
            ) : null}
          </div>
        ) : null}
      </nav>

      <div className="space-y-3 border-t border-border p-3">
        <div className="flex items-center gap-3 px-1">
          {image ? (
            <img
              src={image}
              alt={`${displayName} avatar`}
              className="size-10 shrink-0 rounded-full border border-border object-cover"
            />
          ) : (
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-accent text-sm font-medium text-accent-foreground">
              {fallbackInitial}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{displayName}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{userId}</p>
            {isAdmin ? (
              <p className="mt-1 text-xs text-primary">admin</p>
            ) : canListGamesAsStoryteller ? (
              <p className="mt-1 text-xs text-primary">storyteller</p>
            ) : null}
          </div>
        </div>
        <form action={signOutAction}>
          <Button type="submit" variant="secondary" size="sm" className="w-full">
            Logout
          </Button>
        </form>
      </div>
    </aside>
  );
}
