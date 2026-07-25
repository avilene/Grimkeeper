import { backfillGameWinnersFromEvents, prisma } from "../dist/index.js";

const result = await backfillGameWinnersFromEvents();
console.log(`Backfilled winner on ${result.updated} game(s).`);
await prisma.$disconnect();
