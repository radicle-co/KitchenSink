// @vitest-environment node
/**
 * Repo-wide guard: the Maestro tier runs on TWO platforms, and the flows one platform cannot run are named,
 * classified and printed — never dropped silently.
 *
 * ## The defect class this pins
 *
 * The flow plan in `runMaestroFlows.sh` was written against an Android emulator. Some flows drive Android's
 * SYSTEM back key (`back`, `pressKey: Back`), which Maestro implements on Android only. On an iOS Simulator
 * those commands cannot do what the flow needs, so the flow fails for a reason that has nothing to do with the
 * app. The obvious repair — "skip whatever fails on iOS" — is the silent-narrowing sin `maestroFlowSelection`
 * exists to forbid: a green iOS shard over flows nobody ran.
 *
 * So the script carries ONE exclusion table, per platform, with a class and a reason for every entry, and this
 * guard holds that table to the flows themselves in BOTH directions:
 *
 *   - every planned flow that reaches an Android-only command — directly, or through any `runFlow` sub-flow —
 *     is excluded on iOS (a missed one is an iOS red that reads like an app defect);
 *   - every excluded flow really does reach one (an extra one is coverage given away for nothing).
 *
 * The Android-only set is DERIVED from the YAML by walking each flow's commands, so the table cannot drift from
 * the flows without this file going red. The table is still written down in the script because the script must
 * answer "which flows run here" without a YAML parser, and because each entry carries a REASON a reader of the
 * CI log needs.
 *
 * ## The two classes, and why they are kept apart
 *
 *   - `android-behaviour` — the flow's SUBJECT is Android system-back behaviour (a hardware back key consumed
 *     by a modal before any `BackHandler`). There is no iOS equivalent to test; excluding it loses nothing.
 *   - `coverage-gap` — the flow's subject is cross-platform, and it only uses the system back key INCIDENTALLY
 *     (the shared `common/raiseDiscardGuard.yaml` raises the discard dialog with it). Excluding it is a real
 *     iOS coverage gap, and the class says so in the log rather than dressing it up as "Android only".
 *
 * ## How it is asserted
 *
 * By EXECUTING the script's pure subcommands (`platforms`, `exclusions`, `platform-flows`, `shard-selection`,
 * `shard-matrix`), never by re-implementing them — the same posture as `maestroFlowSelection.test.ts` and
 * `maestroShardPartition.test.ts`. The YAML walker below is this guard's own reading of the flows, proved
 * against a fixture table of command shapes before it is trusted on the real tree.
 *
 * Mutation evidence: written before the script had a platform at all — every `spawnSync` here reported the
 * script's usage error and exit 2.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAllDocuments } from 'yaml';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const MOBILE = join(REPO_ROOT, 'packages/apps/commise/mobile');
const SCRIPT = join(MOBILE, 'tests/e2e/runMaestroFlows.sh');
const MAESTRO_DIR = join(MOBILE, '.maestro');

/** The exclusion classes the script may state. */
const EXCLUSION_CLASSES = ['android-behaviour', 'coverage-gap'] as const;

interface Spawned {
    readonly status: number;
    readonly stdout: string;
    readonly stderr: string;
}

/**
 * Run the script with optional environment overrides.
 *
 * @sideEffect Spawns `bash`. Touches no device and no network.
 */
function run(env: Readonly<Record<string, string>>, ...args: readonly string[]): Spawned {
    const result = spawnSync('bash', [SCRIPT, ...args], {
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '', ...env },
    });

    if (result.error) {
        throw result.error;
    }

    return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** The values of every `<key>=` line, in order. */
function valuesOf(stdout: string, key: string): readonly string[] {
    return stdout.split('\n').flatMap((line) => (line.startsWith(`${key}=`) ? [line.slice(key.length + 1)] : []));
}

/** The committed plan's flows, in plan order. */
const PLANNED: readonly string[] = run({}, 'plan')
    .stdout.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((entry) => entry.slice(entry.indexOf(':') + 1));

/** The spine — the flows every shard runs, read from the plan's `spine:` label. */
const SPINE: readonly string[] = run({}, 'plan')
    .stdout.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('spine:'))
    .map((entry) => entry.slice('spine:'.length));

interface Exclusion {
    readonly flow: string;
    readonly klass: string;
    readonly reason: string;
}

/** The script's exclusion table for one platform. */
function exclusions(platform: string): readonly Exclusion[] {
    const outcome = run({}, 'exclusions', platform);

    expect(outcome.status, `exclusions ${platform} failed: ${outcome.stderr}`).toBe(0);

    return outcome.stdout
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => {
            const [flow = '', klass = '', ...reason] = line.split('|');

            return { flow, klass, reason: reason.join('|') };
        });
}

