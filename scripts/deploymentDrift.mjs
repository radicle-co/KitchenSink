#!/usr/bin/env node
/**
 * DEPLOYMENT DRIFT — is what is RUNNING the code this commit declares?
 *
 * ## The failure, stated exactly
 *
 * `docs/architecture/2026-08-28-ingredient-pipeline-state.md` §1 was a hand-maintained table headed "What
 * runs where, today" and it marked `verifyLine` plus thirteen other handlers ✅ deployed. Measured against
 * the live account: `kitchensink-recipe-workers-prod` held SIX Lambdas — AccountErasureWorker,
 * ArchiveSweeper, ErasureOrphanSweeper, ErasureSweeper, HandleSyncWorker, VersionArchiveWorker — and had
 * last been updated on 2026-08-02, with the branch 600+ commits ahead. Neither `verifyLine` nor `parseLine`
 * was deployed anywhere.
 *
 * ⛔ `infrastructureManifest.mjs` alone CANNOT catch that, and it is important to understand why: both
 * handlers ARE declared at HEAD, so a document generated from CDK makes exactly the claim the prose table
 * made. CDK describes INTENT. Only the account holds REALITY. This module is the half that reads reality —
 * everything it reports is a fact obtained from AWS, and nothing here may be inferred from the source.
 *
 * ## Why the Lambda comparison is on HANDLERS, not on logical ids
 *
 * Measured, not reasoned about. Synthesizing `new lambda.Function(stack, 'VersionArchiveWorkerFunction', …)`
 * emits the logical id `VersionArchiveWorkerFunction1E510C35` — CDK appends an 8-character hash derived from
 * the construct PATH. A construct that merely MOVES in the tree therefore changes its logical id while
 * running identical code, and a logical-id comparison would report one spurious "missing" plus one spurious
 * "unexpected" for a refactor that deployed perfectly. A check that cries wolf is a check that gets deleted.
 * A handler string is what the manifest declares, what `lambda:GetFunctionConfiguration` returns, and what
 * answers the question actually being asked.
 *
 * ## Why the sha is read from a STACK tag
 *
 * `@kitchensink/infra-security`'s `stampCommitProvenance` writes {@link COMMIT_TAG_KEY} as a CloudFormation
 * STACK tag, which leaves the synthesized template byte-identical (ADR-0002 / ADR-0008 no-prod-diff) and is
 * exactly the field `teardown-sandbox-pr.sh` already reads for `Environment`. One knowledge, two modules;
 * `deploymentDrift.test.ts` asserts the two spellings of the key agree.
 *
 * ## Usage
 *
 *     node scripts/deploymentDrift.mjs --region us-east-1 --stage prod \
 *         --app packages/infra/global/bin/app.ts --expected-sha "$GITHUB_SHA"
 *
 * `--expected-sha` defaults to `COMMIT_SHA` then `GITHUB_SHA`, so a workflow step needs neither.
 * `--warn-only` reports without failing, for a step that runs where no deploy happened (ADR-0010's
 * ensure-exists gate skips the deploy but still verifies).
 *
 * Exit status: 0 = no drift (or `--warn-only`), 1 = findings, 2 = misuse. A misuse NEVER exits 0 — a drift
 * check that answers "nothing wrong" on malformed input is how a stale deploy passes a green check.
 *
 * @sideEffect The CLI reads the committed manifest and calls the AWS CLI (read-only: `describe-stacks`,
 *   `list-stack-resources`, `get-function-configuration`).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MANIFEST_JSON, resolveStageNames } from './infrastructureManifest.mjs';

/**
 * The shapes this module passes between its pure half and its impure one.
 *
 * Written out rather than left as bare `object` for the same reason `infrastructureManifest.mjs` writes its
 * own: `packages/infra/global` typechecks this file through `allowJs`, and without them a guard asserting on
 * `stack.handlers.missing` compiles against `object` and would still compile if the field vanished.
 *
 * @typedef {object} CommitVerdict
 * @property {'current' | 'stale' | 'untagged' | 'unknown' | 'indeterminate'} verdict
 * @property {string} reason - Operator-facing, and it names both commits when they differ.
 * @property {string | null} deployed - The tag value, when there was one.
 *
 * @typedef {object} DeclaredHandler
 * @property {string} logicalId
 * @property {string | null} handler
 * @property {string | null} condition
 *
 * @typedef {object} HandlerDiff
 * @property {Array<{ logicalId: string, handler: string | null }>} missing - Declared, not running. THE
 *   finding.
 * @property {string[]} unexpected - Running, declared nowhere. Reported only; see {@link hasDriftFindings}.
 * @property {DeclaredHandler[]} conditional - Behind a guard this comparison cannot evaluate.
 * @property {string[]} unreadable - Logical ids whose handler the manifest could not read.
 *
 * @typedef {object} StageStack
 * @property {string} stackName - The declared name, resolved for the stage.
 * @property {string} className
 * @property {string | null} condition
 * @property {DeclaredHandler[]} handlers
 *
 * @typedef {object} StackResult
 * @property {string} stackName
 * @property {string | null} condition
 * @property {boolean} present - Whether the account holds it.
 * @property {CommitVerdict | null} commit - `null` exactly when absent.
 * @property {HandlerDiff | null} handlers - `null` exactly when absent.
 */

