// @vitest-environment node
/**
 * Repo-wide guard: the structural invariants that hold for EVERY file in `.github/workflows/`.
 *
 * ## Why this file exists
 *
 * Three production incidents in this repo originated in workflow YAML, and they share one property: the run
 * was GREEN and the *absence* of work is what shipped. No linter available to us catches the worst of them —
 * `actionlint` validates syntax, expressions and contexts; `zizmor` audits security; CodeQL's `actions` pack
 * looks for injection and untrusted checkout. None of them model "this job can never be reached", "this
 * download has no upload", "this build runs after the prune that deleted its compiler", or "this step named
 * `verify` cannot fail". Those are properties of THIS pipeline, so they are asserted here.
 *
 * Three narrower guards already exist and are deliberately NOT duplicated:
 *
 *   - `prodDeployReachability.test.ts` — the flag/paths reachability of `prod-deploy.yml`'s food+recipe
 *     legs, by EXECUTING the embedded bash. That is step-level reachability inside one job; invariant 1 here
 *     is JOB-level reachability across the `needs` graph of every workflow. Different failure, no overlap.
 *   - `prodDeployBuildOrder.test.ts` — `turbo run build` before `npm prune`, in `prod-deploy.yml` only.
 *     The prod-deploy-specific claims that file owns (exactly one prune; every pushed image has a build)
 *     are not restated here.
 *   - `postPruneToolchain.test.ts` — the one-way door generalised to every pruning job and every tool,
 *     DERIVED from the manifests and the lockfile rather than from a list of build commands. That is where
 *     invariant 3 of this file went (2026-09-03): its enumerated `BUILD_COMMANDS` regex could not tell a
 *     tool the prune removes (`aws-cdk`, `turbo`) from one a workspace declares as runtime (`typescript`,
 *     `esbuild`), so it carried two false findings as a ratchet and missed eight real `npx cdk` registry
 *     fallbacks — including the identity leg's — because it exempted `npx cdk deploy` by name.
 *   - `globalBootstrapBundle.test.ts` — `bundle:lambda` before `cdk deploy`/prune for the global app. It
 *     anchors on `findIndex` (the FIRST bundle and FIRST prune).
 *
 * ## How it is asserted (and what it refuses to do)
 *
 * Each invariant is a PURE analyzer: parsed workflows in, a sorted list of compact violation IDs out. Two
 * callers exercise every analyzer — the real tree (must be clean) and deliberately broken FIXTURES written to
 * a temp dir (must be flagged, with negative controls that must not be). The fixtures are the permanent
 * mutation evidence: a guard nobody has watched fail is not a guard, and a `toEqual([])` against a tree that
 * happens to be clean passes just as well when the analyzer is broken.
 *
 * No embedded bash is re-implemented here. Where a rule lives in a shell script that CI runs, the existing
 * guards execute that script (`prodDeployReachability.test.ts`, `deployGate.test.ts`, `prScope.test.ts`)
 * — a second copy of the rules drifts from the one CI runs. This file asserts only the YAML STRUCTURE around
 * those scripts, which is not expressible in bash at all.
 *
 * ## Mutation evidence (every assertion below has been watched fail)
 *
 * First run: all five analyzers stubbed to `return []`. All 10 positive fixture assertions failed, while the
 * negative controls and the real-tree checks passed vacuously — exactly the false confidence the fixtures
 * exist to remove. Then, per invariant (analyzer mutations first, then a transient edit to a REAL workflow to
 * prove the real-tree assertion is not vacuous; every real file was restored from a byte-copy and verified
 * with `md5sum -c` plus `git status --porcelain`):
 *
 *   1. **Reachability** — `if (orphaned.length > 0)` → `> 1` reds `edge.yml`; forcing `orphaned` to `[]` reds
 *      it too; deleting the dead-job push reds `dead.yml`; deleting the `isSkipTolerant` escape turns
 *      `tolerant.yml` into a false positive; dropping the reversed-comparison normalisation reds
 *      `reversed.yml`; short-circuiting the no-caller check reds `_orphaned.yml`. Real tree: narrowing
 *      `sandbox-deploy.yml`'s `deploy-food` to dispatch-only AND
 *      removing `deploy-recipe`'s `!cancelled()` produced `deploy-recipe → runs on pull_request but its
 *      dependency \`deploy-food\` cannot`.
 *      **Known limitation, measured:** removing ONLY `!cancelled()` is *not* flagged. Under a
 *      `workflow_dispatch` with `service: recipe`, `deploy-food`'s `github.event.inputs.service == 'food'` is
 *      UNKNOWN to the evaluator, so it cannot prove the dependency is skipped. Dispatch-input asymmetry is
 *      out of scope here; ADR-0010 and the comment in the workflow remain the protection for that specific
 *      case, and `!cancelled()` must stay.
 *   2. **Artifact pairing** — replacing the `needs` closure with "every other job" makes `unordered.yml` pass,
 *      so the closure walk is load-bearing. Real tree: adding an unpaired `download-artifact` to
 *      `_ci-heavy.yml` reds both the pairing assertion and the anti-vacuity check.
 *   3. **Prune ordering** — MOVED to `postPruneToolchain.test.ts` (see above); the number is kept so the
 *      other invariants keep their names.
 *   4. **Silent-success inventory** — folding the `×N` count to a constant reds `twice.yml`; deleting one
 *      allowlist entry reds the real-tree equality; dropping the job-level branch reds `whole-job.yml`.
 *      Real tree: adding one `aws sts get-caller-identity ||
 *      true` step to `_ci-heavy.yml` produced `+ "suppressed-exit _ci-heavy.yml::load-test::Sneaky new silent
 *      step ×1"`.
 *   5. **Unfailable verifications** — dropping the suppression precondition turns `linter.yml` into a false
 *      positive, which is why the rule is "suppresses its exit status AND has no explicit failure path"
 *      rather than the blunter "contains no comparison, no `exit 1`, no `::error::`": GitHub runs `run:`
 *      bodies under `bash -e`, so `actionlint`'s own non-zero exit already fails its step and the blunt rule
 *      would flag it. Dropping the job-level `continue-on-error` term reds `excused-job.yml`. Real tree:
 *      adding a `code=$(curl … || true)`-then-`echo` step named "Smoke test" to `sandbox-deploy.yml`
 *      produced `→ cannot fail: suppresses its exit status and never checks it`.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { type Truth, evaluateCondition, isSkipTolerant } from './workflowExpression.js';

const WORKFLOW_DIR = fileURLToPath(new URL('../../../../.github/workflows/', import.meta.url));

interface WorkflowStep {
    readonly name?: string;
    readonly id?: string;
    readonly run?: string;
    readonly uses?: string;
    readonly if?: string;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly with?: Readonly<Record<string, unknown>>;
    readonly 'continue-on-error'?: boolean;
}

interface WorkflowJob {
    readonly name?: string;
    readonly needs?: string | readonly string[];
    readonly if?: string;
    readonly uses?: string;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly with?: Readonly<Record<string, unknown>>;
    readonly services?: Readonly<Record<string, unknown>>;
    readonly steps?: readonly WorkflowStep[];
    readonly 'continue-on-error'?: boolean;
}

interface WorkflowInput {
    readonly default?: unknown;
}

interface WorkflowDocument {
    readonly on?: Readonly<Record<string, unknown>> | readonly string[] | string;
    readonly jobs?: Readonly<Record<string, WorkflowJob>>;
}

interface Workflow {
    readonly file: string;
    readonly doc: WorkflowDocument;
}

/** Parse every workflow in a directory, in filename order. */
function load(directory: string): readonly Workflow[] {
    return readdirSync(directory)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .sort()
        .map((file) => ({ file, doc: parse(readFileSync(join(directory, file), 'utf8')) as WorkflowDocument }));
}

/** The real `.github/workflows/` tree. */
function realWorkflows(): readonly Workflow[] {
    return load(WORKFLOW_DIR);
}

/**
 * Write the given YAML bodies into a throwaway directory and parse them as a workflow tree.
 *
 * @sideEffect Creates a temp directory. Real workflow files are never touched.
 */
function fixture(files: Readonly<Record<string, string>>): readonly Workflow[] {
    const directory = mkdtempSync(join(tmpdir(), 'workflow-invariants-'));

    for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(directory, name), body);
    }

    return load(directory);
}

