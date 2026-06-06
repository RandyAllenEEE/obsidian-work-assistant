type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

const FREQUENCY_TO_UNIT: Record<Frequency, string> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
};

export function recurrenceTextToRule(text: string): string {
  const value = text.trim().toLowerCase();
  if (!value) return "";
  if (value.includes("weekday")) return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";

  const intervalMatch = value.match(/every\s+(\d+)\s+(day|week|month|year)s?/);
  if (intervalMatch) {
    const frequency = unitToFrequency(intervalMatch[2]);
    const interval = Number(intervalMatch[1]);
    return interval > 1 ? `FREQ=${frequency};INTERVAL=${interval}` : `FREQ=${frequency}`;
  }

  const simpleMatch = value.match(/every\s+(day|week|month|year)/);
  if (simpleMatch) {
    return `FREQ=${unitToFrequency(simpleMatch[1])}`;
  }

  return "";
}

export function ruleToRecurrenceText(rule: string): string {
  const parts = parseRule(rule);
  const frequency = parts.FREQ as Frequency | undefined;
  if (!frequency || !FREQUENCY_TO_UNIT[frequency]) return "";

  if (parts.BYDAY === "MO,TU,WE,TH,FR") return "every weekday";

  const interval = Number(parts.INTERVAL || "1");
  const unit = FREQUENCY_TO_UNIT[frequency];
  if (!Number.isFinite(interval) || interval <= 1) {
    return `every ${unit}`;
  }
  return `every ${interval} ${unit}s`;
}

export function getNextOccurrenceDate(rule: string, baseDate: Date): Date | null {
  const parts = parseRule(rule);
  const frequency = parts.FREQ as Frequency | undefined;
  if (!frequency) return null;

  if (parts.BYDAY === "MO,TU,WE,TH,FR") {
    return nextWeekday(baseDate);
  }

  const interval = Math.max(1, Number(parts.INTERVAL || "1"));
  const next = new Date(baseDate.getTime());
  switch (frequency) {
    case "DAILY":
      next.setUTCDate(next.getUTCDate() + interval);
      return next;
    case "WEEKLY":
      next.setUTCDate(next.getUTCDate() + interval * 7);
      return next;
    case "MONTHLY":
      next.setUTCMonth(next.getUTCMonth() + interval);
      return next;
    case "YEARLY":
      next.setUTCFullYear(next.getUTCFullYear() + interval);
      return next;
    default:
      return null;
  }
}

function parseRule(rule: string): Record<string, string> {
  return rule
    .replace(/^RRULE:/, "")
    .split(";")
    .reduce<Record<string, string>>((acc, part) => {
      const [key, value] = part.split(":").join("=").split("=");
      if (key && value) acc[key.toUpperCase()] = value.toUpperCase();
      return acc;
    }, {});
}

function unitToFrequency(unit: string): Frequency {
  switch (unit) {
    case "day":
      return "DAILY";
    case "week":
      return "WEEKLY";
    case "month":
      return "MONTHLY";
    case "year":
      return "YEARLY";
    default:
      return "DAILY";
  }
}

function nextWeekday(baseDate: Date): Date {
  const next = new Date(baseDate.getTime());
  do {
    next.setUTCDate(next.getUTCDate() + 1);
  } while (next.getUTCDay() === 0 || next.getUTCDay() === 6);
  return next;
}
