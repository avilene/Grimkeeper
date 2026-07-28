import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";

function getDiscordAvatarUrl(discordUserId: string, avatar: string | null): string | null {
  if (!discordUserId || !avatar) return null;
  const ext = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatar}.${ext}?size=128`;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      authorization: { params: { scope: "identify" } },
    }),
  ],
  secret: process.env.AUTH_SECRET?.trim() || process.env.ADMIN_SESSION_SECRET?.trim(),
  trustHost: true,
  pages: {
    signIn: "/login",
    error: "/login",
  },
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
