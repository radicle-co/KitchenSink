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
 *     Invariant 3 generalises the same one-way door to every workflow and every dev-dependency build tool,
 *     which is how it found the two real violations recorded in `KNOWN_BUILDS_AFTER_PRUNE` below. The
 *     prod-deploy-specific claims that file owns (exactly one prune; every pushed image has a build) are not
 *     restated here.
 *   - `globalBootstrapBundle.test.ts` — `bundle:lambda` before `cdk deploy`/prune for the global app. It
 *     anchors on `findIndex` (the FIRST bundle and FIRST prune), which is precisely why it does not see the
 *     LATER `bundle:lambda` calls that invariant 3 reports.
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
 *   3. **Prune ordering** — dropping the same-job restriction turns `other-job.yml` into a false positive;
 *      dropping the `index <= pruneIndex` comparison reds the correctly-ordered fixture; emptying
 *      `KNOWN_BUILDS_AFTER_PRUNE` reds the real-tree assertion, which is the proof those two entries are real
 *      findings and not decoration.
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
    readonly with?: Readonly<Record<string, unknown>>;
    readonly 'continue-on-error'?: boolean;
}

interface WorkflowJob {
    readonly needs?: string | readonly string[];
    readonly if?: string;
    readonly uses?: string;
    readonly with?: Readonly<Record<string, unknown>>;
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
// Invariant 3 — prune before build
// ---------------------------------------------------------------------------------------------------------

/** `npm prune --omit=dev` and its equivalents: the one-way door. */
const PRUNE = /npm prune|--omit=dev/;

/**
 * Commands that need a devDependency binary. `docker buildx build` is deliberately absent (it must run
 * AFTER the prune, so the image ships production deps only), and so is `npx cdk deploy` — `npx` falls back
 * to the registry when the local binary is gone, which is how the post-prune CDK steps work today. `npm run
 * …` does NOT have that fallback: it resolves from `node_modules/.bin` and exits 127.
 */
const BUILD_COMMANDS =
    /turbo run build|npm run [\w:@/-]*build\b|npm run bundle:lambda|nest build|(?:^|\s)tsc\s|node esbuild\.mjs|cdk synth|next build/g;

/** Build-like steps that follow a prune step IN THE SAME JOB (a different job gets a fresh checkout). */
function findBuildsAfterPrune(workflows: readonly Workflow[]): readonly string[] {
    const violations: string[] = [];

    for (const { file, doc } of workflows) {
        for (const [name, job] of Object.entries(doc.jobs ?? {})) {
            const steps = job.steps ?? [];
            const pruneIndex = steps.findIndex((step) => PRUNE.test(step.run ?? ''));

            if (pruneIndex === -1) {
                continue;
            }

            steps.forEach((step, index) => {
                if (index <= pruneIndex) {
                    return;
                }

                const matched = [...new Set((step.run ?? '').match(BUILD_COMMANDS) ?? [])].map((text) => text.trim());

                if (matched.length > 0) {
                    violations.push(`${file}::${name}::${stepLabel(step)} → ${matched.sort().join(', ')}`);
                }
            });
        }
    }

    return [...violations].sort();
}

/**
 * Currently-present build-after-prune orderings — a ratchet, not an excuse (same posture as
 * `scripts/boundaries-baseline.json`): the equality assertion below means a NEW one fails the build.
 *
 * ⚠️ CORRECTED 2026-08-07 — these two are an ordering SMELL, not a live defect, and the original
 * reasoning here was wrong. It claimed both legs "have never run" and "will exit 127 on the first one
 * that does". Both halves are false: prod-deploy run 30764536782 executed the prune at step 17 and then
 * these very steps at 32 and 38, and all three reported success. The premise behind the prediction —
 * "typescript and esbuild are devDependencies with no production dependent anywhere in the tree" — does
 * not hold either: `typescript` is declared in the ROOT `peerDependencies` (`^5`), and `esbuild` is a
 * production `dependencies` entry of `packages/tools/esbuild`, so neither binary is removed by
 * `npm prune --omit=dev`. `prod-deploy.yml` also runs an explicit "Verify runtime dependencies" step
 * immediately after the prune.
 *
 * They stay listed because the ORDERING is still worth pinning: it survives on a transitive
 * peer/production edge that nothing asserts, so a future dependency cleanup could remove the compiler
 * out from under these steps with no signal here. The identity leg does the same two builds BEFORE the
 * prune (steps 11/12), which is the shape to converge on. Treat fixing it as hygiene, not an incident —
 * and do not "fix" it on the strength of an exit-127 claim that production has already falsified.
 */
const KNOWN_BUILDS_AFTER_PRUNE: readonly string[] = [
    // `npm run infra:build` is `tsc -p infra/tsconfig.json`; `bundle:lambda` is `node esbuild.mjs`. Both
    // resolve after the prune today — see the corrected note above for why, and why that is fragile
    // rather than fine.
    'prod-deploy.yml::deploy::Build, tag, and push food service Docker image → npm run bundle:lambda, npm run infra:build',
    'prod-deploy.yml::deploy::Build, tag, and push recipe service Docker image → npm run bundle:lambda, npm run infra:build',
];

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
    'continue-on-error _ci.yml::e2e-backend::Load ${{ inputs.stage }} secrets ×1',
    'continue-on-error _ci.yml::e2e-mobile::Load ${{ inputs.stage }} secrets ×1',
    'continue-on-error _ci.yml::e2e-web::Load sandbox (dev-instance) Clerk secrets for localhost web E2E ×1',
    // Same fork-PR degradation, one job downstream: `e2e-web` is a 4-way shard matrix whose Playwright steps
    // skip when the Clerk secrets are withheld, so it uploads no blob. `download-artifact` FAILS on a pattern
    // that matches nothing, which would turn that designed skip into an unfixable red on exactly the PRs that
    // cannot supply secrets. Not silent: the merge step tests the directory and reports "no blob reports
    // found", and the job's final step still re-asserts `needs.e2e-web.result`, so a genuinely failing suite
    // is red regardless of what these two downloads did.
    'continue-on-error _ci.yml::e2e-web-report::Download shard blob reports ×1',
    'continue-on-error _ci.yml::e2e-web-report::Download shard visual + fidelity output ×1',
    // Source maps are an observability nicety: a Sentry upload outage must not block a production deploy.
    'continue-on-error prod-deploy.yml::deploy::Upload webhooks Lambda source maps to Sentry ×1',
    // Best-effort disk reclamation before the Android system image — the paths may not exist on every runner
    // image, and their absence is not a failure.
    'suppressed-exit _ci-heavy.yml::e2e-mobile-maestro::Free disk space for the emulator system image ×1',
    // Failure-path diagnostics: `docker logs | grep` exits non-zero when it matches nothing, and a
    // no-diagnostics run must not mask the real failure that triggered it.
    'suppressed-exit _ci-heavy.yml::e2e-mobile-maestro::Recipe-service error logs on failure ×1',
    'suppressed-exit _ci-heavy.yml::e2e-mobile-maestro::Recipe-service logs on failure ×1',
    'suppressed-exit _ci-heavy.yml::load-test::Recipe-service logs on failure ×1',
    'suppressed-exit _ci-heavy.yml::load-test-food::Food-service logs on failure ×1',
    // Same failure-path diagnostic, for the identity boot check (ADR-0028). The log is dumped so a boot
    // failure is readable in the job that found it; if the BUILD step failed the file was never created,
    // and a missing diagnostic must not add a second red X on top of the real one.
    'suppressed-exit _ci.yml::e2e-identity-boot::Identity boot log ×1',
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
// Invariant 3 — prune before build
// ---------------------------------------------------------------------------------------------------------

describe('invariant 3 — no build-like step runs after the dev-dependency prune', () => {
    it('flags a build placed after the prune in the same job', () => {
        const violations = findBuildsAfterPrune(
            fixture({
                'late-build.yml': [
                    'name: late build',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    deploy:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - name: Prune dev dependencies',
                    '              run: npm prune --omit=dev',
                    '            - name: Build the service infra',
                    '              run: npm run infra:build --workspace=packages/services/food-service',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations.join('\n')).toMatch(/late-build\.yml::deploy/);
        expect(violations.join('\n')).toMatch(/infra:build/);
    });

    it('does NOT flag a build that precedes the prune, nor the docker build that must follow it', () => {
        const violations = findBuildsAfterPrune(
            fixture({
                'ordered.yml': [
                    'name: ordered',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    deploy:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - name: Build the service infra',
                    '              run: npm run infra:build --workspace=packages/services/food-service',
                    '            - name: Prune dev dependencies',
                    '              run: npm prune --omit=dev',
                    '            - name: Push the image',
                    '              run: docker buildx build -t image .',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations).toEqual([]);
    });

    it('does NOT flag a build in a DIFFERENT job from the prune', () => {
        const violations = findBuildsAfterPrune(
            fixture({
                'other-job.yml': [
                    'name: other job',
                    'on:',
                    '    push:',
                    '        branches: [main]',
                    'jobs:',
                    '    deploy:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - run: npm prune --omit=dev',
                    '    build:',
                    '        runs-on: ubuntu-latest',
                    '        steps:',
                    '            - run: npx turbo run build',
                    '',
                ].join('\n'),
            }),
        );

        expect(violations).toEqual([]);
    });

    it('has no violations beyond the recorded, still-open ones', () => {
        expect(
            findBuildsAfterPrune(realWorkflows()),
            'a devDependency build after `npm prune --omit=dev` exits 127 ("command not found"), which reads ' +
                'like a broken toolchain rather than a step-ordering mistake. If you FIXED one of the recorded ' +
                'violations, delete its entry from KNOWN_BUILDS_AFTER_PRUNE.',
        ).toEqual([...KNOWN_BUILDS_AFTER_PRUNE].sort());
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
