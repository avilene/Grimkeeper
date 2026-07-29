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
  ensureDiscussionChannelSendable,
  formatBlockContestSummary,
  formatNominationBlockField,
  formatNominationRef,
  postNominationToChannel,
  sanitizeMarkdownLinkLabel,
  townPhaseBaseChannelName,
  townPhaseParentChannelName,
  townVoteThreadName,
  type DayDiscussionChannel,
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

/** TownSetup enters Setup; day commands need Day 1 after next-phase twice. */
function advanceToDay1(engine: GameEngine): void {
  for (const event of engine.handle({
    kind: GameCommandKind.AdvancePhase,
    gameId,
    targetPhase: "night",
  })) {
    engine.apply(event);
  }
  for (const event of engine.handle({
    kind: GameCommandKind.AdvancePhase,
    gameId,
    targetPhase: "day",
  })) {
    engine.apply(event);
  }
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
    advanceToDay1(engine);

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
      "**1** yes needed to pass (2 alive)",
    );
    const voteOrder = embed.data.fields?.find((field) => field.name === "Vote order")?.value;
    expect(voteOrder).toContain("1. Alice");
    expect(voteOrder).toContain("2. Bob");
    expect(voteOrder).toContain("_pending_");
  });

  it("keeps private ST-thread ballots off the Town Voting roll", () => {
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
        {
          playerId: "p3",
          discordUserId: "u3",
          displayName: "Carol",
          seat: 3,
        },
      ],
      timestamp: new Date().toISOString(),
    });
    advanceToDay1(engine);

    const nominationEvents = engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: "p1",
      nomineeId: "p2",
      accusation: "Looks evil.",
    });
    for (const event of nominationEvents) engine.apply(event);
    const nomination = engine.getState().day!.nominations[0]!;

    for (const event of engine.handle({
      kind: GameCommandKind.CastVote,
      gameId,
      nominationId: nomination.id,
      voterId: "p3",
      choice: "yes",
    })) {
      engine.apply(event);
    }
    for (const event of engine.handle({
      kind: GameCommandKind.CastVote,
      gameId,
      nominationId: nomination.id,
      voterId: "p3",
      choice: "no",
      privateBallot: true,
    })) {
      engine.apply(event);
    }

    const embed = buildNominationEmbed(engine, nomination);
    const votes = embed.data.fields?.find((field) => field.name === "Votes")?.value;
    const voteOrder = embed.data.fields?.find((field) => field.name === "Vote order")?.value;
    expect(votes).toContain("Yes: 1");
    expect(votes).toContain("No: 0");
    expect(voteOrder).toContain("Carol");
    expect(voteOrder).toContain("**yes**");
    expect(voteOrder).not.toContain("**no**");
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
    advanceToDay1(engine);

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

  it("updates the Votes close embed field after NominationVoteDeadlineUpdated", () => {
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
    advanceToDay1(engine);

    for (const event of engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: "p1",
      nomineeId: "p2",
      accusation: "Looks evil.",
    })) {
      engine.apply(event);
    }
    const nomination = engine.getState().day!.nominations[0]!;
    const nextDeadline = "2026-07-02T20:00:00.000Z";
    engine.apply({
      type: GameEventType.NominationVoteDeadlineUpdated,
      gameId,
      nominationId: nomination.id,
      voteDeadlineAt: nextDeadline,
      timestamp: new Date().toISOString(),
    });

    const updated = engine.getNominationById(nomination.id)!;
    const embed = buildNominationEmbed(engine, updated);
    const deadlineField = embed.data.fields?.find((field) => field.name === "Votes close");
    expect(deadlineField?.value).toBe(
      `<t:${Math.floor(new Date(nextDeadline).getTime() / 1000)}:R>`,
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
    advanceToDay1(engine);
    for (const event of engine.handle({
      kind: GameCommandKind.SetVoteVisibility,
      gameId,
      visibility: "secret",
    })) {
      engine.apply(event);
    }
    for (const event of engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: "p1",
      nomineeId: "p2",
      accusation: "Looks evil.",
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

  it("keeps existing nomination embeds public after a mid-day secret toggle", () => {
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
    advanceToDay1(engine);
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
    expect(embed.data.fields?.find((field) => field.name === "Votes")?.value).toContain("Yes:");
    expect(embed.data.fields?.find((field) => field.name === "Vote order")).toBeDefined();
  });
});