/**
 * The CloudFormation stack tag carrying the commit a deploy was built from.
 *
 * ⛔ Must equal `@kitchensink/infra-security`'s `COMMIT_TAG_KEY`. It is repeated rather than imported
 * because that package exports BUILT JavaScript (see its manifest's `//exports` note) and this script runs
 * under plain `node` from a checkout that may not have been built. `deploymentDrift.test.ts` asserts the two
 * are the same string, so the duplication cannot drift silently.
 */
export const COMMIT_TAG_KEY = 'CommitSha';

/** A commit sha, abbreviated or full — the same shape the stamp accepts. */
const COMMIT_SHA = /^[0-9a-f]{7,40}$/u;

/**
 * Compare the commit a stack was deployed from against the commit under consideration.
 *
 * The four non-current verdicts are deliberately distinct, because they call for different actions:
 *
 * | verdict         | means                                                    | action                        |
 * | --------------- | -------------------------------------------------------- | ----------------------------- |
 * | `stale`         | running a different commit                                | deploy, or explain why not    |
 * | `untagged`      | deployed before the provenance stamp existed              | clears itself on next deploy  |
 * | `unknown`       | deployed by something that could not name its own commit  | fix the pipeline              |
 * | `indeterminate` | we have no sha to compare AGAINST                         | fix the caller                |
 *
 * ⛔ `untagged` and `unknown` must not be collapsed. Every stack in the account is `untagged` until its
 * first post-stamp deploy; reporting that as a pipeline defect would make the report noise from day one,
 * and a noisy report is an ignored one.
 *
 * @param {string} expected - The commit under consideration.
 * @param {string | null | undefined} deployed - The stack's tag value.
 * @returns {CommitVerdict} The verdict. Pure.
 */
export function classifyCommitTag(expected, deployed) {
    const running = (deployed ?? '').trim();

    if (running === '') {
        return {
            verdict: 'untagged',
            reason:
                `carries no ${COMMIT_TAG_KEY} tag, so the commit it is running is unknowable. It was ` +
                'deployed before the provenance stamp existed; the next deploy records it.',
            deployed: null,
        };
    }

    if (!COMMIT_SHA.test(running)) {
        return {
            verdict: 'unknown',
            reason:
                `is tagged ${COMMIT_TAG_KEY}=${running}, which is not a commit — whatever deployed it could ` +
                'not name its own source.',
            deployed: running,
        };
    }

    if (!COMMIT_SHA.test((expected ?? '').trim())) {
        return {
            verdict: 'indeterminate',
            reason:
                `is tagged ${COMMIT_TAG_KEY}=${running}, but this run has no commit to compare it against ` +
                `(expected='${expected ?? ''}'). Pass --expected-sha, or set COMMIT_SHA/GITHUB_SHA.`,
            deployed: running,
        };
    }

    // An abbreviated sha on either side is the same commit. `startsWith` on the shorter is anchored at the
    // start, so `abcdefb…` and `abcdefc` do NOT match — asserted, because an unanchored comparison would
    // silently pass a genuinely different commit that shares a prefix.
    const [shorter, longer] = running.length <= expected.length ? [running, expected] : [expected, running];

    if (longer.startsWith(shorter)) {
        return { verdict: 'current', reason: `is running ${running}`, deployed: running };
    }

    return {
        verdict: 'stale',
        reason: `deployed at ${running}, expected ${expected}`,
        deployed: running,
    };
}

/**
 * Compare declared Lambda handlers against the handlers actually running.
 *
 * Four buckets, and only two of them are findings:
 *
 *  - `missing` — DECLARED and not running. The sentence this whole change exists to produce.
 *  - `unexpected` — running and declared nowhere. Code the source has dropped and the account has not.
 *  - `conditional` — declared behind a guard this comparison cannot evaluate (`stage === 'prod'`). Absent is
 *    the CORRECT answer on another stage, so reporting it as missing would be a false accusation.
 *  - `unreadable` — the manifest could not read the handler (a ternary, an imported constant). Absence of
 *    evidence, reported as such rather than as evidence of absence.
 *
 * @param {{ declared: readonly DeclaredHandler[], deployed: readonly string[] }} input - Both sides.
 * @returns {HandlerDiff} The comparison. Pure.
 */
