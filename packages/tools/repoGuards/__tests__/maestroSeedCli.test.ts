// @vitest-environment node
/**
 * Repo-wide guard: the Maestro jobs run the seed and pool CLIs as BUNDLES built once per run, and install nothing.
 *
 * ## Why (run 39345702996, iOS shard 1)
 *
 * Fifteen minutes passed before the first flow, and 9m23s of it was Node: `npm ci` of the WHOLE monorepo on a 3-core
 * macOS runner (8m26s) and a turbo build of the seed tools' closure (57s). The Android job paid a `node_modules` restore,
 * an npm-cache restore inside `setup-node`, and the same build. Yet all either job runs on Node is four CLIs:
 * `resetPool`, `poolAdmin` and `provision` from the job's steps, and `reset` before every flow from `runMaestroFlows.sh`.
 *
 * So `resolve-mobile-target`, a Linux job that already restores the install, bundles those four with esbuild
 * (`packages/tools/e2e-seed/cliBundle.mjs`) and uploads them; each Maestro shard downloads them, proves they were built
 * from its own commit, and runs them with plain `node` through the one door (`runCli.sh`, held by
 * `seedCliLauncher.test.ts`).
 *
 * ## The rules
 *
 *   1. **No install.** No `npm ci`/`npm install`, no `node_modules` cache, no turbo build, and `setup-node` with its
 *      package-manager cache OFF — the pinned action caches automatically otherwise (the iOS job measured a 616 MB
 *      restore at 3 to 5 MB/s).
 *   2. **Every CLI through the door, and only a bundled one.** No step runs `tsx` or `npx`; every e2e-seed or e2e-fixtures
 *      source a step names is launched by `runCli.sh`, and is one `cliBundle.mjs` declares. A CLI added to a job but not
 *      to the bundle reds HERE, not on a Mac forty minutes into a run.
 *   3. **This run's bundles, verified before use.** The download names, literally, an artifact a job in its `needs`
 *      uploads (`workflowInvariants` invariant 2 already refuses a name with no upload in the closure; this guard pins
 *      WHICH upload), from THIS run only (no `run-id`, no token), and the next step checks the
 *      manifest's commit against the job's own `GITHUB_SHA` before it exports `E2E_SEED_CLI_DIR`. Nothing else sets that
 *      variable, so "set" means "verified". Both precede the first CLI and sit behind the secrets valve.
 *   4. **The producer** builds from `${GITHUB_SHA}`, after its install, unconditionally (so the artifact exists whenever
 *      the job succeeds), and uploads with `overwrite` so a re-run of that job does not red on its own earlier upload.
 *   5. **`runMaestroFlows.sh` resets through ONE function**, `maestro_seed_reset`, which is the script's only call to
 *      the door and its only Node at all.
 *
 * Rule 3's verify step is EXECUTED below under real bash, against a manifest that matches and one that does not.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parse } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scalarText } from './workflowScalar.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKFLOW = join(REPO_ROOT, '.github/workflows/_ci-heavy.yml');
const FLOW_SCRIPT = join(REPO_ROOT, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');
const BUILDER = join(REPO_ROOT, 'packages/tools/e2e-seed/cliBundle.mjs');
const DOOR = 'packages/tools/e2e-seed/runCli.sh';
const BUNDLE_DIR = '${{ runner.temp }}/seedCli';
const VALVE = /steps\.secrets\.outcome == 'success'/u;
/** The Linux job that already holds the install, and bundles the CLIs for both Maestro jobs. */
const PRODUCER = 'resolve-mobile-target';

interface Step {
    readonly name?: string;
    readonly id?: string;
    readonly if?: unknown;
    readonly uses?: string;
    readonly run?: unknown;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly with?: Readonly<Record<string, unknown>>;
}

interface Job {
    readonly needs?: readonly string[] | string;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly steps?: readonly Step[];
}