// ---------------------------------------------------------------------------------------------------------
// This guard's own reading of a flow: does it reach an Android-only command?
// ---------------------------------------------------------------------------------------------------------

/**
 * The commands Maestro implements on Android only, as this guard detects them. Kept to what Maestro's own
 * reference says, and no wider: `back` is documented "Android only", and the `Back` key of `pressKey` is the
 * same system key event. A command whose iOS support is merely uncertain does NOT belong here — adding one
 * would force exclusions this guard cannot justify.
 */
function isAndroidOnlyCommand(name: string, argument: unknown): boolean {
    if (name === 'back') {
        return true;
    }

    return name === 'pressKey' && typeof argument === 'string' && argument.trim().toLowerCase() === 'back';
}

/** One command list, or one command, from a parsed flow document. */
type Commands = unknown;

/**
 * Whether a command tree reaches an Android-only command, following every `runFlow` file it names.
 *
 * Walks the shapes Maestro nests commands in: a bare string command (`- back`), a single-key mapping
 * (`- pressKey: Back`), `runFlow` as a path or as `{ file }` / `{ commands }`, and `repeat` / `retry` blocks
 * with `commands`. `seen` stops a sub-flow cycle from recursing forever.
 *
 * @param commands - A command list (or a single command).
 * @param fromFlow - The flow file the commands live in, slash-separated, without extension — sub-flow paths
 *     resolve relative to it.
 * @param readFlow - Reads a flow by name; injected so the fixture table below never touches disk.
 * @param seen - Flows already being walked.
 */
function reachesAndroidOnly(
    commands: Commands,
    fromFlow: string,
    readFlow: (flow: string) => string,
    seen: Set<string> = new Set([fromFlow]),
): boolean {
    if (Array.isArray(commands)) {
        return commands.some((command) => reachesAndroidOnly(command, fromFlow, readFlow, seen));
    }

    if (typeof commands === 'string') {
        return isAndroidOnlyCommand(commands, undefined);
    }

    if (commands === null || typeof commands !== 'object') {
        return false;
    }

    return Object.entries(commands as Record<string, unknown>).some(([name, argument]) => {
        if (isAndroidOnlyCommand(name, argument)) {
            return true;
        }

        if (name === 'commands' || name === 'onFlowStart' || name === 'onFlowComplete') {
            return reachesAndroidOnly(argument, fromFlow, readFlow, seen);
        }

        if (name === 'runFlow' || name === 'repeat' || name === 'retry') {
            const file =
                typeof argument === 'string'
                    ? argument
                    : typeof (argument as { file?: unknown } | null)?.file === 'string'
                      ? (argument as { file: string }).file
                      : undefined;
            const nested = (argument as { commands?: unknown } | null)?.commands;

            if (nested !== undefined && reachesAndroidOnly(nested, fromFlow, readFlow, seen)) {
                return true;
            }

            if (file !== undefined) {
                const target = posix.normalize(posix.join(posix.dirname(fromFlow), file)).replace(/\.yaml$/u, '');

                if (seen.has(target)) {
                    return false;
                }

                seen.add(target);

                return flowReachesAndroidOnly(target, readFlow, seen);
            }
        }

        return false;
    });
}

/** Whether a whole flow file (its config header AND its command list) reaches an Android-only command. */
function flowReachesAndroidOnly(
    flow: string,
    readFlow: (flow: string) => string,
    seen: Set<string> = new Set([flow]),
): boolean {
    return parseAllDocuments(readFlow(flow)).some((document) =>
        reachesAndroidOnly(document.toJS() as unknown, flow, readFlow, seen),
    );
}

const readCommittedFlow = (flow: string): string => readFileSync(join(MAESTRO_DIR, `${flow}.yaml`), 'utf8');

