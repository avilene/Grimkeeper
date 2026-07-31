import { migrateVotesToIsPrivate, prisma } from "../dist/index.js";

const result = await migrateVotesToIsPrivate();
console.log(`Created ${result.created} private-ballot vote row(s) from old privateChoice data.`);
await prisma.$disconnect();
