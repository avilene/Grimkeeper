import { describe, expect, it } from "vitest";

import { encodeIdPair, parseIdPair } from "./interaction-ids.js";
import {
  parseVoteButtonCustomId,
  parseVoteModalCustomId,
  voteButtonCustomId,
  voteModalCustomId,
} from "./day-thread.js";
import {
  announceBlockButtonCustomId,
  cancelCountButtonCustomId,
  countNoButtonCustomId,
  countYesButtonCustomId,
  lockVotesButtonCustomId,
  parseLockVotesButtonCustomId,
  parseVoteTrackerButtonCustomId,
  pingHandButtonCustomId,
  pingMissingButtonCustomId,
  startCountButtonCustomId,
  unlockVotesButtonCustomId,
} from "./st-vote-tracker.js";

const gameId = "6911cd74-25ba-46f5-a57f-e9420bc219af";
const nominationId = "a1111111-2222-4333-8444-555555555555";

describe("parseIdPair", () => {
  it("parses dot-separated UUID pairs", () => {
    expect(parseIdPair(encodeIdPair(gameId, nominationId))).toEqual({
      left: gameId,
      right: nominationId,
    });
  });

  it("parses legacy colon and pipe separators", () => {
    expect(parseIdPair(`${gameId}:${nominationId}`)).toEqual({
      left: gameId,
      right: nominationId,
    });
    expect(parseIdPair(`${gameId}|${nominationId}`)).toEqual({
      left: gameId,
      right: nominationId,
    });
  });

  it("ignores trailing modal nonces", () => {
    expect(parseIdPair(`${gameId}.${nominationId}.lmno12`)).toEqual({
      left: gameId,
      right: nominationId,
    });
  });

  it("rejects payloads without two UUIDs", () => {
    expect(parseIdPair(`${gameId.split("-")[0]}:${nominationId}`)).toBeNull();
  });
});

describe("vote button custom ids", () => {
  it("round-trips UUID game and nomination ids", () => {
    const customId = voteButtonCustomId(gameId, nominationId);
    expect(customId).toContain(".");
    expect(parseVoteButtonCustomId(customId)).toEqual({ gameId, nominationId });
  });

  it("still parses legacy colon/pipe vote buttons", () => {
    expect(parseVoteButtonCustomId(`gk:vote:${gameId}:${nominationId}`)).toEqual({
      gameId,
      nominationId,
    });
    expect(parseVoteButtonCustomId(`gk:vote:${gameId}|${nominationId}`)).toEqual({
      gameId,
      nominationId,
    });
  });

  it("round-trips modal ids including nonce", () => {
    const customId = voteModalCustomId(gameId, nominationId);
    expect(customId.length).toBeLessThanOrEqual(100);
    expect(parseVoteModalCustomId(customId)).toEqual({ gameId, nominationId });
  });
});

describe("lock vote custom ids", () => {
  it("round-trips UUID pairs", () => {
    expect(parseLockVotesButtonCustomId(lockVotesButtonCustomId(gameId, nominationId))).toEqual({
      gameId,
      nominationId,
      lock: true,
    });
    expect(parseLockVotesButtonCustomId(unlockVotesButtonCustomId(gameId, nominationId))).toEqual({
      gameId,
      nominationId,
      lock: false,
    });
  });

  it("parses count and ping tracker buttons", () => {
    expect(parseVoteTrackerButtonCustomId(startCountButtonCustomId(gameId, nominationId))).toEqual({
      gameId,
      nominationId,
      action: "start-count",
    });
    expect(parseVoteTrackerButtonCustomId(countYesButtonCustomId(gameId, nominationId))).toEqual({
      gameId,
      nominationId,
      action: "count-yes",
    });
    expect(parseVoteTrackerButtonCustomId(countNoButtonCustomId(gameId, nominationId))).toEqual({
      gameId,
      nominationId,
      action: "count-no",
    });
    expect(parseVoteTrackerButtonCustomId(cancelCountButtonCustomId(gameId, nominationId))).toEqual(
      {
        gameId,
        nominationId,
        action: "cancel-count",
      },
    );
    expect(parseVoteTrackerButtonCustomId(pingMissingButtonCustomId(gameId, nominationId))).toEqual(
      {
        gameId,
        nominationId,
        action: "ping-missing",
      },
    );
    expect(parseVoteTrackerButtonCustomId(pingHandButtonCustomId(gameId, nominationId))).toEqual({
      gameId,
      nominationId,
      action: "ping-hand",
    });
    expect(
      parseVoteTrackerButtonCustomId(announceBlockButtonCustomId(gameId, nominationId)),
    ).toEqual({
      gameId,
      nominationId,
      action: "announce-block",
    });
  });
});
