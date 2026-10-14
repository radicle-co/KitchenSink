// @vitest-environment node
/**
 * Repo-wide guard: the mobile TEST APP is built ONCE per platform, in `_mobileAppBuild.yml`, and every Maestro shard
 * consumes that build or refuses to run.
 *
 * ## The measurement and the ruling this exists for (2026-10-13)
 *
 * Run 38322183404 built the app once PER SHARD: 18.4 and 14.3 minutes on Android (four ABIs, of which the one emulator
 * needs one), 17.5 and 26.2 on iOS, each after a fresh `npm ci`. The owner ruled: "Do all three" (own iOS lanes, build
 * once per platform, four shards per platform), "Do 2 and 3" (reuse a build whose inputs did not change; make rebuilds
 * faster), "Do item 1 too" (the CI APK builds `x86_64` only). So the build moved into a job that runs BESIDE the deploy
 * (36.6 minutes on that run), and the shards download its artifact.
 *
 * ## What these tests hold, and why each is a guard rather than a reading
 *
 *   - Every caller that turns Maestro on through `deployedE2eTiers.yml` has a build job and relays its two outputs.
 *     A caller without one would hand the shards an empty name — which is a red, not a skipped tier, by design.
 *   - The build job runs under EXACTLY the condition that decides whether Maestro runs. A build that could be skipped
 *     while Maestro runs, or run when Maestro does not, is either a red or ~25 wasted runner-minutes.
 *   - ⛔ The tiers job NEVER gates on the build. A failed build would otherwise SKIP every deployed tier, and a skip
 *     renders green: the exact absence-of-work-behind-a-status class this repository has paid for. The shards' own
 *     refusal makes a missing app red instead.
 *   - No shard builds. `gradlew`, `xcodebuild … build` and `expo prebuild` appear in `buildTestApp.sh` and nowhere in
 *     `_ci-heavy.yml`, so the per-shard build cannot quietly return.
 *   - The refusal is EXECUTED (empty input -> red, set -> proceeds) and sits where it must: after the stage refusal,
 *     before the first checkout. The download and the manifest verification sit before the first pool reset, so a wrong
 *     app is refused before a Clerk slot is touched.
 *   - The Xcode path is one literal in two files, because the content key hashes it and a build job on a different
 *     Xcode than the shards would produce a binary the shards' manifest check cannot place.
 *
 * Pattern: Guard clause (the shard refusals) over a Cache-aside of content-addressed artifacts (the build workflow).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';

import { scalarText } from './workflowScalar.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKFLOWS = join(REPO_ROOT, '.github/workflows');
const BUILD_WORKFLOW = '_mobileAppBuild.yml';
const SCRIPT = join(REPO_ROOT, 'packages/apps/commise/mobile/scripts/buildTestApp.sh');

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
    readonly name?: unknown;
    readonly if?: unknown;
    readonly uses?: string;
    readonly needs?: string | readonly string[];
    readonly with?: Readonly<Record<string, unknown>>;
    readonly permissions?: Readonly<Record<string, string>>;
    readonly env?: Readonly<Record<string, unknown>>;
    readonly outputs?: Readonly<Record<string, unknown>>;
    readonly steps?: readonly Step[];
}

interface Workflow {
    readonly env?: Readonly<Record<string, unknown>>;
    readonly on?: Record<
        string,
        { readonly inputs?: Record<string, { readonly type?: string; readonly default?: unknown }> }
    >;
    readonly jobs?: Readonly<Record<string, Job>>;
}

const read = (file: string): Workflow => parse(readFileSync(join(WORKFLOWS, file), 'utf8')) as Workflow;

const needsOf = (job: Job | undefined): readonly string[] =>
    job?.needs === undefined ? [] : typeof job.needs === 'string' ? [job.needs] : job.needs;

/** A step's shell with comment lines removed — a comment naming `gradlew` is documentation, not a call. */
const commands = (step: Step): string =>
    scalarText(step.run)
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');

const heavy = read('_ci-heavy.yml');
const build = read(BUILD_WORKFLOW);

/** The two Maestro shard jobs and the platform each one drives. */
const SHARD_JOBS = [
    { job: 'e2e-mobile-maestro', platform: 'android', input: 'android_test_app' },
    { job: 'e2e-mobile-maestro-ios', platform: 'ios', input: 'ios_test_app' },
] as const;

/** Every workflow that calls `deployedE2eTiers.yml`, and the job that does. */
function tierCallers(): readonly { readonly file: string; readonly name: string; readonly workflow: Workflow }[] {
    return ['_ci.yml', 'deployedE2e.yml'].flatMap((file) => {
        const workflow = read(file);

        return Object.entries(workflow.jobs ?? {})
            .filter(([, job]) => (job.uses ?? '').endsWith('/deployedE2eTiers.yml'))
            .map(([name]) => ({ file, name, workflow }));
    });
}

