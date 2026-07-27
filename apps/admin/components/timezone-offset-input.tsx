"use client";

import { useEffect, useState } from "react";

export function TimezoneOffsetInput({
  name = "timezoneOffsetMinutes",
}: {
  name?: string;
}) {
  const [offset, setOffset] = useState("0");

  useEffect(() => {
    setOffset(String(new Date().getTimezoneOffset()));
  }, []);

  return <input type="hidden" name={name} value={offset} />;
}
