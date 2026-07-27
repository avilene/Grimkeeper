import Link from "next/link";

import { getAccessProfile, homePathForAccess } from "@/lib/access";
import { signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export async function AppNav() {
  const access = await getAccessProfile();
  if (!access) return null;

  const home = homePathForAccess(access);

  return (
    <nav className="sticky top-0 z-40 flex items-center gap-4 border-b border-border bg-card/95 px-6 py-3 backdrop-blur">
      {access.canListGames ? (
        <Link href="/games" className="text-sm font-medium hover:text-primary">
          Games
        </Link>
      ) : null}
      <Link href="/stats" className="text-sm font-medium hover:text-primary">
        My stats
      </Link>
      {access.isAdmin ? (
        <>
          <Link href="/reminders" className="text-sm font-medium hover:text-primary">
            Reminders
          </Link>
          <Link href="/aliases" className="text-sm font-medium hover:text-primary">
            Aliases
          </Link>
          <Link href="/queues" className="text-sm font-medium hover:text-primary">
            Queue
          </Link>
        </>
      ) : null}
      <div className="flex-1" />
      <span className="text-sm text-muted-foreground">
        {access.name ?? "User"} · {access.userId}
        {access.isAdmin ? (
          <span className="ml-2 text-xs text-primary">admin</span>
        ) : access.canListGames ? (
          <span className="ml-2 text-xs text-primary">storyteller</span>
        ) : null}
      </span>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <Button type="submit" variant="secondary" size="sm">
          Logout
        </Button>
      </form>
      {/* Keep home link available for keyboard / screen readers via brand-less nav */}
      <span className="sr-only">
        <Link href={home}>Home</Link>
      </span>
    </nav>
  );
}