describe('the Android-only detector — proved on command shapes before it is trusted on the tree', () => {
    const header = 'appId: io.commise.mobile\n---\n';
    const fixtures: Readonly<Record<string, string>> = {
        bareBack: `${header}- launchApp\n- back\n`,
        pressKeyBack: `${header}- pressKey: Back\n`,
        pressKeyLower: `${header}- pressKey: back\n`,
        pressKeyEnter: `${header}- pressKey: Enter\n- tapOn: 'Back'\n`,
        textBackIsNotTheKey: `${header}- tapOn:\n      text: 'Back'\n      above:\n          text: 'Step 1 of 4'\n`,
        conditional: `${header}- runFlow:\n      when:\n          notVisible: 'x'\n      commands:\n          - pressKey: Back\n`,
        repeated: `${header}- repeat:\n      times: 2\n      commands:\n          - back\n`,
        hook: 'appId: io.commise.mobile\nonFlowComplete:\n    - back\n---\n- launchApp\n',
        viaSubFlow: `${header}- runFlow: common/sub.yaml\n`,
        viaSubFlowFile: `${header}- runFlow:\n      file: common/sub.yaml\n`,
        'common/sub': `${header}- pressKey: Back\n`,
        viaCleanSubFlow: `${header}- runFlow: common/clean.yaml\n`,
        'common/clean': `${header}- tapOn: 'Done'\n`,
        cycleA: `${header}- runFlow: cycleB.yaml\n`,
        cycleB: `${header}- runFlow: cycleA.yaml\n`,
    };

    const readFixture = (flow: string): string => {
        const body = fixtures[flow];

        if (body === undefined) {
            throw new Error(`fixture ${flow} is not in the table`);
        }

        return body;
    };

    it.each([
        ['bareBack', true],
        ['pressKeyBack', true],
        ['pressKeyLower', true],
        ['pressKeyEnter', false],
        ['textBackIsNotTheKey', false],
        ['conditional', true],
        ['repeated', true],
        ['hook', true],
        ['viaSubFlow', true],
        ['viaSubFlowFile', true],
        ['viaCleanSubFlow', false],
        ['cycleA', false],
    ] as const)('%s → %s', (flow, expected) => {
        expect(flowReachesAndroidOnly(flow, readFixture)).toBe(expected);
    });
});

/** Every planned flow that reaches an Android-only command, by this guard's own reading of the YAML. */
const ANDROID_ONLY: readonly string[] = PLANNED.filter((flow) => flowReachesAndroidOnly(flow, readCommittedFlow));

describe('the platform set', () => {
    it('is exactly android and ios', () => {
        const outcome = run({}, 'platforms');

        expect(outcome.status).toBe(0);
        expect(outcome.stdout.split('\n').filter((line) => line.length > 0)).toEqual(['android', 'ios']);
    });

    it('REFUSES an unknown platform in every pure door, rather than defaulting to one', () => {
        for (const args of [
            ['exclusions', 'windows'],
            ['platform-flows', 'windows', 'home'],
        ]) {
            const outcome = run({}, ...args);

            expect(outcome.status, `${args.join(' ')} accepted an unknown platform`).toBe(2);
            expect(outcome.stdout, `${args.join(' ')} printed a verdict for an unknown platform`).toBe('');
        }

        for (const args of [
            ['shard-matrix', '2'],
            ['shard-selection', '1', '1'],
        ]) {
            const outcome = run({ MAESTRO_PLATFORM: 'windows' }, ...args);

            expect(outcome.status, `MAESTRO_PLATFORM=windows ${args.join(' ')} was accepted`).toBe(2);
            expect(outcome.stdout).toBe('');
        }
    });

    it('treats an UNSET platform as android — the shape every pre-iOS caller (and the local runner) relies on', () => {
        expect(run({}, 'shard-matrix', '2').stdout).toBe(
            run({ MAESTRO_PLATFORM: 'android' }, 'shard-matrix', '2').stdout,
        );
        expect(run({}, 'shard-selection', '1', '2').stdout).toBe(
            run({ MAESTRO_PLATFORM: 'android' }, 'shard-selection', '1', '2').stdout,
        );
    });
});

describe('the exclusion table holds to the flows, in both directions', () => {
    it('is not vacuous: the detector finds the direct case and the sub-flow-only case on the real tree', () => {
        expect(ANDROID_ONLY).toContain('recipes/systemBackGuard');
        // Reaches `pressKey: Back` ONLY through `common/raiseDiscardGuard.yaml` — proves the walk is transitive.
        expect(readCommittedFlow('recipes/ingredientUnmatched')).not.toMatch(/pressKey:\s*Back/u);
        expect(ANDROID_ONLY).toContain('recipes/ingredientUnmatched');
    });

    it('excludes NOTHING on android — the plan is the Android plan', () => {
        expect(exclusions('android')).toEqual([]);
    });

    it('⛔ excludes on iOS exactly the planned flows that reach an Android-only command', () => {
        expect(
            exclusions('ios')
                .map((entry) => entry.flow)
                .sort(),
        ).toEqual([...ANDROID_ONLY].sort());
    });

    it('names only planned flows, once each, with a known class and a stated reason', () => {
        const table = exclusions('ios');

        expect(new Set(table.map((entry) => entry.flow)).size).toBe(table.length);

        for (const entry of table) {
            expect(PLANNED, `${entry.flow} is excluded but not planned`).toContain(entry.flow);
            expect(EXCLUSION_CLASSES as readonly string[], `${entry.flow} has an unknown class`).toContain(entry.klass);
            expect(entry.reason.trim().length, `${entry.flow} states no reason`).toBeGreaterThan(20);
        }
    });

    it('never excludes the spine — an iOS shard with no sign-in runs every flow signed out', () => {
        for (const flow of SPINE) {
            expect(
                exclusions('ios').map((entry) => entry.flow),
                `${flow} is the spine`,
            ).not.toContain(flow);
        }
    });
});

