export interface RuntimeTimeContext {
  nowMs: number;
  iso: string;
  timezone: string;
  locale: string;
  localTimeText: string;
}

export function getRuntimeTimeContext(now = new Date()): RuntimeTimeContext {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  const localTimeText = `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}:${pick("second")}`;
  return {
    nowMs: now.getTime(),
    iso: now.toISOString(),
    timezone,
    locale,
    localTimeText
  };
}
