// @vitest-environment node
/**
 * Repo-wide guard: the k6 load tier is WIRED — every committed script actually runs in CI, and the
 * credential pools those runs mint never leave the runner.
 *
 * `docs/CODING_STANDARDS.md §7.1` mandates k6 load/performance tests for every deployable HTTP service, and
 * `heavy-e2e-load-tier-gate.test.ts` proves the tier is REACHED on the right triggers. Neither says anything
 * about whether a given script is invoked by any step at all, and neither looks at what the job uploads
 * afterwards. Both gaps have already cost this repo something:
 *
 * | # | The failure | The evidence |
 * |---|---|---|
 * | 1 | scripts written, reviewed, merged — and run by NO job | identity's four `tests/load/*.load.js` sat unexecuted; `lib/common.js` even documents an `open()` bug found by reading rather than running, "latent … because no CI job runs the identity tier yet" |
 * | 2 | a run's minted token pool uploaded as a build artifact | 6,054 live Clerk bearer JWTs, in a PUBLIC repo |
 * | 3 | a prepare step writing credentials OUTSIDE the ignore rule | `.gitignore`'s own note: the food tier grew its own `prepare-clerk-tokens.ts` "within hours and put 50 live JWTs … outside the rule" |
 *
 * None of the three is visible to `actionlint`, `zizmor` or CodeQL. All three are green YAML plus a green
 * test run: a script nothing executes cannot fail, and an artifact upload cannot tell a summary from a secret.
 *
 * ## 1 — every `.load.js` under a service is invoked by a workflow step
 *
 * Discovered from the filesystem, not listed here, so a NEW script inherits the requirement the day it lands
 * rather than the day somebody remembers to extend a list. Matching is PATH-aware, not by basename: food and
 * recipe both ship a `service-erasure.load.js`, so a step's argument is resolved against its
 * `working-directory` before comparison. Basename matching would let one service's job vouch for the other's
 * script — which is exactly the shape of the mistake, since the two jobs are copies of each other.
 *
 * ## 1b — and in the order the package declares
 *
 * A load job that runs each script as its OWN step (so the run graph attributes a failure to a scenario
 * rather than to one opaque block) necessarily re-states the ordering the package's `test:load` script already
 * owns. Identity's ordering is measured, not stylistic: with the write-heavy script running before the
 * read-sensitive ones, `validUnderStorm` p95 was 722ms against a 500ms budget versus 5.4ms on a settled
 * database — a ~130x artefact, i.e. a red run that looks like a service defect and is not one. So the npm
 * script stays the ONE authoritative statement and the duplication is held to it, as a SUBSEQUENCE so a job
 * may still add a script the chain omits (food runs its short-TTL erasure scenario first).
 *
 * ## 2 — no artifact upload can capture k6 credential material
 *
 * The forbidden paths are read from `.gitignore`'s own "CREDENTIAL MATERIAL" block rather than restated here,
 * so the ignore rule and this guard cannot drift, and adding a fifth pattern there extends the guard for free.
 * An `upload-artifact` glob is checked against every concrete path that block can name (each real service
 * substituted for its `*`), and a bare DIRECTORY path counts as capturing everything beneath it — because it
 * does.
 *
 * ## 3 — what a prepare step writes lands inside those rules
 *
 * Analyzer 2 protects the paths the ignore rules name. It says nothing about a prepare script that writes
 * somewhere ELSE — which is failure 3 verbatim. So this analyzer has two halves, and needs both:
 *
 *   • the emitted filenames are extracted from each prepare script's own `writeFileSync` calls and handed to
 *     `git check-ignore` — the real ignore engine, on the real paths, rather than a second glob
 *     implementation that could disagree with git about what is protected; and
 *   • the `outDir` those calls resolve against is pinned to the script's own directory, because `.gitignore`
 *     protects exactly ONE level under `tests/load/`. Without this half the filenames are derived from an
 *     assumption: repointing `outDir` upward moves every pool outside the rule while the filenames — and
 *     every other assertion in this file — stay identical. (See mutation 7.)
 *
 * ## Mutation evidence (each applied, and the named test watched to fail)
 *
 *   1. Written BEFORE the identity load job existed: "every committed k6 script is invoked by some workflow
 *      step" reported all four identity scripts unwired, and went green when the job landed.
 *   2. `working-directory` dropped from the food job's erasure step → that script reports unwired (recipe's
 *      identically-named step does NOT cover it).
 *   3. Identity's `k6 run` argument changed to a script that does not exist → the real script reports unwired.
 *   3b. Continuation folding removed → food's `local-store-throughput.load.js` reports unwired. Recorded
 *      because it is the bug this file's own fixture caught in the analyzer BEFORE the real tree did, and it
 *      is the failure mode that would have got the whole analyzer muted as noisy.
 *   3c. Identity's provisioning step moved to the top of its job → analyzer 1b reports the order drift.
 *   4. Artifact path widened from `k6-*-summary.json` to `tests/load` → analyzer 2 reports the token pool.
 *   5. Artifact path widened to a glob over the identity package → analyzer 2 reports it too (glob form), and a
 *      recursive glob spanning `packages/services` reports EVERY service's pool, not just the first.
 *   6. `clerk-tokens.json` removed from `.gitignore`'s credential block → analyzer 2's discovery assertion and
 *      analyzer 3's `git check-ignore` assertion both fail.
 *   7. `outDir` in `prepare-clerk-tokens.ts` repointed one level up → "mints them into the script's own
 *      directory" fails. Recorded with its history, because this is the one mutation the FIRST draft of this
 *      file survived: analyzer 3 assumed the emit directory instead of checking it, so moving every pool
 *      outside the ignore rule left all of its assertions green. The `outDir` pin exists because of that miss.
 *   8. The `const outDir = …` binding renamed → same assertion fails (an emit directory that cannot be
 *      established is not the same as one that is correct).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { minimatch } from 'minimatch';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');
const SERVICES_DIR = join(REPO_ROOT, 'packages', 'services');

interface RunDefaults {
    readonly run?: { readonly 'working-directory'?: string };
}

interface WorkflowStep {
    readonly name?: string;
    readonly uses?: string;
    readonly run?: string;
    readonly with?: Readonly<Record<string, unknown>>;
    readonly 'working-directory'?: string;
}

interface WorkflowJob {
    readonly defaults?: RunDefaults;
    readonly steps?: readonly WorkflowStep[];
}

interface WorkflowDocument {
    readonly defaults?: RunDefaults;
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

/** A step paired with the job it lives in and the directory its `run:` executes from. */
interface LocatedStep {
    readonly file: string;
    readonly job: string;
    readonly step: WorkflowStep;
    /** Repo-relative, POSIX, no trailing slash. `'.'` when nothing narrows it. */
    readonly workingDirectory: string;
}

