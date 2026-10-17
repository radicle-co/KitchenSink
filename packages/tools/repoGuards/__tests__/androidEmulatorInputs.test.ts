// @vitest-environment node
/**
 * Repo-wide guard: **every input handed to `android-emulator-runner` is one the PINNED version declares.**
 *
 * ## The defect this pins, found in a real run's log
 *
 * `_ci-heavy.yml` passed `enable-hardware-keyboard: true` for months. The action declares
 * `enable-hw-keyboard`. GitHub does not fail an unknown `with:` key — it emits a WARNING and drops it:
 *
 *     ##[warning]Unexpected input(s) 'enable-hardware-keyboard', valid inputs are ['api-level',
 *     'system-image-api-level', 'target', 'arch', 'profile', 'cores', 'ram-size', … 'enable-hw-keyboard',
 *     'emulator-build', 'working-directory', 'ndk', 'cmake', 'channel', 'script',
 *     'pre-emulator-launch-script']
 *
 * So the AVD kept `hw.keyboard=no` (the action's `enable-hw-keyboard` is what pushes `hw.keyboard=yes`
 * into the config, `lib/emulator-manager.js`), the runner script's `show_ime_with_hard_keyboard 0` was
 * INERT — that Android setting only means anything when a hardware keyboard is attached — and three comment
 * blocks in two files asserted, as settled fact, that the soft keyboard could never appear.
 *
 * ⛔ THAT IS WHY A WARNING IS WORSE THAN AN ERROR HERE. The job stayed green, the flows stayed green, and
 * the only artefact of the mistake was one line in a 3,700-line log of a tier that runs on a label. A typo
 * in a `with:` key is indistinguishable from a working configuration at every level a reader normally looks.
 *
 * ## Why the input list is COMMITTED rather than fetched
 *
 * A guard must not need the network: it would turn an offline machine, a rate limit or a GitHub outage into a
 * red test about nothing. So the declared inputs are copied here from the pinned SHA's own `action.yml` — and
 * the copy is bound to that SHA: {@link PINNED_SHA} is asserted against the `uses:` in the workflow tree, so
 * a version bump cannot silently keep a stale list. Bumping the action is then a two-part act, which is what
 * it already was (the digest and the version move together in the Maestro install step for the same reason).
 *
 * ## Mutation evidence
 *
 * Written before the fix: its first run reported `enable-hardware-keyboard` against the real `_ci-heavy.yml`
 * — the live defect, reproduced as a red test. After the fix, two mutations watched fail: changing
 * {@link PINNED_SHA} by one character reds the SHA binding, and removing `'script'` from
 * {@link DECLARED_INPUTS} — an input the workflow does actually pass — reds the drop detector.
 *
 * ⚠️ Removing `'enable-hw-keyboard'` from that list reds NOTHING, and that is correct rather than a hole: the
 * workflow deliberately passes no hardware-keyboard input at all (see the note in its place in
 * `_ci-heavy.yml`). This guard's subject is the keys a workflow DOES pass; it takes no view on which inputs a
 * workflow ought to use.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { WORKFLOWS_DIR } from './cdkApps.js';
import { repoRoot, trackedFiles } from './serviceSources.js';
import { scalarText } from './workflowScalar.js';

/** The action this guard constrains. */
const ACTION = 'reactivecircus/android-emulator-runner';

/**
 * The commit {@link DECLARED_INPUTS} was read from — `v2.38.0`.
 *
 * ⛔ Asserted against the workflow tree's own `uses:`, so the list below cannot outlive the version it
 * describes. If this fails after a deliberate bump, re-read that SHA's `action.yml` and update BOTH.
 */
const PINNED_SHA = 'a421e43855164a8197daf9d8d40fe71c6996bb0d';

/**
 * Every input `action.yml` declares at {@link PINNED_SHA}, in its own order.
 *
 * ⚠️ `icon` and `color` are branding keys rather than step inputs, and `using`/`main` belong to `runs:`;
 * they are excluded because a workflow passing them would be a mistake this guard should still catch.
 */
const DECLARED_INPUTS: readonly string[] = [
    'api-level',
    'system-image-api-level',
    'target',
    'arch',
    'profile',
    'cores',
    'ram-size',
    'heap-size',
    'sdcard-path-or-size',
    'disk-size',
    'avd-name',
    'force-avd-creation',
    'emulator-boot-timeout',
    'emulator-port',
    'emulator-options',
    'disable-animations',
    'disable-spellchecker',
    'disable-linux-hw-accel',
    'enable-hw-keyboard',
    'emulator-build',
    'working-directory',
    'ndk',
    'cmake',
    'channel',
    'script',
    'pre-emulator-launch-script',
];

interface Step {
    readonly name?: string;
    readonly uses?: unknown;
    readonly with?: Readonly<Record<string, unknown>>;
}

/** One step in the tree that runs the emulator action. */
interface EmulatorStep {
    readonly label: string;
    readonly uses: string;
    readonly keys: readonly string[];
}

/** Every step in every tracked workflow that uses the emulator action. Pure over the tree on disk. */
function emulatorSteps(): readonly EmulatorStep[] {
    return trackedFiles(WORKFLOWS_DIR)
        .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
        .flatMap((file) => {
            const doc = parse(readFileSync(path.join(repoRoot, file), 'utf8')) as {
                jobs?: Record<string, { steps?: readonly Step[] }>;
            } | null;

            return Object.entries(doc?.jobs ?? {}).flatMap(([job, definition]) =>
                (definition.steps ?? [])
                    .filter((step) => scalarText(step.uses).startsWith(`${ACTION}@`))
                    .map((step) => ({
                        label: `${path.basename(file)}::${job}::${step.name ?? '(unnamed)'}`,
                        uses: scalarText(step.uses),
                        keys: Object.keys(step.with ?? {}),
                    })),
            );
        });
}

const found = emulatorSteps();

describe('android-emulator-runner is configured with inputs it actually declares', () => {
    it('finds its subject (non-vacuity — a discovery that found nothing would pass by finding nothing)', () => {
        expect(found.map((step) => step.label)).toContain(
            '_ci-heavy.yml::e2e-mobile-maestro::Run Maestro flows on emulator',
        );
    });

    it('⛔ pins the version the declared-input list was read from', () => {
        for (const step of found) {
            expect(
                step.uses,
                `${step.label} uses a version this guard's input list was not read from — re-read that ` +
                    "SHA's action.yml and update DECLARED_INPUTS and PINNED_SHA together",
            ).toBe(`${ACTION}@${PINNED_SHA}`);
        }
    });

    it.each(found.map((step) => [step.label, step] as const))(
        '⛔ %s passes no input the action would silently DROP with a warning',
        (_, step) => {
            const undeclared = step.keys.filter((key) => !DECLARED_INPUTS.includes(key));

            expect(
                undeclared,
                'GitHub does not fail an unknown `with:` key — it warns and drops it, so the step reads as ' +
                    'configured and configures nothing. `enable-hardware-keyboard` did that for months ' +
                    `(the action declares \`enable-hw-keyboard\`). Nearest declared inputs: ${DECLARED_INPUTS.join(', ')}`,
            ).toStrictEqual([]);
        },
    );

    it('keeps the declared list free of duplicates and of the action.yml keys that are not step inputs', () => {
        expect(new Set(DECLARED_INPUTS).size).toBe(DECLARED_INPUTS.length);

        for (const notAnInput of ['icon', 'color', 'using', 'main']) {
            expect(DECLARED_INPUTS).not.toContain(notAnInput);
        }
    });
});
