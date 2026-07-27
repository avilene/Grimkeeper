import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";

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
        token.discordId = String(profile.id);
        const globalName =
          "global_name" in profile && typeof profile.global_name === "string"
            ? profile.global_name
            : null;
        const username =
          "username" in profile && typeof profile.username === "string"
            ? profile.username
            : null;
        token.name = globalName || username || token.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.discordId ?? token.sub ?? "");
      }
      return session;
    },
  },
});