export function diffHandlers({ declared, deployed }) {
    const running = new Set(deployed);
    const conditional = declared.filter((entry) => entry.condition !== null && entry.handler !== null);
    const unreadable = declared.filter((entry) => entry.handler === null).map((entry) => entry.logicalId);
    const asserted = declared.filter((entry) => entry.handler !== null && entry.condition === null);
    const declaredHandlers = new Set(declared.flatMap((entry) => (entry.handler === null ? [] : [entry.handler])));

    return {
        missing: asserted
            .filter((entry) => !running.has(entry.handler))
            .map((entry) => ({ logicalId: entry.logicalId, handler: entry.handler })),
        // A handler nobody declares is reported even when some declaration is unreadable: the unreadable
        // ones are named in their own bucket, so a reader can see the two facts side by side.
        unexpected: [...running].filter((handler) => !declaredHandlers.has(handler)).sort(),
        conditional,
        unreadable,
    };
}

/**
 * Normalise a CDK `--app` argument to the SOURCE entrypoint the manifest is keyed by.
 *
 * ⚠️ Two normalisations, both load-bearing, both taken from `cdkApps.ts` so the two sides name ONE app:
 * the runner is dropped (the entrypoint is the argument's last whitespace-separated token), and a COMPILED
 * path is mapped back to its source. `prod-deploy.yml` deploys `node
 * packages/infra/global/dist/bin/app.js` while the manifest is keyed by
 * `packages/infra/global/bin/app.ts`; without the second rule every prod drift check would throw "no entry
 * for", which is a loud failure but the wrong one.
 *
 * @param {string} appArgument - The `--app` string a deploy step passes.
 * @returns {string} The repo-relative source entrypoint. Pure.
 */
export function toSourceEntrypoint(appArgument) {
    const last = appArgument.trim().split(/\s+/u).at(-1) ?? '';

    return last.replace(/(^|\/)dist\/bin\/app\.js$/u, '$1bin/app.ts');
}

/**
 * The stacks one CDK app declares for a stage, with their Lambda handlers.
 *
 * ⛔ Throws for an entrypoint the manifest does not carry. Returning `[]` would report a clean drift check
 * for an app nobody read — the vacuity failure `verify-deployment.sh` guards against in three places.
 *
 * @param {import('./infrastructureManifest.mjs').InfrastructureManifest} manifest - The committed manifest.
 * @param {string} entrypoint - Repo-relative `bin/app.ts`.
 * @param {string} stage - The stage to resolve names for.
 * @returns {StageStack[]} One entry per declared stack. Pure.
 */
export function declaredForStage(manifest, entrypoint, stage) {
    const app = manifest.apps.find((candidate) => candidate.entrypoint === entrypoint);

    if (app === undefined) {
        throw new Error(
            `deployment-drift: the committed manifest has no entry for '${entrypoint}'. Run ` +
                '`npm run infra:manifest` and commit the result, or check the --app path.',
        );
    }

    return app.stacks.map((stack) => ({
        stackName: resolveStageNames(stack.stackNameTemplate, stage) ?? stack.className,
        className: stack.className,
        condition: stack.condition,
        handlers: stack.resources
            .filter((resource) => resource.kind === 'lambdaFunction')
            .map((resource) => ({
                logicalId: resource.logicalId,
                handler: resource.handler,
                condition: resource.condition,
            })),
    }));
}

/**
 * Whether any inspected stack carries a finding.
 *
 * ⚠️ `untagged` COUNTS. A stack whose commit is unknowable is the precise state prod was in when a document
 * claimed it was current, so treating it as ok would leave the original defect reachable.
 *
 * ⛔ Two things are REPORTED and deliberately are NOT findings, both because the derivation behind them is
 * knowingly incomplete and a check that cries wolf is a check that gets deleted. Both were measured against
 * the live prod account on the first real run of this module:
 *
 *  1. An ABSENT stack that is declared behind a guard. `kitchensink-sandbox-scheduler-{stage}` exists only
 *     for `sandbox` (ADR-0007) and `kitchensink-edge-{stage}` only for `prod` (ADR-0020); this comparison
 *     cannot evaluate `stage === 'sandbox'`, so calling either "NOT DEPLOYED" on the other stage is a false
 *     accusation. (An UNCONDITIONAL stack that is absent stays the loudest finding there is — and the same
 *     run found a real one: `kitchensink-service-logs-prod`, which ADR-0028 added and prod has never had.)
 *  2. `unexpected` handlers. It answers a different question from the one this check exists for, and it has
 *     two known blind spots: CDK synthesises Lambdas of its own (`framework.onEvent` for every custom
 *     resource — four of them in `kitchensink-data-prod`), and the manifest deliberately does not follow a
 *     construct imported from another workspace. `missing` has neither blind spot, which is why it is the
 *     one that fails.
 *
 * @param {readonly StackResult[]} stacks - Per-stack results.
 * @returns {boolean} True when anything needs a human. Pure.
 */
