/**
 * This stage's paid-features gate, resolved ONCE at boot and injected (plan
 * `docs/plans/2026-10-14-009-feat-roles-and-paid-gate-plan.md` D8).
 *
 * The value comes from `PAID_FEATURES_GATE`, which the CDK stack sets explicitly from the owner's GitHub variable; boot
 * validation (`EnvironmentSchema`) has already rejected anything but `true`/`false`. Only `paidFeatureAccess` reads it.
 */
import type { FactoryProvider } from '@nestjs/common';

import { resolvePaidFeaturesGate } from '../config/env.schema.js';

/** The injection token for the gate's boolean. */
export const PAID_FEATURES_GATE = Symbol('PAID_FEATURES_GATE');

/**
 * The gate provider.
 *
 * @sideEffect The factory reads `process.env['PAID_FEATURES_GATE']`, once, when the module boots.
 */
export const paidFeaturesGateProvider: FactoryProvider<boolean> = {
    provide: PAID_FEATURES_GATE,
    useFactory: (): boolean => resolvePaidFeaturesGate(process.env['PAID_FEATURES_GATE']),
};
