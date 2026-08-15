// @vitest-environment node
/**
 * Repo-wide guard: per-PR reclamation is REACHABLE — nothing that runs before the teardown script may
 * pre-empt it, the teardown runs even after an earlier step has failed, and no CloudFormation export is
 * resolved with the idiom that emits two lines.
 *
 * ## The incident this exists to make impossible
 *
 * ADR-0005 gives a closed PR exactly two chances to have its `pr-{N}` resources reclaimed: the `cleanup`
 * job on `pull_request: closed`, and the daily `reap-abandoned` sweep. Both call the ONE script
 * `.github/scripts/teardown-sandbox-pr.sh`, which is what keeps them from drifting. On 2026-07-28,
 * `a75bdcd7` added a *preview-DNS* prerequisite step — `Resolve the sandbox hosted zone` — to BOTH jobs,
 * ahead of the teardown step, ending in:
 *
 *     if [ -z "$ZONE" ] || [ "$ZONE" = "None" ]; then … exit 1; fi
 *     echo "hosted_zone_id=$ZONE" >> "$GITHUB_OUTPUT"
 *
 * That step then failed deterministically, for a reason unrelated to teardown: `ListExports` pages at 100
 * items and the AWS CLI applies `--query` per page, so with 196 exports in the account the lookup returned
 * `"Z0474…\nNone"`. The `= "None"` guard compares the WHOLE two-line string and does not match, so the
 * multi-line value reached `$GITHUB_OUTPUT`, which GitHub rejects: `Invalid format 'None'`. The step failed,
 * and because a failed step skips the rest of the job, the teardown step **never ran at all**.
 *
 * The blast radius was total and silent:
 *
 * | What | Evidence |
 * |---|---|
 * | 9 merged PRs never reclaimed (73, 77–83, 90) | their stacks sat at `UPDATE_COMPLETE`/`CREATE_COMPLETE` — delete was never even *attempted* |
 * | 27 live Fargate tasks billing for closed work | food (2 tasks) + recipe (1) per PR, ~$8.25/mo per food API task |
 * | the daily reaper NEVER succeeded once | 11 scheduled runs, 2026-07-31 → 2026-08-10, all `failure`, all at the same step |
 * | the retry path for a genuinely stuck stack was dead too | pr-57/pr-59 hit `DELETE_FAILED` on 2026-07-05 and were never retried, because the only thing that retries them is the reaper |
 *
 * Note the shape: the failing lookup serves ONLY the DNS half of teardown. The stacks, ECR repos and log
 * groups need no hosted zone whatsoever. A prerequisite for one *part* of the work was allowed to cancel
 * *all* of it — and `teardown-sandbox-pr.sh` was already written to handle a missing zone correctly
 * (section 0 records `::error::` + `teardown_failed=1` and carries on to the stacks). The script's own
 * robustness was bypassed by the workflow that calls it.
 *
 * None of this is visible to `actionlint` or `zizmor`: the YAML is valid and the shell is well-formed. It is
 * visible only by asking a question neither tool asks — *can this step stop the teardown from running?*
 *
 * ## 1 — no step preceding a teardown invocation may deliberately abort
 *
 * For every job that invokes `teardown-sandbox-pr.sh`, each EARLIER step's `run:` body must contain no
 * explicit non-zero `exit`. The teardown is the last line of defense against a leak; nothing staged ahead of
 * it gets to decide it should not happen. When a prerequisite genuinely cannot be met, the correct shape is
 * to hand the script an empty value and let the script report what it could not reclaim and exit non-zero —
 * which fails the job just as loudly while still reclaiming everything that did not depend on the missing
 * value.
 *
 * The rule targets *deliberate* aborts (`exit 1`), not the inherent possibility that any step fails: a step
 * like `npm ci` can fail too, but it is a real precondition for running the script at all and carries no
 * explicit exit, so it passes without being special-cased. Steps that only ever `exit 0` also pass — an early
 * "nothing to do" return does not leak anything. `uses:` steps have no shell body to inspect.
 *
 * ## 2 — no workflow resolves a CloudFormation export with the unpaginated one-liner
 *
 * `.github/scripts/cfn-export.sh` exists because `list-exports … --query "Exports[?Name=='…'].Value | [0]"`
 * is wrong per-page, and it was wrong in ten places. `cfnExport.test.ts` proves the helper is right; nothing
 * stopped a caller from open-coding the broken idiom again, which is precisely how it reached both
 * reclamation jobs. This analyzer pins every export lookup in every workflow to the helper.
 *
 * ## 3 — a failed earlier step must not be able to skip the teardown at all
 *
 * Analyzers 1 and 2 between them remove the coupling and the trigger, but neither closes the general case:
 * GitHub skips every remaining step once any step fails, so a predecessor that fails **without** an explicit
 * `exit` still takes the teardown with it — and that is literally what happened here, since the fatal step
 * failed by writing a malformed `$GITHUB_OUTPUT` line rather than by exiting. So each teardown step must also
 * carry a skip-tolerant `if:` (`!cancelled()`), making it run on its own merits and report its own outcome.
 *
 * The three are complements, not alternatives: 1 removes the *coupling*, 2 removes the *trigger*, 3 removes
 * the *consequence*. This is the same double protection the food/recipe deploy ordering uses (ADR-0010) — a
 * structural rule AND an explicit condition, so neither alone is load-bearing. Skip-tolerance is decided by
 * the shared `isSkipTolerant` helper, not a local regex, so this guard and `workflowInvariants.test.ts`
 * cannot disagree about what the phrase means.
 *
 * ## Mutation evidence (each applied, and the named test watched to fail)
 *
 *   1. Written BEFORE the fix: analyzer 1 reported both real jobs' `Resolve the sandbox hosted zone` steps —
 *      `sandbox-deploy.yml#cleanup` and `sandbox-deploy.yml#reap-abandoned` — and went green once the two
 *      steps stopped calling `exit 1`. This is the red-before-green run for the real defect.
 *   2. `exit 1` restored to the `cleanup` job's zone step only → analyzer 1 reports that one job, proving the
 *      analyzer localizes per job rather than passing on the strength of the other.
 *   3. An `exit 1` step appended AFTER the reaper's teardown step → analyzer 1 stays green, confirming it
 *      keys on ORDER rather than on the mere presence of an aborting step in the job.
 *   4. `cfn-export.sh` in the cleanup job's zone step replaced with the bare
 *      `aws cloudformation list-exports --query "Exports[?Name=='…'].Value | [0]"` → analyzer 2 reports it.
 *      Recorded in full because the FIRST attempt did **not** report: analyzer 2 then exempted any body
 *      mentioning the helper, and the step's own explanatory comment satisfied that. The mutation found a
 *      real defect in this guard, not in the workflow. The exemption is now gone and the
 *      `is not exempted by a COMMENT that merely mentions the helper` fixture pins the distinction — which
 *      is the whole argument for running mutations rather than trusting a green suite.
 *   5. `shellLines`' comment filter removed → the `ignores a commented-out exit` fixture fails, showing the
 *      analyzers read code rather than prose.
 *   6. `if: ${{ !cancelled() }}` dropped from the `cleanup` job's teardown step → analyzer 3 reports
 *      `sandbox-deploy.yml#cleanup » Tear down …`, and the `reap-abandoned` copy does not vouch for it.
 *
 * Every function here is pure: parsed workflows in, a sorted list of compact violation IDs out.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { isSkipTolerant } from './workflowExpression.js';

const WORKFLOW_DIR = fileURLToPath(new URL('../../../../.github/workflows/', import.meta.url));

/** The teardown entry point both reclamation paths must reach. */
const TEARDOWN_SCRIPT = 'teardown-sandbox-pr.sh';

