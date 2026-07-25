import Link from "next/link";

import { auth, signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export async function AppNav() {
  const session = await auth();
  if (!session?.user) return null;

  return (
    <nav className="sticky top-0 z-40 flex items-center gap-4 border-b border-border bg-card/95 px-6 py-3 backdrop-blur">
      <Link href="/games" className="text-sm font-medium hover:text-primary">
        Games
      </Link>
      <Link href="/reminders" className="text-sm font-medium hover:text-primary">
        Reminders
      </Link>
      <Link href="/aliases" className="text-sm font-medium hover:text-primary">
        Aliases
      </Link>
      <Link href="/queues" className="text-sm font-medium hover:text-primary">
        Queue
      </Link>
      <div className="flex-1" />
      <span className="text-sm text-muted-foreground">
        {session.user.name ?? "User"} · {session.user.id}
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
    </nav>
  );
}
