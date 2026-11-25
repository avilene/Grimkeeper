import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client.js", () => ({
  prisma: {
    guildSettings: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from "./client.js";
import {
  addGuildSettingRoleIds,
  ensureGuildSettings,
  parseIdList,
  serializeIdList,
  upsertGuildSettings,
} from "./guild-settings.js";

describe("parseIdList / serializeIdList", () => {
  it("parses comma-separated ids", () => {
    expect([...parseIdList(" a,b , c ")]).toEqual(["a", "b", "c"]);
    expect(parseIdList(null).size).toBe(0);
    expect(parseIdList("").size).toBe(0);
  });

  it("serializes uniquely and sorted", () => {
    expect(serializeIdList(["b", "a", "b", "  "])).toBe("a,b");
  });
});

describe("ensureGuildSettings", () => {
  beforeEach(() => {
    vi.mocked(prisma.guildSettings.findUnique).mockReset();
    vi.mocked(prisma.guildSettings.create).mockReset();
  });

  it("returns existing row", async () => {
    const row = { guildId: "g1", archiveCategoryId: null };
    vi.mocked(prisma.guildSettings.findUnique).mockResolvedValue(row as never);
    await expect(ensureGuildSettings("g1")).resolves.toBe(row);
    expect(prisma.guildSettings.create).not.toHaveBeenCalled();
  });

  it("creates when missing", async () => {
    vi.mocked(prisma.guildSettings.findUnique).mockResolvedValue(null);
    const created = { guildId: "g1" };
    vi.mocked(prisma.guildSettings.create).mockResolvedValue(created as never);
    await expect(ensureGuildSettings("g1")).resolves.toBe(created);
    expect(prisma.guildSettings.create).toHaveBeenCalledWith({ data: { guildId: "g1" } });
  });
});

describe("upsertGuildSettings", () => {
  beforeEach(() => {
    vi.mocked(prisma.guildSettings.upsert).mockReset();
  });

  it("normalizes role CSV on upsert", async () => {
    vi.mocked(prisma.guildSettings.upsert).mockResolvedValue({ guildId: "g1" } as never);
    await upsertGuildSettings("g1", {
      allowedRoleIds: "role-b, role-a",
      archiveCategoryId: " cat1 ",
    });
    expect(prisma.guildSettings.upsert).toHaveBeenCalledWith({
      where: { guildId: "g1" },
      create: {
        guildId: "g1",
        archiveCategoryId: "cat1",
        allowedRoleIds: "role-a,role-b",
        adminRoleIds: null,
        reminderRoleIds: null,
        reminderPingRoleId: null,
      },
      update: {
        archiveCategoryId: "cat1",
        allowedRoleIds: "role-a,role-b",
      },
    });
  });

  it("stores empty string for open allowlist", async () => {
    vi.mocked(prisma.guildSettings.upsert).mockResolvedValue({ guildId: "g1" } as never);
    await upsertGuildSettings("g1", { allowedRoleIds: "" });
    expect(prisma.guildSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { allowedRoleIds: "" },
      }),
    );
  });
});

describe("addGuildSettingRoleIds", () => {
  beforeEach(() => {
    vi.mocked(prisma.guildSettings.findUnique).mockReset();
    vi.mocked(prisma.guildSettings.create).mockReset();
    vi.mocked(prisma.guildSettings.upsert).mockReset();
  });

  it("merges new role ids into the CSV field", async () => {
    vi.mocked(prisma.guildSettings.findUnique).mockResolvedValue({
      guildId: "g1",
      allowedRoleIds: "role-a",
      adminRoleIds: null,
      reminderRoleIds: null,
      reminderPingRoleId: null,
      archiveCategoryId: null,
    } as never);
    vi.mocked(prisma.guildSettings.upsert).mockResolvedValue({ guildId: "g1" } as never);

    await addGuildSettingRoleIds("g1", "allowedRoleIds", ["role-b", "role-a"]);
    expect(prisma.guildSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { allowedRoleIds: "role-a,role-b" },
      }),
    );
  });
});
