import { describe, expect, it } from "vitest";

import {
  shouldKeepVoteDeadlineReminder,
  voteDeadlineChanged,
} from "./refresh-noms-from-projection.js";

describe("voteDeadlineChanged", () => {
  it("is false when both sides match", () => {
    const at = new Date("2026-07-02T12:00:00.000Z");
    expect(voteDeadlineChanged(at.toISOString(), at)).toBe(false);
  });

  it("is true when projection moves the deadline", () => {
    expect(
      voteDeadlineChanged(
        "2026-07-02T12:00:00.000Z",
        new Date("2026-07-02T18:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("is true when clearing or setting a deadline", () => {
    expect(voteDeadlineChanged("2026-07-02T12:00:00.000Z", null)).toBe(true);
    expect(voteDeadlineChanged(null, new Date("2026-07-02T12:00:00.000Z"))).toBe(true);
    expect(voteDeadlineChanged(null, null)).toBe(false);
  });
});

describe("shouldKeepVoteDeadlineReminder", () => {
  const deadline = "2026-07-02T12:00:00.000Z";

  it("keeps reminders for open unlocked noms with a deadline", () => {
    expect(
      shouldKeepVoteDeadlineReminder({
        status: "open",
        votesLocked: false,
        voteDeadlineAt: deadline,
      }),
    ).toBe(true);
  });

  it("cancels for locked, resolved, or missing deadline", () => {
    expect(
      shouldKeepVoteDeadlineReminder({
        status: "open",
        votesLocked: true,
        voteDeadlineAt: deadline,
      }),
    ).toBe(false);
    expect(
      shouldKeepVoteDeadlineReminder({
        status: "resolved_pass",
        votesLocked: false,
        voteDeadlineAt: deadline,
      }),
    ).toBe(false);
    expect(
      shouldKeepVoteDeadlineReminder({
        status: "open",
        votesLocked: false,
        voteDeadlineAt: null,
      }),
    ).toBe(false);
  });
});
