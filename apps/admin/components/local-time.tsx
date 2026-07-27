"use client";

import { useEffect, useState } from "react";

function formatLocalTime(
  value: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

export function LocalTime({
  value,
  mode = "datetime",
  className,
}: {
  value: string | Date;
  mode?: "datetime" | "date";
  className?: string;
}) {
  const iso = typeof value === "string" ? value : value.toISOString();
  const [text, setText] = useState("");

  useEffect(() => {
    setText(
      formatLocalTime(
        iso,
        mode === "date"
          ? { year: "numeric", month: "short", day: "numeric" }
          : {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            },
      ),
    );
  }, [iso, mode]);

  return (
    <time dateTime={iso} title={iso} suppressHydrationWarning className={className}>
      {text || iso}
    </time>
  );
}