describe("block contest display", () => {
  function townEngine(playerCount: number): GameEngine {
    const engine = GameEngine.fromEvents(gameId, baseEvents());
    const players = Array.from({ length: playerCount }, (_, index) => ({
      playerId: `p${index + 1}`,
      discordUserId: `u${index + 1}`,
      displayName: `Player ${index + 1}`,
      seat: index + 1,
    }));
    engine.apply({
      type: GameEventType.TownSetup,
      gameId,
      channelId: "channel-1",
      players,
      timestamp: new Date().toISOString(),
    });
    advanceToDay1(engine);
    return engine;
  }

  it("shows block leader on remaining open nominations after a resolve", () => {
    const engine = townEngine(4);
    const players = engine.getState().players;

    for (const event of engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[0]!.id,
      nomineeId: players[1]!.id,
      accusation: "First.",
    })) {
      engine.apply(event);
    }
    for (const event of engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: players[2]!.id,
      nomineeId: players[3]!.id,
      accusation: "Second.",
    })) {
      engine.apply(event);
    }

    const first = engine.getState().day!.nominations[0]!;
    const second = engine.getState().day!.nominations[1]!;

    for (const voter of [players[0]!, players[2]!, players[3]!]) {
      for (const event of engine.handle({
        kind: GameCommandKind.CastVote,
        gameId,
        nominationId: first.id,
        voterId: voter.id,
        choice: "yes",
      })) {
        engine.apply(event);
      }
    }

    for (const event of engine.handle({
      kind: GameCommandKind.ResolveNomination,
      gameId,
      nominationId: first.id,
    })) {
      engine.apply(event);
    }

    const resolvedField = formatNominationBlockField(engine, engine.getNominationById(first.id)!);
    expect(resolvedField).toContain("On the block for execution");
    expect(resolvedField).toContain("**3** yes");

    const openField = formatNominationBlockField(engine, second);
    expect(openField).toContain("**2** yes needed to pass");
    expect(openField).toContain("Player 2");
    expect(openField).toContain("on the block");
    expect(formatBlockContestSummary(engine)).toContain("Player 2");
  });
});

describe("sanitizeMarkdownLinkLabel", () => {
  it("strips bracket nickname tags that would break Discord links", () => {
    expect(sanitizeMarkdownLinkLabel("nomination of arlie on sharii🦀 [craboots!]")).toBe(
      "nomination of arlie on sharii🦀",
    );
    expect(sanitizeMarkdownLinkLabel("Alice [ST] (night)")).toBe("Alice");
  });
});

describe("formatNominationRef", () => {
  it("appends a jump URL for plain Discord message content", () => {
    const engine = GameEngine.fromEvents(gameId, baseEvents());
    engine.apply({
      type: GameEventType.TownSetup,
      gameId,
      channelId: "channel-1",
      players: [
        {
          playerId: "p1",
          discordUserId: "u1",
          displayName: "arlie",
          seat: 1,
        },
        {
          playerId: "p2",
          discordUserId: "u2",
          displayName: "sharii🦀 [craboots!]",
          seat: 2,
        },
      ],
      timestamp: new Date().toISOString(),
    });
    advanceToDay1(engine);
    for (const event of engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: "p1",
      nomineeId: "p2",
      accusation: "test",
    })) {
      engine.apply(event);
    }

    const nominationId = engine.getState().day!.nominations[0]!.id;
    const url = "https://discord.com/channels/1/2/3";
    expect(formatNominationRef(engine, nominationId, url)).toBe(
      `[nomination of arlie on sharii🦀](${url})`,
    );
    expect(formatNominationRef(engine, nominationId, null)).toBe(
      "nomination of arlie on sharii🦀 [craboots!]",
    );
  });
});