/**
 * Every step in every workflow, with its effective `working-directory` resolved through the step → job →
 * workflow `defaults.run` chain GitHub itself uses. Pure apart from the reads in {@link load}.
 */
function locatedSteps(workflows: readonly Workflow[]): readonly LocatedStep[] {
    return workflows.flatMap(({ file, doc }) =>
        Object.entries(doc.jobs ?? {}).flatMap(([job, definition]) =>
            (definition.steps ?? []).map((step) => ({
                file,
                job,
                step,
                workingDirectory:
                    step['working-directory'] ??
                    definition.defaults?.run?.['working-directory'] ??
                    doc.defaults?.run?.['working-directory'] ??
                    '.',
            })),
        ),
    );
}

/** A step's stable identity for violation messages. */
function stepLabel(step: WorkflowStep): string {
    return step.name ?? (step.run ?? '').split('\n')[0]?.trim() ?? '(unnamed)';
}

/** Repo-relative POSIX path, with `./` and `../` collapsed. Pure. */
function repoRelative(workingDirectory: string, argument: string): string {
    return posix.normalize(posix.join(workingDirectory, argument));
}

// ---------------------------------------------------------------------------------------------------------
// Analyzer 1 — every committed k6 script is invoked
// ---------------------------------------------------------------------------------------------------------

/**
 * Every `packages/services/*​/tests/load/*.load.js`, repo-relative.
 *
 * The `.load.js` suffix is the repo's own marker for "run by the k6 binary, excluded from every vitest glob"
 * (`docs/CODING_STANDARDS.md §7`), so it is a reliable discriminator and needs no allowlist.
 */
