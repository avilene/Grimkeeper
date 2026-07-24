"use client";

import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type RoleOption = {
  id: string;
  name: string;
  /** BotC type: townsfolk | outsider | minion | demon | traveler */
  type: string;
  edition?: string | null;
};

/** Map catalog character type → player.team alignment for stats. */
export function alignmentFromRoleType(type: string): "good" | "evil" | "traveler" {
  if (type === "traveler") return "traveler";
  if (type === "minion" || type === "demon") return "evil";
  return "good";
}

type RoleComboboxProps = {
  id: string;
  name?: string;
  label?: string;
  defaultValue?: string | null;
  roles: RoleOption[];
  /** When set, selecting a role fills this `<select name="team">` if it is empty. */
  teamSelectId?: string;
};

export function RoleCombobox({
  id,
  name = "roleId",
  label = "Character / role",
  defaultValue,
  roles,
  teamSelectId,
}: RoleComboboxProps) {
  const byId = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);
  const initial = defaultValue?.trim() ?? "";
  const initialRole = initial ? byId.get(initial) : undefined;

  const [value, setValue] = useState(initial);
  const [query, setQuery] = useState(initialRole?.name ?? initial);
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = !q
      ? roles
      : roles.filter(
          (role) =>
            role.name.toLowerCase().includes(q) ||
            role.id.toLowerCase().includes(q) ||
            role.type.toLowerCase().includes(q),
        );
    return list.slice(0, 40);
  }, [query, roles]);

  function pick(role: RoleOption) {
    setValue(role.id);
    setQuery(role.name);
    setOpen(false);
    if (!teamSelectId) return;
    const teamSelect = document.getElementById(teamSelectId);
    if (!(teamSelect instanceof HTMLSelectElement)) return;
    if (teamSelect.value) return;
    teamSelect.value = alignmentFromRoleType(role.type);
  }

  function commitTyped() {
    const trimmed = query.trim();
    if (!trimmed) {
      setValue("");
      return;
    }
    if (value && byId.get(value)?.name === trimmed) return;
    const match =
      byId.get(trimmed.toLowerCase()) ||
      roles.find((role) => role.name.toLowerCase() === trimmed.toLowerCase());
    setValue(match?.id ?? trimmed);
    if (match) setQuery(match.name);
  }

  return (
    <div className="relative space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <input type="hidden" name={name} value={value} />
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Search characters…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setValue("");
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => {
            commitTyped();
            setOpen(false);
          }, 120);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" && open && filtered[0]) {
            event.preventDefault();
            pick(filtered[0]);
          }
        }}
      />
      {open ? (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className={cn(
            "absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-popover p-1",
            "text-sm text-popover-foreground shadow-md",
          )}
        >
          {filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-muted-foreground">
              No matches — leave typed text to save a custom id
            </li>
          ) : (
            filtered.map((role) => (
              <li key={role.id} role="option" aria-selected={value === role.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left",
                    "hover:bg-accent hover:text-accent-foreground",
                    value === role.id && "bg-accent",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(role)}
                >
                  <span>{role.name}</span>
                  <span className="shrink-0 text-xs capitalize text-muted-foreground">
                    {role.type}
                    {role.edition ? ` · ${role.edition}` : ""}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
