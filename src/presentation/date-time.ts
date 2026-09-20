import type { Localization } from "../localization/localization.ts";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const JUST_NOW_LIMIT = 5 * SECOND;

export function formatPresentationDate(
  epochSeconds: number,
  localization: Localization,
  nowMilliseconds = Date.now(),
): string {
  const value = dateFromEpochSeconds(epochSeconds);
  if (!value) return "";
  const now = new Date(nowMilliseconds);
  return sameLocalDay(value, now)
    ? localization.catalog.temporal.today
    : `${value.getFullYear()}/${pad(value.getMonth() + 1)}/${pad(value.getDate())}`;
}

export function formatPresentationTime(
  epochSeconds: number,
  localization: Localization,
  nowMilliseconds = Date.now(),
): string {
  const value = dateFromEpochSeconds(epochSeconds);
  if (!value) return "";
  const elapsed = nowMilliseconds - value.getTime();
  const copy = localization.catalog.temporal;
  if (elapsed < 0 || elapsed >= DAY) return clock(value);
  if (elapsed < JUST_NOW_LIMIT) return copy.justNow;
  if (elapsed < MINUTE) return copy.secondsAgo(Math.max(1, Math.floor(elapsed / SECOND)));
  if (elapsed < HOUR) return copy.minutesAgo(Math.max(1, Math.floor(elapsed / MINUTE)));
  return copy.hoursAgo(Math.max(1, Math.floor(elapsed / HOUR)));
}

export function formatPresentationDateTime(
  epochSeconds: number,
  localization: Localization,
  nowMilliseconds = Date.now(),
): string {
  const date = formatPresentationDate(epochSeconds, localization, nowMilliseconds);
  const time = formatPresentationTime(epochSeconds, localization, nowMilliseconds);
  return date && time ? `${date} ${time}` : date || time;
}

export function formatGitBlameDateTime(epochSeconds: number): string {
  const value = dateFromEpochSeconds(epochSeconds);
  if (!value) return "";
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${clock(value)}`;
}

function dateFromEpochSeconds(epochSeconds: number): Date | null {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return null;
  const value = new Date(epochSeconds * 1_000);
  return Number.isNaN(value.getTime()) ? null : value;
}

function sameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function clock(value: Date): string {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