/** A step's stable identity for violation IDs and the allowlist. */
function stepLabel(step: WorkflowStep): string {
    return step.name ?? step.uses ?? (step.run ?? '').split('\n')[0]?.trim() ?? '(unnamed)';
}

/** `needs:` normalised to a list. */
function needsOf(job: WorkflowJob): readonly string[] {
    if (job.needs === undefined) {
        return [];
    }

    return typeof job.needs === 'string' ? [job.needs] : job.needs;
}

/** The event names a workflow triggers on, however `on:` is written. */
function triggerEvents(doc: WorkflowDocument): readonly string[] {
    const on = doc.on;

    if (typeof on === 'string') {
        return [on];
    }

    if (Array.isArray(on)) {
        return on;
    }

    return Object.keys(on ?? {});
}

// ---------------------------------------------------------------------------------------------------------
// Event-name reasoning over GitHub `if:` expressions.
//
// The boolean grammar (`!`, `&&`, `||`, parens, call atoms) lives ONCE, in `./workflowExpression.ts`, and is
// shared with `heavyE2eLoadTierGate.test.ts` — see that module's header for why the atom resolver is a
// parameter. What is local to THIS guard is the resolver's POLICY.
//
// The question asked of an `if` here is only ever "can this be FALSE for certain under event E?". Anything
// the resolver does not model — `inputs.*`, `needs.*.result`, `contains(...)`, secrets — is UNKNOWN, i.e. it
// might be true, so the job might run. That asymmetry is deliberate: a guard that guesses "false" would
// invent unreachable jobs, whereas guessing "unknown" only ever loses a finding.
// ---------------------------------------------------------------------------------------------------------

/** Resolve an atom against a known event name; everything else is UNKNOWN. */
function eventAtomTruth(atom: string, event: string, eventKnown: boolean): Truth {
    if (!eventKnown) {
        return 'unknown';
    }

    // Normalise `'push' == github.event_name` to the usual order so one pattern covers both.
    const comparison = /^github\.event_name\s*(==|!=)\s*'([^']*)'$/.exec(
        atom.replace(/^'([^']*)'\s*(==|!=)\s*github\.event_name$/, "github.event_name $2 '$1'"),
    );

    if (comparison === null) {
        return 'unknown';
    }

    const equal = comparison[2] === event;

    return (comparison[1] === '==' ? equal : !equal) ? 'true' : 'false';
}

/** Whether a job's `if` leaves it able to run under `event`. Absent `if` means yes. */
function mayRun(condition: string | undefined, event: string, eventKnown: boolean): boolean {
    if (condition === undefined) {
        return true;
    }

    return evaluateCondition(condition, (atom) => eventAtomTruth(atom, event, eventKnown)) !== 'false';
}

/** `workflow_call` inputs of a reusable workflow. */
function callInputs(doc: WorkflowDocument): Readonly<Record<string, WorkflowInput>> {
    const on = doc.on;

    if (typeof on !== 'object' || Array.isArray(on)) {
        return {};
    }

    const call = (on as Record<string, { inputs?: Record<string, WorkflowInput> }>)['workflow_call'];

    return call?.inputs ?? {};
}

/** Every job across the tree that calls the given reusable workflow file. */
function callersOf(file: string, workflows: readonly Workflow[]): readonly WorkflowJob[] {
    return workflows.flatMap(({ doc }) =>
        Object.values(doc.jobs ?? {}).filter((job) => (job.uses ?? '').endsWith(`/${file}`)),
    );
}

// ---------------------------------------------------------------------------------------------------------
// Invariant 1 — job reachability
// ---------------------------------------------------------------------------------------------------------

/**
 * Jobs no real trigger can reach, and edges where a dependent outlives its dependency.
 *
 * A reusable workflow has no trigger of its own, so its jobs are reachable only through callers: an
 * `inputs.X`-gated job whose input defaults false and which no caller switches on is dead code that renders
 * as a permanently-skipped entry in every run graph.
 */
function findUnreachableJobs(workflows: readonly Workflow[]): readonly string[] {
    const violations: string[] = [];

    for (const { file, doc } of workflows) {
        const jobs = doc.jobs ?? {};
        const events = triggerEvents(doc);
        const reusable = events.includes('workflow_call');
        // Inside a called workflow `github.event_name` is the CALLER's event, so it is not knowable here.
        const reasoned = reusable ? ['workflow_call'] : events;
        const inputs = callInputs(doc);
        const callers = callersOf(file, workflows);

        if (reusable && callers.length === 0) {
            violations.push(`${file} → unreachable: reusable workflow that no workflow calls`);
        }

        for (const [name, job] of Object.entries(jobs)) {
            for (const need of needsOf(job)) {
                if (!(need in jobs)) {
                    violations.push(`${file}::${name} → needs \`${need}\`, which is not a job in this workflow`);
                }
            }

            const live = reasoned.filter((event) => mayRun(job.if, event, !reusable));

            if (live.length === 0) {
                violations.push(
                    `${file}::${name} → unreachable: no trigger (${reasoned.join(', ')}) satisfies its \`if\``,
                );
                continue;
            }

            for (const input of new Set([...(job.if ?? '').matchAll(/inputs\.([\w-]+)/g)].map((match) => match[1]))) {
                if (input === undefined || !(input in inputs)) {
                    continue;
                }

                const truthyDefault = inputs[input]?.default !== undefined && isTruthy(inputs[input]?.default);
                const switchedOn = callers.some((caller) => {
                    const passed = caller.with?.[input];

                    return passed === undefined ? truthyDefault : isTruthy(passed);
                });

                if (!truthyDefault && !switchedOn) {
                    violations.push(
                        `${file}::${name} → unreachable: gated on \`inputs.${input}\`, which no caller sets truthy`,
                    );
                }
            }

            if (isSkipTolerant(job.if)) {
                continue;
            }

            for (const need of needsOf(job)) {
                const dependency = jobs[need];

                if (dependency === undefined) {
                    continue;
                }

                const orphaned = live.filter((event) => !mayRun(dependency.if, event, !reusable));

                if (orphaned.length > 0) {
                    violations.push(
                        `${file}::${name} → runs on ${orphaned.join(', ')} but its dependency \`${need}\` cannot`,
                    );
                }
            }
        }
    }

    return [...violations].sort();
}

/** GitHub-expression truthiness of a literal `with:` value or input default. */
function isTruthy(value: unknown): boolean {
    return value !== false && value !== 'false' && value !== '' && value !== 0 && value !== null;
}

// ---------------------------------------------------------------------------------------------------------
// Invariant 2 — artifact pairing
// ---------------------------------------------------------------------------------------------------------

/** Artifact names a job uploads (`actions/upload-artifact` defaults the name to `artifact`). */
function uploadedNames(job: WorkflowJob): readonly string[] {
    return (job.steps ?? [])
        .filter((step) => /actions\/upload-artifact/.test(step.uses ?? ''))
        .map((step) => String(step.with?.['name'] ?? 'artifact'));
}

/** Downloads a job performs, as `{ name?, pattern? }` (neither means "every artifact in the run"). */
function downloads(
    job: WorkflowJob,
): readonly { readonly step: string; readonly name?: string; readonly pattern?: string }[] {
    return (job.steps ?? [])
        .filter((step) => /actions\/download-artifact/.test(step.uses ?? ''))
        .map((step) => ({
            step: stepLabel(step),
            ...(step.with?.['name'] === undefined ? {} : { name: String(step.with['name']) }),
            ...(step.with?.['pattern'] === undefined ? {} : { pattern: String(step.with['pattern']) }),
        }));
}

/** The transitive `needs` closure of a job — the only jobs guaranteed to have finished before it starts. */
function ancestors(name: string, jobs: Readonly<Record<string, WorkflowJob>>): readonly string[] {
    const seen = new Set<string>();
    const pending = [...needsOf(jobs[name] ?? {})];

    while (pending.length > 0) {
        const next = pending.pop() as string;

        if (seen.has(next)) {
            continue;
        }

        seen.add(next);
        pending.push(...needsOf(jobs[next] ?? {}));
    }

    return [...seen];
}

/** A `pattern:` glob, as a regex. */
function globToRegExp(pattern: string): RegExp {
    return new RegExp(
        `^${pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.')}$`,
    );
}

/**
 * Downloads with no upload that provably precedes them.
 *
 * An unmatched `download-artifact` does NOT fail — it yields an empty directory, so whatever consumes it
 * reads nothing and the job usually carries on green. Uploads inside a called reusable workflow count, since
 * a caller's `needs:` on the calling job does order them within the same run.
 */
