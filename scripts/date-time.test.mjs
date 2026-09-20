import assert from "node:assert/strict";
import test from "node:test";

import { createLocalization } from "../src/localization/localization.ts";
import { EN_US } from "../src/localization/en-US.ts";
import { ZH_CN } from "../src/localization/zh-CN.ts";
import {
  formatGitBlameDateTime,
  formatPresentationDate,
  formatPresentationDateTime,
  formatPresentationTime,
} from "../src/presentation/date-time.ts";

const english = createLocalization(EN_US);
const chinese = createLocalization(ZH_CN);

test("presentation dates and relative time follow one local policy", () => {
  const now = localTime(2026, 9, 20, 12, 0, 0);
  assert.equal(formatPresentationDate(seconds(localTime(2026, 9, 20, 8)), english, now), "Today");
  assert.equal(formatPresentationDate(seconds(localTime(2026, 9, 8, 8)), english, now), "2026/09/08");
  assert.equal(formatPresentationTime(seconds(now - 2_000), chinese, now), "刚刚");
  assert.equal(formatPresentationTime(seconds(now - 18_000), chinese, now), "18 秒前");
  assert.equal(formatPresentationTime(seconds(now - 12 * 60_000), english, now), "12 minutes ago");
  assert.equal(formatPresentationTime(seconds(now - 3 * 3_600_000), english, now), "3 hours ago");
});

test("older timestamps use an exact date and 24-hour local clock", () => {
  const now = localTime(2026, 9, 20, 12);
  const value = seconds(localTime(2026, 9, 18, 7, 4));
  assert.equal(formatPresentationTime(value, english, now), "07:04");
  assert.equal(formatPresentationDateTime(value, english, now), "2026/09/18 07:04");
  assert.equal(formatPresentationDateTime(0, english, now), "");
});

test("Git Blame always uses its exact dense-table timestamp", () => {
  assert.equal(formatGitBlameDateTime(seconds(localTime(2026, 9, 8, 6, 3))), "2026-09-08 06:03");
});

function localTime(year, month, day, hour = 0, minute = 0, second = 0) {
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

function seconds(milliseconds) {
  return Math.floor(milliseconds / 1_000);
}
