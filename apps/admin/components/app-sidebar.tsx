"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronRight,
  Dices,
  LogOut,
  Settings2,
  BarChart3,
  Users,
  Bell,
  Tags,
  ListOrdered,
  Building2,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export type AppSidebarProps = {
  home: string;
  canListGames: boolean;
  isAdmin: boolean;
  canListGamesAsStoryteller: boolean;
  image: string | null;
  name: string | null;
  userId: string;
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
};

const ADMIN_PREFIXES = ["/reminders", "/aliases", "/queues", "/guild-settings", "/stats/players"];

function isAdminPath(pathname: string): boolean {
  if (ADMIN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }
  return pathname.startsWith("/stats/") && pathname !== "/stats/players";
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
  children,
}: AppSidebarProps) {
  const pathname = usePathname();
  const adminActive = isAdmin && isAdminPath(pathname);
  const [adminOpen, setAdminOpen] = useState(adminActive);
  const displayName = name ?? "User";
  const fallbackInitial = displayName.charAt(0).toUpperCase() || "U";
  const roleLabel = isAdmin ? "admin" : canListGamesAsStoryteller ? "storyteller" : null;

  useEffect(() => {
    if (adminActive) setAdminOpen(true);
  }, [adminActive]);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link href={home}>
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <Dices className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">Grimkeeper</span>
                    <span className="truncate text-xs text-muted-foreground">Admin panel</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigate</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {canListGames ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === "/games" || pathname.startsWith("/games/")}
                      tooltip="Games"
                    >
                      <Link href="/games">
                        <Dices />
                        <span>Games</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : null}
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/stats"} tooltip="My stats">
                    <Link href="/stats">
                      <BarChart3 />
                      <span>My stats</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {isAdmin ? (
            <SidebarGroup>
              <SidebarGroupLabel>Admin</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <Collapsible open={adminOpen} onOpenChange={setAdminOpen} className="group/collapsible">
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip="Admin" isActive={adminActive}>
                          <Settings2 />
                          <span>Admin</span>
                          <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton
                              asChild
                              isActive={
                                pathname === "/stats/players" ||
                                (pathname.startsWith("/stats/") && pathname !== "/stats/players")
                              }
                            >
                              <Link href="/stats/players">
                                <Users />
                                <span>Player stats</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton
                              asChild
                              isActive={pathname === "/reminders" || pathname.startsWith("/reminders/")}
                            >
                              <Link href="/reminders">
                                <Bell />
                                <span>Reminders</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton
                              asChild
                              isActive={pathname === "/aliases" || pathname.startsWith("/aliases/")}
                            >
                              <Link href="/aliases">
                                <Tags />
                                <span>Aliases</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton
                              asChild
                              isActive={pathname === "/queues" || pathname.startsWith("/queues/")}
                            >
                              <Link href="/queues">
                                <ListOrdered />
                                <span>Queue</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton
                              asChild
                              isActive={
                                pathname === "/guild-settings" ||
                                pathname.startsWith("/guild-settings/")
                              }
                            >
                              <Link href="/guild-settings">
                                <Building2 />
                                <span>Guild settings</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null}
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  >
                    <Avatar size="default" className="size-8 rounded-lg">
                      {image ? <AvatarImage src={image} alt={displayName} /> : null}
                      <AvatarFallback className="rounded-lg">{fallbackInitial}</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{displayName}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {roleLabel ?? userId}
                      </span>
                    </div>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                  side="bottom"
                  align="end"
                  sideOffset={4}
                >
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                      <Avatar size="default" className="size-8 rounded-lg">
                        {image ? <AvatarImage src={image} alt={displayName} /> : null}
                        <AvatarFallback className="rounded-lg">{fallbackInitial}</AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-semibold">{displayName}</span>
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          {userId}
                        </span>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault();
                      void signOutAction();
                    }}
                  >
                    <LogOut />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <span className="truncate text-sm text-muted-foreground">Grimkeeper Admin</span>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
