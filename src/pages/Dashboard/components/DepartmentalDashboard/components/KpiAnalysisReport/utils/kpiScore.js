/**
 * How much of a KPI's weight it earned, as a fraction of that weight (0 – 1).
 *
 * Achievement is capped at 100% of target — beating a target earns the full
 * weight, never more — and floored at zero: a KPI that went backwards scores
 * nothing, it does not subtract from the rest of the scorecard.
 *
 * The floor is the point. Without it, a month where the portfolio or the active
 * client base shrank produced a negative weight-scored value, which was then
 * subtracted from the other KPIs' scores — and an annualised figure that ran
 * away (a monthly −100% × 12) printed −6,000% of weight.
 *
 * @param {number|null} achievedPct  achievement, already expressed as a percentage
 * @param {number} targetPct         the target on the same scale (default 100)
 * @returns {number} 0 – 1
 */
export const scoreFraction = (achievedPct, targetPct = 100) => {
  const a = Number(achievedPct);
  const t = Number(targetPct);
  if (!Number.isFinite(a) || !Number.isFinite(t) || t === 0) return 0;
  return Math.min(100, Math.max(0, (a / t) * 100)) / 100;
};

export default scoreFraction;
