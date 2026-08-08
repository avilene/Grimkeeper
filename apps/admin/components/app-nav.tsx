import { getAccessProfile, homePathForAccess } from "@/lib/access";
import { signOut } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";

export async function AppNav({ children }: { children: React.ReactNode }) {
  const access = await getAccessProfile();
  if (!access) return <>{children}</>;

  const home = homePathForAccess(access);

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <AppSidebar
      home={home}
      canListGames={access.canListGames}
      isAdmin={access.isAdmin}
      canListGamesAsStoryteller={access.canListGames && !access.isAdmin}
      image={access.image}
      name={access.name}
      userId={access.userId}
      signOutAction={signOutAction}
    >
      {children}
    </AppSidebar>
  );
}
