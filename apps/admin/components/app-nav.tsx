import { getAccessProfile, homePathForAccess } from "@/lib/access";
import { AppSidebar } from "@/components/app-sidebar";

export async function AppNav({ children }: { children: React.ReactNode }) {
  const access = await getAccessProfile();
  if (!access) return <>{children}</>;

  const home = homePathForAccess(access);

  return (
    <AppSidebar
      home={home}
      canListGames={access.canListGames}
      isAdmin={access.isAdmin}
      canListGamesAsStoryteller={access.canListGames && !access.isAdmin}
      image={access.image}
      name={access.name}
      userId={access.userId}
    >
      {children}
    </AppSidebar>
  );
}
