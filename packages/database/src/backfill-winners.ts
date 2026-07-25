import { prisma } from "./client.js";

type EndedPayload = {
  winner?: unknown;
};

/**
 * Copy winner from GameEnded event payloads onto Game.winner for rows that are
 * ended but missing a winner (pre-projection-column games).
 */
export async function backfillGameWinnersFromEvents(): Promise<{ updated: number }> {
  const events = await prisma.gameEvent.findMany({
    where: { type: "GameEnded" },
    select: { gameId: true, payload: true, seq: true },
    orderBy: { seq: "asc" },
  });

  const winnerByGame = new Map<string, "good" | "evil">();
  for (const event of events) {
    const payload = event.payload as EndedPayload;
    const winner = payload?.winner;
    if (winner === "good" || winner === "evil") {
      winnerByGame.set(event.gameId, winner);
    }
  }

  let updated = 0;
  for (const [gameId, winner] of winnerByGame) {
    const result = await prisma.game.updateMany({
      where: {
        id: gameId,
        OR: [{ winner: null }, { winner: "" }],
      },
      data: { winner, phase: "ended" },
    });
    updated += result.count;
  }

  return { updated };
}