export function hasDriftFindings(stacks) {
    return stacks.some(
        (stack) =>
            (!stack.present && (stack.condition ?? null) === null) ||
            (stack.present &&
                (stack.commit === null ||
                    stack.commit.verdict !== 'current' ||
                    stack.handlers === null ||
                    stack.handlers.missing.length > 0)),
    );
}

/**
 * Render the operator-facing report.
 *
 * The shape is dictated by what a reader has to DO: name the stack, say which commit is running versus
 * which was expected, then list the declared handlers that are not there. A count without the names is not
 * actionable, and a list without the commits does not say whether the cause is a stale deploy or a broken
 * one.
 *
 * @param {{ stage: string, expected: string, stacks: readonly StackResult[] }} result - The comparison.
 * @returns {string} A Markdown report. Pure.
 */
export function formatDriftReport({ stage, expected, stacks }) {
    const lines = [`### Deployment drift — stage \`${stage}\`, expected commit \`${expected}\``, ''];

    for (const stack of stacks) {
        if (!stack.present) {
            lines.push(
                (stack.condition ?? null) === null
                    ? `- ⛔ \`${stack.stackName}\` **is NOT DEPLOYED** — the source declares it and no such ` +
                          'stack exists in this account.'
                    : `- ℹ️ \`${stack.stackName}\` is absent, and is declared only when ` +
                          `\`${stack.condition}\` — not asserted for this stage.`,
            );
            continue;
        }

        const { verdict, reason } = stack.commit;
        const icon = verdict === 'current' ? '✅' : verdict === 'stale' ? '⛔' : '⚠️';

        lines.push(`- ${icon} \`${stack.stackName}\` ${reason}`);

        const { missing, unexpected, conditional, unreadable } = stack.handlers;

        if (missing.length > 0) {
            lines.push(`    - ⛔ ${missing.length} declared handler(s) are not running:`);
            for (const entry of missing) {
                lines.push(`        - \`${entry.handler}\` (\`${entry.logicalId}\`)`);
            }
        }
        if (unexpected.length > 0) {
            lines.push(`    - ⚠️ ${unexpected.length} running handler(s) this commit does not declare:`);
            for (const handler of unexpected) {
                lines.push(`        - \`${handler}\``);
            }
        }
        if (conditional.length > 0) {
            lines.push(
                `    - not asserted (declared behind a guard): ` +
                    conditional.map((entry) => `\`${entry.handler}\``).join(', '),
            );
        }
        if (unreadable.length > 0) {
            lines.push(
                `    - not asserted (the manifest could not read the handler): ` +
                    unreadable.map((logicalId) => `\`${logicalId}\``).join(', '),
            );
        }
    }

    lines.push('');
    lines.push(
        hasDriftFindings(stacks)
            ? 'Deploy the affected stage, or record why it is deliberately behind. A stack whose commit is ' +
                  'unknowable is how `docs/architecture/2026-08-28-ingredient-pipeline-state.md` came to ' +
                  'claim two handlers were live that no account contained.'
            : 'No drift: every declared stack is deployed, at the expected commit, running every handler ' +
                  'this commit declares.',
    );

    return lines.join('\n');
}

// ── Impure: the account ─────────────────────────────────────────────────────────────────────────────────

/** This file sits at `scripts/`, so the repo root is one level up. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Run the AWS CLI and parse its JSON, or return `null` when the call fails.
 *
 * A failure is deliberately indistinguishable from "absent" here, because both are answered the same way by
 * the caller: the stack (or function) could not be read, which is reported, never passed.
 *
 * @param {readonly string[]} args - Arguments after `aws`.
 * @returns {object | null} The parsed response.
 * @sideEffect Calls AWS.
 */
function aws(args) {
    try {
        return JSON.parse(
            execFileSync('aws', [...args, '--output', 'json'], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                maxBuffer: 1 << 28,
            }),
        );
    } catch {
        return null;
    }
}

