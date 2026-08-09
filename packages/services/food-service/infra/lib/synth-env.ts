/**
 * The CDK app's SYNTH-TIME environment contract — the deploy-shaped numbers `bin/app.ts` feeds into
 * {@link FoodServiceStack}, validated in one place with a loud, named failure.
 *
 * Why these are not in `src/config/env.schema.ts` (which owns every RUNTIME setting through the one
 * `settingFromEnv` reader):
 *
 * - The two task counts are consumed ONLY here. Neither is ever placed in a container's environment, so
 *   neither belongs to the running service's env contract — a variable's definition lives with the process
 *   that reads it, and this is that process.
 * - The compile boundary also forbids sharing: `infra/tsconfig.json` pins `rootDir` to `infra/`, and
 *   widening it to reach `../src` relocates the emitted entrypoint that BOTH deploy workflows invoke by
 *   literal path (`infra/dist/bin/app.js`). A config refactor must not become a deploy-pipeline change.
 * - `FOOD_UNRESOLVED_TTL_DAYS` is the exception that proves the rule: it IS a runtime setting, owned by
 *   `src/config/env.schema.ts`, and is only PASSED THROUGH here into the change-refresh task definition.
 *   Absent stays absent (no template diff, and the app applies its own default); present is sanity-checked
 *   at deploy time so a typo fails the deploy instead of the task's first nightly run. The authoritative
 *   rule remains the app's — this is a gate, not a second source of truth.
 *
 * A synth-time `NaN` is the worst kind: `JSON.stringify(NaN)` is `null`, so it does not fail, it lands in a
 * CloudFormation template. `Number('')` is `0`, so an unset CI variable would deploy ZERO tasks — an outage
 * behind a green deploy. Hence: parse, don't coerce.
 */
import { z } from 'zod';

/**
 * A deploy-time Fargate task count.
 *
 * `nonnegative`, NOT `positive`: the per-PR sandbox deploy provisions at scale ZERO in its first pass (the
 * per-PR database does not exist yet, so booting tasks would crash-loop and trip the ECS deployment circuit
 * breaker), then scales up in a second pass.
 *
 * A BLANK value is forced to fail rather than read as zero. `Number('')` is `0`, so an unset CI variable
 * interpolated into the deploy env (`FOOD_DESIRED_COUNT: ${{ vars.… }}`) would otherwise deploy a service
 * with NO tasks — an outage behind a green deploy. An explicitly written `'0'` remains valid.
 */
const TaskCountSchema = z.preprocess(
    (raw) => (typeof raw === 'string' && raw.trim() === '' ? Number.NaN : raw),
    z.coerce.number().int().nonnegative(),
);

/** The synth-time settings, each with exactly one definition of its default and its rule. */
const SynthEnvSchema = z.object({
    // Desired count of Fargate API tasks. Prod keeps the two-task default; a per-PR preview passes 1.
    FOOD_DESIRED_COUNT: TaskCountSchema.default(2),
    // Desired count of Fargate fan-out worker tasks (the single-drainer invariant holds regardless; FR-022).
    FOOD_WORKER_DESIRED_COUNT: TaskCountSchema.default(1),
    // Optional override stamped into the change-refresh task's environment; unset → the app's own default
    // (FR-025a). The rule mirrors `src/config/env.schema.ts`, which remains authoritative.
    FOOD_UNRESOLVED_TTL_DAYS: z.coerce.number().int().positive().optional(),
});

/** The validated synth-time inputs for {@link FoodServiceStack}. */
export interface SynthEnv {
    /** Desired count of Fargate API tasks. */
    readonly desiredCount: number;
    /** Desired count of Fargate fan-out worker tasks. */
    readonly workerDesiredCount: number;
    /** UNRESOLVED-candidate TTL (days) to stamp into the change-refresh task, or `undefined` to omit it. */
    readonly unresolvedTtlDays: number | undefined;
}

/**
 * Read and validate the synth-time environment.
 *
 * @returns The validated deploy-shaped inputs.
 * @throws {Error} naming the offending variable when a value is malformed, so `cdk synth` fails instead of
 *   emitting `null` (or a silent `0`) into a CloudFormation template.
 * @sideEffect Reads `process.env`.
 */
export function synthEnv(): SynthEnv {
    const parsed = SynthEnvSchema.safeParse(process.env);

    if (!parsed.success) {
        const reasons = parsed.error.issues
            .map((issue) => {
                const name = String(issue.path[0]);

                return `${name} "${process.env[name] ?? ''}": ${issue.message}`;
            })
            .join('; ');

        throw new Error(`Invalid synth-time environment — ${reasons}`);
    }

    return {
        desiredCount: parsed.data.FOOD_DESIRED_COUNT,
        workerDesiredCount: parsed.data.FOOD_WORKER_DESIRED_COUNT,
        unresolvedTtlDays: parsed.data.FOOD_UNRESOLVED_TTL_DAYS,
    };
}
