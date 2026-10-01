/**
 * How a workflow job declares the TARGET its end-to-end suite drives, defined once for every guard that asks.
 *
 * `docs/CODING_STANDARDS.md` §7.1a rule 2: every e2e suite names its target, LOCAL or DEPLOYED, and a CI job's
 * displayed name states it too. A job declares it as a literal job-level `env: E2E_TARGET: local | deployed`,
 * and three guards read that declaration through this module:
 *
 *   - `deployedE2eTiers.test.ts` case 1: which file a job may live in (DEPLOYED jobs only in the tiers file).
 *   - `workflowInvariants.test.ts` invariant 7: whether the job's shape and name agree with its declaration.
 *   - `testTierWiring.test.ts`: whether a LOCAL job's run is checked by the floor script.
 *
 * ⛔ ONLY A JOB-LEVEL LITERAL COUNTS. A `${{ … }}` value is decided at run time, so no guard can read what the
 * job will claim; a step-level value describes one step, not the job a reader sees in the checks list.
 *
 * @pattern Specification — one set of predicates over a job's shape, composed by several guards
 */

/** The job-level environment key that carries the declaration. */
export const E2E_TARGET_KEY = 'E2E_TARGET';

/** The two targets of §7.1a. */
export type E2eTarget = 'local' | 'deployed';

/** What a job's declaration reads as. */
export type E2eTargetDeclaration =
    E2eTarget | { readonly kind: 'undeclared' } | { readonly kind: 'invalid'; readonly value: string };

/**
 * A displayed job name that claims the end-to-end tier.
 *
 * ⚠️ The KEY is consulted only when a job has no `name:`: a reader and branch protection see the name, and the
 * key is `GITHUB_JOB`, which `deriveRunKey` folds into the Clerk fixture identity, so it cannot be renamed freely.
 */
export const E2E_CLAIM = /\be2e\b|\bend[\s-]?to[\s-]?end\b/i;

/**
 * Jobs that carry the e2e word without being a tier, keyed `file::job`, each with the reason.
 *
 * They must still declare a target. They are exempt from two rules only: where a tier may live
 * (`deployedE2eTiers.test.ts` case 1) and what its name must state (invariant 7), because they present results
 * and send no request of their own. A stale entry fails case 1.
 */
export const NOT_A_TIER: ReadonlyMap<string, string> = new Map([
    [
        '_ci.yml::e2e-web-report',
        'Merges the deployed shards’ blobs WITH the stubbed Integration tier’s blobs into one report and issues no ' +
            'request of its own. It needs `integration-web-playwright`, which is not a deployed tier and cannot be a ' +
            '`needs` of anything inside a called workflow, so the report is the PR pipeline’s own job.',
    ],
]);

/** The parts of a workflow job this module reads. */
export interface DeclaringJob {
    readonly name?: string;
    readonly env?: unknown;
}

/** The pattern a name must match to state each target. */
const NAME_STATES: Readonly<Record<E2eTarget, RegExp>> = {
    // Case-sensitive, so the everyday word "local" in a sentence does not count as a declaration.
    local: /\bLOCAL\b/,
    deployed: /\bdeployed\b/i,
};

/**
 * Whether a job's displayed name claims the end-to-end tier. Pure.
 *
 * @param key - The job's key, read only when it has no `name:`.
 * @param job - The job.
 * @returns True when the name (or, failing that, the key) says e2e or end-to-end.
 */
export function claimsE2e(key: string, job: DeclaringJob): boolean {
    return E2E_CLAIM.test(job.name ?? key);
}

/**
 * Read a job's declared e2e target. Pure.
 *
 * @param job - The job.
 * @returns `'local'` or `'deployed'` for a job-level literal; `undeclared` when the job-level key is absent;
 *   `invalid` for any other value, including an expression and a differently cased word.
 */
export function declaredE2eTarget(job: DeclaringJob): E2eTargetDeclaration {
    const env = job.env;

    if (env === undefined || env === null) {
        return { kind: 'undeclared' };
    }

    if (typeof env !== 'object' || Array.isArray(env)) {
        // `env: ${{ fromJSON(…) }}` is a whole environment decided at run time.
        return { kind: 'invalid', value: asText(env) };
    }

    if (!Object.hasOwn(env, E2E_TARGET_KEY)) {
        return { kind: 'undeclared' };
    }

    const value: unknown = (env as Readonly<Record<string, unknown>>)[E2E_TARGET_KEY];

    if (value === 'local' || value === 'deployed') {
        return value;
    }

    return { kind: 'invalid', value: asText(value) };
}

/** A parsed YAML value as the text a finding shows: a string as written, anything else as JSON. */
function asText(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Whether a displayed name states `target`, and only `target`. Pure.
 *
 * ⚠️ A name that states BOTH targets states neither: a reader cannot tell from it which one the job drives.
 *
 * @param name - The job's displayed name.
 * @param target - The job's declared target.
 * @returns True when the name states the declared target and not the other one.
 */
export function nameStatesTarget(name: string, target: E2eTarget): boolean {
    const other: E2eTarget = target === 'local' ? 'deployed' : 'local';

    return NAME_STATES[target].test(name) && !NAME_STATES[other].test(name);
}
