import Link from "next/link";
import { formatBotcEdition, listBotcRoles } from "@grimkeeper/engine";

import { WarnBanner } from "@/components/banners";
import { RecordGameForm } from "@/components/record-game-form";
import type { RoleOption } from "@/components/role-combobox";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Record completed game" };

function catalogRoleOptions(): RoleOption[] {
  return listBotcRoles()
    .map((role) => ({
      id: role.id,
      name: role.name,
      type: role.team,
      edition: formatBotcEdition(role.edition),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function RecordCompletedGamePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Record completed game</h1>
        <Button asChild variant="secondary" size="sm">
          <Link href="/games">Back</Link>
        </Button>
      </div>
      <WarnBanner>
        Creates an ended game for <strong>/stats</strong> only. No kib/log threads, roles, or
        Discord posts. Storytellers are stored as engine events (
        <code>GameCreated.storytellerId</code> + <code>StorytellerPromoted</code>), same as live
        games.
      </WarnBanner>
      <RecordGameForm roles={catalogRoleOptions()} />
    </div>
  );
}