const workflow = parse(readFileSync(WORKFLOW, 'utf8')) as { readonly jobs?: Readonly<Record<string, Job>> };
const jobs = workflow.jobs ?? {};

/** A step's shell commands — its `run:` and an action's `script:` — with whole-line comments dropped. */
function commandsOf(step: Step): string {
    return [scalarText(step.run), scalarText(step.with?.['script'])]
        .join('\n')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
}

/** The same, over a whole shell script. */
function scriptCommands(text: string): string {
    return text
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
}

const needsOf = (job: Job | undefined): readonly string[] =>
    typeof job?.needs === 'string' ? [job.needs] : (job?.needs ?? []);

/**
 * The flow loop's RUN mode: `runMaestroFlows.sh` with no subcommand. `resolve-mobile-target` also calls the script, for
 * `shard-matrix`, and is the producer, not a subject.
 */
const RUNS_FLOWS = /runMaestroFlows\.sh[ \t]*$/mu;

/** The Maestro jobs: every job that runs the flow loop — discovered, never listed. */
const maestroJobs = Object.entries(jobs).filter(([, job]) =>
    (job.steps ?? []).some((step) => RUNS_FLOWS.test(commandsOf(step))),
);

/** A seed or pool CLI source named on a command line. */
const CLI_SOURCE = /packages\/tools\/e2e-(?:seed|fixtures)\/src\/[\w/]+\.ts/gu;
/** The same, for a yes/no question (a `g` regex's `test` is stateful). */
const NAMES_CLI = new RegExp(CLI_SOURCE.source, 'u');

let declaredSources: readonly string[] = [];

beforeAll(async () => {
    const module: unknown = await import(pathToFileURL(BUILDER).href);
    const clis = (module as Record<string, unknown>)['SEED_CLIS'];

    if (!Array.isArray(clis)) {
        throw new Error('cliBundle.mjs does not export SEED_CLIS');
    }

    declaredSources = clis.map((cli: unknown) => scalarText((cli as Record<string, unknown>)['source']));
});

const scratch: string[] = [];

afterAll(() => {
    for (const directory of scratch) {
        rmSync(directory, { recursive: true, force: true });
    }
});

it('finds both Maestro jobs (non-vacuity — a job it cannot see is a job it cannot guard)', () => {
    expect(maestroJobs.map(([id]) => id)).toStrictEqual(['e2e-mobile-maestro', 'e2e-mobile-maestro-ios']);
});