describe('every door to the Maestro tier builds the apps and hands the shards their names', () => {
    const callers = tierCallers();

    it('finds both doors (non-vacuity): the pull-request pipeline and the manual dispatch', () => {
        expect(callers.map(({ file }) => file).sort()).toEqual(['_ci.yml', 'deployedE2e.yml']);
    });

    it.each(callers.map((caller) => [caller.file, caller] as const))(
        '⛔ %s has a build job that calls _mobileAppBuild.yml and relays BOTH outputs into the tiers',
        (_, caller) => {
            const jobs = caller.workflow.jobs ?? {};
            const builders = Object.entries(jobs).filter(([, job]) => (job.uses ?? '').endsWith(`/${BUILD_WORKFLOW}`));

            expect(builders, `${caller.file} calls ${BUILD_WORKFLOW} nowhere`).toHaveLength(1);

            const [builderName] = builders[0] ?? [''];
            const tiers = jobs[caller.name];

            expect(needsOf(tiers), 'the tiers job must wait for the build, or its outputs are empty').toContain(
                builderName,
            );

            for (const platform of ['android', 'ios']) {
                expect(scalarText(tiers?.with?.[`${platform}_test_app`])).toBe(
                    `\${{ needs.${builderName}.outputs.${platform}_test_app }}`,
                );
            }
        },
    );

    /**
     * The build must run when Maestro runs and only then. The tiers job turns Maestro on with `run_mobile_maestro`; the
     * build job's `if:` must therefore CONTAIN that same expression, character for character, so the two can never
     * name different labels or different switches. (Derived from the tiers job — it states no label of its own.)
     */
    it.each(callers.map((caller) => [caller.file, caller] as const))(
        '⛔ %s: the build job’s condition contains the SAME expression that switches Maestro on',
        (_, caller) => {
            const jobs = caller.workflow.jobs ?? {};
            const [, builder] =
                Object.entries(jobs).find(([, job]) => (job.uses ?? '').endsWith(`/${BUILD_WORKFLOW}`)) ?? [];
            const switchExpression = /^\$\{\{\s*(.*?)\s*\}\}$/su.exec(
                scalarText(jobs[caller.name]?.with?.['run_mobile_maestro']),
            )?.[1];

            expect(switchExpression, 'the tiers job states no run_mobile_maestro expression').toBeTruthy();
            expect(scalarText(builder?.if).replace(/\s+/gu, ' ')).toContain(switchExpression?.replace(/\s+/gu, ' '));
        },
    );

    it('the pull-request build job also requires the deploy gate and a resolved stage, so it never builds for nothing', () => {
        const ci = read('_ci.yml').jobs ?? {};
        const condition = scalarText(ci['mobile-app-build']?.if);

        expect(condition).toContain("needs.sandbox-status.outputs.branch == 'run'");
        expect(condition).toContain("needs.resolve-sandbox.outputs.stage != ''");
    });

    /**
     * `build-ui` is NOT a need (reviewer, 2026-10-13): `_mobileAppBuild.yml` builds the app's whole dependency closure and
     * restores nothing `build-ui` produces, so waiting for it only delayed the start of a ~15-minute build. `install` IS
     * (it seeds the `node_modules` entry the build restores — `depsCacheOrdering.test.ts` holds that edge).
     */
    it('the pull-request build job waits for install and the gate, and NOT for build-ui', () => {
        const needs = needsOf(read('_ci.yml').jobs?.['mobile-app-build']);

        expect([...needs].sort()).toEqual(['install', 'resolve-sandbox', 'sandbox-status']);
    });

    it('the manual build job requires a live, non-production target', () => {
        const condition = scalarText(read('deployedE2e.yml').jobs?.['mobile-app-build']?.if);

        expect(condition).toContain("needs.resolve.outputs.live == 'true'");
        expect(condition).toContain("needs.resolve.outputs.stage != 'prod'");
    });

    /**
     * ⛔ THE TIERS JOB MUST NOT GATE ON THE BUILD'S RESULT. A skipped or failed dependency skips its dependents, and a
     * skipped job renders green. Every OTHER need is listed as `success` explicitly (so `!cancelled()` does not widen
     * what used to run), and the build is mentioned nowhere in the condition.
     */
    it.each(callers.map((caller) => [caller.file, caller] as const))(
        '⛔ %s: the tiers job runs under !cancelled(), names every other need explicitly, and never mentions the build',
        (_, caller) => {
            const jobs = caller.workflow.jobs ?? {};
            const [builderName] = Object.entries(jobs).find(([, job]) =>
                (job.uses ?? '').endsWith(`/${BUILD_WORKFLOW}`),
            ) ?? [''];
            const tiers = jobs[caller.name];
            const condition = scalarText(tiers?.if);

            expect(condition, 'without a status function a skipped build skips the tiers').toContain('!cancelled()');
            expect(condition, 'the tiers must not be gated on the build').not.toContain(builderName);

            for (const need of needsOf(tiers).filter((name) => name !== builderName)) {
                expect(
                    condition.includes(`needs.${need}.result == 'success'`) ||
                        condition.includes(`needs.${need}.outputs.`),
                    `${need} is a need of the tiers job that its condition does not state — !cancelled() would run it past a failure`,
                ).toBe(true);
            }
        },
    );

    /**
     * The two scopes the build needs and no more: `actions: read` to reuse an earlier run's app, and `id-token: write`
     * because its jobs sign in to AWS through `awsAuth` (ADR-0063) and a called workflow can only downgrade. Any other
     * scope here would be granted to a job that reads a Clerk key and uploads an artifact.
     */
    it('grants the build job the two extra scopes it needs, and no more', () => {
        for (const file of ['_ci.yml', 'deployedE2e.yml']) {
            const job = read(file).jobs?.['mobile-app-build'];

            expect(job?.permissions, `${file}::mobile-app-build`).toEqual({
                contents: 'read',
                actions: 'read',
                'id-token': 'write',
            });
        }
    });

    it('the callers of _ci.yml grant actions: read, because a callee can only downgrade (or the run is rejected)', () => {
        for (const file of ['ci-pr.yml', 'ci-main.yml', 'ci-full.yml']) {
            const callers = Object.entries(read(file).jobs ?? {}).filter(([, job]) =>
                (job.uses ?? '').endsWith('/_ci.yml'),
            );

            expect(callers, `${file} calls _ci.yml nowhere`).toHaveLength(1);
            expect(callers[0]?.[1].permissions?.['actions'], `${file}::${callers[0]?.[0]}`).toBe('read');
        }
    });
});