/** The shared, paginated export resolver every lookup must go through. */
const EXPORT_HELPER = 'cfn-export.sh';

interface WorkflowStep {
    readonly name?: string;
    readonly id?: string;
    readonly uses?: string;
    readonly run?: string;
    readonly if?: string;
}

interface WorkflowJob {
    readonly steps?: readonly WorkflowStep[];
}

interface WorkflowDocument {
    readonly jobs?: Readonly<Record<string, WorkflowJob>>;
}

interface ParsedWorkflow {
    readonly file: string;
    readonly doc: WorkflowDocument;
}

/**
 * Every workflow in `.github/workflows/`, parsed. Discovered from disk rather than listed, so a NEW
 * workflow inherits both invariants the day it lands.
 *
 * @sideEffect reads the workflow directory
 */
function readWorkflows(): readonly ParsedWorkflow[] {
    return readdirSync(WORKFLOW_DIR)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .sort()
        .map((file) => ({ file, doc: parse(readFileSync(join(WORKFLOW_DIR, file), 'utf8')) as WorkflowDocument }));
}

/** A stable, human-readable id for a step, for use in violation messages. */
function stepId(file: string, job: string, step: WorkflowStep, index: number): string {
    return `${file}#${job} » ${step.name ?? step.id ?? `step[${index}]`}`;
}