describe.each(maestroJobs)('%s', (_id, job) => {
    const steps = job.steps ?? [];
    const download = steps.findIndex(
        (step) =>
            /^actions\/download-artifact@/u.test(step.uses ?? '') && scalarText(step.with?.['path']) === BUNDLE_DIR,
    );
    const verify = steps.findIndex((step) => commandsOf(step).includes(`${DOOR} verify`));
    const firstCli = steps.findIndex(
        (step) => NAMES_CLI.test(commandsOf(step)) || /runMaestroFlows\.sh/u.test(commandsOf(step)),
    );

    describe('⛔ installs nothing', () => {
        it('runs no npm install and no turbo build', () => {
            for (const step of steps) {
                expect(commandsOf(step), step.name).not.toMatch(/\bnpm\s+(?:ci|install|i)\b|\bturbo\b/u);
            }
        });

        it('restores no node_modules cache', () => {
            for (const step of steps.filter((candidate) => /^actions\/cache/u.test(candidate.uses ?? ''))) {
                expect(scalarText(step.with?.['path']), step.name).not.toMatch(/node_modules/u);
            }
        });

        it('sets Node up with the package-manager cache OFF and no cache input', () => {
            const setups = steps.filter((step) => /^actions\/setup-node@/u.test(step.uses ?? ''));

            expect(setups).toHaveLength(1);
            expect(scalarText(setups[0]?.with?.['package-manager-cache'])).toBe('false');
            expect(setups[0]?.with?.['cache']).toBeUndefined();
        });
    });

    describe('⛔ runs every CLI through the door, and only one the bundle declares', () => {
        it('never runs tsx or npx', () => {
            for (const step of steps) {
                expect(commandsOf(step), step.name).not.toMatch(/\bnpx\b|\btsx\b/u);
            }
        });

        it('launches each CLI source by `bash runCli.sh <source>`, and every one is declared by cliBundle.mjs', () => {
            const launched = steps.flatMap((step) => commandsOf(step).match(CLI_SOURCE) ?? []);

            expect(launched.length, 'no step launches a CLI (non-vacuity)').toBeGreaterThan(0);

            for (const step of steps) {
                const commands = commandsOf(step);

                for (const source of commands.match(CLI_SOURCE) ?? []) {
                    expect(commands, `${step.name ?? '(unnamed)'} runs ${source} outside the door`).toContain(
                        `bash ${DOOR} ${source}`,
                    );
                    expect(declaredSources, `${source} is not bundled by cliBundle.mjs`).toContain(source);
                }
            }
        });
    });

    describe('⛔ uses this run’s bundles, verified before the first CLI', () => {
        it('downloads them, then verifies them, before the first CLI — both behind the secrets valve', () => {
            expect(download, 'no download of the seed CLI bundles').toBeGreaterThan(-1);
            expect(verify).toBe(download + 1);
            expect(verify).toBeLessThan(firstCli);
            expect(scalarText(steps[download]?.if)).toMatch(VALVE);
            expect(scalarText(steps[verify]?.if)).toMatch(VALVE);
        });

        it('names, literally, the bundles a job it needs uploads — from this run only', () => {
            const step = steps[download];
            const name = scalarText(step?.with?.['name']);
            const producers = needsOf(job).filter((needed) =>
                (jobs[needed]?.steps ?? []).some(
                    (candidate) =>
                        /^actions\/upload-artifact@/u.test(candidate.uses ?? '') &&
                        scalarText(candidate.with?.['path']) === BUNDLE_DIR &&
                        scalarText(candidate.with?.['name']) === name,
                ),
            );

            expect(name).toMatch(/^[\w.-]+$/u);
            expect(producers, `no job in needs uploads the bundles as '${name}'`).toStrictEqual([PRODUCER]);

            for (const input of ['run-id', 'github-token', 'repository']) {
                expect(step?.with?.[input], `${input} would fetch bundles another run built`).toBeUndefined();
            }
        });

        it('lets nothing but the verify step set E2E_SEED_CLI_DIR', () => {
            expect(job.env?.['E2E_SEED_CLI_DIR']).toBeUndefined();

            steps.forEach((step, index) => {
                expect(step.env?.['E2E_SEED_CLI_DIR'], step.name).toBeUndefined();

                if (index !== verify) {
                    expect(commandsOf(step), step.name).not.toMatch(/E2E_SEED_CLI_DIR=/u);
                }
            });
        });

        /**
         * Run the verify step's own body under bash, from the repository root (it calls the real door), over a bundle
         * directory whose manifest names `manifestCommit`.
         *
         * @sideEffect Writes a scratch directory and spawns bash.
         */
        function runVerify(manifestCommit: string): {
            readonly status: number;
            readonly log: string;
            readonly env: string;
        } {
            const temp = mkdtempSync(join(tmpdir(), 'maestro-seed-verify-'));

            scratch.push(temp);
            mkdirSync(join(temp, 'seedCli'));
            writeFileSync(
                join(temp, 'seedCli', 'seedCli.manifest'),
                `commit ${manifestCommit}\nentry packages/tools/e2e-seed/src/reset.ts reset.mjs\n`,
            );
            writeFileSync(join(temp, 'seedCli', 'reset.mjs'), '');
            writeFileSync(join(temp, 'env'), '');

            const result = spawnSync(
                'bash',
                ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', commandsOf(steps[verify] ?? {})],
                {
                    cwd: REPO_ROOT,
                    encoding: 'utf8',
                    env: {
                        PATH: process.env['PATH'] ?? '',
                        RUNNER_TEMP: temp,
                        GITHUB_SHA: 'a'.repeat(40),
                        GITHUB_ENV: join(temp, 'env'),
                    },
                },
            );

            return {
                status: result.status ?? -1,
                log: `${result.stdout}${result.stderr}`,
                env: readFileSync(join(temp, 'env'), 'utf8'),
            };
        }

        it('exports E2E_SEED_CLI_DIR when the bundles were built from this commit', () => {
            const temp = runVerify('a'.repeat(40));

            expect(temp.status, temp.log).toBe(0);
            expect(temp.env).toMatch(/^E2E_SEED_CLI_DIR=\/.+\/seedCli$/mu);
        });

        it('⛔ fails, and exports nothing, when they were built from another commit', () => {
            const temp = runVerify('b'.repeat(40));

            expect(temp.status).not.toBe(0);
            expect(temp.env).toBe('');
        });
    });
});

