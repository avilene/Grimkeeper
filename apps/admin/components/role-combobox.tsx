"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  /** Pass `null` to hide the label (table cells). */
  label?: string | null;
  defaultValue?: string | null;
  roles: RoleOption[];
  /** When set, selecting a role fills this `<select>` if it is empty. */
  teamSelectId?: string;
  compact?: boolean;
};

export function RoleCombobox({
  id,
  name = "roleId",
  label = "Character / role",
  defaultValue,
  roles,
  teamSelectId,
  compact = false,
}: RoleComboboxProps) {
  const byId = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);
  const initial = defaultValue?.trim() ?? "";
  const initialRole = initial ? byId.get(initial) : undefined;
  const inputRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState(initial);
  const [query, setQuery] = useState(initialRole?.name ?? initial);
  const [open, setOpen] = useState(false);
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );

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

  useEffect(() => {
    if (!open || !inputRef.current) {
      setMenuBox(null);
      return;
    }
    const update = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuBox({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 224),
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, query, filtered.length]);

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

  const listbox = open ? (
    <ul
      id={`${id}-listbox`}
      role="listbox"
      className={cn(
        "z-50 max-h-60 overflow-auto rounded-md border border-border bg-popover p-1",
        "text-sm text-popover-foreground shadow-md",
        compact ? "fixed" : "absolute mt-1 w-full min-w-[14rem]",
      )}
      style={
        compact && menuBox
          ? { top: menuBox.top, left: menuBox.left, width: menuBox.width }
          : undefined
      }
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
  ) : null;

  return (
    <div className={cn("relative", label != null && "space-y-1.5")}>
      {label != null ? <Label htmlFor={id}>{label}</Label> : null}
      <input type="hidden" name={name} value={value} />
      <Input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        aria-label={label ?? "Character / role"}
        autoComplete="off"
        placeholder="Search…"
        value={query}
        className={cn(
          compact &&
            "h-8 min-w-[11rem] rounded-md border border-input bg-background px-2 text-sm shadow-sm",
        )}
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
      {compact && typeof document !== "undefined" && listbox
        ? createPortal(listbox, document.body)
        : listbox}
    </div>
  );
}
