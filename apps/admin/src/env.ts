import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = resolve(repoRoot, ".env");
if (existsSync(envPath)) {
  config({ path: envPath });
}

export function parseAllowedUserIds(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. See apps/admin/README.md.`);
  }
  return value;
}

export const adminConfig = {
  port: Number(process.env.ADMIN_PORT ?? 3847),
  clientId: () => requireEnv("DISCORD_CLIENT_ID"),
  clientSecret: () => requireEnv("DISCORD_CLIENT_SECRET"),
  redirectUri: () =>
    process.env.ADMIN_OAUTH_CALLBACK_URL?.trim() ||
    `http://localhost:${Number(process.env.ADMIN_PORT ?? 3847)}/auth/callback`,
  sessionSecret: () => requireEnv("ADMIN_SESSION_SECRET"),
  allowedUserIds: () => parseAllowedUserIds(process.env.ALLOWED_USER_IDS),
};
