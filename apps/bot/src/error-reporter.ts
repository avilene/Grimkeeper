import { EmbedBuilder, type APIEmbed, type Client, type TextChannel } from "discord.js";
import * as Sentry from "@sentry/node";

import { getBotClient } from "./discord-client.js";
import { log, logError, serializeError } from "./logger.js";

const DEDUPE_WINDOW_MS = 15_000;
const MIN_SEND_INTERVAL_MS = 750;
const MAX_QUEUE_SIZE = 50;
const EMBED_FIELD_LIMIT = 1024;

const COLOR_ERROR = 0xed4245;
const COLOR_LIFECYCLE = 0x57f287;
const COLOR_INFO = 0x5865f2;

type PendingReport = {
  source: string;
  error: unknown;
  context: Record<string, unknown>;
};

const pendingReports: PendingReport[] = [];
const recentFingerprints = new Map<string, number>();
let lastSentAt = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let processHandlersInstalled = false;

export function getErrorChannelId(): string | null {
  const value = process.env.ERROR_CHANNEL_ID?.trim();
  return value ? value : null;
}

function formatContextValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const TRUNCATED_SUFFIX = "\n… (truncated)";

function wrapCodeBlock(body: string, max = EMBED_FIELD_LIMIT, language?: string): string {
  const open = language ? `\`\`\`${language}\n` : "```\n";
  const close = "\n```";
  const maxBodyLength = max - open.length - close.length;
  let content = body;
  if (content.length > maxBodyLength) {
    const sliceLength = Math.max(0, maxBodyLength - TRUNCATED_SUFFIX.length);
    content = `${content.slice(0, sliceLength)}${TRUNCATED_SUFFIX}`;
  }
  return `${open}${content}${close}`;
}

function yamlField(meta: Record<string, unknown>): string {
  const lines = Object.entries(meta)
    .filter(([key, value]) => value !== undefined && key !== "time")
    .map(([key, value]) => `${key}: ${formatContextValue(value)}`);
  return wrapCodeBlock(lines.join("\n"), EMBED_FIELD_LIMIT, "yaml");
}

function codeField(body: string): string {
  return wrapCodeBlock(body);
}

function embedColorForSource(source: string, hasError: boolean): number {
  if (hasError || source.includes("failed") || source.startsWith("process.")) {
    return COLOR_ERROR;
  }
  if (source.endsWith(".started") || source === "bot.ready") {
    return COLOR_LIFECYCLE;
  }
  return COLOR_INFO;
}

