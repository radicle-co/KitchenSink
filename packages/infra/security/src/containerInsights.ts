// ⚠️ DELIBERATE — see docs/architecture/decisions/0007-sandbox-cost-controls.md (amended 2026-08-27).
//
// THE Container Insights tier every ECS cluster in this repository runs. One value, one place.
//
// ## Why this is a cost control, and why prod is no longer exempt
//
// ADR-0007 dropped NON-PROD from ENHANCED to STANDARD and deliberately left prod untouched, to keep the prod
// template diff-free. The cost then concentrated in the half it did not touch. Measured 2026-08-27:
// `ECS/ContainerInsights` was 2,526 metric series and CloudWatch was $155 of a $484 monthly bill — 94% of it
// custom-metric storage, NOT logs — and 2,048 of those series (81%) existed only because the three prod
// clusters were ENHANCED.
//
// The ENHANCED tier adds `TaskId` and `ContainerName` dimensions. `TaskId` is UNBOUNDED cardinality: each
// task launch mints ~23 brand-new billable custom metrics which never merge with the ones the previous task
// created. `food-service-prod` shows what that costs in practice — `FoodChangeRefresh` runs on
// `rate(6 hours)`, so 56 of the 70 task IDs seen in a two-week window came from one scheduled batch job, and
// that single cluster accounted for 1,812 of the 2,048 enhanced-only series.
//
// ## Why `pr-{N}` gets NOTHING rather than STANDARD
//
// A preview environment is observed by its own CI smoke test and by a human reading the PR, neither of which
// queries ECS cluster metrics. STANDARD still costs ~111 billable series per open PR (food + recipe), which
// on 2026-08-02 meant seven PRs spinning up fourteen clusters within nine hours and taking daily CloudWatch
// spend from $1.75 to $13.07 until they were torn down.
//
// ## Why ENHANCED is unreachable rather than left behind a flag
//
// A knob no caller sets is a presumptive feature (YAGNI). Nothing here needs per-container metrics today and
// re-enabling the tier for a debugging session is a one-line edit; what is NOT cheap is leaving a ~$100/mo
// default one typo away. So the tier is simply not offered.
import { ContainerInsights } from 'aws-cdk-lib/aws-ecs';

/**
 * Matches an EPHEMERAL per-PR stage, using ADR-0005's delimiter-aware rule.
 *
 * Deliberately the same shape as `.github/scripts/pr-scope.sh` — `pr-{N}` exactly, or `pr-{N}-…` — so that
 * "gets no Container Insights" and "is deleted when the PR closes" cannot disagree about which stages are
 * ephemeral. The delimiter is what keeps `pr-1` from matching `pr-15`, and the anchor is what keeps a named
 * stage like `preview` or `production` from reading as a PR.
 */
const EPHEMERAL_PR_STAGE = /^pr-[1-9]\d*(?:-|$)/u;

/**
 * The Container Insights tier a cluster gets, derived from its deployment stage.
 *
 * `pr-{N}` → DISABLED (ephemeral, unobserved); every named stage including **prod** → ENABLED, the STANDARD
 * tier, which keeps cluster- and service-level metrics and drops the per-task/per-container cardinality that
 * ENHANCED bills for. No stage resolves to ENHANCED.
 *
 * @param stage - Deployment stage, e.g. `prod`, `sandbox`, `pr-91`.
 * @returns The tier to pass as `containerInsightsV2`. Pure.
 */
export function containerInsightsForStage(stage: string): ContainerInsights {
    return EPHEMERAL_PR_STAGE.test(stage) ? ContainerInsights.DISABLED : ContainerInsights.ENABLED;
}
