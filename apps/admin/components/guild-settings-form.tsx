"use client";

import { useActionState } from "react";

import {
  deleteGuildSettings,
  saveGuildSettings,
  type SaveResult,
} from "@/actions/guild-settings";
import { SaveStatus, SubmitButton } from "@/components/save-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type GuildSettingsFields = {
  guildId: string;
  archiveCategoryId: string | null;
  allowedRoleIds: string | null;
  adminRoleIds: string | null;
  reminderRoleIds: string | null;
  reminderPingRoleId: string | null;
};

export function GuildSettingsForm({ row }: { row?: GuildSettingsFields }) {
  const [result, action] = useActionState<SaveResult | null, FormData>(
    saveGuildSettings.bind(null, row?.guildId ?? null),
    null,
  );
  const [deleteResult, deleteAction] = useActionState<SaveResult | null, FormData>(
    deleteGuildSettings.bind(null, row?.guildId ?? ""),
    null,
  );

  return (
    <div className="space-y-4">
      <form
        action={action}
        className="grid gap-3 rounded-md border border-border bg-card p-4 sm:grid-cols-2"
      >
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="guildId">Guild ID</Label>
          <Input
            id="guildId"
            name="guildId"
            required
            className="font-mono"
            defaultValue={row?.guildId ?? ""}
            readOnly={Boolean(row)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="allowedRoleIds">Allowed role IDs</Label>
          <Input
            id="allowedRoleIds"
            name="allowedRoleIds"
            className="font-mono"
            placeholder="comma-separated role snowflakes"
            defaultValue={row?.allowedRoleIds ?? ""}
          />
          <p className="text-xs text-muted-foreground">
            Who can use bot commands. Leave empty to use the shared bot default. Prefer{" "}
            <code>/setup configure</code> in Discord.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="adminRoleIds">Admin helper role IDs</Label>
          <Input
            id="adminRoleIds"
            name="adminRoleIds"
            className="font-mono"
            placeholder="comma-separated role snowflakes"
            defaultValue={row?.adminRoleIds ?? ""}
          />
          <p className="text-xs text-muted-foreground">
            Helper roles for private ST threads and pins. Leave empty for the shared bot default.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reminderRoleIds">Reminder manager role IDs</Label>
          <Input
            id="reminderRoleIds"
            name="reminderRoleIds"
            className="font-mono"
            placeholder="comma-separated role snowflakes"
            defaultValue={row?.reminderRoleIds ?? ""}
          />
          <p className="text-xs text-muted-foreground">
            Who can manage channel reminders when there is no active game. Leave empty for the shared
            bot default.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reminderPingRoleId">Reminder ping role ID</Label>
          <Input
            id="reminderPingRoleId"
            name="reminderPingRoleId"
            className="font-mono"
            placeholder="Discord role snowflake"
            defaultValue={row?.reminderPingRoleId ?? ""}
          />
          <p className="text-xs text-muted-foreground">
            Default ping for channel reminders. Leave empty for the shared bot default.
          </p>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="archiveCategoryId">Archives category ID</Label>
          <Input
            id="archiveCategoryId"
            name="archiveCategoryId"
            className="font-mono"
            placeholder="Discord category snowflake"
            defaultValue={row?.archiveCategoryId ?? ""}
          />
          <p className="text-xs text-muted-foreground">
            Town (and kib channel) move here on <code>/st do archive</code>. Overrides{" "}
            <code>ARCHIVE_CATEGORY_ID</code> env when set.
          </p>
        </div>
        <div className="col-span-full flex flex-wrap items-center gap-3">
          <SubmitButton>{row ? "Save settings" : "Create settings"}</SubmitButton>
          <SaveStatus result={result} />
        </div>
      </form>

      {row ? (
        <form action={deleteAction} className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="destructive"
            onClick={(event) => {
              if (!window.confirm(`Delete guild settings for ${row.guildId}?`)) {
                event.preventDefault();
              }
            }}
          >
            Delete settings
          </Button>
          <SaveStatus result={deleteResult} />
        </form>
      ) : null}
    </div>
  );
}