function committedLoadScripts(): readonly string[] {
    const scripts: string[] = [];

    for (const service of readdirSync(SERVICES_DIR).sort()) {
        const loadDir = join(SERVICES_DIR, service, 'tests', 'load');

        if (!existsSync(loadDir)) {
            continue;
        }

        for (const entry of readdirSync(loadDir).sort()) {
            if (entry.endsWith('.load.js')) {
                scripts.push(posix.join('packages/services', service, 'tests/load', entry));
            }
        }
    }

    return scripts;
}

/** One `k6 run …` invocation, on a single logical line (see {@link joinContinuations}). */
const K6_INVOCATION = /k6 run[^\n]*/g;

/**
 * Fold shell line-continuations into one logical line. Pure.
 *
 * Load-bearing, and caught by this file's own fixture before the real tree: the food job's throughput step is
 * written `k6 run --summary-export=… \` with the script on the NEXT line. Scanning raw lines reports that
 * wired script as unwired — an analyzer that cries wolf on a correct workflow gets muted, which is worse than
 * not having it. Folding first is also why the invocation pattern can stay a simple single-line match instead
 * of a regex that has to reason about escaped newlines.
 */
function joinContinuations(run: string): string {
    return run.replace(/\\\n\s*/g, ' ');
}

/** A `.load.js` argument inside one invocation. */
const LOAD_SCRIPT_ARGUMENT = /\S*\.load\.js\b/g;

/** Every load script a workflow step invokes, resolved to a repo-relative path. */
function invokedLoadScripts(workflows: readonly Workflow[]): ReadonlyMap<string, readonly string[]> {
    const invoked = new Map<string, string[]>();

    for (const { file, job, step, workingDirectory } of locatedSteps(workflows)) {
        for (const invocation of joinContinuations(step.run ?? '').match(K6_INVOCATION) ?? []) {
            for (const argument of invocation.match(LOAD_SCRIPT_ARGUMENT) ?? []) {
                const path = repoRelative(workingDirectory, argument);
                const sites = invoked.get(path) ?? [];

                sites.push(`${file}::${job}::${stepLabel(step)}`);
                invoked.set(path, sites);
            }
        }
    }

    return invoked;
}

/** Committed load scripts that no workflow step runs. A script nothing executes cannot fail. */
function findUnwiredLoadScripts(scripts: readonly string[], workflows: readonly Workflow[]): readonly string[] {
    const invoked = invokedLoadScripts(workflows);

    return [...scripts]
        .filter((script) => !invoked.has(script))
        .map(
            (script) => `${script} → committed but invoked by no workflow step, so its thresholds can never fail a run`,
        )
        .sort();
}

// ---------------------------------------------------------------------------------------------------------
// Analyzer 1b — CI runs the scripts in the order the package declares
// ---------------------------------------------------------------------------------------------------------

/**
 * The scripts a service's `test:load` npm script chains, in order — the authoritative ordering.
 *
 * Only services that declare one are considered; a service whose scripts are order-independent simply has
 * nothing to preserve.
 */
