// @vitest-environment node
/**
 * Repo-wide guard: **the destroy path can never be pointed at production.**
 *
 * ## Why this is its own file
 *
 * `prScope.test.ts` proves the MATCHERS are correct — that `pr-1` does not claim `pr-15`, that `production`
 * is not claimed by anything. `sandboxReclamationReachability.test.ts` proves the teardown is REACHABLE —
 * that nothing runs ahead of it and pre-empts it. Neither asks the question this file asks:
 *
 * > can any caller, on any trigger, get a value that is not a `pr-{N}` token as far as the deletion script?
 *
 * That is a different property from both, and it is the one with no recovery. A reaper that misses is a
 * bill; a reaper that hits production is an outage plus data loss, and `DataStack` carries
 * `removalPolicy: DESTROY` with no automatic snapshot (ADR-0002).
 *
 * ## The three layers, asserted independently
 *
 * The safety is not one check, and it must not become one:
 *
 * 1. **The script refuses.** `teardown-sandbox-pr.sh` runs `pr_scope_is_token` on its argument and exits 2
 *    on anything else. Executed here against real hostile inputs, not read.
 * 2. **The caller cannot express a bad target.** Every workflow that reaches the script derives its target
 *    from a PR NUMBER, so a stage name is not a value the input can hold. A free-form `stage` string that
 *    flows to teardown would satisfy layer 1 only by luck of what someone typed.
 * 3. **No literal tier word appears on a teardown path at all.** `production`, `prod`, `sandbox` and
 *    `global` are the values a resource carries when it must survive; none of them belongs anywhere near
 *    the call.
 *
 *    ⚠️ THIS LAYER IS TEXTUAL, AND ITS LIMIT IS NOW NAMED RATHER THAN IMPLIED. It reads the YAML, so it
 *    catches the copy-paste it was written for and nothing else: a caller that built its target by
 *    concatenation, read it from a file, or routed it through `env:` indirection passes, because the
 *    literal never appears. A review demonstrated exactly that by mutation while this suite stayed green.
 *    The behavioural form of the question — what value actually ARRIVES at the deletion script — is
 *    answerable only by execution and now lives in `tests/teardownTargetIsAToken.integration.test.ts`,
 *    which runs each caller's real `run:` body against a recording stub. This layer is kept because it is
 *    cheap and fails fast on the obvious mistake; it is no longer the only thing standing behind claim 3.
 *
 * ⛔ Do not collapse these into one assertion because they overlap. Layer 1 is the last line and is the only
 * one that holds if a new caller is added tomorrow; layer 2 is what stops a caller being written wrongly in
 * the first place; layer 3 catches the copy-paste that neither shape-check would see.
 *
 * ## The independence is MEASURED, not asserted
 *
 * "Three independent layers" is the kind of claim that decays into prose, so each was removed in turn and
 * the suites watched to fail:
 *
 * | mutation | result |
 * |---|---|
 * | `pr_scope_is_token` neutered in `teardown-sandbox-pr.sh` | 10 failures here |
 * | the digits `case` removed from `sandbox-down.yml` | 9 failures in `tests/sandboxDownReclaims.integration.test.ts` |
 * | a tier word (`sandbox`) put on the teardown's argument | 1 failure here |
 *
 * ⚠️ Note where layer 2's evidence lives: it is BEHAVIOURAL and sits in the integration tier, because this
 * file can only read the workflow's shape. Until that tier existed, layer 2 was the one claim in the header
 * with nothing behind it.
 *
 * ## ⚠️ A workflow this guard cannot see is a workflow it silently approves
 *
 * Layers 2 and 3 enumerate their subjects through `trackedFiles`, which is `git ls-files` — so an UNTRACKED
 * file is not merely unchecked, it is absent from the population, and `it.each` over an empty slice reports
 * nothing at all rather than failing. Measured while writing this file: `sandbox-down.yml` passed every
 * assertion here before it was staged, and failed one the moment it was. The vacuity guards below
 * (`finds the callers`, and the non-empty `targets` assertion) are what stop the population going to zero
 * ENTIRELY; they cannot detect one missing member. Stage a new workflow before trusting a green run.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { WORKFLOWS_DIR, withoutComments, workflowJobs } from './cdkApps.js';
import { repoRoot, trackedFiles } from './serviceSources.js';

/** The one script that deletes a preview. */
const TEARDOWN = path.join(repoRoot, '.github/scripts/teardown-sandbox-pr.sh');

/** Values a resource carries when it must SURVIVE. None may appear on a teardown path. */
const MUST_SURVIVE = ['production', 'prod', 'sandbox', 'global'] as const;