/**
 * The handlers actually running in one deployed stack.
 *
 * @param {string} region - AWS region.
 * @param {string} stackName - The stack.
 * @returns {string[]} Handler strings.
 * @sideEffect Calls CloudFormation and Lambda.
 */
function deployedHandlers(region, stackName) {
    const listed = aws(['cloudformation', 'list-stack-resources', '--region', region, '--stack-name', stackName]);
    const functions = (listed?.StackResourceSummaries ?? [])
        .filter((resource) => resource.ResourceType === 'AWS::Lambda::Function')
        .map((resource) => resource.PhysicalResourceId)
        .filter((name) => typeof name === 'string' && name !== '');

    return functions.flatMap((name) => {
        const configuration = aws([
            'lambda',
            'get-function-configuration',
            '--region',
            region,
            '--function-name',
            name,
        ]);

        return typeof configuration?.Handler === 'string' ? [configuration.Handler] : [];
    });
}

/**
 * Read one stack's provenance tag and running handlers.
 *
 * @param {string} region - AWS region.
 * @param {string} expected - The commit under consideration.
 * @param {StageStack} declared - One entry from {@link declaredForStage}.
 * @returns {StackResult} The per-stack result.
 * @sideEffect Calls AWS.
 */
function inspectStack(region, expected, declared) {
    const described = aws([
        'cloudformation',
        'describe-stacks',
        '--region',
        region,
        '--stack-name',
        declared.stackName,
    ]);
    const stack = described?.Stacks?.[0];

    if (stack === undefined) {
        return {
            stackName: declared.stackName,
            condition: declared.condition,
            present: false,
            commit: null,
            handlers: null,
        };
    }

    const tag = (stack.Tags ?? []).find((entry) => entry.Key === COMMIT_TAG_KEY);

    return {
        stackName: declared.stackName,
        condition: declared.condition,
        present: true,
        commit: classifyCommitTag(expected, tag?.Value),
        handlers: diffHandlers({
            declared: declared.handlers,
            deployed: deployedHandlers(region, declared.stackName),
        }),
    };
}

/** Read `--flag value` out of `argv`. */
function flag(argv, name) {
    const index = argv.indexOf(`--${name}`);

    return index === -1 ? undefined : argv[index + 1];
}

/**
 * The CLI.
 *
 * @sideEffect Reads the manifest, calls AWS, writes a report, sets the exit code.
 */
function main() {
    const argv = process.argv.slice(2);
    const region = flag(argv, 'region');
    const stage = flag(argv, 'stage');
    const appArgument = flag(argv, 'app');
    const app = appArgument === undefined ? undefined : toSourceEntrypoint(appArgument);
    const expected = flag(argv, 'expected-sha') ?? process.env['COMMIT_SHA'] ?? process.env['GITHUB_SHA'] ?? '';

    if (!region || !stage || !app) {
        process.stderr.write(
            'usage: deploymentDrift.mjs --region <region> --stage <stage> --app <entrypoint> ' +
                '[--expected-sha <sha>] [--warn-only]\n',
        );
        process.exitCode = 2;

        return;
    }

    const manifest = JSON.parse(readFileSync(path.join(repoRoot, MANIFEST_JSON), 'utf8'));
    const declared = declaredForStage(manifest, app, stage);

    if (declared.length === 0) {
        // Vacuity guard: an app that declares no stack cannot have been verified against anything.
        process.stdout.write(
            `::error::deployment-drift: the manifest declares NO stacks for ${app}, so this run compared ` +
                'nothing. Regenerate it with `npm run infra:manifest`.\n',
        );
        process.exitCode = 1;

        return;
    }

    const stacks = declared.map((entry) => inspectStack(region, expected, entry));
    const report = formatDriftReport({ stage, expected, stacks });
    const summary = process.env['GITHUB_STEP_SUMMARY'];

    process.stdout.write(`${report}\n`);
    if (summary !== undefined && summary !== '') {
        execFileSync('bash', ['-c', 'cat >> "$1"', '_', summary], { input: `${report}\n` });
    }

    if (!hasDriftFindings(stacks)) {
        return;
    }

    const annotation =
        `deployment-drift: stage '${stage}' does not match commit ${expected} — see the report above. ` +
        'This is the check that would have caught prod running a month-old recipe-workers behind green ticks.';

    if (argv.includes('--warn-only')) {
        process.stdout.write(`::warning::${annotation}\n`);

        return;
    }

    process.stdout.write(`::error::${annotation}\n`);
    process.exitCode = 1;
}

// `import.meta.main` is Node 24; the suite imports the pure helpers without calling AWS.
if (import.meta.main) {
    main();
}
