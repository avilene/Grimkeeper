export type SessionUser = {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
};

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    oauthState?: string;
    flash?: string;
  }
}

const DISCORD_API = "https://discord.com/api/v10";

export function discordAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify",
    state,
  });
  return `https://discord.com/api/oauth2/authorize?${params}`;
}

export async function exchangeDiscordCode(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<string> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
  });

  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord token exchange failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("Discord token response missing access_token");
  }
  return json.access_token;
}

export async function fetchDiscordUser(accessToken: string): Promise<SessionUser> {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord user fetch failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
  };

  return {
    id: json.id,
    username: json.username,
    globalName: json.global_name ?? null,
    avatar: json.avatar ?? null,
  };
}
