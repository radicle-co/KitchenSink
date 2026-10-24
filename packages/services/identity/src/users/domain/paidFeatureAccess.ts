/**
 * What identity tells a client about the paid features: `account.paidFeatures` (plan
 * `docs/plans/2026-10-14-009-feat-roles-and-paid-gate-plan.md` D2, D6).
 *
 * Owner rulings 2026-10-13 and 2026-10-15: an entitled role (`hasPaidFeatures` — superuser, vip or premium, from the
 * signed `public_metadata.roles`) always gets the paid features. Anyone else — an admin included — sees the upsell only
 * while this stage's paid-features gate is on, and nothing at all while it is off.
 *
 * ⛔ THE GATE CHANGES WHAT IS SHOWN, NEVER WHO IS ALLOWED. This is the only reader of the gate in the system, and it
 * answers a presentation question. recipe-service authorizes a paid write from the roles alone (`isPremiumPrincipal`),
 * so the gate can never let a non-entitled user in or keep an entitled one out.
 *
 * It replaces `subscriptionTier.ts`, whose `premium` PERMISSION was the old entitlement: roles are the one source now.
 *
 * @pattern Specification — a pure predicate over the verified roles and the stage's gate
 */
import { hasPaidFeatures, type Role } from '@kitchensink/clerk-verify';

import type { PaidFeatures } from '../users.schema.js';

/**
 * The viewer's `account.paidFeatures`. Pure.
 *
 * @param input - The verified roles, and this stage's paid-features gate.
 * @returns `granted` for an entitled role; otherwise `upsell` with the gate on and `hidden` with it off.
 */
export function paidFeatureAccess(input: { readonly roles: readonly Role[]; readonly gate: boolean }): PaidFeatures {
    if (hasPaidFeatures(input.roles)) {
        return 'granted';
    }

    return input.gate ? 'upsell' : 'hidden';
}
