import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";

function getDiscordAvatarUrl(discordUserId: string, avatar: string | null): string | null {
  if (!discordUserId || !avatar) return null;
  const ext = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatar}.${ext}?size=128`;
}

function authSecret(): string | undefined {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    process.env.ADMIN_SESSION_SECRET?.trim() ||
    undefined
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Discord({
      // Read at request time via Auth.js env defaults + these fallbacks (Docker runtime env).
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      authorization: { params: { scope: "identify" } },
    }),
  ],
  secret: authSecret(),
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  logger: {
    error(error) {
      console.error("[auth]", error);
      const cause =
        error && typeof error === "object" && "cause" in error
          ? (error as { cause: unknown }).cause
          : undefined;
      if (cause !== undefined) {
        console.error("[auth] cause:", cause);
        if (cause && typeof cause === "object" && "err" in cause) {
          console.error("[auth] cause.err:", (cause as { err: unknown }).err);
        }
      }
    },
  },
  debug: process.env.AUTH_DEBUG === "1",
  callbacks: {
    async signIn({ profile }) {
      // Anyone with a Discord account can sign in. Visibility is role-gated
      // (ADMIN_IDS admins, storytellers, players) after login.
      const id = profile && "id" in profile ? String(profile.id) : "";
      return Boolean(id);
    },
    async jwt({ token, profile }) {
      if (profile && "id" in profile) {
        const discordId = String(profile.id);
        const avatar =
          "avatar" in profile && typeof profile.avatar === "string" ? profile.avatar : null;

        token.discordId = discordId;
        const globalName =
          "global_name" in profile && typeof profile.global_name === "string"
            ? profile.global_name
            : null;
        const username =
          "username" in profile && typeof profile.username === "string"
            ? profile.username
            : null;
        token.name = globalName || username || token.name;
        token.image = getDiscordAvatarUrl(discordId, avatar);
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.discordId ?? token.sub ?? "");
        session.user.image = typeof token.image === "string" ? token.image : null;
      }
      return session;
    },
  },
});