/**
 * ADDED 2026-10-13 (reviewer ruling, replacing an exemption this file briefly carried). Every workflow that calls
 * `_ci-heavy.yml` without going through the tiers file has no build job to hand the Maestro shards an app. It must say so
 * with a LITERAL `run_mobile_maestro: false` — which is what lets the artifact-pairing invariant clear the call site —
 * and must not offer a form field that could turn Maestro on without one. `deployedE2e.yml` is the manual door for Maestro.
 */
describe('a direct caller of _ci-heavy.yml switches Maestro off for good', () => {
    const direct = ['ci-full.yml', 'recipe-loadtest.yml'].map((file) => {
        const workflow = parse(readFileSync(join(WORKFLOWS, file), 'utf8')) as Workflow & {
            on?: { workflow_dispatch?: { inputs?: Record<string, unknown> } };
        };
        const calls = Object.entries(workflow.jobs ?? {}).filter(([, job]) =>
            (job.uses ?? '').endsWith('/_ci-heavy.yml'),
        );

        return { file, workflow, calls };
    });

    it.each(direct.map((caller) => [caller.file, caller] as const))(
        '%s passes the literal false and offers no Maestro input',
        (_, caller) => {
            expect(caller.calls.length, `${caller.file} calls _ci-heavy.yml nowhere`).toBeGreaterThan(0);

            for (const [name, job] of caller.calls) {
                expect(job.with?.['run_mobile_maestro'], `${caller.file}::${name}`).toBe(false);
            }

            expect(Object.keys(caller.workflow.on?.workflow_dispatch?.inputs ?? {})).not.toContain(
                'run_mobile_maestro',
            );
        },
    );

    it('ci-full.yml no longer gates its heavy job on a Maestro switch', () => {
        const heavy = parse(readFileSync(join(WORKFLOWS, 'ci-full.yml'), 'utf8')) as Workflow;

        expect(scalarText(heavy.jobs?.['heavy']?.if)).not.toMatch(/run_mobile_maestro/u);
    });
});

describe('deployedE2eTiers.yml relays the two names from its callers to the shards', () => {
    const tiers = read('deployedE2eTiers.yml');
    const maestro = tiers.jobs?.['e2e-mobile-maestro'];

    it.each(['android_test_app', 'ios_test_app'])('declares %s as a string input defaulting to empty', (name) => {
        const declared = tiers.on?.['workflow_call']?.inputs?.[name];

        expect(declared?.type).toBe('string');
        expect(scalarText(declared?.default)).toBe('');
    });

    it.each(['android_test_app', 'ios_test_app'])('passes %s on to _ci-heavy.yml untouched', (name) => {
        expect(scalarText(maestro?.with?.[name])).toBe(`\${{ inputs.${name} }}`);
    });

    it.each(['android_test_app', 'ios_test_app'])(
        '_ci-heavy.yml declares %s as a string input defaulting to empty',
        (name) => {
            const declared = heavy.on?.['workflow_call']?.inputs?.[name];

            expect(declared?.type).toBe('string');
            expect(scalarText(declared?.default)).toBe('');
        },
    );
});