function findUnreachableArtifacts(workflows: readonly Workflow[]): readonly string[] {
    const violations: string[] = [];
    const uploadsByFile = new Map(
        workflows.map(({ file, doc }) => [
            file,
            Object.fromEntries(Object.entries(doc.jobs ?? {}).map(([name, job]) => [name, uploadedNames(job)])),
        ]),
    );

    for (const { file, doc } of workflows) {
        const jobs = doc.jobs ?? {};

        for (const [name, job] of Object.entries(jobs)) {
            const closure = ancestors(name, jobs);
            const available = closure.flatMap((ancestor) => {
                const called = jobs[ancestor]?.uses ?? '';
                const calledFile = called.split('/').pop() ?? '';
                const nested = Object.values(uploadsByFile.get(calledFile) ?? {}).flat();

                return [...(uploadsByFile.get(file)?.[ancestor] ?? []), ...nested];
            });

            for (const download of downloads(job)) {
                const matches =
                    download.name !== undefined
                        ? available.includes(download.name)
                        : download.pattern !== undefined
                          ? available.some((uploaded) => globToRegExp(download.pattern as string).test(uploaded))
                          : available.length > 0;

                if (!matches) {
                    const wanted = download.name ?? download.pattern ?? '(all artifacts)';

                    violations.push(
                        `${file}::${name}::${download.step} → downloads \`${wanted}\` with no upload in its needs closure`,
                    );
                }
            }
        }
    }

    return [...violations].sort();
}

// ---------------------------------------------------------------------------------------------------------
// Invariant 3 — prune before build: MOVED to `postPruneToolchain.test.ts` (2026-09-03), where "what the
// prune removes" is derived from the manifests and the lockfile instead of an enumerated command regex.
// ---------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------
// Invariant 4 — the silent-success inventory
// ---------------------------------------------------------------------------------------------------------

/** `|| true`, `|| :` and `set +e` — the shell forms of "do not fail whatever happens". */
const SUPPRESSION = /\|\|\s*(?:true|:)(?![\w:])|set \+e\b/g;

/** Count suppressions in a `run:` body, ignoring whole-line shell comments. */
function suppressionCount(run: string): number {
    return run
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .reduce((total, line) => total + (line.match(SUPPRESSION) ?? []).length, 0);
}

/**
 * Every place a workflow is allowed to keep going after something failed, as
 * `<kind> <file>::<job>[::<step>] ×<count>`.
 *
 * Measured baseline on this branch: 6 `continue-on-error: true` (all step-level) and 9 suppression sites
 * across 9 steps. The count is part of the key so that a SECOND `|| true` added to a step that already has
 * one cannot hide behind the existing entry.
 */
function discoverSilentSuccess(workflows: readonly Workflow[]): readonly string[] {
    const found: string[] = [];

    for (const { file, doc } of workflows) {
        for (const [name, job] of Object.entries(doc.jobs ?? {})) {
            if (job['continue-on-error'] === true) {
                found.push(`continue-on-error ${file}::${name} ×1`);
            }

            for (const step of job.steps ?? []) {
                if (step['continue-on-error'] === true) {
                    found.push(`continue-on-error ${file}::${name}::${stepLabel(step)} ×1`);
                }

                const suppressions = suppressionCount(step.run ?? '');

                if (suppressions > 0) {
                    found.push(`suppressed-exit ${file}::${name}::${stepLabel(step)} ×${suppressions}`);
                }
            }
        }
    }

    return [...found].sort();
}

/**
 * The allowlist. Every entry needs a one-line reason; an unlisted one fails the build, and so does a listed
 * one that no longer exists (stale entries are how an inventory rots into fiction).
 */
const ALLOWED_SILENT_SUCCESS: readonly string[] = [
    // Clerk/AWS secrets are withheld from Dependabot and fork PRs by design; the soft failure lets the
    // dependent steps skip on `steps.secrets.outcome`, instead of reporting a red check nobody can fix.
    'continue-on-error _ci-heavy.yml::e2e-mobile-maestro::Load ${{ inputs.stage }} Clerk secrets ×1',
    'continue-on-error _ci.yml::build::Load sandbox (dev-instance) Clerk secrets for the web build ×1',
    'continue-on-error _ci.yml::e2e-web::Load sandbox (dev-instance) Clerk secrets for the preview web E2E ×1',
    // Same reason as its `e2e-web` sibling directly above: the secrets action is allowed to fail so a fork
    // PR (which has no access to them) reports a clean skip rather than a red job, and EVERY step below it
    // is gated on `steps.secrets.outcome == 'success'` — so a failure here cannot produce a green run that
    // tested nothing; it produces a job that visibly did nothing.
    'continue-on-error _ci.yml::integration-web-playwright::Load sandbox (dev-instance) Clerk secrets for the stubbed-API web suite ×1',
    // Same fork-PR degradation, one job downstream: `e2e-web` is a 4-way shard matrix whose Playwright steps
    // skip when the Clerk secrets are withheld, so it uploads no blob. `download-artifact` FAILS on a pattern
    // that matches nothing, which would turn that designed skip into an unfixable red on exactly the PRs that
    // cannot supply secrets. Not silent: the merge step tests the directory and reports "no blob reports
    // found", and the job's final step still re-asserts `needs.e2e-web.result`, so a genuinely failing suite
    // is red regardless of what these two downloads did.
    // Three downloads, all tolerant for the same reason the single one was: on a fork PR the shards skip
    // entirely (no secrets), and this job must render "no blobs" rather than invent a red for a designed
    // skip. The blob merge below is separately guarded on the directory being non-empty.
    'continue-on-error _ci.yml::e2e-web-report::Download shard blob reports (deployed tier) ×1',
    'continue-on-error _ci.yml::e2e-web-report::Download shard blob reports (stubbed tier) ×1',
    'continue-on-error _ci.yml::e2e-web-report::Download shard visual + fidelity output (stubbed tier) ×1',
    // Teardown reclaims the run's fixture data and Clerk identities and runs `if: always()`. It must never
    // be the thing that fails a job: by the time it runs the flows have already reported their verdict, and
    // a subject the erasure flow REALLY DELETED is a normal outcome here rather than an error. Not silent —
    // every failure is printed with the identity it could not reclaim, and what it misses is collected by
    // the next run's age-gated sweep, which is the mechanism that makes leaks self-healing rather than the
    // exit status of this step.
    "continue-on-error _ci-heavy.yml::e2e-mobile-maestro::Reclaim the run's world and identities (e2e-seed teardown) ×1",
    // Source maps are an observability nicety: a Sentry upload outage must not block a production deploy.
    'continue-on-error prod-deploy.yml::deploy::Upload webhooks Lambda source maps to Sentry ×1',
    // Best-effort disk reclamation before the Android system image — the paths may not exist on every runner
    // image, and their absence is not a failure.
    'suppressed-exit _ci-heavy.yml::e2e-mobile-maestro::Free disk space for the emulator system image ×1',
    // Failure-path diagnostics: `docker logs | grep` exits non-zero when it matches nothing, and a
    // no-diagnostics run must not mask the real failure that triggered it.
    // Same failure-path diagnostic, for the identity boot check (ADR-0028). The log is dumped so a boot
    // failure is readable in the job that found it; if the BUILD step failed the file was never created,
    // and a missing diagnostic must not add a second red X on top of the real one.
    // One cache entry failing to DELETE must not abort the sweep: entries legitimately vanish between the
    // list and the delete (a concurrent run, or GitHub's own LRU eviction — the very pressure this job
    // relieves), and aborting there would leave the prune half-done with the largest entries untouched. The
    // failure is reported as an `::error::`-free `::warning::` per entry and the loop continues; the LISTING
    // above deliberately carries no suppression, so an API outage is still loud.
    'suppressed-exit cache-prune.yml::prune::Delete cache entries for hashes nothing references ×1',
    // Health probes: curl exits non-zero on connection failure, and the retry loop needs the code (`000`) in
    // hand rather than an aborted step. Each of these four ends in `::error::` + `exit 1` — invariant 5
    // proves the assertion is still there.
    'suppressed-exit prod-deploy.yml::deploy::Smoke test — food service live & reachable (prod) ×1',
    'suppressed-exit prod-deploy.yml::deploy::Smoke test — identity service live & reachable (prod) ×1',
    'suppressed-exit sandbox-deploy.yml::deploy-food::Smoke test — food service live & reachable (sandbox) ×1',
    'suppressed-exit sandbox-identity-deploy.yml::deploy::Smoke test — identity service live & reachable (sandbox) ×1',
    // The sandbox router is a separately-deployed singleton; its absence is a missing prerequisite, so the
    // step reports `::error::` and sets `found=false` for downstream steps rather than failing the PR.
    'suppressed-exit sandbox-web-preview.yml::route::Resolve the router KVS ARN (from the router stack output) ×1',
];

