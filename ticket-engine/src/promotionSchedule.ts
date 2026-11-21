/**
 * Promotion scheduling — the one place the day-of-week / time-window rules are
 * defined, shared by every engine (TS calc + the Go port).
 *
 * Contract (mirrors the server's SQL filter in
 * `promotionModel.GetByLocationGroupAndSchedule`):
 *
 *   offerable  <=>  all_week OR <todaysDayFlag>
 *
 * `all_week` is the escape hatch: when true the day flags are ignored. When
 * false, the promotion is offerable only on a day whose flag is true. The
 * `*_start_time` / `*_end_time` pairs are NOT consulted: no UI edits them and
 * every stored value is 0, so a window of 0..0 would make every day-scheduled
 * promotion permanently unavailable. They stay persisted and are reported
 * untouched.
 *
 * See omni/docs/.planz/loyalty-points-promotions-review.md item 5.
 */

/** 0 = Sunday … 6 = Saturday — `Date#getDay()` ordering, not ISO. */
export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Minimal shape the schedule check needs; `PromotionDB` satisfies it. */
export type ScheduledPromotion = {
  all_week?: boolean | null;
  mon?: boolean | null;
  tue?: boolean | null;
  wed?: boolean | null;
  thu?: boolean | null;
  fri?: boolean | null;
  sat?: boolean | null;
  sun?: boolean | null;
};

const DAY_FLAG: Record<DayIndex, keyof ScheduledPromotion> = {
  0: "sun",
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
};

/**
 * Is this promotion offerable at `now`?
 *
 * `now` is injectable so tests (and the clients, which know their own clock)
 * can pin the weekday; it defaults to the device clock.
 *
 * A promotion with no schedule information at all (`all_week` absent AND every
 * day flag absent) is treated as unrestricted. That is the stored default
 * (`all_week` DEFAULT 1) and it keeps a caller feeding a partial row from
 * silently losing every promotion; a real day-scheduled promotion always has
 * `all_week = false` plus at least one day flag.
 */
export function isPromotionScheduled<
  T extends ScheduledPromotion | undefined | null,
>(promotion: T, now: Date = new Date()): boolean {
  if (!promotion) return false;
  if (promotion.all_week) return true;

  const flags: (keyof ScheduledPromotion)[] = [
    "sun",
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
    "sat",
  ];
  const hasAnySchedule =
    promotion.all_week != null ||
    flags.some((f) => promotion[f] != null);
  if (!hasAnySchedule) return true;

  const flag = DAY_FLAG[now.getDay() as DayIndex];
  return Boolean(promotion[flag]);
}
