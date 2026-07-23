import "./load-env.js";

import { randomBytes } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";

import {
  listAppLogs,
  listDistinctGameEventTypes,
  listGameEvents,
  prisma,
} from "@grimkeeper/database";

import {
  discordAuthorizeUrl,
  exchangeDiscordCode,
  fetchDiscordUser,
  type SessionUser,
} from "./auth.js";
import { adminConfig } from "./env.js";
import { escapeHtml, layout } from "./html.js";

const ACTIVE_PHASES = ["lobby", "setup", "night", "day"] as const;

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function queryString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

function parseDateInput(value: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function emptyToNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function parseOptionalInt(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error("Seat must be an integer");
  return n;
}

function parseBool(value: unknown): boolean {
  return value === "on" || value === "true" || value === "1";
}

function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.user) {
    res.redirect("/login");
    return;
  }
  next();
}

function isAllowed(userId: string): boolean {
  const allowed = adminConfig.allowedUserIds();
  // Admin UI is deny-by-default: empty allowlist means nobody can sign in.
  return allowed.size > 0 && allowed.has(userId);
}

function flash(req: Request): string | null {
  const value = req.session.flash ?? null;
  delete req.session.flash;
  return value;
}

function setFlash(req: Request, message: string): void {
  req.session.flash = message;
}

function field(
  name: string,
  label: string,
  value: string | number | null | undefined,
  opts?: { type?: string; hint?: string },
): string {
  const type = opts?.type ?? "text";
  const hint = opts?.hint ? `<span class="mono">${escapeHtml(opts.hint)}</span>` : "";
  return `<label>${escapeHtml(label)} ${hint}
    <input type="${type}" name="${escapeHtml(name)}" value="${escapeHtml(value ?? "")}" />
  </label>`;
}

function jsonPreview(value: unknown): string {
  try {
    return escapeHtml(JSON.stringify(value, null, 2));
  } catch {
    return escapeHtml(String(value));
  }
}

const app = express();
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    name: "grimkeeper_admin",
    secret: adminConfig.sessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.ADMIN_COOKIE_SECURE === "true",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.get("/login", (req, res) => {
  if (req.session.user) {
    res.redirect("/");
    return;
  }
  const body = `
    <div class="login-box">
      <p>Sign in with Discord. Only users listed in <code>ALLOWED_USER_IDS</code> can access this admin UI.</p>
      <p><a class="btn" href="/auth/discord">Login with Discord</a></p>
    </div>`;
  res.type("html").send(layout({ title: "Login", body }));
});

app.get("/auth/discord", (req, res) => {
  const state = randomBytes(16).toString("hex");
  req.session.oauthState = state;
  res.redirect(discordAuthorizeUrl(adminConfig.clientId(), adminConfig.redirectUri(), state));
});