function parseEmbedTimestamp(meta: Record<string, unknown>): Date {
  if (typeof meta.time === "string") {
    const parsed = Date.parse(meta.time);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  return new Date();
}

function formatCommandPath(context: Record<string, unknown>): string | undefined {
  const command = context.command;
  const subcommand = context.subcommand;
  if (typeof command !== "string" || !command) return undefined;
  if (typeof subcommand === "string" && subcommand) {
    return `/${command} ${subcommand}`;
  }
  return `/${command}`;
}

function buildFullErrorLogText(
  meta: Record<string, unknown>,
  message: string,
  stack?: string,
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${formatContextValue(value)}`);
  }
  lines.push("");
  lines.push(`message: ${message}`);
  if (stack) {
    lines.push("");
    lines.push(stack);
  }
  return lines.join("\n");
}

export function buildDiscordLogEmbed(
  source: string,
  meta: Record<string, unknown>,
  options: { message?: string; stack?: string } = {},
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(source)
    .setColor(embedColorForSource(source, Boolean(options.message)))
    .setTimestamp(parseEmbedTimestamp(meta))
    .addFields({ name: "Details", value: yamlField({ source, ...meta }), inline: false });

  if (options.message) {
    embed.addFields({ name: "Message", value: codeField(options.message), inline: false });
  }
  if (options.stack) {
    embed.addFields({ name: "Stack", value: codeField(options.stack), inline: false });
  }

  return embed;
}

function extractErrorMessage(error: unknown, serialized: Record<string, unknown>): string {
  if (typeof serialized.error === "string" && serialized.error) {
    return serialized.error;
  }
  if (typeof serialized.message === "string" && serialized.message) {
    return serialized.message;
  }
  return String(error);
}

function extractErrorMeta(
  source: string,
  error: unknown,
  serialized: Record<string, unknown>,
  context: Record<string, unknown>,
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    time: new Date().toISOString(),
    source,
    ...context,
  };

  if (typeof serialized.errorName === "string") {
    meta.type = serialized.errorName;
  } else if (error instanceof Error) {
    meta.type = error.name;
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (record.code !== undefined) meta.code = record.code;
    if (record.status !== undefined) meta.status = record.status;
    if (typeof record.method === "string") meta.method = record.method;
    if (typeof record.url === "string") meta.url = record.url;
  }

  if (typeof serialized.stack === "string") {
    const frame = serialized.stack.split("\n")[1]?.trim();
    if (frame) meta.at = frame;
  }

  return meta;
}

export function buildErrorLogEmbed(
  source: string,
  error: unknown,
  context: Record<string, unknown> = {},
): EmbedBuilder {
  const serialized = serializeError(error);
  const message = extractErrorMessage(error, serialized);
  const meta = extractErrorMeta(source, error, serialized, context);
  const commandPath = formatCommandPath(context);
  if (commandPath) meta.command = commandPath;

  const stack = typeof serialized.stack === "string" ? serialized.stack : undefined;
  const fullLog = buildFullErrorLogText(meta, message, stack);
  const title = commandPath ? `${source} · ${commandPath}` : source;

  const embed = buildDiscordLogEmbed(source, meta)
    .setTitle(title)
    .addFields({ name: "Log", value: codeField(fullLog), inline: false });

  return embed;
}

export function buildLifecycleLogEmbed(
  source: string,
  context: Record<string, unknown> = {},
): EmbedBuilder {
  const meta: Record<string, unknown> = {
    time: new Date().toISOString(),
    source,
    ...context,
  };
  return buildDiscordLogEmbed(source, meta);
}

/** @deprecated Use buildErrorLogEmbed */
export function formatErrorForDiscord(
  source: string,
  error: unknown,
  context: Record<string, unknown> = {},
): string {
  return JSON.stringify(buildErrorLogEmbed(source, error, context).toJSON());
}

/** @deprecated Use buildLifecycleLogEmbed */
export function formatLifecycleForDiscord(
  source: string,
  context: Record<string, unknown> = {},
): string {
  return JSON.stringify(buildLifecycleLogEmbed(source, context).toJSON());
}

function fingerprint(source: string, error: unknown, context: Record<string, unknown> = {}): string {
  const serialized = serializeError(error);
  const message = typeof serialized.error === "string" ? serialized.error : String(error);
  const stackLine =
    typeof serialized.stack === "string" ? serialized.stack.split("\n")[1]?.trim() ?? "" : "";
  const guildId = typeof context.guildId === "string" ? context.guildId : "";
  const command =
    typeof context.command === "string"
      ? `${context.command}:${typeof context.subcommand === "string" ? context.subcommand : ""}`
      : "";
  return `${source}:${guildId}:${command}:${message}:${stackLine}`;
}

function shouldSkipDuplicate(
  source: string,
  error: unknown,
  context: Record<string, unknown> = {},
): boolean {
  const key = fingerprint(source, error, context);
  const now = Date.now();
  const lastSeen = recentFingerprints.get(key);
  recentFingerprints.set(key, now);

  for (const [seenKey, seenAt] of recentFingerprints) {
    if (now - seenAt > DEDUPE_WINDOW_MS) {
      recentFingerprints.delete(seenKey);
    }
  }

  return lastSeen !== undefined && now - lastSeen < DEDUPE_WINDOW_MS;
}

function queueDiscordReport(report: PendingReport): void {
  if (!getErrorChannelId()) return;
  if (shouldSkipDuplicate(report.source, report.error, report.context)) return;

  if (pendingReports.length >= MAX_QUEUE_SIZE) {
    pendingReports.shift();
  }
  pendingReports.push(report);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushDiscordReports();
  }, MIN_SEND_INTERVAL_MS);
}

async function sendToErrorChannel(client: Client, embed: APIEmbed): Promise<void> {
  const channelId = getErrorChannelId();
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    logError("warn", "errorReporter.channel.unavailable", new Error("ERROR_CHANNEL_ID is not a text channel"), {
      channelId,
    });
    return;
  }

  await (channel as TextChannel).send({ embeds: [embed] }).catch((sendError: unknown) => {
    logError("warn", "errorReporter.channel.sendFailed", sendError, { channelId });
  });
}

export async function flushDiscordReports(client?: Client | null): Promise<void> {
  const resolvedClient = client ?? getBotClient();
  if (!resolvedClient?.isReady() || pendingReports.length === 0) {
    if (pendingReports.length > 0) {
      scheduleFlush();
    }
    return;
  }

  const now = Date.now();
  if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
    scheduleFlush();
    return;
  }

  const report = pendingReports.shift();
  if (!report) return;

  lastSentAt = now;
  const embed = buildErrorLogEmbed(report.source, report.error, report.context).toJSON();
  await sendToErrorChannel(resolvedClient, embed);

  if (pendingReports.length > 0) {
    scheduleFlush();
  }
}

export async function notifyLifecycle(
  source: string,
  context: Record<string, unknown> = {},
  client?: Client | null,
): Promise<void> {
  log("info", source, context);
  const resolvedClient = client ?? getBotClient();
  if (!resolvedClient?.isReady() || !getErrorChannelId()) return;
  await sendToErrorChannel(resolvedClient, buildLifecycleLogEmbed(source, context).toJSON());
}

function captureInSentry(
  source: string,
  error: unknown,
  context: Record<string, unknown>,
): void {
  if (!Sentry.getClient()) return;

  Sentry.withScope((scope) => {
    scope.setTag("source", source);
    scope.setLevel("error");
    for (const [key, value] of Object.entries(context)) {
      if (value === undefined) continue;
      scope.setExtra(key, value);
    }
    if (error instanceof Error) {
      Sentry.captureException(error);
      return;
    }
    Sentry.captureException(new Error(typeof error === "string" ? error : source), {
      extra: { original: error },
    });
  });
}

export async function reportError(
  source: string,
  error: unknown,
  context: Record<string, unknown> = {},
): Promise<void> {
  logError("error", source, error, context);
  captureInSentry(source, error, context);
  queueDiscordReport({ source, error, context });
  await flushDiscordReports();
}

export function installProcessErrorHandlers(): void {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;

  process.on("uncaughtException", (error) => {
    void reportError("process.uncaughtException", error);
  });

  process.on("unhandledRejection", (reason) => {
    void reportError("process.unhandledRejection", reason);
  });
}

export function registerClientErrorHandlers(client: Client): void {
  client.on("error", (error) => {
    void reportError("discord.client", error);
  });

  client.on("shardError", (error, shardId) => {
    void reportError("discord.shard", error, { shardId });
  });

  client.on("warn", (message) => {
    log("warn", "discord.warn", { message });
  });
}
