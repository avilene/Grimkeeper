import "dotenv/config";
import { defineConfig } from "prisma/config";

// prisma generate does not connect to the DB; this default keeps CLI/build working
// when DATABASE_URL is unset (e.g. Docker image build, local .env without DB vars).
const defaultDatabaseUrl = "file:./prisma/dev.db";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? defaultDatabaseUrl,
  },
});