describe('platform-flows — the filter itself', () => {
    it('keeps every flow on android, in order', () => {
        const outcome = run({}, 'platform-flows', 'android', ...PLANNED);

        expect(outcome.status).toBe(0);
        expect(valuesOf(outcome.stdout, 'flow')).toEqual(PLANNED);
        expect(valuesOf(outcome.stdout, 'excluded')).toEqual([]);
    });

    it('drops exactly the table on iOS, keeps plan order, and SAYS what it dropped', () => {
        const excluded = new Set(exclusions('ios').map((entry) => entry.flow));
        const outcome = run({}, 'platform-flows', 'ios', ...PLANNED);

        expect(outcome.status).toBe(0);
        expect(valuesOf(outcome.stdout, 'flow')).toEqual(PLANNED.filter((flow) => !excluded.has(flow)));
        expect(valuesOf(outcome.stdout, 'excluded')).toEqual(PLANNED.filter((flow) => excluded.has(flow)));
    });

    it('refuses an empty flow list rather than reporting a filter over nothing', () => {
        expect(run({}, 'platform-flows', 'ios').status).toBe(2);
    });
});

/** Every selector the guard exercises: the full run, and each vertical on its own. */
function selectors(): readonly (readonly string[])[] {
    const verticals = run({}, 'verticals')
        .stdout.split('\n')
        .filter((line) => line.length > 0);

    return [[], ...verticals.map((vertical) => [`${vertical}=true`])];
}

describe('shard-selection — select, then filter for the platform, then partition', () => {
    it.each(selectors().map((pairs) => [pairs.join(' ') || '(no selector)', pairs] as const))(
        '⛔ on iOS, %s: every kept flow runs on exactly one shard, no excluded flow runs anywhere',
        (_, pairs) => {
            const env = { MAESTRO_PLATFORM: 'ios' };
            const matrix = run(env, 'shard-matrix', '2', ...pairs);

            expect(matrix.status, matrix.stderr).toBe(0);

            const count = (JSON.parse(matrix.stdout) as readonly number[]).length;
            const selected = valuesOf(run({}, 'select', ...pairs).stdout, 'flow');
            const excluded = new Set(exclusions('ios').map((entry) => entry.flow));
            const expected = selected.filter((flow) => !excluded.has(flow));
            const ran: string[] = [];

            for (let index = 1; index <= count; index += 1) {
                const shard = run(env, 'shard-selection', String(index), String(count), ...pairs);

                expect(shard.status, shard.stderr).toBe(0);

                const flows = valuesOf(shard.stdout, 'flow');

                for (const flow of SPINE) {
                    expect(flows, `shard ${index}/${count} lost the spine`).toContain(flow);
                }

                expect(valuesOf(shard.stdout, 'excluded'), 'every shard prints what the platform dropped').toEqual(
                    selected.filter((flow) => excluded.has(flow)),
                );

                ran.push(...flows.filter((flow) => !SPINE.includes(flow)));
            }

            expect([...ran].sort(), 'the union of the iOS shards').toEqual(
                expected.filter((flow) => !SPINE.includes(flow)).sort(),
            );
        },
    );

    it('sizes the iOS matrix from what iOS actually runs — never a shard holding only the spine', () => {
        for (const pairs of selectors()) {
            const count = (
                JSON.parse(run({ MAESTRO_PLATFORM: 'ios' }, 'shard-matrix', '2', ...pairs).stdout) as readonly number[]
            ).length;

            for (let index = 1; index <= count; index += 1) {
                const flows = valuesOf(
                    run({ MAESTRO_PLATFORM: 'ios' }, 'shard-selection', String(index), String(count), ...pairs).stdout,
                    'flow',
                );

                expect(
                    flows.filter((flow) => !SPINE.includes(flow)).length,
                    `${pairs.join(' ')}: iOS shard ${index}/${count} holds only the spine`,
                ).toBeGreaterThan(0);
            }
        }
    });

    it('is the existing select → shard composition on android, flow for flow', () => {
        for (const pairs of selectors()) {
            const selected = valuesOf(run({}, 'select', ...pairs).stdout, 'flow');

            for (const [index, count] of [
                [1, 1],
                [1, 2],
                [2, 2],
            ] as const) {
                const composed = run({}, 'shard-selection', String(index), String(count), ...pairs);
                const direct = run({}, 'shard', String(index), String(count), ...selected);

                expect(valuesOf(composed.stdout, 'flow')).toEqual(valuesOf(direct.stdout, 'flow'));
                expect(valuesOf(composed.stdout, 'deferred')).toEqual(valuesOf(direct.stdout, 'deferred'));
                expect(valuesOf(composed.stdout, 'excluded')).toEqual([]);
            }
        }
    });
});
