/**
 * @module @commise/features-account/subscriptionEntryPoints — the ONE switch that says whether any surface may link to,
 * or sell, the subscription page (spec 010 T-035, FR-042j, FR-042k).
 *
 * ⛔ OFF until feature 010 ships (owner ruling 2026-10-26): there is no subscription page to send a cook to, and none may
 * be invented. While it is off, every upsell states its fact and offers only a close control, and no surface shows
 * "See Pro" or a Pro sales line. Web and native read this one value; turning it on is this one change plus giving each
 * entry point its destination.
 *
 * It is NOT the paid-features gate (`PAID_FEATURES_GATE_*`, which identity derives into `account.paidFeatures`); the two
 * are independent and this never reads or changes the gate.
 *
 * @pattern Feature Toggle — one release toggle read in one module
 */
export const SUBSCRIPTION_ENTRY_POINTS_ON = false;