function declaredScriptOrder(service: string): readonly string[] {
    const manifest = join(SERVICES_DIR, service, 'package.json');

    if (!existsSync(manifest)) {
        return [];
    }

    const scripts = (JSON.parse(readFileSync(manifest, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};

    return [...(scripts['test:load'] ?? '').matchAll(LOAD_SCRIPT_ARGUMENT)].map((match) =>
        posix.join('packages/services', service, match[0].replace(/^\.?\//, '')),
    );
}

/** The scripts a workflow runs for one service, in the order its steps appear. */
function workflowScriptOrder(service: string, workflows: readonly Workflow[]): readonly string[] {
    const prefix = `packages/services/${service}/`;
    const order: string[] = [];

    for (const { step, workingDirectory } of locatedSteps(workflows)) {
        for (const invocation of joinContinuations(step.run ?? '').match(K6_INVOCATION) ?? []) {
            for (const argument of invocation.match(LOAD_SCRIPT_ARGUMENT) ?? []) {
                const path = repoRelative(workingDirectory, argument);

                if (path.startsWith(prefix)) {
                    order.push(path);
                }
            }
        }
    }

    return order;
}

/**
 * Services whose CI step order contradicts the order their `test:load` script declares.
 *
 * Compared as a SUBSEQUENCE, not for equality: a job may legitimately add a script the npm chain omits (food
 * runs `service-erasure` first, because its EdDSA pool lives 120s and the fixture seed after it takes ~15s).
 * What must hold is that the scripts the chain DOES name still appear in the chain's relative order.
 *
 * This is not stylistic. Identity's suite measured `validUnderStorm` p95 at 722ms against a 500ms budget when
 * the write-heavy script ran before the read-sensitive ones, versus 5.4ms on a settled database — a ~130x
 * artefact of ordering, i.e. a red run that looks like a service defect and is not one. The ordering therefore
 * has ONE authoritative statement (the npm script), and a CI job that re-states it per step for per-scenario
 * attribution is only safe while something proves the two agree.
 */
function findScriptOrderDrift(workflows: readonly Workflow[]): readonly string[] {
    const violations: string[] = [];

    for (const service of serviceNames()) {
        const declared = declaredScriptOrder(service);

        if (declared.length < 2) {
            continue;
        }

        const actual = workflowScriptOrder(service, workflows).filter((path) => declared.includes(path));
        const expected = declared.filter((path) => actual.includes(path));

        if (actual.join(' → ') !== expected.join(' → ')) {
            violations.push(
                `${service} → CI runs [${actual.join(', ')}] but \`test:load\` declares [${expected.join(', ')}]; ` +
                    'the order is load-bearing (a write-heavy script before a read-sensitive one leaves ' +
                    'Postgres vacuuming under the measurement)',
            );
        }
    }

    return [...violations].sort();
}

// ---------------------------------------------------------------------------------------------------------
// Analyzer 2 — no artifact upload can capture credential material
// ---------------------------------------------------------------------------------------------------------

/**
 * The `packages/services/*​/tests/load/…` patterns from `.gitignore`'s "CREDENTIAL MATERIAL" block.
 *
 * Read rather than restated so the ignore rule stays the ONE authoritative statement of what is secret. The
 * block is the comment line containing `CREDENTIAL MATERIAL` followed by its patterns, terminated by the
 * first blank line — which is how the file is already written, and why the neighbouring "store fixtures" and
 * "run summaries" blocks (not secret, and legitimately uploaded) are excluded.
 */
function credentialPatterns(): readonly string[] {
    const lines = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8').split('\n');
    const start = lines.findIndex((line) => line.startsWith('#') && line.includes('CREDENTIAL MATERIAL'));

    if (start === -1) {
        throw new Error(
            '.gitignore has no `# … CREDENTIAL MATERIAL …` block — this guard reads the forbidden paths ' +
                'from there rather than restating them, so a renamed block must be re-pointed, not ignored.',
        );
    }

    const patterns: string[] = [];

    for (const line of lines.slice(start + 1)) {
        const trimmed = line.trim();

        if (trimmed.startsWith('#')) {
            continue;
        }

        if (trimmed === '') {
            break;
        }

        patterns.push(trimmed);
    }

    if (patterns.length === 0) {
        throw new Error(".gitignore's CREDENTIAL MATERIAL block declares no patterns");
    }

    return patterns;
}

/** Every service package directory name, so a `*` in a credential pattern can be made concrete. */
function serviceNames(): readonly string[] {
    return readdirSync(SERVICES_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
}

/**
 * Concrete repo-relative paths the credential patterns can name.
 *
 * A glob-vs-glob comparison ("could these two patterns ever overlap?") is undecidable in general; a glob
 * against a CONCRETE path is exactly what `minimatch` answers, and the `*` here ranges over a knowable,
 * enumerable set — the service packages that exist.
 */
function credentialPaths(): readonly string[] {
    return credentialPatterns()
        .flatMap((pattern) =>
            pattern.includes('*')
                ? serviceNames().map((service) =>
                      pattern.replace('packages/services/*/', `packages/services/${service}/`),
                  )
                : [pattern],
        )
        .sort();
}

/** The `path:` input of an `upload-artifact` step, split into its individual globs. */
function artifactGlobs(step: WorkflowStep): readonly string[] {
    return String(step.with?.['path'] ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('!'));
}

/**
 * Artifact uploads whose paths can capture a credential file.
 *
 * Two capture shapes, because both are real: a GLOB that matches the file, and a bare DIRECTORY that contains
 * it (`actions/upload-artifact` uploads a directory's whole subtree, so `tests/load` publishes the pool as
 * surely as `tests/load/clerk-tokens.json` would).
 *
 * ⚠️ Paths are resolved against the WORKSPACE ROOT, deliberately ignoring any `working-directory` on the step.
 * That is `actions/upload-artifact`'s actual contract — it is a JS action, and `working-directory` applies only
 * to `run:` steps — so honouring it here would model a semantic GitHub does not have. (An earlier draft did,
 * and its fixture asserted that false semantic; it was conservative rather than unsound, but a guard that
 * teaches the wrong rule about the thing it guards is worse than the over-flagging it buys.)
 */
function findCredentialLeakingUploads(workflows: readonly Workflow[]): readonly string[] {
    const violations: string[] = [];
    const secrets = credentialPaths();

    for (const { file, job, step } of locatedSteps(workflows)) {
        if (!/actions\/upload-artifact@/.test(step.uses ?? '')) {
            continue;
        }

        for (const glob of artifactGlobs(step)) {
            const resolved = glob.startsWith('~') || glob.startsWith('/') ? glob : repoRelative('.', glob);

            for (const secret of secrets) {
                const matched = minimatch(secret, resolved, { dot: true }) || secret.startsWith(`${resolved}/`);

                if (matched) {
                    violations.push(
                        `${file}::${job}::${stepLabel(step)} → uploads \`${glob}\`, which captures ` +
                            `${secret} — live bearer credentials, in a PUBLIC repo`,
                    );
                }
            }
        }
    }

    return [...violations].sort();
}

// ---------------------------------------------------------------------------------------------------------
// Analyzer 3 — what a prepare step writes is actually ignored
// ---------------------------------------------------------------------------------------------------------

/** `writeFileSync(join(outDir, 'name.ext')` — the emit sites of a token-minting prepare script. */
const EMITTED_FILE = /writeFileSync\(\s*join\(\s*outDir\s*,\s*'([^']+)'\s*\)/g;

/** `const outDir = …;` — where those emit sites resolve to. */
const OUT_DIR_ASSIGNMENT = /const\s+outDir\s*=\s*([^;]+);/;

/**
 * The ONLY emit directory that keeps a minted pool inside the ignore rule.
 *
 * `.gitignore` protects `packages/services/*​/tests/load/<file>` — one level, no `**` — so a pool written
 * anywhere other than beside the script that mints it falls outside the rule and becomes committable. That is
 * not hypothetical: the rule was once scoped to identity's path while the food tier emitted 50 live JWTs one
 * directory over. Pinning the expression is what lets {@link mintedCredentialFiles} derive a path at all
 * without executing the script (executing it would mint real credentials).
 */
const SCRIPT_OWN_DIRECTORY = 'dirname(fileURLToPath(import.meta.url))';

/** Every `tests/load/prepare-*token*.ts` in the tree, as `[service, filename, source]`. */
function tokenPrepareScripts(): readonly {
    readonly service: string;
    readonly file: string;
    readonly source: string;
}[] {
    const found: { service: string; file: string; source: string }[] = [];

    for (const service of serviceNames()) {
        const loadDir = join(SERVICES_DIR, service, 'tests', 'load');

        if (!existsSync(loadDir)) {
            continue;
        }

        for (const entry of readdirSync(loadDir).sort()) {
            if (/^prepare-.*token.*\.ts$/.test(entry)) {
                found.push({ service, file: entry, source: readFileSync(join(loadDir, entry), 'utf8') });
            }
        }
    }

    return found;
}

/** Prepare scripts whose emit directory is not the script's own — i.e. outside the ignore rule. */
function findMisplacedEmitDirectories(): readonly string[] {
    const violations: string[] = [];

    for (const { service, file, source } of tokenPrepareScripts()) {
        const assignment = OUT_DIR_ASSIGNMENT.exec(source);
        const expression = assignment?.[1]?.replace(/\s+/g, ' ').trim();

        if (expression === undefined) {
            violations.push(
                `packages/services/${service}/tests/load/${file} → declares no \`const outDir = …\`, so where ` +
                    'it writes its credential pool cannot be established without running it',
            );
            continue;
        }

        if (expression !== SCRIPT_OWN_DIRECTORY) {
            violations.push(
                `packages/services/${service}/tests/load/${file} → writes to \`${expression}\`, not the ` +
                    `script's own directory (\`${SCRIPT_OWN_DIRECTORY}\`); \`.gitignore\` protects exactly ` +
                    'one level under `tests/load/`, so anywhere else is committable credential material',
            );
        }
    }

    return [...violations].sort();
}

/**
 * Every file a `tests/load/prepare-*token*.ts` script writes, repo-relative.
 *
 * Sound only because {@link findMisplacedEmitDirectories} pins `outDir` to the script's own directory — which
 * is asserted separately rather than assumed here.
 */
function mintedCredentialFiles(): readonly string[] {
    const emitted = tokenPrepareScripts().flatMap(({ service, source }) =>
        [...source.matchAll(EMITTED_FILE)].map((match) =>
            posix.join('packages/services', service, 'tests/load', match[1] as string),
        ),
    );

    return [...new Set(emitted)].sort();
}

/**
 * Whether git itself would refuse to commit a path.
 *
 * `git check-ignore` rather than a second glob engine: the question is "is this protected", and only git's own
 * matcher can answer it without the risk of disagreeing with git. One path per call — with several, the exit
 * status means "at least one matched", which would let an ignored sibling vouch for an exposed file.
 *
 * @sideEffect Shells out to `git`.
 */
function isGitIgnored(repoRelativePath: string): boolean {
    try {
        execFileSync('git', ['check-ignore', '--quiet', '--no-index', repoRelativePath], {
            cwd: REPO_ROOT,
            stdio: 'ignore',
        });

        return true;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------------------------------------
// Analyzer 1 — assertions
// ---------------------------------------------------------------------------------------------------------

describe('every committed k6 load script is invoked by a workflow step', () => {
    it('is not vacuous: the tree ships load scripts for every service that has the tier', () => {
        // Pins the discovery half. If the suffix convention changes or the directory moves, the real-tree
        // assertion below would go quiet rather than red.
        const scripts = committedLoadScripts();

        expect(scripts.length).toBeGreaterThan(0);
        expect(scripts).toContain('packages/services/identity/tests/load/session-hot-path.load.js');
        expect(scripts).toContain('packages/services/food-service/tests/load/search.load.js');
        expect(scripts).toContain('packages/services/recipe-service/tests/load/sc009-read-write.load.js');
    });

    it('flags a script no step runs', () => {
        const violations = findUnwiredLoadScripts(
            ['packages/services/ghost/tests/load/unrun.load.js'],
            [
                {
                    file: 'heavy.yml',
                    doc: {
                        jobs: {
                            load: {
                                steps: [
                                    {
                                        name: 'Run k6',
                                        'working-directory': 'packages/services/ghost',
                                        run: 'k6 run tests/load/something-else.load.js',
                                    },
                                ],
                            },
                        },
                    },
                },
            ],
        );

        expect(violations.join('\n')).toMatch(/unrun\.load\.js → committed but invoked by no workflow step/);
    });

    it("does NOT credit one service for another service's identically-named script", () => {
        // food and recipe both ship `service-erasure.load.js`. Basename matching would let either job's step
        // vouch for both — and since the two jobs are copies of one another, that is the likely mistake.
        const workflows: readonly Workflow[] = [
            {
                file: 'heavy.yml',
                doc: {
                    jobs: {
                        load: {
                            steps: [
                                {
                                    name: 'Run recipe erasure',
                                    'working-directory': 'packages/services/recipe-service',
                                    run: 'k6 run tests/load/service-erasure.load.js',
                                },
                            ],
                        },
                    },
                },
            },
        ];

        expect(
            findUnwiredLoadScripts(['packages/services/recipe-service/tests/load/service-erasure.load.js'], workflows),
        ).toEqual([]);
        expect(
            findUnwiredLoadScripts(
                ['packages/services/food-service/tests/load/service-erasure.load.js'],
                workflows,
            ).join('\n'),
        ).toMatch(/food-service.*service-erasure\.load\.js → committed but invoked by no workflow step/);
    });

    it('resolves a backslash-continued invocation', () => {
        // The food job's throughput step puts the script on the NEXT line. A single-line regex reports a
        // wired script as unwired, which would make this whole analyzer untrustworthy on the real tree.
        const violations = findUnwiredLoadScripts(
            ['packages/services/svc/tests/load/wrapped.load.js'],
            [
                {
                    file: 'heavy.yml',
                    doc: {
                        jobs: {
                            load: {
                                steps: [
                                    {
                                        name: 'Run k6',
                                        'working-directory': 'packages/services/svc',
                                        run: 'k6 run --summary-export=k6-summary.json \\\n    tests/load/wrapped.load.js',
                                    },
                                ],
                            },
                        },
                    },
                },
            ],
        );

        expect(violations).toEqual([]);
    });

    it('holds for the real tree', () => {
        expect(
            findUnwiredLoadScripts(committedLoadScripts(), realWorkflows()),
            'a k6 script no job runs is a performance gate that cannot fail — the same silent success as a ' +
                "`|| true`, and how identity's four scripts sat unexecuted after review",
        ).toEqual([]);
    });
});

describe("CI runs each service's k6 scripts in the order its package declares", () => {
    it('is not vacuous: at least two services declare a multi-script `test:load` chain', () => {
        const declaring = serviceNames().filter((service) => declaredScriptOrder(service).length >= 2);

        expect(declaring).toContain('identity');
        expect(declaring).toContain('food-service');
    });

    it('flags a job that runs the write-heavy script first', () => {
        // Identity's exact recorded artefact: `provisioning-and-rename` before the read-sensitive scripts
        // measured `validUnderStorm` p95 at 722ms against its 500ms budget.
        const violations = findScriptOrderDrift([
            {
                file: 'heavy.yml',
                doc: {
                    jobs: {
                        load: {
                            steps: [
                                {
                                    name: 'Writes first',
                                    'working-directory': 'packages/services/identity',
                                    run: 'k6 run tests/load/provisioning-and-rename.load.js',
                                },
                                {
                                    name: 'Then reads',
                                    'working-directory': 'packages/services/identity',
                                    run: 'k6 run tests/load/session-hot-path.load.js',
                                },
                            ],
                        },
                    },
                },
            },
        ]);

        expect(violations.join('\n')).toMatch(/identity → CI runs/);
    });

    it('tolerates a job that runs an EXTRA script the chain does not name', () => {
        // Food's job legitimately runs `service-erasure` first (its EdDSA pool lives 120s), and that script is
        // not in the npm chain. A strict equality check would report the correct workflow as broken.
        const violations = findScriptOrderDrift([
            {
                file: 'heavy.yml',
                doc: {
                    jobs: {
                        load: {
                            defaults: { run: { 'working-directory': 'packages/services/food-service' } },
                            steps: [
                                { name: 'Erasure', run: 'k6 run tests/load/service-erasure.load.js' },
                                { name: 'Read', run: 'k6 run tests/load/local-store-read.load.js' },
                                { name: 'Throughput', run: 'k6 run tests/load/local-store-throughput.load.js' },
                                { name: 'Search', run: 'k6 run tests/load/search.load.js' },
                            ],
                        },
                    },
                },
            },
        ]);

        expect(violations).toEqual([]);
    });

    it('holds for the real tree', () => {
        expect(
            findScriptOrderDrift(realWorkflows()),
            "the ordering has ONE authoritative statement — the package's `test:load` script. A CI job that " +
                're-states it per step (for per-scenario attribution in the run graph) is only safe while the ' +
                'two are proven to agree.',
        ).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------
// Analyzer 2 — assertions
// ---------------------------------------------------------------------------------------------------------

describe('no artifact upload can capture a k6 credential pool', () => {
    it('reads the forbidden paths from .gitignore rather than restating them', () => {
        const paths = credentialPaths();

        expect(paths).toContain('packages/services/identity/tests/load/clerk-tokens.json');
        expect(paths).toContain('packages/services/identity/tests/load/clerk-public-key.pem');
        expect(paths).toContain('packages/services/food-service/tests/load/clerk-tokens.json');
        // The neighbouring blocks are NOT secret and are legitimately uploaded — proving they are out of
        // scope keeps this analyzer from becoming a source of findings nobody can act on.
        expect(paths).not.toContain('packages/services/identity/tests/load/perf-fixture.json');
    });

    it('flags a directory upload that contains the pool', () => {
        const violations = findCredentialLeakingUploads([
            {
                file: 'heavy.yml',
                doc: {
                    jobs: {
                        load: {
                            steps: [
                                {
                                    name: 'Upload k6 summaries',
                                    uses: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
                                    with: { path: 'packages/services/identity/tests/load' },
                                },
                            ],
                        },
                    },
                },
            },
        ]);

        expect(violations.join('\n')).toMatch(/clerk-tokens\.json — live bearer credentials/);
    });

    it('flags a wildcard upload that matches the pool', () => {
        const violations = findCredentialLeakingUploads([
            {
                file: 'heavy.yml',
                doc: {
                    jobs: {
                        load: {
                            steps: [
                                {
                                    name: 'Upload everything',
                                    uses: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
                                    with: { path: 'packages/services/identity/**' },
                                },
                            ],
                        },
                    },
                },
            },
        ]);

        expect(violations.join('\n')).toMatch(/clerk-tokens\.json/);
    });

    it('flags a deep `**` glob and reports EVERY service it captures', () => {
        // The "just grab the load outputs" form. It is also the shape that scales the damage: one glob, every
        // service's pool.
        const violations = findCredentialLeakingUploads([
            {
                file: 'heavy.yml',
                doc: {
                    jobs: {
                        load: {
                            steps: [
                                {
                                    name: 'Upload load outputs',
                                    uses: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
                                    with: { path: 'packages/services/**/tests/load/**' },
                                },
                            ],
                        },
                    },
                },
            },
        ]);

        expect(violations.join('\n')).toMatch(/identity\/tests\/load\/clerk-tokens\.json/);
        expect(violations.join('\n')).toMatch(/food-service\/tests\/load\/clerk-tokens\.json/);
    });

    it('ignores `working-directory` on an upload step, because upload-artifact does', () => {
        // `working-directory` applies to `run:` steps only, so this path resolves at the WORKSPACE ROOT — where
        // `tests/load/*` matches nothing. Honouring it would model a semantic GitHub does not have.
        const violations = findCredentialLeakingUploads([
            {
                file: 'heavy.yml',
                doc: {
                    jobs: {
                        load: {
                            steps: [
                                {
                                    name: 'Upload load outputs',
                                    uses: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
                                    'working-directory': 'packages/services/identity',
                                    with: { path: 'tests/load/*' },
                                },
                            ],
                        },
                    },
                },
            },
        ]);

        expect(violations).toEqual([]);
    });

    it('does NOT flag the summary-only upload the load jobs actually use', () => {
        const violations = findCredentialLeakingUploads([
            {
                file: 'heavy.yml',
                doc: {
                    jobs: {
                        load: {
                            steps: [
                                {
                                    name: 'Upload k6 summaries',
                                    uses: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
                                    with: { path: 'packages/services/identity/k6-*-summary.json' },
                                },
                            ],
                        },
                    },
                },
            },
        ]);

        expect(violations).toEqual([]);
    });

    it('holds for the real tree', () => {
        expect(
            findCredentialLeakingUploads(realWorkflows()),
            'a k6 token pool is thousands of live bearer credentials; an artifact publishes them to anyone ' +
                "who can read this PUBLIC repo's workflow runs",
        ).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------
// Analyzer 3 — assertions
// ---------------------------------------------------------------------------------------------------------

describe('every file a k6 prepare step mints is ignored by git', () => {
    it('is not vacuous: the prepare scripts do emit credential files', () => {
        const minted = mintedCredentialFiles();

        expect(minted.length).toBeGreaterThan(0);
        expect(minted).toContain('packages/services/identity/tests/load/clerk-tokens.json');
        expect(minted).toContain('packages/services/identity/tests/load/clerk-public-key.pem');
    });

    it("mints them into the script's own directory, the one level the ignore rule protects", () => {
        // Without this, the paths above are DERIVED from an assumption rather than checked: repointing
        // `outDir` one level up moves every pool outside `packages/services/*/tests/load/…` — committable,
        // in a public repo — while the emitted FILENAMES stay identical and every other assertion here
        // stays green. (Found by mutation: this file's first draft had exactly that blind spot.)
        expect(findMisplacedEmitDirectories()).toEqual([]);
    });

    it('asks git itself, and git says every one of them is ignored', () => {
        // The `.gitignore` glob was ONCE scoped to `packages/services/identity/...` while the food tier
        // emitted 50 live JWTs one directory over — outside the rule, and committable. This is the assertion
        // that catches the next instance of that: the emit sites are discovered from the scripts, so a
        // prepare step that starts writing somewhere new fails here.
        for (const file of mintedCredentialFiles()) {
            expect(isGitIgnored(file), `${file} is NOT gitignored — it is committable credential material`).toBe(true);
        }
    });

    it('is a real check: an unlisted neighbour in the same directory is NOT ignored', () => {
        // Proves analyzer 3 can distinguish, rather than reporting `true` for everything under `tests/load/`.
        expect(isGitIgnored('packages/services/identity/tests/load/not-a-credential.json')).toBe(false);
    });
});