app.get("/auth/callback", async (req, res) => {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !state || state !== req.session.oauthState) {
      res.status(400).type("html").send(layout({ title: "Auth failed", body: "<p>Invalid OAuth state.</p>" }));
      return;
    }
    delete req.session.oauthState;

    const token = await exchangeDiscordCode({
      clientId: adminConfig.clientId(),
      clientSecret: adminConfig.clientSecret(),
      redirectUri: adminConfig.redirectUri(),
      code,
    });
    const user = await fetchDiscordUser(token);

    if (!isAllowed(user.id)) {
      res.status(403).type("html").send(
        layout({
          title: "Access denied",
          body: `<div class="login-box"><p>Discord user <code>${escapeHtml(user.id)}</code> is not in <code>ALLOWED_USER_IDS</code>.</p><p><a href="/login">Back</a></p></div>`,
        }),
      );
      return;
    }

    req.session.user = user;
    res.redirect("/");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).type("html").send(layout({ title: "Auth failed", body: `<p>${escapeHtml(message)}</p>` }));
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/", requireUser, async (req, res) => {
  const user = req.session.user as SessionUser;
  const showEnded = req.query.show === "ended" || req.query.show === "all";
  const games = await prisma.game.findMany({
    where: showEnded ? undefined : { phase: { not: "ended" } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      players: { orderBy: [{ seat: "asc" }, { displayName: "asc" }] },
    },
  });

  const rows = games
    .map((game) => {
      const active = game.phase !== "ended";
      const players = game.players
        .map(
          (p) =>
            `${escapeHtml(p.displayName)} <span class="mono">(${escapeHtml(p.discordUserId)})</span>`,
        )
        .join("<br/>");
      return `<tr>
        <td><a href="/games/${escapeHtml(game.id)}"><code>${escapeHtml(game.id.slice(0, 8))}…</code></a></td>
        <td><span class="badge ${active ? "active" : "ended"}">${escapeHtml(game.phase)}</span></td>
        <td class="mono">${escapeHtml(game.guildId)}</td>
        <td class="mono">${escapeHtml(game.channelId)}</td>
        <td>${game.players.length}</td>
        <td>${players || "—"}</td>
        <td>${escapeHtml(game.createdAt.toISOString())}</td>
      </tr>`;
    })
    .join("");

  const body = `
    <p>Active games by default. Edits write directly to the SQLite projection — they do <strong>not</strong> append engine events and can drift from Discord / event history.</p>
    <div class="meta">
      <span><a href="/">Active only</a></span>
      <span><a href="/?show=all">Include ended</a></span>
      <span><a href="/logs">Game events</a> · <a href="/logs/app">App logs</a></span>
      <span>${games.length} shown</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Game</th><th>Phase</th><th>Guild</th><th>Channel</th><th>#</th><th>Players</th><th>Created</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="7">No games found.</td></tr>`}</tbody>
    </table>`;

  res.type("html").send(layout({ title: "Games", user, flash: flash(req), body }));
});

app.get("/games/:id", requireUser, async (req, res) => {
  const user = req.session.user as SessionUser;
  const id = param(req.params.id);
  const game = await prisma.game.findUnique({
    where: { id },
    include: {
      players: { orderBy: [{ seat: "asc" }, { displayName: "asc" }] },
    },
  });
  if (!game) {
    res.status(404).type("html").send(layout({ title: "Not found", user, body: "<p>Game not found.</p>" }));
    return;
  }

  const playerForms = game.players
    .map(
      (p) => `
      <h3>${escapeHtml(p.displayName)} <span class="mono">· ${escapeHtml(p.id.slice(0, 8))}</span></h3>
      <form class="edit" method="post" action="/games/${escapeHtml(game.id)}/players/${escapeHtml(p.id)}">
        ${field("displayName", "Display name", p.displayName)}
        ${field("discordUserId", "Discord user ID", p.discordUserId)}
        ${field("seat", "Seat", p.seat, { type: "number" })}
        ${field("roleId", "Role ID", p.roleId)}
        <label>Alive
          <input type="checkbox" name="alive" ${p.alive ? "checked" : ""} />
        </label>
        <label>Ghost vote used
          <input type="checkbox" name="ghostVoteUsed" ${p.ghostVoteUsed ? "checked" : ""} />
        </label>
        <div class="actions"><button type="submit">Save player</button></div>
      </form>`,
    )
    .join("");

  const body = `
    <div class="warn">
      Direct DB edits. Prefer bot commands when possible. Changing Discord IDs / thread IDs can break live Discord surfaces until they are recreated.
      Known phases: ${ACTIVE_PHASES.map((p) => `<code>${p}</code>`).join(", ")}, <code>ended</code>.
    </div>
    <div class="meta">
      <span>ID <code>${escapeHtml(game.id)}</code></span>
      <span>Created ${escapeHtml(game.createdAt.toISOString())}</span>
      <span><a href="/logs?gameId=${escapeHtml(game.id)}">Game events</a></span>
      <span><a href="/logs/app?gameId=${escapeHtml(game.id)}">App logs</a></span>
    </div>
    <h2>Game fields</h2>
    <form class="edit" method="post" action="/games/${escapeHtml(game.id)}">
      ${field("phase", "Phase", game.phase)}
      ${field("dayNumber", "Day number", game.dayNumber, { type: "number" })}
      ${field("nightNumber", "Night number", game.nightNumber, { type: "number" })}
      ${field("guildId", "Guild ID", game.guildId)}
      ${field("channelId", "Town channel ID", game.channelId)}
      ${field("stRoleId", "ST role ID", game.stRoleId)}
      ${field("playerRoleId", "Player role ID", game.playerRoleId)}
      ${field("kibRoleId", "Kib role ID", game.kibRoleId)}
      ${field("kibThreadId", "Kib thread ID", game.kibThreadId)}
      ${field("logThreadId", "Log thread ID", game.logThreadId)}
      ${field("whisperDeclThreadId", "Whisper declarations thread", game.whisperDeclThreadId)}
      ${field("claimsThreadId", "Claims thread ID", game.claimsThreadId)}
      ${field("rulesThreadId", "Rules thread ID", game.rulesThreadId)}
      <div class="actions"><button type="submit">Save game</button> <a class="btn secondary" href="/">Back</a></div>
    </form>
    <div class="section">
      <h2>Players (${game.players.length})</h2>
      ${playerForms || "<p>No players.</p>"}
    </div>`;

  res.type("html").send(layout({ title: `Game ${game.id.slice(0, 8)}…`, user, flash: flash(req), body }));
});

app.post("/games/:id", requireUser, async (req, res) => {
  const id = param(req.params.id);
  try {
    await prisma.game.update({
      where: { id },
      data: {
        phase: String(req.body.phase ?? "").trim() || "lobby",
        dayNumber: Number(req.body.dayNumber ?? 0),
        nightNumber: Number(req.body.nightNumber ?? 0),
        guildId: String(req.body.guildId ?? "").trim(),
        channelId: String(req.body.channelId ?? "").trim(),
        stRoleId: emptyToNull(req.body.stRoleId),
        playerRoleId: emptyToNull(req.body.playerRoleId),
        kibRoleId: emptyToNull(req.body.kibRoleId),
        kibThreadId: emptyToNull(req.body.kibThreadId),
        logThreadId: emptyToNull(req.body.logThreadId),
        whisperDeclThreadId: emptyToNull(req.body.whisperDeclThreadId),
        claimsThreadId: emptyToNull(req.body.claimsThreadId),
        rulesThreadId: emptyToNull(req.body.rulesThreadId),
      },
    });
    setFlash(req, "Game saved.");
  } catch (err) {
    setFlash(req, err instanceof Error ? err.message : String(err));
  }
  res.redirect(`/games/${id}`);
});

app.post("/games/:id/players/:playerId", requireUser, async (req, res) => {
  const id = param(req.params.id);
  const playerId = param(req.params.playerId);
  try {
    await prisma.player.update({
      where: { id: playerId },
      data: {
        displayName: String(req.body.displayName ?? "").trim(),
        discordUserId: String(req.body.discordUserId ?? "").trim(),
        seat: parseOptionalInt(req.body.seat),
        roleId: emptyToNull(req.body.roleId),
        alive: parseBool(req.body.alive),
        ghostVoteUsed: parseBool(req.body.ghostVoteUsed),
      },
    });
    setFlash(req, "Player saved.");
  } catch (err) {
    setFlash(req, err instanceof Error ? err.message : String(err));
  }
  res.redirect(`/games/${id}`);
});

app.get("/logs", requireUser, async (req, res) => {
  const user = req.session.user as SessionUser;
  const gameId = queryString(req.query.gameId);
  const type = queryString(req.query.type);
  const sinceRaw = queryString(req.query.since);
  const untilRaw = queryString(req.query.until);
  const since = parseDateInput(sinceRaw);
  const until = parseDateInput(untilRaw);

  const [events, types] = await Promise.all([
    listGameEvents({ gameId: gameId || undefined, type: type || undefined, since, until, take: 200 }),
    listDistinctGameEventTypes(),
  ]);

  const typeOptions = [`<option value="">Any type</option>`]
    .concat(
      types.map(
        (t) =>
          `<option value="${escapeHtml(t)}" ${t === type ? "selected" : ""}>${escapeHtml(t)}</option>`,
      ),
    )
    .join("");

  const rows = events
    .map((event) => {
      const payload = event.payload;
      return `<tr>
        <td class="mono">${escapeHtml(event.createdAt.toISOString())}</td>
        <td><a href="/games/${escapeHtml(event.gameId)}"><code>${escapeHtml(event.gameId.slice(0, 8))}…</code></a></td>
        <td><span class="badge">${escapeHtml(event.type)}</span></td>
        <td>${event.seq}</td>
        <td>
          <details>
            <summary>Payload</summary>
            <pre class="payload">${jsonPreview(payload)}</pre>
          </details>
        </td>
      </tr>`;
    })
    .join("");

  const body = `
    <p>Engine event store (<code>GameEvent</code>) — the authoritative “what happened in this game” timeline. Discord audit-thread messages are not mirrored here.</p>
    <form class="filters" method="get" action="/logs">
      <label>Game ID
        <input type="text" name="gameId" value="${escapeHtml(gameId)}" placeholder="cuid…" />
      </label>
      <label>Type
        <select name="type">${typeOptions}</select>
      </label>
      <label>Since (ISO)
        <input type="text" name="since" value="${escapeHtml(sinceRaw)}" placeholder="2026-07-01T00:00:00Z" />
      </label>
      <label>Until (ISO)
        <input type="text" name="until" value="${escapeHtml(untilRaw)}" placeholder="2026-07-23T23:59:59Z" />
      </label>
      <div class="actions"><button type="submit">Filter</button> <a class="btn secondary" href="/logs">Clear</a></div>
    </form>
    <div class="meta"><span>${events.length} events (max 200)</span></div>
    <table>
      <thead><tr><th>Time</th><th>Game</th><th>Type</th><th>Seq</th><th>Payload</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">No events matched.</td></tr>`}</tbody>
    </table>`;

  res.type("html").send(layout({ title: "Game events", user, flash: flash(req), body }));
});

app.get("/logs/app", requireUser, async (req, res) => {
  const user = req.session.user as SessionUser;
  const gameId = queryString(req.query.gameId);
  const level = queryString(req.query.level);
  const sinceRaw = queryString(req.query.since);
  const untilRaw = queryString(req.query.until);
  const since = parseDateInput(sinceRaw);
  const until = parseDateInput(untilRaw);

  const logs = await listAppLogs({
    gameId: gameId || undefined,
    level: level || undefined,
    since,
    until,
    take: 200,
  });

  const levelOptions = ["", "warn", "error"]
    .map(
      (l) =>
        `<option value="${escapeHtml(l)}" ${l === level ? "selected" : ""}>${l ? escapeHtml(l) : "Any level"}</option>`,
    )
    .join("");

  const rows = logs
    .map((row) => {
      return `<tr>
        <td class="mono">${escapeHtml(row.createdAt.toISOString())}</td>
        <td><span class="badge">${escapeHtml(row.level)}</span></td>
        <td>${row.gameId ? `<a href="/games/${escapeHtml(row.gameId)}"><code>${escapeHtml(row.gameId.slice(0, 8))}…</code></a>` : "—"}</td>
        <td class="mono">${escapeHtml(row.message)}</td>
        <td>
          <details>
            <summary>Context</summary>
            <pre class="payload">${jsonPreview(row.context)}</pre>
          </details>
        </td>
      </tr>`;
    })
    .join("");

  const body = `
    <p>DB-backed operational sink (<code>AppLog</code>) for bot <code>warn</code>/<code>error</code> lines when <code>APP_LOG_TO_DB</code> is not disabled. Info/debug stay on stdout (and Grafana if enabled). Discord ST audit threads are Discord-only.</p>
    <form class="filters" method="get" action="/logs/app">
      <label>Game ID
        <input type="text" name="gameId" value="${escapeHtml(gameId)}" />
      </label>
      <label>Level
        <select name="level">${levelOptions}</select>
      </label>
      <label>Since (ISO)
        <input type="text" name="since" value="${escapeHtml(sinceRaw)}" />
      </label>
      <label>Until (ISO)
        <input type="text" name="until" value="${escapeHtml(untilRaw)}" />
      </label>
      <div class="actions"><button type="submit">Filter</button> <a class="btn secondary" href="/logs/app">Clear</a></div>
    </form>
    <div class="meta"><span>${logs.length} rows (max 200)</span></div>
    <table>
      <thead><tr><th>Time</th><th>Level</th><th>Game</th><th>Message</th><th>Context</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5">No app logs matched.</td></tr>`}</tbody>
    </table>`;

  res.type("html").send(layout({ title: "App logs", user, flash: flash(req), body }));
});

app.get("/healthz", (_req, res) => {
  res.type("text").send("ok");
});

const port = adminConfig.port;
app.listen(port, () => {
  console.log(`Grimkeeper admin listening on http://localhost:${port}`);
  console.log(`OAuth callback: ${adminConfig.redirectUri()}`);
});
