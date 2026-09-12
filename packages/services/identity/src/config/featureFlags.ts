import { z } from 'zod';

/**
 * Feature flags for staged rollout and operational controls.
 * @implements REQ-041..REQ-044 FR-041..FR-044
 */
const FeatureFlagsSchema = z.object({
    ROLLOUT_STAGE: z.enum(['10', '50', '100']).default('10'),
    SUSPENSION_ENABLED: z.enum(['true', 'false']).default('true'),
    IMPERSONATION_ENABLED: z.enum(['true', 'false']).default('false'),
});

export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;

export function resolveFeatureFlags(): FeatureFlags {
    return FeatureFlagsSchema.parse(process.env);
}

export function isRolloutEnabledForPercent(percent: number): boolean {
    const flags = resolveFeatureFlags();
    const rolloutStage = Number.parseInt(flags.ROLLOUT_STAGE, 10);

    return percent <= rolloutStage;
}
