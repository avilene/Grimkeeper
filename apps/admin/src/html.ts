import type { SessionUser } from "./auth.js";

function escapeHtml(value: string | number | boolean | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function layout(opts: {
  title: string;
  user?: SessionUser | null;
  flash?: string | null;
  body: string;
}): string {
  const nav = opts.user
    ? `<nav class="nav">
        <a href="/">Games</a>
        <a href="/logs">Game events</a>
        <a href="/logs/app">App logs</a>
        <span class="spacer"></span>
        <span class="user">${escapeHtml(opts.user.globalName ?? opts.user.username)} · ${escapeHtml(opts.user.id)}</span>
        <a href="/logout">Logout</a>
      </nav>`
    : "";

  const flash = opts.flash
    ? `<p class="flash">${escapeHtml(opts.flash)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)} · Grimkeeper Admin</title>
  <style>
    :root {
      --bg: #e8edf2;
      --ink: #15202b;
      --muted: #4a5a6a;
      --line: #b8c4d0;
      --card: #f7fafc;
      --accent: #1f6feb;
      --warn: #9a3412;
      --danger-bg: #ffedd5;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Source Sans 3", "Helvetica Neue", sans-serif;
      background:
        linear-gradient(135deg, #dce6f0 0%, transparent 40%),
        linear-gradient(180deg, #eef2f6, var(--bg));
      color: var(--ink);
      line-height: 1.45;
      min-height: 100vh;
    }
    main { max-width: 1100px; margin: 0 auto; padding: 1.5rem; }
    h1, h2, h3 { font-family: "Source Sans 3", "Helvetica Neue", sans-serif; font-weight: 700; margin: 0 0 0.6rem; }
    p { margin: 0 0 1rem; color: var(--muted); }
    a { color: var(--accent); }
    .nav {
      display: flex; gap: 1rem; align-items: center;
      border-bottom: 1px solid var(--line);
      padding: 0.85rem 1.5rem;
      background: rgba(247,250,252,0.92);
      position: sticky; top: 0;
    }
    .nav .spacer { flex: 1; }
    .nav .user { color: var(--muted); font-size: 0.9rem; }
    .flash {
      background: #dbeafe;
      border: 1px solid #93c5fd;
      color: #1e40af;
      padding: 0.75rem 1rem;
      border-radius: 4px;
    }
    .warn {
      background: var(--danger-bg);
      border: 1px solid #fdba74;
      color: var(--warn);
      padding: 0.85rem 1rem;
      border-radius: 4px;
      margin-bottom: 1.25rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--card);
      border: 1px solid var(--line);
    }
    th, td {
      text-align: left;
      padding: 0.65rem 0.75rem;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      font-size: 0.92rem;
    }
    th { background: #d9e2ec; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
    tr:last-child td { border-bottom: none; }
    code, .mono { font-family: "Source Code Pro", ui-monospace, monospace; font-size: 0.85rem; }
    .badge {
      display: inline-block;
      padding: 0.1rem 0.45rem;
      border-radius: 3px;
      border: 1px solid var(--line);
      background: #eef2f6;
      font-size: 0.78rem;
    }
    .badge.active { border-color: #93c5fd; background: #dbeafe; color: #1e40af; }
    .badge.ended { opacity: 0.7; }
    form.edit {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      background: var(--card);
      border: 1px solid var(--line);
      padding: 1rem;
      margin-bottom: 1.5rem;
    }
    label { display: grid; gap: 0.3rem; font-size: 0.82rem; color: var(--muted); }
    input[type="text"], input[type="number"] {
      width: 100%;
      padding: 0.45rem 0.55rem;
      border: 1px solid var(--line);
      border-radius: 3px;
      background: #fff;
      color: var(--ink);
      font: inherit;
    }
    .actions { grid-column: 1 / -1; display: flex; gap: 0.75rem; align-items: center; }
    button, .btn {
      appearance: none;
      border: 1px solid var(--accent);
      background: var(--accent);
      color: #fff;
      padding: 0.5rem 0.9rem;
      border-radius: 3px;
      font: inherit;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
    }
    button.secondary, .btn.secondary {
      background: transparent;
      color: var(--accent);
    }
    .login-box {
      max-width: 420px;
      margin: 4rem auto;
      background: var(--card);
      border: 1px solid var(--line);
      padding: 2rem;
    }
    .meta { display: flex; flex-wrap: wrap; gap: 0.75rem 1.25rem; margin-bottom: 1.25rem; }
    .meta span { color: var(--muted); font-size: 0.9rem; }
    .section { margin-top: 2rem; }
    form.filters {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      background: var(--card);
      border: 1px solid var(--line);
      padding: 1rem;
      margin-bottom: 1rem;
      align-items: end;
    }
    form.filters .actions { margin: 0; }
    pre.payload {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: "Source Code Pro", ui-monospace, monospace;
      font-size: 0.78rem;
      max-height: 12rem;
      overflow: auto;
      background: #eef2f6;
      padding: 0.4rem 0.5rem;
      border: 1px solid var(--line);
    }
    details summary { cursor: pointer; color: var(--accent); font-size: 0.85rem; }
  </style>
</head>
<body>
  ${nav}
  <main>
    <h1>${escapeHtml(opts.title)}</h1>
    ${flash}
    ${opts.body}
  </main>
</body>
</html>`;
}

export { escapeHtml, layout };
