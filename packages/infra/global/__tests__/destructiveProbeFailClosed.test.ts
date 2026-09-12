// @vitest-environment node
/**
 * Repo-wide guard: a probe whose answer authorises a DELETE may not turn a failure into a benign answer.
 *
 * ## The class, stated once
 *
 * Every destructive step in this repository is gated on a question asked of an external system — "does this
 * stack exist", "is any preview live", "is anything using the shared tier". Each of those questions has
 * three possible answers, and only two of them are usually written down:
 *
 *     yes  ·  no  ·  I could not ask
 *
 * When the third collapses into the second, the guard inverts: the moment the API is unreachable is the
 * moment the workflow concludes there is nothing to protect. That is strictly worse than having no guard,
 * because the log then states the safe intent while the mechanism does the unsafe thing.
 *
 * ## Three instances, all found within one day of each other
 *
 * 1. `sandbox-reconcile.yml`'s tier probe ended `|| echo 0` — a rate-limited `gh` meant "no runs in
 *    flight", which meant "idle", which deleted the shared ALB and the identity service every preview
 *    signs in against.
 * 2. The same file's discovery step exited non-zero BEFORE writing its output, and the downstream
 *    `!cancelled()` read the unset value as `''` — the same conclusion by a different route
 *    (`stepOutcomeGating.test.ts` covers that half).
 * 3. `sandbox-lifetime.sh live-expiry` and `verify_deployment_resolve_rds` were both written the correct
 *    way — an unaskable question fails rather than answering — which is what this guard generalises.
 *
 * ## What is checked
 *
 * A step that runs a destructive script, or that produces an output such a step is gated on, must not
 * contain `|| echo <literal>` or `|| true` inside the command substitution that feeds its verdict. The
 * honest forms are an explicit `if ! value=$(...)` branch, or letting the command's failure propagate.
 *
 * ⚠️ Deliberately narrow. `|| echo` is entirely reasonable in a step that reports, formats or logs — most
 * uses in this repository are exactly that, and flagging them would make this guard noise, which is how a
 * guard gets deleted before it catches the case that matters.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { WORKFLOWS_DIR, withoutComments } from './cdkApps.js';
import { repoRoot, trackedFiles } from './serviceSources.js';

/** Commands that DELETE infrastructure. A step running one of these is destructive by definition. */
const DESTRUCTIVE = [/teardown-sandbox-pr\.sh/u, /sandbox-shared-tier\.sh\s+down/u, /cdk\s+destroy/u];

/** A fallback that manufactures an answer out of a failure. */
const MANUFACTURED = /\|\|\s*(?:echo\s+\S+|true)\b/u;

/**
 * Steps where a manufactured fallback is FAIL-CLOSED, each with the argument.
 *
 * ⛔ WHY THIS IS A MAP AND NOT A CLEVERER REGEX. Whether `|| echo 0` is safe depends entirely on what the
 * value is later compared against, and that is a question about MEANING, not syntax:
 *
 *     n=$(… || echo 0);  [ "$n" != '0' ] && busy=…      # 0 ⇒ "not busy" ⇒ DELETE.  fail-OPEN
 *     upd=$(… || echo 0); [ "$upd" -gt 0 ] && reason=…  # 0 ⇒ no reason ⇒ no reap.  fail-CLOSED
 *
 * The two lines are near-identical and opposite. A guard that tried to decide this from text would be
 * wrong in one direction or the other; forcing a written argument per site is the honest mechanism, and it
 * is cheap because the population is tiny.
 *
 * ⚠️ A stale entry FAILS, so this cannot rot into a list of things nobody re-reads.
 */
const FAIL_CLOSED: ReadonlyMap<string, string> = new Map([
    [
        'sandbox-deploy.yml:reap-abandoned » Reap pr-{N} resources whose PR is closed or long-stale',
        'Both fallbacks feed `-gt 0` guards, so a failed `date` parse yields 0, fails the guard, and the ' +
            'token is NOT reaped. `closed_at` only decides whether to REPORT a stale orphan; `upd` only ' +
            'decides whether an open-but-stale PR is swept. In both, an unparseable timestamp means the ' +
            'sweep declines to act — which is the direction this guard exists to require.',
    ],
]);

