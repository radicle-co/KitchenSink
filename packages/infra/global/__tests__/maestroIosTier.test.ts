// @vitest-environment node
/**
 * Repo-wide guard: the iOS Simulator Maestro job — the Android tier's twin on the other platform — is gated,
 * targeted and pinned exactly as tightly, and costs nothing it should not.
 *
 * ## What is pinned here, and what is pinned elsewhere
 *
 * The rules the iOS job SHARES with the Android job are asserted where they already live, over EVERY Maestro
 * job: the sandbox-only refusal (`maestroStageGuard`), the in-job liveness re-probe (`maestroRerunLiveness`),
 * the per-shard pool lease, the shard hand-off and the platform-sized matrix (`maestroShardPartition`), the
 * pool resets (`testPoolWorkflowWiring`), the selector hand-off (`maestroFlowSelection`), the pinned CLI
 * (`workflowProvenance`), and which flows iOS cannot run (`maestroPlatformExclusions`). This file pins what is
 * NEW with iOS:
 *
 *   1. **The runner is a STANDARD macOS runner, named by version.** The repository is public, where GitHub's
 *      standard runners cost nothing and its larger runners (`-large`, `-xlarge`, and the `-intel` labels that
 *      map onto them) are ALWAYS billed. `macos-latest` is refused too: it migrates to a new OS without a diff.
 *   2. **The toolchain is pinned by NAME and refused when absent** — the Xcode the build selects, and the
 *      device type and runtime the Simulator is created from. The simulator step is EXECUTED below against a
 *      stubbed `xcrun`, so "absent runtime → red, never another device" is a behaviour, not a reading.
 *   3. **The same gate as Android**, word for word: the job-level `if`, the `needs`, and every stateful step
 *      behind the secrets valve.
 *   4. **No value is put on an argv that the Android job keeps in env**: the deployed origins and the Clerk
 *      publishable key reach the build as step env, never as `xcodebuild KEY=value` arguments (argv is logged).
 *   5. **Caching that cannot go stale**: only content-addressed downloads, keyed first on the lockfile hash
 *      (`cachePrune.yml` reads the FIRST 64-hex run of a key as its lockfile hash), never DerivedData.
 *
 * Mutation evidence: written before the iOS job existed; every case failed on "_ci-heavy.yml has no
 * e2e-mobile-maestro-ios job".
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';

import { scalarText } from './workflowScalar.js';

const WORKFLOW = fileURLToPath(new URL('../../../../.github/workflows/_ci-heavy.yml', import.meta.url));
const ANDROID_JOB = 'e2e-mobile-maestro';
const IOS_JOB = 'e2e-mobile-maestro-ios';

interface Step {
    readonly name?: string;
    readonly id?: string;
    readonly if?: unknown;
    readonly uses?: string;
    readonly run?: unknown;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly with?: Readonly<Record<string, unknown>>;
    readonly 'continue-on-error'?: unknown;
}

interface Job {
    readonly name?: unknown;
    readonly 'runs-on'?: unknown;
    readonly 'timeout-minutes'?: unknown;
    readonly if?: unknown;
    readonly needs?: readonly string[];
    readonly env?: Readonly<Record<string, unknown>>;
    readonly steps?: readonly Step[];
}

const workflow = parse(readFileSync(WORKFLOW, 'utf8')) as { readonly jobs?: Readonly<Record<string, Job>> };
const ios = workflow.jobs?.[IOS_JOB];
const android = workflow.jobs?.[ANDROID_JOB];
const steps = ios?.steps ?? [];

const scratch: string[] = [];

afterAll(() => {
    for (const directory of scratch) {
        rmSync(directory, { recursive: true, force: true });
    }
});

/** The first step whose `run:` matches, with its index. */
function stepRunning(pattern: RegExp): { readonly step: Step | undefined; readonly index: number } {
    const index = steps.findIndex((step) => pattern.test(scalarText(step.run)));

    return { step: steps[index], index };
}