describe('⛔ the producer builds the bundles from this commit, after its install, and uploads what it built', () => {
    const producer = jobs[PRODUCER];
    const steps = producer?.steps ?? [];
    const buildIndex = steps.findIndex((step) =>
        /node packages\/tools\/e2e-seed\/cliBundle\.mjs/u.test(commandsOf(step)),
    );
    const build = steps[buildIndex];
    const upload = steps.find(
        (step) => /^actions\/upload-artifact@/u.test(step.uses ?? '') && scalarText(step.with?.['path']) === BUNDLE_DIR,
    );

    it('builds from ${GITHUB_SHA} into the uploaded directory, unconditionally, after restoring the install', () => {
        const restore = steps.findIndex(
            (step) =>
                /^actions\/cache(?:\/restore)?@/u.test(step.uses ?? '') &&
                /node_modules/u.test(scalarText(step.with?.['path'])),
        );

        expect(buildIndex, 'the producer does not run cliBundle.mjs').toBeGreaterThan(-1);
        expect(commandsOf(build ?? {})).toMatch(/--outdir "\$\{RUNNER_TEMP\}\/seedCli"/u);
        expect(commandsOf(build ?? {})).toMatch(/--commit "\$\{GITHUB_SHA\}"/u);
        expect(build?.if).toBeUndefined();
        expect(restore).toBeGreaterThan(-1);
        expect(restore).toBeLessThan(buildIndex);
    });

    it('uploads them unconditionally, overwriting, and fails on an empty directory', () => {
        expect(upload, 'the producer does not upload the bundles').toBeDefined();
        expect(upload?.if).toBeUndefined();
        expect(scalarText(upload?.with?.['overwrite'])).toBe('true');
        expect(scalarText(upload?.with?.['if-no-files-found'])).toBe('error');
    });
});

describe('⛔ runMaestroFlows.sh resets through ONE function, and runs no other Node', () => {
    const commands = scriptCommands(readFileSync(FLOW_SCRIPT, 'utf8'));
    const body = /^maestro_seed_reset\(\) \{\n([\s\S]*?)^\}/mu.exec(commands)?.[1] ?? '';
    const outside = commands.replace(body, '');

    it('defines maestro_seed_reset, which launches reset.ts through the door', () => {
        expect(body).toContain(`bash ${DOOR} packages/tools/e2e-seed/src/reset.ts`);
    });

    it('calls the door nowhere else, and never npx, tsx or a CLI source directly', () => {
        expect(outside).not.toContain('runCli.sh');
        expect(outside).not.toMatch(/\bnpx\b|\btsx\b|e2e-(?:seed|fixtures)\/src\//u);
        expect(body.match(/runCli\.sh/gu)).toHaveLength(1);
    });

    it('the flow loop resets through it', () => {
        expect(outside).toMatch(/\bmaestro_seed_reset\b/u);
    });

    it('launches a source cliBundle.mjs declares', () => {
        expect(declaredSources).toContain('packages/tools/e2e-seed/src/reset.ts');
    });
});