interface Job {
    readonly workflow: string;
    readonly name: string;
    readonly steps: readonly { id?: string; name?: string; if?: string; run?: string }[];
}

function jobs(): readonly Job[] {
    return trackedFiles(WORKFLOWS_DIR)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .flatMap((file) => {
            const doc = parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
                jobs?: Record<string, { steps?: Job['steps'] }>;
            } | null;

            return Object.entries(doc?.jobs ?? {}).map(([name, body]) => ({
                workflow: path.basename(file),
                name,
                steps: body.steps ?? [],
            }));
        });
}

/**
 * The step ids whose outputs gate a destructive step, per job.
 *
 * Derived from the destructive step's own `if:`, so a step that stops gating — or a new one that starts —
 * moves this population without anybody editing a list.
 */
function gatingIds(job: Job): readonly string[] {
    const destructive = job.steps.filter((step) => DESTRUCTIVE.some((pattern) => pattern.test(step.run ?? '')));

    return [
        ...new Set(
            destructive.flatMap((step) =>
                [...(step.if ?? '').matchAll(/steps\.([A-Za-z_][A-Za-z0-9_-]*)\.outputs\./gu)].map(
                    (match) => match[1] ?? '',
                ),
            ),
        ),
    ];
}

describe('a probe that authorises a delete fails loudly rather than answering "nothing"', () => {
    const suspects = (): readonly string[] =>
        jobs().flatMap((job) => {
            const gates = gatingIds(job);

            return job.steps
                .filter((step) => {
                    const destructive = DESTRUCTIVE.some((pattern) => pattern.test(step.run ?? ''));
                    const gatesADelete = step.id !== undefined && gates.includes(step.id);

                    const key = `${job.workflow}:${job.name} » ${step.name ?? step.id}`;

                    return (
                        (destructive || gatesADelete) &&
                        MANUFACTURED.test(withoutComments(step.run ?? '')) &&
                        !FAIL_CLOSED.has(key)
                    );
                })
                .map(
                    (step) =>
                        `${job.workflow}:${job.name} » "${step.name ?? step.id}" manufactures an answer from a ` +
                        `failure (\`|| echo\` / \`|| true\`) in a step that authorises a delete`,
                );
        });

    it('finds the destructive steps at all', () => {
        // Non-vacuity: if nothing in the repository matches DESTRUCTIVE, every assertion here is empty and
        // this file reports perfect compliance over nothing.
        const destructiveSteps = jobs().flatMap((job) =>
            job.steps.filter((step) => DESTRUCTIVE.some((pattern) => pattern.test(step.run ?? ''))),
        );

        expect(destructiveSteps.length).toBeGreaterThan(0);
    });

    it('finds the steps that GATE them, so the indirect case is covered too', () => {
        // The reconciler's tier probe is not itself destructive — it only answers a question. The delete is
        // two steps later. Without this derivation the guard would check only the obvious half.
        expect(jobs().flatMap(gatingIds).length).toBeGreaterThan(0);
    });

    it('no such step turns a failure into a benign value', () => {
        expect(suspects()).toEqual([]);
    });

    it('every fail-closed exemption still names a real step that still manufactures a fallback', () => {
        // A stale entry is an argument about code that no longer exists — worse than no entry, because it
        // reads as analysis someone did.
        const present = new Set(
            jobs().flatMap((job) =>
                job.steps
                    .filter((step) => MANUFACTURED.test(withoutComments(step.run ?? '')))
                    .map((step) => `${job.workflow}:${job.name} » ${step.name ?? step.id}`),
            ),
        );

        expect([...FAIL_CLOSED.keys()].filter((key) => !present.has(key))).toEqual([]);
    });
});
