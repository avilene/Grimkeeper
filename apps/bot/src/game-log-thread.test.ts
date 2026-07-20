import { describe, expect, it, vi } from "vitest";

import {
  formatGameLogLine,
  formatLogRoleRef,
  formatLogUserRef,
  formatVoteCastLogMessage,
  logThreadName,
  sanitizeGameLogMentions,
} from "./game-log-thread.js";

describe("logThreadName", () => {
  it("includes short game id so games do not share log threads", () => {
    expect(logThreadName("town-square", "abcdef12-3456")).toBe("log-town-square · abcdef");
  });

  it("truncates to 100 characters", () => {
    const longName = "x".repeat(120);
    expect(logThreadName(longName, "abcdef12-3456")).toHaveLength(100);
    expect(logThreadName(longName, "abcdef12-3456").startsWith("log-")).toBe(true);
  });
});

describe("formatGameLogLine", () => {
  it("prefixes with a Discord localized short datetime", () => {
    const at = new Date("2026-07-17T10:30:00.000Z");
    const line = formatGameLogLine("test event", at);
    expect(line).toBe(`<t:${Math.floor(at.getTime() / 1000)}:f> test event`);
  });
});

describe("formatLogUserRef", () => {
  it("renders name and userid without a mention", () => {
    expect(formatLogUserRef("Alice", "123456789012345678")).toBe("Alice (`123456789012345678`)");
  });
});

describe("formatLogRoleRef", () => {
  it("renders role name and id without a mention", () => {
    expect(formatLogRoleRef("Players", "987654321098765432")).toBe(
      "Players (`987654321098765432`)",
    );
  });
});

describe("sanitizeGameLogMentions", () => {
  it("replaces user and role mentions with name + id", async () => {
    const guild = {
      members: {
        fetch: vi.fn(async (id: string) => {
          if (id === "111111111111111111") {
            return { displayName: "Alice", user: { username: "alice" } };
          }
          return null;
        }),
      },
      roles: {
        cache: {
          get: (id: string) => (id === "222222222222222222" ? { name: "ST" } : undefined),
        },
        fetch: vi.fn(async () => null),
      },
    };

    const result = await sanitizeGameLogMentions(
      guild as never,
      `<@111111111111111111> added <@&222222222222222222> for <@!333333333333333333>`,
    );

    expect(result).toBe(
      "Alice (`111111111111111111`) added ST (`222222222222222222`) for unknown (`333333333333333333`)",
    );
    expect(result).not.toMatch(/<@!?/);
    expect(result).not.toMatch(/<@&/);
  });
});

describe("formatVoteCastLogMessage", () => {
  it("labels player ballots as private or public", () => {
    expect(
      formatVoteCastLogMessage({
        voterDiscordId: "111",
        nomineeLabel: "Bob",
        choice: "yes",
        ballot: "public",
      }),
    ).toBe("<@111> set a **public** vote on **Bob** to **yes**.");
    expect(
      formatVoteCastLogMessage({
        voterDiscordId: "111",
        nomineeLabel: "Bob",
        choice: "no",
        ballot: "private",
      }),
    ).toBe("<@111> set a **private** vote on **Bob** to **no**.");
  });

  it("labels ST set-vote as setting another player's public ballot", () => {
    expect(
      formatVoteCastLogMessage({
        voterDiscordId: "222",
        nomineeLabel: "Carol",
        choice: "conditional",
        ballot: "public",
        setByDiscordId: "111",
      }),
    ).toBe("<@111> set <@222> **public** vote on **Carol** to **conditional**.");
  });
});
