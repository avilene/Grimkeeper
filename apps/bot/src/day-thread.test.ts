import { describe, expect, it, vi } from "vitest";
import {
  GameCommandKind,
  GameEngine,
  GameEventType,
  type GameEvent,
  resolveStandardScript,
  StandardEdition,
} from "@grimkeeper/engine";

import {
  buildNominationEmbed,
  townPhaseBaseChannelName,
  townPhaseParentChannelName,
  townVoteThreadName,
} from "./day-thread.js";

const gameId = "day-thread-test";
const script = resolveStandardScript(StandardEdition.TB);

function baseEvents(): GameEvent[] {
  return [
    {
      type: GameEventType.GameCreated,
      gameId,
      guildId: "guild-1",
      channelId: "channel-1",
      storytellerId: "story-1",
      script,
      timestamp: new Date().toISOString(),
    },
  ];
}

describe("buildNominationEmbed", () => {
  it("titles the embed as nomination of nominator on nominee", () => {
    const engine = GameEngine.fromEvents(gameId, baseEvents());
    engine.apply({
      type: GameEventType.TownSetup,
      gameId,
      channelId: "channel-1",
      players: [
        {
          playerId: "p1",
          discordUserId: "u1",
          displayName: "Alice",
          seat: 1,
        },
        {
          playerId: "p2",
          discordUserId: "u2",
          displayName: "Bob",
          seat: 2,
        },
      ],
      timestamp: new Date().toISOString(),
    });

    const nominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: "p1",
      nomineeId: "p2",
      accusation: "Looks evil.",
    });
    for (const event of nominationEvents) engine.apply(event);

    const nomination = engine.getState().day!.nominations[0]!;
    const embed = buildNominationEmbed(engine, nomination);
    expect(embed.data.title).toBe("Nomination of Alice on Bob");
    expect(embed.data.fields?.find((field) => field.name === "On the block")?.value).toBe(
      "**2** yes needed (2 alive)",
    );
    const voteOrder = embed.data.fields?.find((field) => field.name === "Vote order")?.value;
    expect(voteOrder).toContain("1. Alice");
    expect(voteOrder).toContain("2. Bob");
    expect(voteOrder).toContain("_pending_");
  });

  it("includes a vote deadline field when voteDeadlineAt is set", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));

    const engine = GameEngine.fromEvents(gameId, baseEvents());
    engine.apply({
      type: GameEventType.TownSetup,
      gameId,
      channelId: "channel-1",
      players: [
        {
          playerId: "p1",
          discordUserId: "u1",
          displayName: "Alice",
          seat: 1,
        },
        {
          playerId: "p2",
          discordUserId: "u2",
          displayName: "Bob",
          seat: 2,
        },
      ],
      timestamp: new Date().toISOString(),
    });

    const nominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: "p1",
      nomineeId: "p2",
      accusation: "Looks evil.",
    });
    for (const event of nominationEvents) engine.apply(event);

    const nomination = engine.getState().day!.nominations[0]!;
    const embed = buildNominationEmbed(engine, nomination);
    const deadlineField = embed.data.fields?.find((field) => field.name === "Votes close");

    expect(deadlineField?.value).toBe(
      `<t:${Math.floor(new Date(nomination.voteDeadlineAt!).getTime() / 1000)}:R>`,
    );

    vi.useRealTimers();
  });

  it("hides the vote order list in secret visibility", () => {
    const engine = GameEngine.fromEvents(gameId, baseEvents());
    engine.apply({
      type: GameEventType.TownSetup,
      gameId,
      channelId: "channel-1",
      players: [
        {
          playerId: "p1",
          discordUserId: "u1",
          displayName: "Alice",
          seat: 1,
        },
        {
          playerId: "p2",
          discordUserId: "u2",
          displayName: "Bob",
          seat: 2,
        },
      ],
      timestamp: new Date().toISOString(),
    });
    for (const event of engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: "p1",
      nomineeId: "p2",
      accusation: "Looks evil.",
    })) {
      engine.apply(event);
    }
    for (const event of engine.handle({
      kind: GameCommandKind.SetVoteVisibility,
      gameId,
      visibility: "secret",
    })) {
      engine.apply(event);
    }

    const nomination = engine.getState().day!.nominations[0]!;
    const embed = buildNominationEmbed(engine, nomination);
    expect(embed.data.fields?.find((field) => field.name === "Votes")?.value).toBe(
      "Votes recorded (secret mode)",
    );
    expect(embed.data.fields?.find((field) => field.name === "Vote order")).toBeUndefined();
  });
});

describe("town phase channel naming", () => {
  it("keeps a stable Town Voting thread name", () => {
    expect(townVoteThreadName("abcdef12-3456")).toBe("Town Voting · abcdef");
  });

  it("builds base-dayN / base-nightN parent names and strips prior suffixes", () => {
    expect(townPhaseBaseChannelName("trouble-brewing")).toBe("trouble-brewing");
    expect(townPhaseBaseChannelName("trouble-brewing-day1")).toBe("trouble-brewing");
    expect(townPhaseBaseChannelName("trouble-brewing-night2")).toBe("trouble-brewing");
    expect(townPhaseParentChannelName("trouble-brewing", "day", 1)).toBe("trouble-brewing-day1");
    expect(townPhaseParentChannelName("trouble-brewing-day1", "night", 2)).toBe(
      "trouble-brewing-night2",
    );
    expect(townPhaseParentChannelName("trouble-brewing-night2", "day", 2)).toBe(
      "trouble-brewing-day2",
    );
  });
});