/** The step a `${{ steps.<id>.outputs.<name> }}` reference points at. */
function producerOf(reference: string): Step | undefined {
    const id = /\$\{\{ steps\.(\w+)\.outputs\.\w+ \}\}/u.exec(reference)?.[1];

    return steps.find((step) => step.id === id);
}

describe('the iOS job exists, and is named and declared like every e2e job', () => {
    it('exists', () => {
        expect(ios, `_ci-heavy.yml has no ${IOS_JOB} job`).toBeDefined();
    });

    it('has a CONSTANT name that says E2E and iOS, and declares the DEPLOYED target', () => {
        const name = scalarText(ios?.name);

        expect(name).not.toContain('${{');
        expect(name).toMatch(/^E2E \(mobile — Maestro on an iOS Simulator/u);
        expect(ios?.env?.['E2E_TARGET']).toBe('deployed');
    });
});

describe('⛔ the runner is a free STANDARD macOS runner, named by version', () => {
    it('is `macos-<N>` exactly — no larger-runner suffix, no `-latest`, no expression', () => {
        const label = scalarText(ios?.['runs-on']);

        expect(label, 'larger runners are always billed, even on a public repository').not.toMatch(
            /-(?:large|xlarge|intel)\b/u,
        );
        expect(label, '`macos-latest` migrates to a new OS without a diff').not.toMatch(/latest/u);
        expect(label).toMatch(/^macos-\d+$/u);
    });

    it('bounds its own runtime — a hung Simulator would otherwise hold the SHARED pool lane for six hours', () => {
        const minutes = Number(scalarText(ios?.['timeout-minutes']));

        expect(minutes).toBeGreaterThan(0);
        expect(minutes).toBeLessThanOrEqual(180);
    });
});

describe('the same gate as the Android job, word for word', () => {
    it('runs on the same job-level condition and the same needs', () => {
        expect(scalarText(ios?.if)).toBe(scalarText(android?.if));
        expect(ios?.needs).toEqual(android?.needs);
    });

    it('binds the same job-level STAGE from the resolver', () => {
        expect(ios?.env?.['STAGE']).toBe(android?.env?.['STAGE']);
    });

    it('puts every stateful step behind the secrets valve (or makes it a failure-only diagnostic)', () => {
        const secrets = steps.findIndex((step) => /load-secrets/u.test(step.uses ?? ''));

        expect(secrets, 'no load-secrets step').toBeGreaterThan(-1);

        for (const step of steps.slice(secrets + 1)) {
            const condition = scalarText(step.if);

            expect(
                /steps\.secrets\.outcome == 'success'/u.test(condition) || condition === 'failure()',
                `${step.name ?? '(unnamed)'} runs outside the secrets valve: if=${condition || '(none)'}`,
            ).toBe(true);
        }
    });

    it('never soft-launches: no step that builds or runs the app may continue on error', () => {
        for (const step of steps) {
            if (/xcodebuild|runMaestroFlows\.sh|simctl\s+create/u.test(scalarText(step.run))) {
                expect(step['continue-on-error'], `${step.name ?? '(unnamed)'} is continue-on-error`).toBeUndefined();
            }
        }
    });

    it('expands no secret into any shell body', () => {
        for (const step of steps) {
            expect(scalarText(step.run), `${step.name ?? '(unnamed)'}`).not.toMatch(/\$\{\{\s*secrets\./u);
        }
    });
});

describe('⛔ the toolchain is pinned by name and refused when absent', () => {
    it('selects one Xcode by its versioned path, for every step of the job', () => {
        expect(scalarText(ios?.env?.['DEVELOPER_DIR'])).toMatch(
            /^\/Applications\/Xcode_\d+\.\d+(?:\.\d+)?\.app\/Contents\/Developer$/u,
        );
    });

    it('names the Simulator device type and runtime as literals', () => {
        expect(scalarText(ios?.env?.['IOS_SIMULATOR_DEVICE'])).toMatch(/^iPhone \d+/u);
        expect(scalarText(ios?.env?.['IOS_SIMULATOR_RUNTIME'])).toMatch(/^iOS \d+\.\d+$/u);
    });

    /**
     * Execute the simulator step's own body with `xcrun` stubbed, under each answer the image could give.
     *
     * @sideEffect Writes stubs and a script to a scratch directory and spawns bash.
     */
    function runSimulatorStep(runtimes: readonly { name: string; identifier: string; isAvailable: boolean }[]): {
        readonly status: number;
        readonly output: string;
        readonly githubOutput: string;
        readonly calls: string;
    } {
        const { step } = stepRunning(/simctl\s+create/u);
        const dir = mkdtempSync(join(tmpdir(), 'maestro-ios-simulator-'));

        scratch.push(dir);

        const calls = join(dir, 'calls.log');
        const outputFile = join(dir, 'github_output');
        const devicetypes = { devicetypes: [{ name: 'iPhone 17', identifier: 'dt.iPhone-17' }] };

        writeFileSync(join(dir, 'runtimes.json'), JSON.stringify({ runtimes }));
        writeFileSync(join(dir, 'devicetypes.json'), JSON.stringify(devicetypes));
        writeFileSync(
            join(dir, 'xcrun'),
            [
                '#!/usr/bin/env bash',
                `printf '%s\\n' "$*" >> "${calls}"`,
                `case "$*" in`,
                `  'simctl list runtimes -j') cat "${join(dir, 'runtimes.json')}" ;;`,
                `  'simctl list devicetypes -j') cat "${join(dir, 'devicetypes.json')}" ;;`,
                `  simctl\\ create*) echo 'UDID-FROM-CREATE' ;;`,
                'esac',
                'exit 0',
            ].join('\n'),
        );
        writeFileSync(join(dir, 'defaults'), `#!/usr/bin/env bash\nprintf 'defaults %s\\n' "$*" >> "${calls}"\n`);
        chmodSync(join(dir, 'xcrun'), 0o755);
        chmodSync(join(dir, 'defaults'), 0o755);
        writeFileSync(outputFile, '');
        writeFileSync(join(dir, 'step.sh'), scalarText(step?.run));

        const env: Record<string, string> = {
            PATH: `${dir}:${process.env['PATH'] ?? ''}`,
            HOME: dir,
            GITHUB_OUTPUT: outputFile,
            GITHUB_RUN_ID: '1',
            IOS_SIMULATOR_DEVICE: scalarText(ios?.env?.['IOS_SIMULATOR_DEVICE']),
            IOS_SIMULATOR_RUNTIME: scalarText(ios?.env?.['IOS_SIMULATOR_RUNTIME']),
        };

        for (const [key, value] of Object.entries(step?.env ?? {})) {
            if (!scalarText(value).includes('${{')) {
                env[key] = scalarText(value);
            }
        }

        env['SHARD_INDEX'] = '1';

        const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', 'step.sh'], {
            cwd: dir,
            encoding: 'utf8',
            env,
        });

        return {
            status: result.status ?? -1,
            output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
            githubOutput: readFileSync(outputFile, 'utf8'),
            calls: readFileSync(calls, 'utf8'),
        };
    }

    it('creates and boots the pinned device on the pinned runtime, and publishes its UDID', () => {
        const runtime = scalarText(ios?.env?.['IOS_SIMULATOR_RUNTIME']);
        const outcome = runSimulatorStep([
            { name: 'iOS 26.2', identifier: 'rt.iOS-26-2', isAvailable: true },
            { name: runtime, identifier: 'rt.pinned', isAvailable: true },
        ]);

        expect(outcome.status, outcome.output).toBe(0);
        expect(outcome.calls).toMatch(/^simctl create \S+ dt\.iPhone-17 rt\.pinned$/mu);
        expect(outcome.calls).toMatch(/^simctl boot UDID-FROM-CREATE$/mu);
        expect(outcome.githubOutput).toMatch(/^udid=UDID-FROM-CREATE$/mu);
        // The keyboard settings are written BEFORE the boot — the keyboard reads them as the device starts.
        expect(outcome.calls.indexOf('defaults write')).toBeGreaterThan(-1);
        expect(outcome.calls.indexOf('defaults write')).toBeLessThan(outcome.calls.indexOf('simctl boot'));
    });

    it('⛔ REFUSES when the pinned runtime is absent or unavailable — never "whatever iPhone is there"', () => {
        const runtime = scalarText(ios?.env?.['IOS_SIMULATOR_RUNTIME']);

        for (const runtimes of [
            [{ name: 'iOS 26.2', identifier: 'rt.other', isAvailable: true }],
            [{ name: runtime, identifier: 'rt.pinned', isAvailable: false }],
        ]) {
            const outcome = runSimulatorStep(runtimes);

            expect(outcome.status, 'the step accepted a missing pinned runtime').not.toBe(0);
            expect(outcome.output).toMatch(/::error::/u);
            expect(outcome.calls).not.toMatch(/^simctl (?:create|boot)/mu);
        }
    });
});

describe('the build and the run', () => {
    // The build is the step that runs `xcodebuild -workspace`; the pin check also calls `xcodebuild -version`.
    const build = stepRunning(/xcodebuild\s+-workspace/u);
    const flows = stepRunning(/runMaestroFlows\.sh/u);

    it('builds a RELEASE app for the Simulator SDK, from a fresh prebuild, before the flows run', () => {
        const body = scalarText(build.step?.run);

        expect(body).toMatch(/expo prebuild --platform ios --no-install/u);
        expect(body).toMatch(/-configuration Release/u);
        expect(body).toMatch(/-sdk iphonesimulator/u);
        expect(build.index).toBeGreaterThan(-1);
        expect(build.index).toBeLessThan(flows.index);
    });

    it('hands the build the same origins and key as the Android build — as ENV, never on the xcodebuild argv', () => {
        const androidBuild = (android?.steps ?? []).find((step) => /assembleRelease/u.test(scalarText(step.run)));

        for (const key of Object.keys(androidBuild?.env ?? {})) {
            expect(build.step?.env?.[key], `${key} differs from the Android build`).toBe(androidBuild?.env?.[key]);
        }

        expect(scalarText(build.step?.run)).not.toMatch(/\b(?:EXPO_PUBLIC_|SENTRY_)[A-Z_]*=/u);
        expect(scalarText(build.step?.run)).not.toContain('${{');
    });

    it('fails the build loudly when the app bundle is not exactly one', () => {
        expect(scalarText(build.step?.run)).toMatch(/::error::[^\n]*\.app/u);
    });

    it('runs the flows for iOS, on the Simulator and app the earlier steps produced', () => {
        const env = flows.step?.env ?? {};

        expect(env['MAESTRO_PLATFORM']).toBe('ios');
        expect(producerOf(scalarText(env['MAESTRO_IOS_UDID']))?.run).toMatch(/simctl\s+create/u);
        expect(producerOf(scalarText(env['MAESTRO_IOS_APP']))?.run).toMatch(/xcodebuild\s+-workspace/u);
        expect(scalarText(flows.step?.run)).toBe('bash packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');
    });

    it('uploads its report under a name the Android shards cannot also claim', () => {
        const upload = (job: Job | undefined): string =>
            scalarText((job?.steps ?? []).find((step) => /upload-artifact@/u.test(step.uses ?? ''))?.with?.['name']);

        expect(upload(ios)).toMatch(/matrix\.shard/u);
        expect(upload(ios)).not.toBe(upload(android));
    });
});

/**
 * The env names `load-secrets` puts in `$GITHUB_ENV` that are SECRET — read out of the action itself, so a secret
 * added there is covered here without anyone remembering to list it — plus the credentials its own
 * `aws-actions/configure-aws-credentials` step exports for every later step.
 */
function secretEnvNames(): readonly string[] {
    const action = readFileSync(
        fileURLToPath(new URL('../../../../.github/actions/load-secrets/action.yml', import.meta.url)),
        'utf8',
    );
    const written = [...action.matchAll(/^\s*echo "([A-Z_]+)=\$[A-Z_]+"/gmu)].map((match) => match[1] ?? '');
    const secret = written.filter((name) => /SECRET/u.test(name));

    expect(written.length, 'load-secrets no longer writes the shape this guard reads').toBeGreaterThan(0);
    expect(action, 'load-secrets no longer configures AWS credentials').toMatch(/configure-aws-credentials@/u);

    return [...new Set([...secret, 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'])];
}

/**
 * ⛔ A SECRET MUST NOT REACH A FILE THIS PUBLIC REPOSITORY UPLOADS. `load-secrets` writes the Clerk secret key and
 * webhook secrets to `$GITHUB_ENV`, so every later step's process inherits them; `xcodebuild` imports its
 * environment as BUILD SETTINGS and echoes them (`export NAME=value`) ahead of every script phase. GitHub masks
 * the CONSOLE, not a file — and a run artifact of a public repository is downloadable by any signed-in user.
 */
describe('⛔ no secret reaches the build, and no unmasked log leaves the runner', () => {
    it('the build step unsets every secret the job holds, before it builds anything', () => {
        const body = scalarText(steps.find((step) => /xcodebuild\s+-workspace/u.test(scalarText(step.run)))?.run);
        const unsetLine = body.split('\n').find((line) => /^\s*unset\s/u.test(line)) ?? '';
        const unset = new Set(unsetLine.trim().split(/\s+/u).slice(1));

        for (const name of secretEnvNames()) {
            expect(unset.has(name), `the build step does not unset ${name}`).toBe(true);
        }

        expect(body.indexOf(unsetLine), 'the unset must come before the prebuild').toBeLessThan(
            body.indexOf('expo prebuild'),
        );
    });

    it('uploads no build log and no XCTest-runner log — their unmasked copies stay on the runner', () => {
        const upload = steps.find((step) => /upload-artifact@/u.test(step.uses ?? ''));
        const paths = scalarText(upload?.with?.['path'])
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        expect(paths.filter((path) => !path.startsWith('!') && /\.log\b/u.test(path))).toEqual([]);
        expect(paths, 'the Maestro report must exclude the XCTest runner log').toContain(
            '!~/.maestro/tests/**/xctest_runner_*.log',
        );
    });

    it('builds the Simulator architecture only — Release otherwise compiles every architecture', () => {
        expect(scalarText(steps.find((step) => /xcodebuild\s+-workspace/u.test(scalarText(step.run)))?.run)).toMatch(
            /ONLY_ACTIVE_ARCH=YES/u,
        );
    });
});

describe('⛔ caching cannot go stale and cannot escape the prune', () => {
    const caches = steps.filter((step) => /actions\/cache(?:\/(?:restore|save))?@/u.test(step.uses ?? ''));

    it('restores no Linux node_modules cache — a different OS can never hit it, and the miss would be a false warning', () => {
        for (const step of caches) {
            expect(scalarText(step.with?.['path'])).not.toMatch(/node_modules/u);
        }
    });

    it('keys every cache FIRST on the lockfile hash, and never caches DerivedData or a build product', () => {
        for (const step of caches) {
            const key = scalarText(step.with?.['key']);

            expect(key).toMatch(/^\$\{\{ runner\.os \}\}-[a-z]+-\$\{\{ hashFiles\('package-lock\.json'\) \}\}/u);
            expect(scalarText(step.with?.['path'])).not.toMatch(/DerivedData|derived|\/build\b|\.app\b/iu);
        }
    });
});