describe('⛔ no shard builds an app: the recipe lives in buildTestApp.sh', () => {
    it('_ci-heavy.yml runs no gradlew, no xcodebuild build, no expo prebuild and no pod install', () => {
        const offenders = Object.entries(heavy.jobs ?? {}).flatMap(([name, job]) =>
            (job.steps ?? []).flatMap((step) =>
                /gradlew|expo prebuild|pod install|xcodebuild[^\n]*\bbuild\b|assembleRelease/u.test(commands(step))
                    ? [`${name}::${step.name ?? '(unnamed)'}`]
                    : [],
            ),
        );

        expect(offenders).toEqual([]);
    });

    it('_ci-heavy.yml caches no Gradle, no CocoaPods and no DerivedData', () => {
        const offenders = Object.entries(heavy.jobs ?? {}).flatMap(([name, job]) =>
            (job.steps ?? []).flatMap((step) =>
                /gradle|cocoapods|DerivedData/iu.test(
                    `${step.uses ?? ''} ${scalarText(step.with?.['path'])} ${scalarText(step.with?.['key'])}`,
                )
                    ? [`${name}::${step.name ?? '(unnamed)'}`]
                    : [],
            ),
        );

        expect(offenders).toEqual([]);
    });

    it('the build recipe IS in the script, so the guard above is not satisfied by deleting the build', () => {
        const script = readFileSync(SCRIPT, 'utf8');

        expect(script).toMatch(/gradlew :app:assembleRelease/u);
        expect(script).toMatch(/xcodebuild -workspace/u);
        expect(script).toMatch(/-PreactNativeArchitectures=/u);
    });

    it('the CI test APK is x86_64 only', () => {
        expect(readFileSync(SCRIPT, 'utf8')).toMatch(/^TEST_APP_ANDROID_ABIS='x86_64'$/mu);
    });
});

const scratch: string[] = [];