// ---------------------------------------------------------------------------------------------------------
// Invariant 5 — assertions that cannot fail
// ---------------------------------------------------------------------------------------------------------

/** A step name that claims to prove something. `\bcheck\b` deliberately excludes "Checkout". */
const VERIFICATION_NAME = /\b(?:smoke|verif(?:y|ies|ication|ied)|assert|validates?|checks?)\b/i;

/** An explicit failure path: a comparison, a non-zero exit, or a workflow-command error annotation. */
const EXPLICIT_FAILURE = /exit\s+[1-9]|::error|\[\[|\[\s+[-"'$]|\btest\s+[-"'$]|\bcase\b|-eq\b|-ne\b|!=|==/;

/**
 * Steps whose NAME claims verification but which cannot fail the job.
 *
 * GitHub runs `run:` bodies under `bash -e`, so an ordinary command's non-zero exit already fails the step —
 * that is why `actionlint` needs no `exit 1` of its own. The defect is a step that has DISABLED that (via
 * `continue-on-error`, `|| true`, `|| :`, `set +e`) and then never checks the result it captured instead.
 */
function findUnfailableVerifications(workflows: readonly Workflow[]): readonly string[] {
    const violations: string[] = [];

    for (const { file, doc } of workflows) {
        for (const [name, job] of Object.entries(doc.jobs ?? {})) {
            for (const step of job.steps ?? []) {
                const label = stepLabel(step);

                if (step.run === undefined || !VERIFICATION_NAME.test(step.name ?? '')) {
                    continue;
                }

                if (step['continue-on-error'] === true || job['continue-on-error'] === true) {
                    violations.push(`${file}::${name}::${label} → cannot fail: continue-on-error`);
                    continue;
                }

                if (suppressionCount(step.run) > 0 && !EXPLICIT_FAILURE.test(step.run)) {
                    violations.push(
                        `${file}::${name}::${label} → cannot fail: suppresses its exit status and never checks it`,
                    );
                }
            }
        }
    }

    return [...violations].sort();
}

// ---------------------------------------------------------------------------------------------------------
// Invariant 1 — job reachability
// ---------------------------------------------------------------------------------------------------------

describe('invariant 1 — every job is reachable through its whole needs closure', () => {
    it('flags a job gated on an event the workflow does not trigger on', () => {
        const violations = findUnreachableJobs(
            fixture({
                'dead.yml': [
                    'name: dead',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    prepare:',
                    "        if: github.event_name == 'workflow_dispatch'",
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - run: echo prepare',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations.join('\n')).toMatch(/dead\.yml::prepare/);
        expect(violations.join('\n')).toMatch(/no trigger/i);
    });

    it('flags a dependent that can run on an event its dependency cannot', () => {
        const violations = findUnreachableJobs(
            fixture({
                'edge.yml': [
                    'name: edge',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    '    schedule:',
                    "        - cron: '0 0 * * *'",
                    'jobs:',
                    '    prepare:',
                    "        if: github.event_name == 'schedule'",
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - run: echo prepare',
                    '    deploy:',
                    '        needs: [prepare]',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - run: echo deploy',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations.join('\n')).toMatch(/edge\.yml::deploy/);
        expect(violations.join('\n')).toMatch(/push/);
    });

    it('does NOT flag a dependent whose if is skip-tolerant', () => {
        const violations = findUnreachableJobs(
            fixture({
                'tolerant.yml': [
                    'name: tolerant',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    '    schedule:',
                    "        - cron: '0 0 * * *'",
                    'jobs:',
                    '    prepare:',
                    "        if: github.event_name == 'schedule'",
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - run: echo prepare',
                    '    deploy:',
                    '        needs: [prepare]',
                    '        if: ${{ !cancelled() }}',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - run: echo deploy',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations).toEqual([]);
    });

    it('flags a needs entry that names no job in the workflow', () => {
        const violations = findUnreachableJobs(
            fixture({
                'missing.yml': [
                    'name: missing',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    deploy:',
                    '        needs: [nonexistent]',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - run: echo deploy',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations.join('\n')).toMatch(/nonexistent/);
    });

    it('flags a reusable-workflow job no caller can switch on', () => {
        const violations = findUnreachableJobs(
            fixture({
                '_reusable.yml': [
                    'name: reusable',
                    'on:',
                    '    workflow_call:',
                    '        inputs:',
                    '            run_heavy:',
                    '                required: false',
                    '                type: boolean',
                    '                default: false',
                    'jobs:',
                    '    heavy:',
                    '        if: ${{ inputs.run_heavy }}',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - run: echo heavy',
                    '',
                ].join('\n'),
                'caller.yml': [
                    'name: caller',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    call:',
                    '        uses: ./.github/workflows/_reusable.yml',
                    '        with:',
                    '            run_heavy: false',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations.join('\n')).toMatch(/_reusable\.yml::heavy/);
        expect(violations.join('\n')).toMatch(/run_heavy/);
    });

    it('reads an event comparison written the other way round', () => {
        const violations = findUnreachableJobs(
            fixture({
                'reversed.yml': [
                    'name: reversed',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    nightly:',
                    "        if: ${{ 'schedule' == github.event_name }}",
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - run: echo nightly',
                    '',
                ].join('\n'),
            }),
        );

        // Without the normalisation the atom is opaque, the job looks reachable, and the finding is lost.
        expect(violations.join('\n')).toMatch(/reversed\.yml::nightly/);
    });

    it('flags a reusable workflow nothing calls', () => {
        const violations = findUnreachableJobs(
            fixture({
                '_orphaned.yml': [
                    'name: orphaned',
                    'on:',
                    '    workflow_call:',
                    'jobs:',
                    '    work:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - run: echo work',
                    '',
                ].join('\n'),
            }),
        );

        // `workflow_call` is its ONLY trigger, so with no caller nothing can ever start it.
        expect(violations.join('\n')).toMatch(/_orphaned\.yml → unreachable/);
    });

    it('does NOT flag a reusable-workflow job whose input defaults on', () => {
        const violations = findUnreachableJobs(
            fixture({
                '_reusable.yml': [
                    'name: reusable',
                    'on:',
                    '    workflow_call:',
                    '        inputs:',
                    '            run_heavy:',
                    '                required: false',
                    '                type: boolean',
                    '                default: true',
                    'jobs:',
                    '    heavy:',
                    '        if: ${{ inputs.run_heavy }}',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - run: echo heavy',
                    '',
                ].join('\n'),
                'caller.yml': [
                    'name: caller',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    call:',
                    '        uses: ./.github/workflows/_reusable.yml',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations).toEqual([]);
    });

    it('holds for every workflow in .github/workflows/', () => {
        expect(
            findUnreachableJobs(realWorkflows()),
            'a job no trigger reaches never runs and never reports — it renders as permanently skipped',
        ).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------
// Invariant 2 — artifact pairing
// ---------------------------------------------------------------------------------------------------------

describe('invariant 2 — every artifact download has an upload before it', () => {
    it('flags a download whose name is never uploaded', () => {
        const violations = findUnreachableArtifacts(
            fixture({
                'orphan.yml': [
                    'name: orphan',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    consume:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - uses: actions/download-artifact@v5',
                    '              with:',
                    '                  name: never-uploaded',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations.join('\n')).toMatch(/never-uploaded/);
    });

    it('flags a download whose upload is in a job outside its needs closure', () => {
        const violations = findUnreachableArtifacts(
            fixture({
                'unordered.yml': [
                    'name: unordered',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    produce:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - uses: actions/upload-artifact@v5',
                    '              with:',
                    '                  name: report',
                    '                  path: report/',
                    '    consume:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - uses: actions/download-artifact@v5',
                    '              with:',
                    '                  name: report',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations.join('\n')).toMatch(/unordered\.yml::consume/);
        expect(violations.join('\n')).toMatch(/report/);
    });

    it('does NOT flag a download whose upload runs in a needed job', () => {
        const violations = findUnreachableArtifacts(
            fixture({
                'ordered.yml': [
                    'name: ordered',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    produce:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - uses: actions/upload-artifact@v5',
                    '              with:',
                    '                  name: report',
                    '                  path: report/',
                    '    consume:',
                    '        needs: [produce]',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - uses: actions/download-artifact@v5',
                    '              with:',
                    '                  name: report',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations).toEqual([]);
    });

    it('holds for every workflow in .github/workflows/', () => {
        expect(
            findUnreachableArtifacts(realWorkflows()),
            'an unmatched download-artifact yields an EMPTY directory, not an error',
        ).toEqual([]);
    });

    it('is NOT vacuous: the tree both uploads AND downloads artifacts, so the check above has teeth', () => {
        // This test used to assert `downloaded === []` and explicitly said "the moment a download appears the
        // assertion above stops being vacuous — this pins the day that happens". That day is the `e2e-web`
        // shard split: the 4-way Playwright matrix writes one BLOB report per shard and `e2e-web-report`
        // downloads all four to `merge-reports` them into the single HTML report a human reads.
        //
        // So the invariant above is now load-bearing rather than trivially true, and this test flips to
        // guarding that fact: if the download side ever disappears, the reachability assertion silently goes
        // back to proving nothing, and the next person to add a download inherits an untested guard.
        const uploads = realWorkflows().flatMap(({ doc }) => Object.values(doc.jobs ?? {}).flatMap(uploadedNames));
        const downloaded = realWorkflows().flatMap(({ doc }) => Object.values(doc.jobs ?? {}).flatMap(downloads));

        expect(uploads.length).toBeGreaterThan(0);
        expect(downloaded.length).toBeGreaterThan(0);

        // REWRITTEN (was: "every download is a PATTERN"). That held only while every download in the tree
        // consumed a SHARDED artifact, and it stopped being true when `e2e-web` began serving a production
        // build: the `build` job publishes ONE `.next` artifact and each of the eight shards downloads that
        // same one BY NAME, which is correct — a `*` pattern there would be the mistake.
        //
        // So the rule is stated against the thing that actually makes an exact name wrong: a SHARDED upload
        // names itself with `${{ matrix.… }}`, and there is no literal a `name:` can hold that collects all of
        // them. Reaching for one silently yields shard 1 alone — a merged report that looks complete and is
        // missing seven eighths of the run. Checking the literal PREFIX (rather than equality) catches the
        // hand-written `…-1` variant too, which equality would wave through.
        const shardedPrefixes = uploads
            .map((name) => name.indexOf('${{ matrix.'))
            .map((index, position) => (index === -1 ? null : (uploads[position] as string).slice(0, index)))
            .filter((prefix): prefix is string => prefix !== null);

        for (const download of downloaded) {
            const named = download.name;

            if (named === undefined) {
                continue;
            }

            expect(
                shardedPrefixes.filter((prefix) => named.startsWith(prefix)),
                `${download.step} names \`${named}\`, which is one leg of a sharded artifact — use a pattern`,
            ).toEqual([]);
        }

        // …and the pattern-shaped consumers still exist, so the paragraph above is not guarding an empty set.
        expect(downloaded.some((download) => (download.pattern ?? '').includes('*'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------------------------------------
// Invariant 4 — the silent-success inventory
// ---------------------------------------------------------------------------------------------------------

describe('invariant 4 — every silent-success escape hatch is inventoried', () => {
    it('discovers a continue-on-error step and a || true line', () => {
        const found = discoverSilentSuccess(
            fixture({
                'quiet.yml': [
                    'name: quiet',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    deploy:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - name: Load secrets',
                    '              continue-on-error: true',
                    '              run: echo load',
                    '            - name: Dump logs',
                    '              run: docker logs thing || true',
                    '',
                ].join('\n'),
            }),
        );

        expect(found).toEqual([
            'continue-on-error quiet.yml::deploy::Load secrets ×1',
            'suppressed-exit quiet.yml::deploy::Dump logs ×1',
        ]);
    });

    it('counts a second suppression in the same step rather than folding it into the first', () => {
        const found = discoverSilentSuccess(
            fixture({
                'twice.yml': [
                    'name: twice',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    deploy:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - name: Dump logs',
                    '              run: |',
                    '                  docker logs one || true',
                    '                  docker logs two || :',
                    '',
                ].join('\n'),
            }),
        );

        expect(found).toEqual(['suppressed-exit twice.yml::deploy::Dump logs ×2']);
    });

    it('inventories a JOB-level continue-on-error, not just step-level ones', () => {
        const found = discoverSilentSuccess(
            fixture({
                'whole-job.yml': [
                    'name: whole job',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    optional:',
                    '        runs-on: ubuntu-latest',
                    '        continue-on-error: true',
                    '        steps:',
                    '            - run: npm test',
                    '',
                ].join('\n'),
            }),
        );

        // Job-level is the broadest form of "cannot fail" — the whole job's result stops mattering.
        expect(found).toEqual(['continue-on-error whole-job.yml::optional ×1']);
    });

    it('ignores a mention inside a shell comment', () => {
        const found = discoverSilentSuccess(
            fixture({
                'prose.yml': [
                    'name: prose',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    deploy:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - name: Explain',
                    '              run: |',
                    '                  # Do NOT add `|| true` here — see the ADR.',
                    '                  echo fine',
                    '',
                ].join('\n'),
            }),
        );

        expect(found).toEqual([]);
    });

    it('matches the checked-in allowlist exactly', () => {
        expect(
            discoverSilentSuccess(realWorkflows()),
            'a NEW continue-on-error / `|| true` must be justified in ALLOWED_SILENT_SUCCESS with a one-line ' +
                'reason. This repo has already lost four weeks of production to a step that reported success ' +
                'without doing its job.',
        ).toEqual([...ALLOWED_SILENT_SUCCESS].sort());
    });
});

// ---------------------------------------------------------------------------------------------------------
// Invariant 5 — assertions that cannot fail
// ---------------------------------------------------------------------------------------------------------

describe('invariant 5 — a step that claims to verify something can fail', () => {
    it('flags a smoke test that swallows its probe and never compares it', () => {
        const violations = findUnfailableVerifications(
            fixture({
                'toothless.yml': [
                    'name: toothless',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    deploy:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - name: Smoke test — the service is live',
                    '              run: |',
                    '                  code=$(curl -s -o /dev/null -w \'%{http_code}\' "$URL" || true)',
                    '                  echo "got $code"',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations.join('\n')).toMatch(/toothless\.yml::deploy/);
        expect(violations.join('\n')).toMatch(/Smoke test/);
    });

    it('flags a verification carrying continue-on-error', () => {
        const violations = findUnfailableVerifications(
            fixture({
                'excused.yml': [
                    'name: excused',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    deploy:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - name: Verify runtime dependencies',
                    '              continue-on-error: true',
                    '              run: node -e "require(\'aws-cdk-lib\')" || exit 1',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations.join('\n')).toMatch(/continue-on-error/);
    });

    it('flags a verification inside a job that is itself continue-on-error', () => {
        const violations = findUnfailableVerifications(
            fixture({
                'excused-job.yml': [
                    'name: excused job',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    deploy:',
                    '        runs-on: ubuntu-latest',
                    '        continue-on-error: true',
                    '        steps:',
                    '            - name: Smoke test — the service is live',
                    '              run: exit 1',
                    '',
                ].join('\n'),
            }),
        );

        // A perfectly-written assertion still proves nothing when the JOB is allowed to fail.
        expect(violations.join('\n')).toMatch(/continue-on-error/);
    });

    it('does NOT flag a suppressed probe that is compared and exits non-zero', () => {
        const violations = findUnfailableVerifications(
            fixture({
                'toothy.yml': [
                    'name: toothy',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    deploy:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - name: Smoke test — the service is live',
                    '              run: |',
                    '                  code=$(curl -s -o /dev/null -w \'%{http_code}\' "$URL" || true)',
                    '                  if [ "$code" != "200" ]; then echo "::error::down"; exit 1; fi',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations).toEqual([]);
    });

    it('does NOT flag a check whose tool exit status IS the assertion', () => {
        const violations = findUnfailableVerifications(
            fixture({
                'linter.yml': [
                    'name: linter',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    lint:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - name: Lint GitHub workflow files (expression + context checks)',
                    '              run: |',
                    '                  set -euo pipefail',
                    '                  /tmp/actionlint -shellcheck= .github/workflows/*.yml',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations).toEqual([]);
    });

    it('holds for every workflow in .github/workflows/', () => {
        expect(
            findUnfailableVerifications(realWorkflows()),
            'a step named smoke/verify/check that cannot fail is worse than no step: it reports proof it did ' +
                'not obtain',
        ).toEqual([]);
    });
});

describe('invariant 6 — every `pg_isready` healthcheck names the role it probes with', () => {
    /**
     * ⛔ A HEALTHCHECK THAT PASSES WHILE LOGGING `FATAL` IS WORSE THAN ONE THAT FAILS.
     *
     * A service container's healthcheck runs as **root** inside the container, and `pg_isready` with no
     * `-U` falls back to the OS user — so it connects as `root`, a role the official image never creates.
     * Postgres answers `FATAL: role "root" does not exist` on every probe, once per `--health-interval`,
     * for the life of the job.
     *
     * ⚠️ THE CHECK STILL PASSES, which is exactly the problem. Measured against `postgres:18` on
     * 2026-09-04: `docker exec -u root pg_isready` prints `accepting connections` and exits **0**, because
     * `pg_isready` reports whether the SERVER responded, not whether the connection would succeed. So the
     * gate is green and the log is full of authentication failures.
     *
     * The cost is not cosmetic: on 2026-09-04 a `Heavy tiers` Maestro failure was being diagnosed, and this
     * `FATAL` — real, alarming, and completely unrelated — was reasonably read as the cause. A log line that
     * cries wolf every ten seconds spends someone's attention every time a real failure needs it.
     *
     * The fix is `-U postgres`, matching the `POSTGRES_USER` each of these services already sets.
     */
    // ⚠️ The optional quote is load-bearing: the fixed form is `--health-cmd "pg_isready -U postgres"`,
    // and a pattern anchored to a bare `pg_isready` matches NEITHER form once quoted — it would find
    // nothing and pass. The non-vacuity case below is what caught exactly that while this was written.
    const PG_ISREADY = /--health-cmd\s+"?(?<cmd>pg_isready[^"\n]*)/g;

    it('names a user in every pg_isready healthcheck across the workflow tree', () => {
        const offenders: string[] = [];

        for (const file of readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith('.yml'))) {
            const source = readFileSync(join(WORKFLOW_DIR, file), 'utf8');

            for (const match of source.matchAll(PG_ISREADY)) {
                const command = match.groups?.['cmd'] ?? '';

                if (!/\s-U\s+\S+/.test(command)) {
                    offenders.push(`${file}: ${command.trim()}`);
                }
            }
        }

        expect(
            offenders,
            'pg_isready with no -U connects as the container’s root user and logs FATAL on every probe ' +
                'while still reporting success',
        ).toEqual([]);
    });

    it('is not vacuous — it finds the healthchecks it is asserting about', () => {
        // ⛔ Without this, deleting every healthcheck (or breaking the pattern) would make the gate above
        // pass by finding nothing, which is the failure a derived-set guard is most exposed to.
        const found = readdirSync(WORKFLOW_DIR)
            .filter((name) => name.endsWith('.yml'))
            .flatMap((file) => [...readFileSync(join(WORKFLOW_DIR, file), 'utf8').matchAll(PG_ISREADY)]);

        // ⚠️ 14 → 8 on 2026-09-05. The owner ruled that e2e targets a DEPLOYED sandbox, so the local-boot
        // Postgres/LocalStack service containers those jobs stood up were deleted — and their healthchecks
        // with them (14 → 9 measured). The floor tracks what the tree HAS; it exists to catch a discovery
        // that silently stops matching, not to assert a fleet size. Set below the current count so a
        // legitimate future deletion does not red, but high enough that a broken parser still does.
        // ⚠️ 8 → 4 on 2026-09-05: the three isolated-substrate k6 jobs were deleted with the e2e
        // ruling, taking two more Postgres containers with them. The floor tracks what the tree
        // HAS — it exists to catch a parser that stops matching, not to assert a fleet size.
        expect(found.length).toBeGreaterThanOrEqual(4);
    });
});

// ---------------------------------------------------------------------------------------------------------
// Invariant 7 — a job whose NAME says "E2E" targets a DEPLOYED environment
// ---------------------------------------------------------------------------------------------------------

/**
 * A displayed job name that claims the end-to-end tier.
 *
 * ⚠️ The job KEY is deliberately NOT consulted when an explicit `name:` exists. A reader — and branch
 * protection — see the `name:`; the key is an internal identifier this repo cannot freely rename (it is
 * `GITHUB_JOB`, which `deriveRunKey` folds into the Clerk fixture identity, so `e2e-web` → `contract-web`
 * would silently re-key every run-scoped test user). The fallback to the key covers the only case where the
 * key IS what a reader sees: a job with no `name:` at all.
 */
const E2E_CLAIM = /\be2e\b|\bend[\s-]?to[\s-]?end\b/i;

/** A host that lives on the runner, not in a deployed environment. `10.0.2.2` is the Android emulator alias. */
const RUNNER_HOST = /\blocalhost\b|\b127\.0\.0\.1\b|\b0\.0\.0\.0\b|\bhost\.docker\.internal\b|\b10\.0\.2\.2\b/;

/** A configuration key whose VALUE is expected to name the origin under test. */
const TARGET_KEY = /url|origin|host|endpoint|domain|base/i;

/** An expression resolving to configuration supplied from OUTSIDE the workflow file. */
const EXTERNAL_EXPRESSION = /\$\{\{\s*(?:vars|secrets|inputs|env)\./;

/** An absolute origin that is not on the runner. */
const REMOTE_ORIGIN = /https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[a-z0-9$.{[-]/i;

/** Every `key: value` pair a job states as configuration — job `env`, and each step's `env` and `with`. */
function configPairs(job: WorkflowJob): readonly (readonly [string, string])[] {
    const maps: Readonly<Record<string, unknown>>[] = [job.env ?? {}];

    for (const step of job.steps ?? []) {
        maps.push(step.env ?? {}, step.with ?? {});
    }

    return maps.flatMap((map) => Object.entries(map).map(([key, value]) => [key, String(value)] as const));
}

/** Every `run:` body in a job, concatenated. */
function runBodies(job: WorkflowJob): string {
    return (job.steps ?? [])
        .map((step) => step.run ?? '')
        .filter((body) => body !== '')
        .join('\n');
}

/**
 * Jobs whose displayed name claims the end-to-end tier while the target under test lives on the runner.
 *
 * Three independent findings, all derived from the YAML rather than from a list of job names:
 *
 *   - `service-containers` — the job provisions the target's backing stores itself. A test of a DEPLOYED
 *     system needs none; it consumes the ones that stage already runs.
 *   - `runner-target` — a configuration value, or a `run:` body, names `localhost`/`127.0.0.1`/the emulator
 *     alias. Whatever else the job does, that address is on this runner.
 *   - `no-deployed-target` — the BACKSTOP, and the one that catches a job whose boot is invisible in YAML
 *     because it happens inside the suite (an in-process Nest app, a Playwright `webServer`). A job that
 *     names no remote origin anywhere — no literal `https://…`, no `URL`/`ORIGIN`/`HOST`-shaped key fed from
 *     `vars`/`secrets`/`inputs` — is not pointed at a deployed environment, because it is not pointed at
 *     anything outside itself.
 *
 * The first two are evidence of a local target; the third is the absence of a remote one. Reported together
 * so a finding says WHICH property failed rather than only that one did.
 */
function findLocallyTargetedE2eJobs(workflows: readonly Workflow[]): readonly string[] {
    const found: string[] = [];

    for (const { file, doc } of workflows) {
        for (const [key, job] of Object.entries(doc.jobs ?? {})) {
            const displayed = job.name ?? key;

            if (!E2E_CLAIM.test(displayed)) {
                continue;
            }

            const findings: string[] = [];
            const services = Object.keys(job.services ?? {}).sort();

            if (services.length > 0) {
                findings.push(`service-containers (${services.join(', ')})`);
            }

            const pairs = configPairs(job);
            const runners = pairs.filter(([, value]) => RUNNER_HOST.test(value)).map(([name]) => name);

            if (runners.length > 0 || RUNNER_HOST.test(runBodies(job))) {
                findings.push(`runner-target (${[...new Set(runners)].sort().join(', ') || 'in a run: body'})`);
            }

            const namesRemote =
                pairs.some(([name, value]) => TARGET_KEY.test(name) && EXTERNAL_EXPRESSION.test(value)) ||
                pairs.some(([, value]) => REMOTE_ORIGIN.test(value)) ||
                REMOTE_ORIGIN.test(runBodies(job));

            if (!namesRemote) {
                findings.push('no-deployed-target');
            }

            if (findings.length > 0) {
                found.push(`${file}::${key} → ${findings.join('; ')}`);
            }
        }
    }

    return found.sort();
}

/**
 * ⛔ THE ONE JOB OUTSIDE `_ci.yml` THAT STILL CLAIMS THE TIER IT DOES NOT OCCUPY.
 *
 * `_ci-heavy.yml`'s Maestro job boots the real recipe-service in Docker against a Postgres service container
 * on the runner and drives an Android emulator at `10.0.2.2` — hermetic by construction, and its own comment
 * says so ("SELF-CONTAINED"). It is listed rather than renamed here ONLY because `_ci-heavy.yml` is owned by
 * a concurrent change; the rename belongs with that file.
 *
 * ⚠️ This is a set EQUALITY, not a ratchet, and both directions are the point: a NEW mis-named job fails the
 * build, and so does a stale entry once the Maestro job is renamed. Delete the entry in the same change that
 * renames the job — an inventory that only ever grows is the rot this repo has already paid for once
 * (ADR-0004's consumer list).
 */
const PENDING_E2E_RENAMES: readonly string[] = [
    // ⛔ EMPTY, AND THAT IS THE POINT. This held `_ci-heavy.yml::e2e-mobile-maestro` for exactly as long as
    // the rename was owned by a concurrent change; it was cleared in the same change that renamed the job,
    // as the entry's own instruction required. Asserted by set EQUALITY, so a stale entry fails just as
    // loudly as a new offender — an allowlist that outlives its exception is how the next one gets in.
];

describe('invariant 7 — a job whose name says "E2E" targets a deployed environment', () => {
    /**
     * ## Why this invariant exists
     *
     * Owner ruling, 2026-09-04: _"None of the end to end tests should be testing against local services in
     * the pipeline. Also update the naming to be correct."_
     *
     * Every job in `_ci.yml` that called itself `E2E` stood its own target up on the runner — Postgres and
     * LocalStack service containers, a `next start` on `localhost:3000`, two Nest apps booted side by side.
     * The worst of them was named `E2E (recipe ↔ food LIVE — both services, one real Clerk token)` while
     * pointing at `LINKAGE_FOOD_URL=http://localhost:3002`. Nothing about it was live.
     *
     * ⛔ Those suites are NOT the defect and must not be deleted — they assert things a deployed tier
     * structurally cannot (LocalStack S3/SQS side effects, seeded fixtures, `page.route`-mocked UI branches,
     * the SSR-degradation path `ssrPrefetch.spec.ts` covers). The defect was the NAME: a reader, and an owner
     * reading a green checks list, learned "the deployed system works end to end" from a suite that had never
     * touched a deployed system. `docs/CODING_STANDARDS.md` §7.1 now separates the two tiers explicitly, and
     * this guard is what stops the naming drifting back after the next agent reads that standard.
     *
     * ## Mutation evidence (red before green)
     *
     * Written FIRST, against the pre-rename tree. It flagged all nine offenders — the eight in `_ci.yml`
     * plus `_ci-heavy.yml::e2e-mobile-maestro` — and the file's real-tree assertion below was RED until the
     * renames landed:
     *
     *     _ci.yml::e2e-backend → no-deployed-target
     *     _ci.yml::e2e-cross-service-linkage → service-containers (localstack, postgres);
     *         runner-target (FOOD_DATABASE_URL, LINKAGE_AZP, LINKAGE_FOOD_URL, LINKAGE_RECIPE_URL, PGHOST,
     *         RECIPE_DATABASE_URL)
     *     _ci.yml::e2e-food → service-containers (localstack, postgres); runner-target (DATABASE_URL);
     *         no-deployed-target
     *     _ci.yml::e2e-identity-boot → service-containers (postgres);
     *         runner-target (CLERK_AUTHORIZED_PARTIES, DATABASE_URL)
     *     _ci.yml::e2e-mobile → no-deployed-target
     *     _ci.yml::e2e-recipe → service-containers (localstack, postgres);
     *         runner-target (AWS_ENDPOINT_URL, CLOUDFRONT_URL, DATABASE_URL, S3_ENDPOINT); no-deployed-target
     *     _ci.yml::e2e-web → runner-target (NEXT_PUBLIC_IDENTITY_API_URL, NEXT_PUBLIC_RECIPE_API_URL);
     *         no-deployed-target
     *     _ci.yml::e2e-web-report → no-deployed-target
     *     _ci-heavy.yml::e2e-mobile-maestro → service-containers (postgres);
     *         runner-target (DATABASE_URL, EXPO_PUBLIC_IDENTITY_API_URL, EXPO_PUBLIC_RECIPE_API_URL)
     *
     * The two `no-deployed-target`-only findings are the ones a boot-command regex CANNOT reach: `e2e-backend`
     * boots the Nest app in-process inside vitest and `e2e-mobile` boots nothing at all, so neither states a
     * single address in YAML. That is exactly why the backstop is stated as the absence of a REMOTE target
     * rather than the presence of a local one.
     */
    it('flags a job that provisions the database it tests against', () => {
        const violations = findLocallyTargetedE2eJobs(
            fixture({
                'own-db.yml': [
                    'name: own db',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    suite:',
                    '        name: E2E (recipe — Postgres)',
                    '        runs-on: ubuntu-latest',
                    '        services:',
                    '            postgres:',
                    '                image: postgres:18',
                    '        steps:',
                    '            - name: Run the suite',
                    '              env:',
                    '                  RECIPE_ORIGIN: ${{ vars.SANDBOX_RECIPE_ORIGIN }}',
                    '              run: npm run test:e2e',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations.join('\n')).toMatch(/own-db\.yml::suite → service-containers \(postgres\)/);
    });

    it('flags a job whose target address is on the runner', () => {
        const violations = findLocallyTargetedE2eJobs(
            fixture({
                'localhost.yml': [
                    'name: localhost',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    suite:',
                    '        name: E2E (recipe ↔ food LIVE)',
                    '        runs-on: ubuntu-latest',
                    '        env:',
                    '            LINKAGE_FOOD_URL: http://localhost:3002',
                    '        steps:',
                    '            - name: Run the suite',
                    '              env:',
                    '                  RECIPE_ORIGIN: ${{ vars.SANDBOX_RECIPE_ORIGIN }}',
                    '              run: npm run test:e2e',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations.join('\n')).toMatch(/localhost\.yml::suite → runner-target \(LINKAGE_FOOD_URL\)/);
    });

    it('flags a job that names no deployed target at all — the in-process boot YAML cannot see', () => {
        const violations = findLocallyTargetedE2eJobs(
            fixture({
                'in-process.yml': [
                    'name: in process',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    suite:',
                    '        name: E2E (backend services)',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - name: Run the suite',
                    '              run: npm run test:e2e --workspace=@kitchensink/identity-service',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations).toEqual(['in-process.yml::suite → no-deployed-target']);
    });

    it('flags a job that has no name: and whose KEY claims the tier', () => {
        const violations = findLocallyTargetedE2eJobs(
            fixture({
                'unnamed.yml': [
                    'name: unnamed',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    e2e-recipe:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - run: npm run test:e2e',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations).toEqual(['unnamed.yml::e2e-recipe → no-deployed-target']);
    });

    it('does NOT flag a genuine deployed-ecosystem job', () => {
        const violations = findLocallyTargetedE2eJobs(
            fixture({
                'deployed.yml': [
                    'name: deployed',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    suite:',
                    '        name: E2E (deployed sandbox — recipe ↔ food)',
                    '        runs-on: ubuntu-latest',
                    '        env:',
                    '            RECIPE_ORIGIN: ${{ vars.SANDBOX_RECIPE_ORIGIN }}',
                    '        steps:',
                    '            - name: Run the suite',
                    '              run: npm run test:e2e --workspace=@kitchensink/deployed-e2e',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations).toEqual([]);
    });

    it('does NOT flag a hermetic job that no longer claims the tier', () => {
        // The whole point of the rename: the suite is unchanged, the name stopped lying, and the guard is
        // silent. A rule that still flagged this would be a rule to delete the tests instead of naming them.
        const violations = findLocallyTargetedE2eJobs(
            fixture({
                'renamed.yml': [
                    'name: renamed',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    hermetic-recipe:',
                    '        name: Hermetic (recipe — self-booted service + Postgres)',
                    '        runs-on: ubuntu-latest',
                    '        services:',
                    '            postgres:',
                    '                image: postgres:18',
                    '        steps:',
                    '            - run: npm run test:e2e --workspace=@kitchensink/recipe-service',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations).toEqual([]);
    });

    it('holds for every job in .github/workflows/', () => {
        expect(
            findLocallyTargetedE2eJobs(realWorkflows()),
            'a job named "E2E" that boots its own target teaches a reader — and an owner reading a green ' +
                'checks list — that the DEPLOYED system passed, from a suite that never reached it. Either ' +
                'point the job at a deployed environment, or name it for the hermetic contract tier it is ' +
                '(docs/CODING_STANDARDS.md §7.1)',
        ).toEqual(PENDING_E2E_RENAMES);
    });

    it('is not vacuous — the analyzer still recognises the shapes it is asserting about', () => {
        // ⛔ Once `_ci.yml` is clean the real-tree assertion above passes whether the analyzer works or not:
        // a regex that stops matching finds nothing and reports success. So re-run it over a tree that is
        // KNOWN to violate every finding, and require all three.
        const violations = findLocallyTargetedE2eJobs(
            fixture({
                'canary.yml': [
                    'name: canary',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    a:',
                    '        name: E2E (recipe — Postgres + LocalStack)',
                    '        runs-on: ubuntu-latest',
                    '        services:',
                    '            postgres:',
                    '                image: postgres:18',
                    '        steps:',
                    '            - env:',
                    '                  DATABASE_URL: postgres://postgres@localhost:5432/recipe_e2e',
                    '              run: npm run test:e2e',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations).toEqual([
            'canary.yml::a → service-containers (postgres); runner-target (DATABASE_URL); no-deployed-target',
        ]);
    });
});

describe('invariant 8 — a JOB name is a constant, because branch protection matches on it', () => {
    /**
     * ⛔ A REQUIRED CHECK IS MATCHED BY ITS RENDERED NAME. A job whose `name:` interpolates an expression
     * therefore publishes a DIFFERENT check name per run — `Deployed E2E (pr-91)` on one event and
     * `Deployed E2E (prod)` on another — and a branch-protection rule naming either one reads the other as
     * *missing* rather than as failing. Worse, an expression that cannot resolve renders literally: the
     * first deployed-e2e run published `Deployed E2E (${{ needs.resolve.outputs.stage }})`, verbatim, because
     * the job was skipped and `needs.resolve.outputs.stage` never evaluated.
     *
     * ⚠️ SCOPED TO JOB NAMES ONLY, and that is deliberate. Step names (`Load ${{ inputs.stage }} Clerk
     * secrets`) and artifact names (`maestro-report-${{ inputs.stage }}`) SHOULD interpolate — a step name is
     * never a required check, and an artifact name must differ per stage or the uploads collide. Widening
     * this to every `name:` would forbid the correct thing along with the broken one.
     *
     * ⛔ AND `matrix`/`strategy` ARE EXEMPT, WHICH IS THE WHOLE DISTINCTION. `Test (${{ matrix.group }})` is
     * not merely tolerable, it is REQUIRED: without it every leg of the matrix publishes the same check
     * name. It is safe for the same reason it is required — the value set is ENUMERATED IN THE WORKFLOW, so
     * the rendered names are a known, finite, stable set (`Test (infra)`, `Test (services)`, …) that a
     * branch-protection rule can name. `needs.*` and `inputs.*` are the opposite: their values come from a
     * previous job's runtime output or from whatever a human typed into a dispatch form, so the set is
     * neither known nor bounded. The first version of this guard flagged all four matrix jobs and had to be
     * narrowed — the red run is what taught the distinction, which is why it is written down here.
     *
     * The dynamic part belongs in the job SUMMARY or a step name, where it is read by a human rather than
     * matched by a rule.
     *
     * DESIGN PATTERN: Specification over a derived set — the workflow tree is discovered, never listed.
     */
    /**
     * Every `${{ … }}` in a string, as its trimmed body.
     *
     * ⚠️ AN EXTRACTION, NOT A NEGATIVE LOOKAHEAD. The first attempt was
     * `/\$\{\{\s*(?!matrix\.|strategy\.)/`, which passes every matrix job through as an offender:
     * `\s*` backtracks to consume ZERO characters, the lookahead then compares against `" matrix."` with
     * its leading space, does not match `matrix.`, and the NEGATIVE lookahead therefore succeeds. Reading
     * the body out and testing it directly cannot be fooled that way.
     */
    /**
     * Any `${{ … }}` at all.
     *
     * ⛔ NO CONTEXT IS EXEMPT, and the exemptions this guard used to carry were each disproven by the next
     * observation. It began asserting on `needs.*` alone, reasoning that `inputs.*` and `github.*` "always
     * resolve"; PR #91 then published `Deploy food sandbox (pr-${{ github.event.pull_request.number }})`
     * raw. It was widened but kept `matrix`/`strategy` exempt on OBSERVED evidence — `Test (services)` and
     * `Analyze (python)` rendered correctly on that same run. That evidence was real and the conclusion was
     * still wrong: those jobs RAN. The owner's 2026-09-05 ruling then made the Playwright shards skip by
     * default, and the checks list published:
     *
     *     E2E (web — Playwright against the deployed preview) ${{ matrix.shard }}/${{ strategy.job-total }}
     *
     * One clause covers every case, and it is about EVALUATION rather than context: **a job that does not
     * RUN never evaluates its name.** So the subject is not "which context" but "can this job skip", which
     * `jobNames()` decides by the presence of an `if:`.
     *
     * ⚠️ An extraction, not a negative lookahead. An earlier attempt used `/\$\{\{\s*(?!matrix\.)/`, which
     * flagged every matrix job: `\s*` backtracks to zero characters, the lookahead then compares against
     * `" matrix."` with its leading space, and the NEGATIVE therefore succeeds. This form cannot be fooled
     * that way, and is kept even though the exemption it was built for is gone.
     */
    const INTERPOLATION = /\$\{\{[\s\S]*?\}\}/;

    /**
     * Every `jobs.<key>.name` in the tree that belongs to a job which CAN SKIP, with its file.
     *
     * ⛔ ONLY SKIPPABLE JOBS, and the `if:` is what decides it. A job's name renders when it RUNS, so a job
     * that always runs renders correctly and may interpolate freely; every job that ever published a raw
     * `${{ … }}` — `deployed-e2e`, `deploy-food`, the Playwright shards — carries an `if:`, and every job a
     * blanket version wrongly flagged (`test`, `build`, `analyze`) carries none. Collapsing
     * `Test (infra|services|frontend)` into three identical check names would lose real information to
     * prevent a harm those jobs cannot suffer.
     *
     * ⚠️ Step names and artifact names are NOT in scope — a step name is never a required check, and an
     * artifact name must differ per stage or the uploads collide.
     */
    function jobNames(): readonly { readonly file: string; readonly key: string; readonly name: string }[] {
        return realWorkflows().flatMap(({ file, doc }) =>
            Object.entries(doc.jobs ?? {})
                .filter(([, job]) => typeof (job as { name?: unknown }).name === 'string')
                .filter(([, job]) => (job as { if?: unknown }).if !== undefined)
                .map(([key, job]) => ({ file, key, name: (job as { name: string }).name })),
        );
    }

    it('never interpolates an expression into a job name', () => {
        const offenders = jobNames()
            .filter((job) => INTERPOLATION.test(job.name))
            .map((job) => `${job.file}::${job.key} → ${job.name}`);

        expect(
            offenders,
            'a job name containing ${{ }} publishes a different required-check name per run, and renders ' +
                'the raw expression when it cannot resolve',
        ).toEqual([]);
    });

    it('is not vacuous — it reads real job names', () => {
        // ⛔ Without this, a discovery that stopped finding jobs would make the gate above pass by finding
        // nothing — the failure mode every derived-set guard in this file is most exposed to.
        // Skippable named jobs only — a smaller population than the 30+ named jobs in the tree.
        expect(jobNames().length).toBeGreaterThanOrEqual(5);
    });
});
