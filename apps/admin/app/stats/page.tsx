import { redirect } from "next/navigation";
import { getPlayerStatsOverview } from "@grimkeeper/database";

import { PlayerStatsView } from "@/components/player-stats-view";
import { getAccessProfile } from "@/lib/access";

export const metadata = { title: "My stats" };

export default async function PlayerStatsPage() {
  const access = await getAccessProfile();
  if (!access) redirect("/login");

  const overview = await getPlayerStatsOverview(access.userId);

  return (
    <PlayerStatsView
      title="My stats"
      subtitle={
        <>
          Ended games with a recorded winner across all guilds for{" "}
          <code className="font-mono">{access.userId}</code>
          {access.name ? ` (${access.name})` : ""}.
        </>
      }
      overview={overview}
      emptyHistoryMessage="No ended games with a winner found for your Discord ID."
    />
  );
}