afterAll(() => {
    for (const directory of scratch) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe.each(SHARD_JOBS)('⛔ $job refuses to run without a built app, and verifies the one it is given', (wiring) => {
    const job = heavy.jobs?.[wiring.job];
    const steps = job?.steps ?? [];
    const indexOf = (predicate: (step: Step) => boolean): number => steps.findIndex(predicate);

    const stageRefusal = indexOf((step) => /Refuse any stage but sandbox/u.test(step.name ?? ''));
    const refusal = indexOf(
        (step) =>
            Object.values(step.env ?? {}).some((value) => scalarText(value) === `\${{ inputs.${wiring.input} }}`) &&
            /exit 1/u.test(commands(step)),
    );
    const firstCheckout = indexOf((step) => /^actions\/checkout@/u.test(step.uses ?? ''));
    const secrets = indexOf((step) => /load-secrets/u.test(step.uses ?? ''));
    const download = indexOf((step) => /^actions\/download-artifact@/u.test(step.uses ?? ''));
    const verification = indexOf((step) => /verify-manifest/u.test(commands(step)));
    const resetBefore = indexOf((step) => step.id === 'resetBefore');

    it('finds every step it orders (non-vacuity)', () => {
        for (const [label, index] of Object.entries({
            stageRefusal,
            refusal,
            firstCheckout,
            secrets,
            download,
            verification,
            resetBefore,
        })) {
            expect(index, `${wiring.job} has no ${label} step`).toBeGreaterThan(-1);
        }
    });

    it('refuses AFTER the stage refusal and BEFORE anything is fetched', () => {
        expect(refusal).toBeGreaterThan(stageRefusal);
        expect(refusal).toBeLessThan(firstCheckout);
    });

    /**
     * EXECUTED, not read: the step's own body with the input empty and then set. A body that tested the wrong variable,
     * or exited 0 on the empty case, would pass any reading of the YAML.
     */
    it('exits non-zero with a message that names the build job when the input is empty, and zero when it is set', () => {
        const step = steps[refusal];
        const variable = Object.entries(step?.env ?? {}).find(
            ([, value]) => scalarText(value) === `\${{ inputs.${wiring.input} }}`,
        )?.[0];

        expect(variable, 'the refusal step must read the input through its env').toBeTruthy();

        const dir = mkdtempSync(join(tmpdir(), 'mobile-test-app-refusal-'));

        scratch.push(dir);
        writeFileSync(join(dir, 'step.sh'), scalarText(step?.run));

        const run = (value: string) =>
            spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', 'step.sh'], {
                cwd: dir,
                encoding: 'utf8',
                env: { PATH: process.env['PATH'] ?? '', HOME: dir, [variable ?? 'TEST_APP']: value },
            });
        const empty = run('');
        const given = run(`commise-test-app-${wiring.platform}-4f684c1e9bbb30ad`);

        expect(empty.status, 'an empty test app name was accepted').not.toBe(0);
        expect(`${empty.stdout}${empty.stderr}`).toMatch(/::error::/u);
        expect(`${empty.stdout}${empty.stderr}`).toMatch(/mobile-app-build|_mobileAppBuild/u);
        expect(given.status, `${given.stdout}${given.stderr}`).toBe(0);
    });

    it('downloads the app AFTER the secrets valve and verifies it BEFORE the first pool reset', () => {
        expect(download).toBeGreaterThan(secrets);
        expect(verification).toBeGreaterThan(download);
        expect(verification).toBeLessThan(resetBefore);
    });

    it('downloads exactly the name the input carries, and lets the secrets valve gate both steps', () => {
        expect(scalarText(steps[download]?.with?.['name'])).toBe(`\${{ inputs.${wiring.input} }}`);
        expect(scalarText(steps[download]?.if)).toContain("steps.secrets.outcome == 'success'");
        expect(scalarText(steps[verification]?.if)).toContain("steps.secrets.outcome == 'success'");
    });

    it('verifies against what THIS run resolved: the three origins, the publishable key and the key in the name', () => {
        const step = steps[verification];
        const env = step?.env ?? {};

        expect(scalarText(env['EXPECT_RECIPE_ORIGIN'])).toBe(
            '${{ needs.resolve-mobile-target.outputs.recipe_origin }}',
        );
        expect(scalarText(env['EXPECT_FOOD_ORIGIN'])).toBe('${{ needs.resolve-mobile-target.outputs.food_origin }}');
        expect(scalarText(env['EXPECT_IDENTITY_ORIGIN'])).toBe(
            '${{ needs.resolve-mobile-target.outputs.identity_origin }}',
        );
        expect(scalarText(env['EXPECT_PUBLISHABLE_KEY'])).toBe('${{ env.EXPO_PUBLIC_IDP_PUBLISHABLE_KEY }}');
        expect(commands(step ?? {})).toMatch(/key-from-artifact-name/u);
    });

    it('never expands a secret into a shell body or onto an argv', () => {
        for (const step of steps) {
            expect(scalarText(step.run), step.name ?? '(unnamed)').not.toMatch(/\$\{\{\s*secrets\./u);
        }
    });
});

describe('the iOS shard unpacks a tarball into the .app the run step installs', () => {
    const steps = heavy.jobs?.['e2e-mobile-maestro-ios']?.steps ?? [];
    const flows = steps.find((step) => /runMaestroFlows\.sh/u.test(scalarText(step.run)));
    const unpack = steps.find((step) => step.id === 'app');

    it('has an unpack step that is the producer of MAESTRO_IOS_APP', () => {
        expect(scalarText(flows?.env?.['MAESTRO_IOS_APP'])).toBe('${{ steps.app.outputs.app }}');
        expect(commands(unpack ?? {})).toMatch(/tar -xzf/u);
    });

    it('unpacks AFTER the manifest has been verified, so an app that was refused is never unpacked', () => {
        const verification = steps.findIndex((step) => /verify-manifest/u.test(commands(step)));

        expect(steps.indexOf(unpack as Step)).toBeGreaterThan(verification);
    });
});

describe('the Android shard installs the downloaded APK', () => {
    it('hands the runner the downloaded file through MAESTRO_ANDROID_APK', () => {
        const steps = heavy.jobs?.['e2e-mobile-maestro']?.steps ?? [];
        const emulator = steps.find((step) => /android-emulator-runner@/u.test(step.uses ?? ''));

        expect(scalarText(emulator?.env?.['MAESTRO_ANDROID_APK'])).toBe('${{ runner.temp }}/testApp/app.apk');
    });

    it('the runner’s default stays the Gradle output path, for a developer’s own build', () => {
        expect(
            readFileSync(join(REPO_ROOT, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh'), 'utf8'),
        ).toMatch(
            /^APK="\$\{MAESTRO_ANDROID_APK:-packages\/apps\/commise\/mobile\/android\/app\/build\/outputs\/apk\/release\/app-release\.apk\}"$/mu,
        );
    });
});

describe('the build workflow itself', () => {
    const jobs = build.jobs ?? {};

    it('has the three jobs the callers and the tests expect, under CONSTANT names that claim no end-to-end tier', () => {
        expect(Object.keys(jobs).sort()).toEqual(['android', 'ios', 'plan']);

        for (const [key, job] of Object.entries(jobs)) {
            const name = scalarText(job.name);

            expect(name, key).not.toContain('${{');
            expect(name, `${key} must not claim the e2e tier`).not.toMatch(/e2e|end-to-end/iu);
        }
    });

    it('⛔ pins DEVELOPER_DIR to the same literal as the iOS shard — the Xcode path is part of the content key', () => {
        expect(scalarText(build.env?.['DEVELOPER_DIR'])).toMatch(
            /^\/Applications\/Xcode_\d+\.\d+(?:\.\d+)?\.app\/Contents\/Developer$/u,
        );
        expect(scalarText(build.env?.['DEVELOPER_DIR'])).toBe(
            scalarText(heavy.jobs?.['e2e-mobile-maestro-ios']?.env?.['DEVELOPER_DIR']),
        );
    });

    it('declares the cache epoch, which is the manual flush of every reused build', () => {
        expect(scalarText(build.env?.['TEST_APP_CACHE_EPOCH'])).toMatch(/^\d+$/u);
    });

    it('builds on a free standard runner: ubuntu for Android, a named macOS version for iOS', () => {
        expect(scalarText((jobs['android'] as unknown as { 'runs-on'?: unknown })['runs-on'])).toBe('ubuntu-latest');
        expect(scalarText((jobs['ios'] as unknown as { 'runs-on'?: unknown })['runs-on'])).toMatch(/^macos-\d+$/u);
    });

    it('reads the plan: each build needs it, and runs only when the plan is eligible and found nothing to reuse', () => {
        for (const platform of ['android', 'ios']) {
            const job = jobs[platform];

            expect(needsOf(job)).toEqual(['plan']);
            expect(scalarText(job?.if)).toContain("needs.plan.outputs.eligible == 'true'");
            expect(scalarText(job?.if)).toContain(`needs.plan.outputs.${platform}_reused == ''`);
        }
    });

    it('⛔ refuses to build when its key differs from the plan’s, BEFORE any build output exists', () => {
        for (const platform of ['android', 'ios']) {
            const steps = jobs[platform]?.steps ?? [];
            const compare = steps.findIndex(
                (step) => /content-key/u.test(commands(step)) && /exit 1/u.test(commands(step)),
            );
            const turboBuild = steps.findIndex((step) => /turbo run build/u.test(commands(step)));
            const recipe = steps.findIndex((step) =>
                new RegExp(`buildTestApp\\.sh ${platform}\\b`, 'u').test(commands(step)),
            );

            expect(compare, `${platform} has no key comparison`).toBeGreaterThan(-1);
            expect(compare).toBeLessThan(turboBuild);
            expect(turboBuild).toBeLessThan(recipe);
            expect(
                scalarText(steps[recipe]?.env?.['TEST_APP_CONTENT_KEY']),
                'the build must be told the key the plan named',
            ).toBe(`\${{ needs.plan.outputs.${platform}_key }}`);
        }
    });

    it('⛔ ships the iOS app as a TARBALL (upload-artifact drops the executable bit), with the manifest beside it', () => {
        const upload = (jobs['ios']?.steps ?? []).find((step) => /^actions\/upload-artifact@/u.test(step.uses ?? ''));

        expect(scalarText(upload?.with?.['path'])).toMatch(/dist-testApp\/ios\/?$/u);
        expect(readFileSync(SCRIPT, 'utf8')).toMatch(/tar -czf dist-testApp\/ios\/app\.tar\.gz/u);
    });

    it('⛔ every upload overwrites (a same-key rebuild must not red the job) and keeps the artifact seven days', () => {
        const uploads = Object.values(jobs).flatMap((job) =>
            (job.steps ?? []).filter((step) => /^actions\/upload-artifact@/u.test(step.uses ?? '')),
        );

        expect(uploads.length).toBeGreaterThanOrEqual(2);

        for (const upload of uploads) {
            expect(upload.with?.['overwrite'], upload.name ?? '(unnamed)').toBe(true);
            expect(Number(scalarText(upload.with?.['retention-days'])), upload.name ?? '(unnamed)').toBe(7);
            expect(upload.with?.['if-no-files-found'], 'an empty upload must be an error').toBe('error');
        }
    });

    it('each build job publishes the artifact name as an output from its LAST step', () => {
        for (const platform of ['android', 'ios']) {
            const job = jobs[platform];
            const last = (job?.steps ?? []).at(-1);

            expect(scalarText(job?.outputs?.['artifact'])).toBe(
                `\${{ steps.${last?.id ?? 'MISSING'}.outputs.artifact }}`,
            );
            expect(commands(last ?? {})).toMatch(/artifact=/u);
        }
    });

    it('publishes each platform’s reuse answer from a step that only runs when the earlier artifact was fetched', () => {
        const plan = jobs['plan'];

        for (const platform of ['android', 'ios']) {
            const Platform = platform === 'android' ? 'Android' : 'Ios';
            const reuse = (plan?.steps ?? []).find((step) => step.id === `reuse${Platform}`);

            expect(scalarText(plan?.outputs?.[`${platform}_reused`])).toBe(
                `\${{ steps.reuse${Platform}.outputs.name }}`,
            );
            expect(scalarText(reuse?.if), 'a reuse answer without a fetched artifact would name nothing').toContain(
                `steps.fetch${Platform}.outcome == 'success'`,
            );
        }
    });

    it('relays the plan’s reuse answer first and a build’s artifact second, for each platform', () => {
        const call = build.on?.['workflow_call'] as unknown as
            { outputs?: Record<string, { value?: unknown }> } | undefined;
        const outputs = call?.outputs;

        for (const platform of ['android', 'ios']) {
            expect(scalarText(outputs?.[`${platform}_test_app`]?.value)).toBe(
                `\${{ jobs.plan.outputs.${platform}_reused || jobs.${platform}.outputs.artifact }}`,
            );
        }
    });

    it('never builds under a stage other than sandbox, and never without AWS credentials (it SKIPS, which is not a failure)', () => {
        const plan = jobs['plan'];
        const decide = (plan?.steps ?? []).find((step) => step.id === 'eligible');

        expect(decide, 'the plan has no eligibility step').toBeDefined();
        expect(commands(decide ?? {})).toMatch(/eligible=false/u);
        expect(commands(decide ?? {})).toMatch(/exit 0/u);
        expect(scalarText(plan?.outputs?.['eligible'])).toBe('${{ steps.eligible.outputs.eligible }}');
    });
});

/**
 * REUSE (owner, 2026-10-13: "when the inputs of a built app did not change, reuse it"). The plan looks for an artifact
 * named for the content key, downloads it from the run that made it, and re-uploads it into THIS run so the shards fetch
 * by name from their own run. These are the wiring facts; the SELECTION rule (which artifact may stand in) is executed in
 * `buildTestAppManifest.test.ts` over fixtures, including a fork's.
 */
describe('the plan reuses an earlier build of the same content', () => {
    const plan = build.jobs?.['plan'];
    const steps = plan?.steps ?? [];

    it.each([
        ['android', 'Android'],
        ['ios', 'Ios'],
    ])(
        '⛔ %s: looks the artifact up by exact name, through the script’s selection, scoped to THIS repository',
        (platform, Platform) => {
            const lookup = steps.find((step) => step.id === `lookup${Platform}`);
            const body = commands(lookup ?? {});

            expect(lookup, `no lookup${Platform} step`).toBeDefined();
            expect(body).toMatch(/gh api "repos\/\$\{GITHUB_REPOSITORY\}\/actions\/artifacts\?name=\$\{NAME\}/u);
            expect(body, 'the selection must be the script’s, with the repository id').toMatch(
                /buildTestApp\.sh"? select-reusable "\$\{GITHUB_REPOSITORY_ID\}" "\$\{NAME\}"/u,
            );
            expect(scalarText(lookup?.env?.['NAME'])).toBe(`\${{ steps.keys.outputs.${platform}_name }}`);
            expect(scalarText(lookup?.env?.['GH_TOKEN'])).toBe('${{ github.token }}');
            expect(scalarText(lookup?.if)).toContain("steps.eligible.outputs.eligible == 'true'");
        },
    );

    /**
     * ⛔ THE FORK FILTER IS THE SCRIPT'S, AND IT IS EXECUTED — but nothing may route around it. The lookup must not read
     * the API response with its own `--jq`, which would be a second selection that could drop the repository checks.
     */
    it('does not select with its own jq — there is ONE selection rule, in the script', () => {
        for (const step of steps.filter((candidate) => /actions\/artifacts/u.test(commands(candidate)))) {
            expect(commands(step), step.name ?? '(unnamed)').not.toMatch(/--jq|\bjq\b/u);
        }
    });

    it('treats a lookup that cannot be made as a MISS with a warning — reuse is an optimisation, a rebuild is always correct', () => {
        for (const Platform of ['Android', 'Ios']) {
            const body = commands(steps.find((step) => step.id === `lookup${Platform}`) ?? {});

            expect(body).toMatch(/::warning::/u);
            expect(body).toMatch(/run_id=/u);
        }
    });

    it.each(['Android', 'Ios'])(
        '%s: downloads from the run that made it, then re-uploads under the SAME name into this run',
        (Platform) => {
            const fetch = steps.find((step) => step.id === `fetch${Platform}`);
            const upload = steps.find(
                (step) =>
                    /^actions\/upload-artifact@/u.test(step.uses ?? '') &&
                    step.name?.includes(Platform === 'Android' ? 'Android' : 'iOS'),
            );
            const lookup = steps.indexOf(steps.find((step) => step.id === `lookup${Platform}`) as Step);
            const reuse = steps.find((step) => step.id === `reuse${Platform}`);

            expect(fetch, `no fetch${Platform} step`).toBeDefined();
            expect(fetch?.uses).toMatch(/^actions\/download-artifact@/u);
            expect(scalarText(fetch?.with?.['run-id'])).toBe(`\${{ steps.lookup${Platform}.outputs.run_id }}`);
            expect(scalarText(fetch?.with?.['github-token'])).toBe('${{ github.token }}');
            expect(scalarText(fetch?.if)).toContain(`steps.lookup${Platform}.outputs.run_id != ''`);
            expect(steps.indexOf(fetch as Step), 'the fetch precedes the lookup it depends on').toBeGreaterThan(lookup);

            expect(scalarText(upload?.with?.['name'])).toBe(scalarText(fetch?.with?.['name']));
            expect(upload?.with?.['overwrite']).toBe(true);
            expect(scalarText(upload?.if)).toContain(`steps.fetch${Platform}.outcome == 'success'`);
            expect(steps.indexOf(reuse as Step), 'the reuse answer follows the re-upload').toBeGreaterThan(
                steps.indexOf(upload as Step),
            );
        },
    );

    /**
     * ADDED 2026-10-13 (reviewer). REUSE IS AN OPTIMISATION, so its failure must cost a REBUILD, not the plan. The fetch can
     * lose a race with the artifact's expiry, and the re-upload can fail for reasons of its own; either one failing the
     * plan would skip both builds (they need it) and leave every shard to refuse an empty name, red, over something a
     * build would have fixed. So both steps tolerate their own failure, the reuse answer is published only when BOTH
     * succeeded, and an empty answer sends the build jobs ahead. (Each is a `continue-on-error`, inventoried in
     * `workflowInvariants.test.ts`'s silent-success ledger — and not silent: no reuse answer means a build runs.)
     */
    it.each(['Android', 'Ios'])(
        '⛔ %s: a failed fetch or re-upload costs a rebuild — it is tolerated, and never published as a reuse',
        (Platform) => {
            const fetch = steps.find((step) => step.id === `fetch${Platform}`) as
                (Step & { 'continue-on-error'?: unknown }) | undefined;
            const reupload = steps.find((step) => step.id === `reupload${Platform}`) as
                (Step & { 'continue-on-error'?: unknown }) | undefined;
            const reuse = steps.find((step) => step.id === `reuse${Platform}`);

            expect(fetch?.['continue-on-error'], 'a failed fetch must not fail the plan').toBe(true);
            expect(reupload?.['continue-on-error'], 'a failed re-upload must not fail the plan').toBe(true);
            expect(scalarText(reupload?.if), 'there is nothing to re-upload when the fetch failed').toContain(
                `steps.fetch${Platform}.outcome == 'success'`,
            );
            expect(scalarText(reuse?.if)).toContain(`steps.fetch${Platform}.outcome == 'success'`);
            expect(scalarText(reuse?.if)).toContain(`steps.reupload${Platform}.outcome == 'success'`);
        },
    );

    it('re-uploads from the directory it downloaded into, so what is republished is exactly what was fetched', () => {
        for (const Platform of ['Android', 'Ios']) {
            const fetch = steps.find((step) => step.id === `fetch${Platform}`);
            const upload = steps.find(
                (step) =>
                    /^actions\/upload-artifact@/u.test(step.uses ?? '') &&
                    scalarText(step.with?.['name']) === scalarText(fetch?.with?.['name']),
            );

            expect(scalarText(upload?.with?.['path'])).toBe(scalarText(fetch?.with?.['path']));
        }
    });

    it('never builds when it reused: the build jobs are skipped on a non-empty reuse answer', () => {
        for (const platform of ['android', 'ios']) {
            expect(scalarText(build.jobs?.[platform]?.if)).toContain(`needs.plan.outputs.${platform}_reused == ''`);
        }
    });

    /** `id-token: write` is the `awsAuth` sign-in that reads the publishable key; nothing else is granted. */
    it('may read artifacts of other runs (actions: read), sign in to AWS, and nothing else but its contents', () => {
        expect(plan?.permissions).toEqual({ contents: 'read', actions: 'read', 'id-token': 'write' });
    });
});