/** Run the teardown script with one argument, without letting it reach AWS. */
function refuses(target: string): { readonly status: number | null; readonly stderr: string } {
    // A refused token exits BEFORE any AWS call, so this never touches the account. If a future edit moved
    // the guard below the first API call this test would hang or fail rather than quietly pass, which is
    // the correct direction for a guard over a deletion script.
    const result = spawnSync('bash', [TEARDOWN, target], {
        encoding: 'utf8',
        timeout: 20_000,
        env: { ...process.env, AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', AWS_PROFILE: '' },
    });

    return { status: result.status, stderr: `${result.stderr}${result.stdout}` };
}

describe('layer 1 — the deletion script itself refuses a non-preview target', () => {
    it.each([...MUST_SURVIVE, '*', 'pr-', 'pr-abc', '../pr-91', 'pr-91 prod', 'PR-91'])(
        'refuses %j with the token guard',
        (target) => {
            const { status } = refuses(target);

            // 2 is the script's documented misuse status. Anything else — 0 especially — means it began
            // work on a target it should never have accepted.
            expect(status).toBe(2);
        },
    );

    it.each(['', ' '])('refuses a blank argument (%j) before the token guard is even reached', (target) => {
        // ⚠️ Exit 1, not 2, and that is the script's `${1:?usage}` firing rather than `pr_scope_is_token`.
        // Asserted as its own case rather than folded into the list above: the property that matters is
        // "refused without doing work", and pinning the WRONG status here would have to be loosened later
        // by someone who would then loosen it for the token cases too.
        expect(refuses(target).status).not.toBe(0);
    });

    it('is not vacuous: a real preview token is ACCEPTED past the guard', () => {
        // ⛔ The discriminating half. A script that refused everything would pass every assertion above
        // while reclaiming nothing, which is the failure mode that costs money rather than data. This runs
        // with no credentials, so it gets past the token guard and fails at AWS — the point is only that
        // the REFUSAL did not fire.
        const { status, stderr } = refuses('pr-999999');

        expect(status).not.toBe(2);
        expect(stderr).not.toMatch(/refusing to tear down/u);
    });
});

describe('layer 2 — no caller can express a target that is not a PR number', () => {
    const callers = (): readonly { readonly workflow: string; readonly name: string; readonly body: string }[] =>
        workflowJobs().filter((job) => job.body.includes('teardown-sandbox-pr.sh'));

    it('finds the callers', () => {
        expect(callers().length).toBeGreaterThan(0);
    });

    it.each(callers().map((job) => [`${job.workflow}:${job.name}`, job] as const))(
        '%s derives its target from a PR number',
        (_label, job) => {
            // The argument to the script must be a shell variable, never an interpolated `${{ }}` (which is
            // template injection) and never a literal. What fills that variable is asserted by layer 3 and
            // by the input-shape assertion below.
            // ⚠️ Line-wise, and `chmod +x <script>` is not an invocation. A naive
            // `/teardown-sandbox-pr\.sh\s+(\S+)/` spans the newline after the `chmod` line and reports
            // whatever the NEXT line starts with as the target — which is how the first version of this
            // guard accused three correct jobs.
            const calls = job.body
                .split('\n')
                .filter((line) => line.includes('teardown-sandbox-pr.sh') && !/\bchmod\b/u.test(line))
                .flatMap((line) => [...line.matchAll(/teardown-sandbox-pr\.sh\s+(\S+)/gu)].map((m) => m[1] ?? ''));

            expect(calls.length).toBeGreaterThan(0);

            for (const argument of calls) {
                // Either a whole shell variable (`"$PR"`) or the literal `pr-` prefix applied to one
                // (`"pr-${PR_NUMBER}"`). The second is the STRONGER shape, not a concession: the caller
                // holds only digits and cannot name a stage at all, where a whole variable is only as good
                // as what filled it. What both exclude is a literal target and a `${{ }}` interpolation —
                // the latter being both template injection and a value from outside the shell's control.
                expect(argument).toMatch(/^"?(?:pr-)?\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"?$/u);
                expect(argument).not.toMatch(/\$\{\{/u);
            }
        },
    );
});

describe('layer 3 — no tier word appears anywhere on a teardown path', () => {
    /** Every workflow that can reach the teardown script, by its own text. */
    const teardownWorkflows = (): readonly { readonly name: string; readonly text: string }[] =>
        trackedFiles(WORKFLOWS_DIR)
            .filter((file) => file.endsWith('.yml'))
            .map((file) => ({
                name: path.basename(file),
                text: withoutComments(readFileSync(path.join(repoRoot, file), 'utf8')),
            }))
            .filter((workflow) => workflow.text.includes('teardown-sandbox-pr.sh'));

    it.each(teardownWorkflows().map((workflow) => [workflow.name] as const))(
        '%s never assigns a tier word to anything the teardown reads',
        (name) => {
            const text = teardownWorkflows().find((workflow) => workflow.name === name)?.text ?? '';
            // The variables that reach the script, per layer 2 — resolved from this workflow's own calls so
            // a renamed variable cannot slip past by not being listed here.
            const targets = new Set(
                text
                    .split('\n')
                    .filter((line) => line.includes('teardown-sandbox-pr.sh') && !/\bchmod\b/u.test(line))
                    .flatMap((line) =>
                        [
                            ...line.matchAll(
                                /teardown-sandbox-pr\.sh\s+"?(?:pr-)?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"?/gu,
                            ),
                        ].map((match) => match[1] ?? ''),
                    ),
            );

            expect(targets.size).toBeGreaterThan(0);

            for (const variable of targets) {
                for (const word of MUST_SURVIVE) {
                    // An assignment of a surviving tier's name to the very variable that gets deleted.
                    expect(text, `${name} assigns ${word} to ${variable}, which reaches the teardown`).not.toMatch(
                        new RegExp(`^\\s*${variable}[:=]\\s*['"]?${word}['"]?\\s*$`, 'mu'),
                    );
                }
            }
        },
    );
});
