import type { Client, TextChannel } from "discord.js";

import { getBotClient } from "./discord-client.js";
import { log, logError, serializeError } from "./logger.js";

const DISCORD_MESSAGE_LIMIT = 2000;
const DEDUPE_WINDOW_MS = 60_000;
const MIN_SEND_INTERVAL_MS = 1_500;
const MAX_QUEUE_SIZE = 50;

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

function codeBlock(language: string, body: string): string {
  const fence = "```";
  return `${fence}${language}\n${body}\n${fence}`;
}

function truncateBlock(language: string, body: string, maxChars: number): string {
  if (body.length <= maxChars) {
    return codeBlock(language, body);
  }
  const suffix = "\n… (truncated)";
  const budget = Math.max(0, maxChars - language.length - suffix.length - 8);
  return codeBlock(language, `${body.slice(0, budget)}${suffix}`);
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

function formatMetaBlock(meta: Record<string, unknown>): string {
  const lines = Object.entries(meta)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${formatContextValue(value)}`);
  return codeBlock("yaml", lines.join("\n"));
}

export function formatErrorForDiscord(
  source: string,
  error: unknown,
  context: Record<string, unknown> = {},
): string {
  const serialized = serializeError(error);
  const message = extractErrorMessage(error, serialized);
  const meta = extractErrorMeta(source, error, serialized, context);

  const parts = [`**[${source}]**`, formatMetaBlock(meta), truncateBlock("", message, 700)];

  if (typeof serialized.stack === "string") {
    parts.push(truncateBlock("", serialized.stack, 900));
  }

  let text = parts.join("\n");
  if (text.length > DISCORD_MESSAGE_LIMIT) {
    const stack = typeof serialized.stack === "string" ? serialized.stack : "";
    const withoutStack = parts.slice(0, 3).join("\n");
    const remaining = DISCORD_MESSAGE_LIMIT - withoutStack.length - 30;
    if (remaining > 80 && stack) {
      text = `${withoutStack}\n${truncateBlock("", stack, remaining)}`;
    } else {
      text = `${withoutStack}\n… (truncated)`;
    }
  }

  return text.slice(0, DISCORD_MESSAGE_LIMIT);
}

export function formatLifecycleForDiscord(
  source: string,
  context: Record<string, unknown> = {},
): string {
  const meta: Record<string, unknown> = {
    time: new Date().toISOString(),
    source,
    ...context,
  };
  return `**[${source}]**\n${formatMetaBlock(meta)}`.slice(0, DISCORD_MESSAGE_LIMIT);
}

function fingerprint(source: string, error: unknown): string {
  const serialized = serializeError(error);
  const message = typeof serialized.error === "string" ? serialized.error : String(error);
  const stackLine =
    typeof serialized.stack === "string" ? serialized.stack.split("\n")[1]?.trim() ?? "" : "";
  return `${source}:${message}:${stackLine}`;
}

function shouldSkipDuplicate(source: string, error: unknown): boolean {
  const key = fingerprint(source, error);
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
  if (shouldSkipDuplicate(report.source, report.error)) return;

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

async function sendToErrorChannel(client: Client, content: string): Promise<void> {
  const channelId = getErrorChannelId();
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) {
    logError("warn", "errorReporter.channel.unavailable", new Error("ERROR_CHANNEL_ID is not a text channel"), {
      channelId,
    });
    return;
  }

  await (channel as TextChannel).send({ content }).catch((sendError: unknown) => {
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
  const content = formatErrorForDiscord(report.source, report.error, report.context);
  await sendToErrorChannel(resolvedClient, content);

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
  await sendToErrorChannel(resolvedClient, formatLifecycleForDiscord(source, context));
}

export async function reportError(
  source: string,
  error: unknown,
  context: Record<string, unknown> = {},
): Promise<void> {
  logError("error", source, error, context);
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