describe("ensureDiscussionChannelSendable", () => {
  it("unarchives Town Voting before posting so kib ST noms can send", async () => {
    const setArchived = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue({ id: "msg-1" });
    const channel = {
      id: "vote-1",
      isThread: () => true,
      archived: true,
      setArchived,
      send,
    } as unknown as DayDiscussionChannel;

    await ensureDiscussionChannelSendable(channel, "test");
    expect(setArchived).toHaveBeenCalledWith(false, "test");
  });

  it("unarchives before postNominationToChannel send", async () => {
    const engine = GameEngine.fromEvents(gameId, baseEvents());
    engine.apply({
      type: GameEventType.TownSetup,
      gameId,
      channelId: "channel-1",
      players: [
        { playerId: "p1", discordUserId: "u1", displayName: "Alice", seat: 1 },
        { playerId: "p2", discordUserId: "u2", displayName: "Bob", seat: 2 },
      ],
      timestamp: new Date().toISOString(),
    });
    advanceToDay1(engine);
    for (const event of engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: "p1",
      nomineeId: "p2",
      accusation: "evil",
    })) {
      engine.apply(event);
    }
    const nominationId = engine.getState().day!.nominations[0]!.id;

    const setArchived = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue({ id: "msg-1" });
    const channel = {
      id: "vote-1",
      type: 11,
      isThread: () => true,
      archived: true,
      locked: false,
      setArchived,
      send,
    } as unknown as DayDiscussionChannel;

    const message = await postNominationToChannel(engine, gameId, channel, nominationId, {
      pingRoleId: "role-1",
    });
    expect(setArchived).toHaveBeenCalledWith(false, "Posting nomination to Town Voting.");
    expect(send).toHaveBeenCalledOnce();
    expect(message).toEqual({ id: "msg-1" });
  });

  it("retries without mentions when the first send is rejected", async () => {
    const engine = GameEngine.fromEvents(gameId, baseEvents());
    engine.apply({
      type: GameEventType.TownSetup,
      gameId,
      channelId: "channel-1",
      players: [
        { playerId: "p1", discordUserId: "u1", displayName: "Alice", seat: 1 },
        { playerId: "p2", discordUserId: "u2", displayName: "Bob", seat: 2 },
      ],
      timestamp: new Date().toISOString(),
    });
    advanceToDay1(engine);
    for (const event of engine.handle({
      kind: GameCommandKind.MakeNomination,
      gameId,
      nominatorId: "p1",
      nomineeId: "p2",
      accusation: "evil",
    })) {
      engine.apply(event);
    }
    const nominationId = engine.getState().day!.nominations[0]!.id;

    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("Missing Permissions"))
      .mockResolvedValueOnce({ id: "msg-2" });
    const channel = {
      id: "vote-1",
      type: 11,
      isThread: () => true,
      archived: false,
      locked: false,
      setArchived: vi.fn(),
      setLocked: vi.fn(),
      send,
    } as unknown as DayDiscussionChannel;

    const message = await postNominationToChannel(engine, gameId, channel, nominationId, {
      pingRoleId: "role-1",
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]?.allowedMentions).toEqual({ parse: [] });
    expect(message).toEqual({ id: "msg-2" });
  });
});

describe("town phase channel naming", () => {
  it("keeps a stable Town Voting thread name", () => {
    expect(townVoteThreadName("abcdef12-3456")).toBe("Town Voting");
    expect(townVoteThreadName()).toBe("Town Voting");
  });

  it("builds base-dayN / base-nightN / setup parent names and strips prior suffixes", () => {
    expect(townPhaseBaseChannelName("trouble-brewing")).toBe("trouble-brewing");
    expect(townPhaseBaseChannelName("trouble-brewing-day1")).toBe("trouble-brewing");
    expect(townPhaseBaseChannelName("trouble-brewing-night2")).toBe("trouble-brewing");
    expect(townPhaseBaseChannelName("trouble-brewing-setup")).toBe("trouble-brewing");
    expect(townPhaseParentChannelName("trouble-brewing", "day", 1)).toBe("trouble-brewing-day1");
    expect(townPhaseParentChannelName("trouble-brewing-day1", "night", 2)).toBe(
      "trouble-brewing-night2",
    );
    expect(townPhaseParentChannelName("trouble-brewing-night2", "day", 2)).toBe(
      "trouble-brewing-day2",
    );
    expect(townPhaseParentChannelName("trouble-brewing-night1", "setup")).toBe(
      "trouble-brewing-setup",
    );
  });
});
