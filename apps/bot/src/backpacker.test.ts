import { describe, expect, it, vi } from "vitest";

import { assertEligibleBackpacker } from "./backpacker.js";

vi.mock("./access.js", () => ({
  fetchGuildMemberWithTimeout: vi.fn(),
}));

import { fetchGuildMemberWithTimeout } from "./access.js";

describe("assertEligibleBackpacker", () => {
  it("rejects bots", async () => {
    const result = await assertEligibleBackpacker(
      {} as never,
      { id: "g", channelId: "c", stRoleId: "st", kibRoleId: "kib" },
      { id: "u1", bot: true } as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/bot/i);
  });

  it("rejects game ST role holders", async () => {
    vi.mocked(fetchGuildMemberWithTimeout).mockResolvedValue({
      roles: { cache: { has: (id: string) => id === "st" } },
    } as never);

    const result = await assertEligibleBackpacker(
      {} as never,
      { id: "g", channelId: "c", stRoleId: "st", kibRoleId: "kib" },
      { id: "u1", bot: false } as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/storyteller/i);
  });

  it("rejects game kib role holders", async () => {
    vi.mocked(fetchGuildMemberWithTimeout).mockResolvedValue({
      roles: { cache: { has: (id: string) => id === "kib" } },
    } as never);

    const result = await assertEligibleBackpacker(
      {} as never,
      { id: "g", channelId: "c", stRoleId: "st", kibRoleId: "kib" },
      { id: "u1", bot: false } as never,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/kib/i);
  });

  it("allows users without ST or kib roles", async () => {
    vi.mocked(fetchGuildMemberWithTimeout).mockResolvedValue({
      roles: { cache: { has: () => false } },
    } as never);

    const result = await assertEligibleBackpacker(
      {} as never,
      { id: "g", channelId: "c", stRoleId: "st", kibRoleId: "kib" },
      { id: "u1", bot: false } as never,
    );
    expect(result).toEqual({ ok: true });
  });
});