/**
 * The shell lines of a `run:` body, with whole-line comments removed.
 *
 * Comment stripping is line-leading only, deliberately: trimming from the first `#` anywhere would corrupt
 * lines that legitimately contain one (a `#` inside a quoted string, a `${var#prefix}` expansion), and the
 * only thing this needs to avoid is a commented-out example being read as real code.
 */
function shellLines(run: string): readonly string[] {
    return run
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/** True when a `run:` body contains an explicit non-zero `exit`, i.e. a deliberate abort. */
function abortsDeliberately(run: string): boolean {
    return shellLines(run).some((line) => /\bexit\s+[1-9][0-9]*\b/.test(line));
}

/**
 * Analyzer 1 — steps that can pre-empt a teardown invocation in the same job.
 *
 * Returns one id per offending step, sorted. Empty means every teardown invocation is unconditionally
 * reached once its job starts.
 */
export function preEmptibleStepsBeforeReclamation(workflows: readonly ParsedWorkflow[]): readonly string[] {
    const violations: string[] = [];

    for (const { file, doc } of workflows) {
        for (const [job, definition] of Object.entries(doc.jobs ?? {})) {
            const steps = definition.steps ?? [];
            const teardownAt = steps.findIndex((step) => step.run?.includes(TEARDOWN_SCRIPT));

            if (teardownAt < 0) {
                continue;
            }

            steps.slice(0, teardownAt).forEach((step, index) => {
                if (step.run !== undefined && abortsDeliberately(step.run)) {
                    violations.push(stepId(file, job, step, index));
                }
            });
        }
    }

    return violations.sort();
}

/**
 * Analyzer 2 — export lookups that open-code the per-page-broken `ListExports` idiom.
 *
 * There is no exemption, deliberately. The correct form delegates to `cfn-export.sh`, and doing so puts no
 * `list-exports` call in the workflow at all, so a step that carries the idiom has by definition not
 * delegated. An earlier draft exempted any body mentioning the helper — and mutation 4 walked straight
 * through it, because these steps carry a COMMENT pointing at `.github/scripts/cfn-export.sh` to explain
 * why the helper is used: the prose alone kept the step exempt after the real call was swapped back to the
 * broken one-liner. Matching against comment-stripped lines closed that hole; deleting the exemption
 * removed the class.
 *
 * A caller needing a query the helper does not offer is still flagged, and correctly so — it would be
 * subject to the very same per-page bug.
 */
export function unpaginatedExportLookups(workflows: readonly ParsedWorkflow[]): readonly string[] {
    const violations: string[] = [];

    for (const { file, doc } of workflows) {
        for (const [job, definition] of Object.entries(doc.jobs ?? {})) {
            (definition.steps ?? []).forEach((step, index) => {
                if (step.run === undefined) {
                    return;
                }

                const code = shellLines(step.run).join('\n');

                if (code.includes('list-exports') && /Exports\[\?Name\s*==/.test(code)) {
                    violations.push(stepId(file, job, step, index));
                }
            });
        }
    }

    return violations.sort();
}

/**
 * Analyzer 3 — teardown invocations that a preceding step's failure would silently skip.
 *
 * Analyzer 1 removes *deliberate* aborts, which is the defect that actually happened. It cannot cover the
 * general case: GitHub skips every remaining step once any step fails, so a predecessor that fails **without**
 * an explicit `exit` — a failing command under `set -e`, or the malformed `$GITHUB_OUTPUT` write that caused
 * this very incident — still takes the teardown down with it. The durable fix is to make the teardown step
 * skip-tolerant, so it runs on its own merits and reports its own outcome.
 *
 * This is the same double protection the food/recipe deploy ordering uses (ADR-0010): a structural rule AND an
 * explicit `!cancelled()`, so neither alone is load-bearing. `always()` would also satisfy it, but
 * `!cancelled()` is preferred — a cancelled run should not start deleting infrastructure.
 *
 * Skip-tolerance is decided by the shared `isSkipTolerant` from `workflowExpression.ts` rather than a local
 * regex, so this guard and `workflowInvariants.test.ts` cannot disagree about what the phrase means.
 */
export function skippableTeardownSteps(workflows: readonly ParsedWorkflow[]): readonly string[] {
    const violations: string[] = [];

    for (const { file, doc } of workflows) {
        for (const [job, definition] of Object.entries(doc.jobs ?? {})) {
            (definition.steps ?? []).forEach((step, index) => {
                if (step.run?.includes(TEARDOWN_SCRIPT) && !isSkipTolerant(step.if)) {
                    violations.push(stepId(file, job, step, index));
                }
            });
        }
    }

    return violations.sort();
}

/** Parse an inline workflow body, for fixture-driven proofs that the analyzers are not vacuous. */
function fixture(body: string): readonly ParsedWorkflow[] {
    return [{ file: 'fixture.yml', doc: parse(body) as WorkflowDocument }];
}

describe('per-PR reclamation is reachable', () => {
    const workflows = readWorkflows();

    it('has a job that invokes the teardown script at all', () => {
        const invoking = workflows.flatMap(({ file, doc }) =>
            Object.entries(doc.jobs ?? {})
                .filter(([, job]) => (job.steps ?? []).some((step) => step.run?.includes(TEARDOWN_SCRIPT)))
                .map(([job]) => `${file}#${job}`),
        );

        // Both reclamation paths must exist; without this the two analyzers below could pass vacuously.
        expect(invoking.sort()).toEqual(['sandbox-deploy.yml#cleanup', 'sandbox-deploy.yml#reap-abandoned']);
    });

    it('lets no step deliberately abort before the teardown script runs', () => {
        expect(preEmptibleStepsBeforeReclamation(workflows)).toEqual([]);
    });

    it('resolves every CloudFormation export through the paginated helper', () => {
        expect(unpaginatedExportLookups(workflows)).toEqual([]);
    });

    it('runs the teardown even when an earlier step has already failed', () => {
        expect(skippableTeardownSteps(workflows)).toEqual([]);
    });
});

describe('preEmptibleStepsBeforeReclamation', () => {
    it('reports a prerequisite step that exits non-zero ahead of the teardown', () => {
        const violations = preEmptibleStepsBeforeReclamation(
            fixture(`
jobs:
    cleanup:
        steps:
            - name: Resolve the sandbox hosted zone
              run: |
                  ZONE=$(lookup)
                  if [ -z "$ZONE" ]; then exit 1; fi
            - name: Tear down
              run: .github/scripts/${TEARDOWN_SCRIPT} "$PR"
`),
        );

        expect(violations).toEqual(['fixture.yml#cleanup » Resolve the sandbox hosted zone']);
    });

    it('accepts a prerequisite that reports and continues instead of aborting', () => {
        const violations = preEmptibleStepsBeforeReclamation(
            fixture(`
jobs:
    cleanup:
        steps:
            - name: Resolve the sandbox hosted zone
              run: |
                  ZONE=$(lookup --optional)
                  if [ -z "$ZONE" ]; then echo "::error::no zone"; fi
                  echo "hosted_zone_id=$ZONE" >> "$GITHUB_OUTPUT"
            - name: Tear down
              run: .github/scripts/${TEARDOWN_SCRIPT} "$PR"
`),
        );

        expect(violations).toEqual([]);
    });

    it('keys on order — an aborting step AFTER the teardown cannot pre-empt it', () => {
        const violations = preEmptibleStepsBeforeReclamation(
            fixture(`
jobs:
    cleanup:
        steps:
            - name: Tear down
              run: .github/scripts/${TEARDOWN_SCRIPT} "$PR"
            - name: Report
              run: if [ -n "$failed" ]; then exit 1; fi
`),
        );

        expect(violations).toEqual([]);
    });

    it('ignores an early "nothing to do" exit 0, which leaks nothing', () => {
        const violations = preEmptibleStepsBeforeReclamation(
            fixture(`
jobs:
    cleanup:
        steps:
            - name: Probe
              run: if [ -z "$PR" ]; then exit 0; fi
            - name: Tear down
              run: .github/scripts/${TEARDOWN_SCRIPT} "$PR"
`),
        );

        expect(violations).toEqual([]);
    });

    it('ignores a commented-out exit', () => {
        const violations = preEmptibleStepsBeforeReclamation(
            fixture(`
jobs:
    cleanup:
        steps:
            - name: Probe
              run: |
                  # historically this used to exit 1 here
                  echo ok
            - name: Tear down
              run: .github/scripts/${TEARDOWN_SCRIPT} "$PR"
`),
        );

        expect(violations).toEqual([]);
    });

    it('ignores jobs that never invoke the teardown script', () => {
        const violations = preEmptibleStepsBeforeReclamation(
            fixture(`
jobs:
    deploy:
        steps:
            - name: Guard
              run: if [ -z "$STAGE" ]; then exit 1; fi
`),
        );

        expect(violations).toEqual([]);
    });
});

describe('unpaginatedExportLookups', () => {
    it('reports the bare per-page-broken ListExports idiom', () => {
        const violations = unpaginatedExportLookups(
            fixture(`
jobs:
    cleanup:
        steps:
            - name: Resolve the sandbox hosted zone
              run: |
                  ZONE=$(aws cloudformation list-exports --region "$REGION" \\
                    --query "Exports[?Name=='kitchensink-domain-sandbox:HostedZoneId'].Value | [0]" --output text)
`),
        );

        expect(violations).toEqual(['fixture.yml#cleanup » Resolve the sandbox hosted zone']);
    });

    it('is not exempted by a COMMENT that merely mentions the helper', () => {
        const violations = unpaginatedExportLookups(
            fixture(`
jobs:
    cleanup:
        steps:
            - name: Resolve the sandbox hosted zone
              run: |
                  # Resolved through the shared helper. See .github/scripts/${EXPORT_HELPER}.
                  ZONE=$(aws cloudformation list-exports --region "$REGION" \\
                    --query "Exports[?Name=='kitchensink-domain-sandbox:HostedZoneId'].Value | [0]" --output text)
`),
        );

        expect(violations).toEqual(['fixture.yml#cleanup » Resolve the sandbox hosted zone']);
    });

    it('accepts a lookup delegated to the shared helper', () => {
        const violations = unpaginatedExportLookups(
            fixture(`
jobs:
    cleanup:
        steps:
            - name: Resolve the sandbox hosted zone
              run: ZONE=$(bash .github/scripts/${EXPORT_HELPER} --optional 'kitchensink-domain-sandbox:HostedZoneId' "$REGION")
`),
        );

        expect(violations).toEqual([]);
    });
});

describe('skippableTeardownSteps', () => {
    it('reports a teardown step with no skip-tolerant condition', () => {
        const violations = skippableTeardownSteps(
            fixture(`
jobs:
    cleanup:
        steps:
            - name: Tear down
              run: .github/scripts/${TEARDOWN_SCRIPT} "$PR"
`),
        );

        expect(violations).toEqual(['fixture.yml#cleanup » Tear down']);
    });

    it('accepts `!cancelled()`, so a failed predecessor cannot skip reclamation', () => {
        const violations = skippableTeardownSteps(
            fixture(`
jobs:
    cleanup:
        steps:
            - name: Tear down
              if: \${{ !cancelled() }}
              run: .github/scripts/${TEARDOWN_SCRIPT} "$PR"
`),
        );

        expect(violations).toEqual([]);
    });

    it('rejects a condition that is merely present but not skip-tolerant', () => {
        const violations = skippableTeardownSteps(
            fixture(`
jobs:
    cleanup:
        steps:
            - name: Tear down
              if: \${{ github.event.action == 'closed' }}
              run: .github/scripts/${TEARDOWN_SCRIPT} "$PR"
`),
        );

        expect(violations).toEqual(['fixture.yml#cleanup » Tear down']);
    });
});
