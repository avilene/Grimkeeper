import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function emptyToNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

export function parseOptionalInt(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error("Must be an integer");
  return n;
}

export function shortId(id: string, len = 8): string {
  return `${id.slice(0, len)}…`;
}
