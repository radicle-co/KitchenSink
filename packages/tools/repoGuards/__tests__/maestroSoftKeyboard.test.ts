/**
 * The Maestro emulator and simulator must raise the SOFT keyboard when a text field takes focus.
 *
 * `recipes/pinnedActionBar.yaml` failed on every CI Android run at `Assert that "Sections\. Current: .*" is not
 * visible`: the Title field was focused with a caret, no soft keyboard was on screen, and the system bar showed the
 * keyboard-toggle glyph. `useKeyboardShown` was therefore false and the app correctly left the section bar up.
 *
 * Cause, from run 38950847113: `avdmanager create avd --device pixel_6` copies the profile's hardware keyboard, and the
 * action appends only `hw.cpu.ncore` and `hw.ramSize` (its `enable-hw-keyboard` input, false, adds nothing; it does not
 * write `hw.keyboard=no`). With a hardware keyboard reported, Android's `show_ime_with_hard_keyboard` (Settings.Secure,
 * "Show virtual keyboard while a physical keyboard is active") decides whether the IME opens, and the runner script
 * wrote `0`. An earlier comment called that write inert on the assumption that the AVD said `hw.keyboard=no`.
 *
 * Two layers, both asserted: the AVD stops reporting a hardware keyboard, and the setting is `1` with a read-back in
 * the log. The iOS Simulator has the same class (Connect Hardware Keyboard), asserted at its boot step.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';
import { scalarText } from './workflowScalar.js';

const WORKFLOW = path.join(repoRoot, '.github/workflows/_ci-heavy.yml');
const SCRIPT = path.join(repoRoot, 'packages/apps/commise/mobile/tests/e2e/runMaestroFlows.sh');

interface Step {
    readonly name?: string;
    readonly uses?: unknown;
    readonly with?: Readonly<Record<string, unknown>>;
    readonly run?: unknown;
}

const doc = parse(readFileSync(WORKFLOW, 'utf8')) as { jobs: Record<string, { steps?: readonly Step[] }> };
const steps = Object.values(doc.jobs).flatMap((job) => job.steps ?? []);
const emulatorStep = steps.find((step) => scalarText(step.uses).startsWith('reactivecircus/android-emulator-runner@'));
const simulatorStep = steps.find((step) => step.name?.startsWith('Create the pinned iOS Simulator') === true);
const script = readFileSync(SCRIPT, 'utf8');

describe('Maestro devices raise the soft keyboard on focus', () => {
    it('finds its subjects (non-vacuity)', () => {
        expect(emulatorStep).toBeDefined();
        expect(simulatorStep).toBeDefined();
    });

    it('⛔ the AVD is rewritten to report NO hardware keyboard before the emulator launches', () => {
        const pre = scalarText(emulatorStep?.with?.['pre-emulator-launch-script']);

        expect(pre).toMatch(/hw\.keyboard=no/);
        expect(pre).toMatch(/config\.ini/);
    });

    it('⛔ the runner script shows the IME with a hardware keyboard and prints the value back', () => {
        expect(script).toMatch(/settings put secure show_ime_with_hard_keyboard 1/);
        expect(script).not.toMatch(/settings put secure show_ime_with_hard_keyboard 0/);
        expect(script).toMatch(/settings get secure show_ime_with_hard_keyboard/);
    });

    it('⛔ the iOS Simulator is told not to connect the host hardware keyboard before it boots', () => {
        const run = scalarText(simulatorStep?.run);
        const write = run.indexOf('ConnectHardwareKeyboard');

        expect(write).toBeGreaterThan(-1);
        expect(write).toBeLessThan(run.indexOf('xcrun simctl boot'));
    });
});
