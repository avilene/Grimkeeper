function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. See apps/admin/README.md.`);
  }
  return value;
}

export function parseAdminIds(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export const adminEnv = {
  port: Number(process.env.ADMIN_PORT ?? 3847),
  discordClientId: () => requireEnv("DISCORD_CLIENT_ID"),
  discordClientSecret: () => requireEnv("DISCORD_CLIENT_SECRET"),
  /** Auth.js secret — prefers AUTH_SECRET, falls back to ADMIN_SESSION_SECRET. */
  authSecret: () =>
    process.env.AUTH_SECRET?.trim() || requireEnv("ADMIN_SESSION_SECRET"),
  adminIds: () => parseAdminIds(process.env.ADMIN_IDS),
  /**
   * Public origin for Auth.js (e.g. https://admin.example.com).
   * Derived from ADMIN_OAUTH_CALLBACK_URL when set.
   */
  publicOrigin: (): string | undefined => {
    const callback = process.env.ADMIN_OAUTH_CALLBACK_URL?.trim();
    if (callback) {
      try {
        return new URL(callback).origin;
      } catch {
        /* ignore */
      }
    }
    return process.env.AUTH_URL?.trim() || undefined;
  },
};
