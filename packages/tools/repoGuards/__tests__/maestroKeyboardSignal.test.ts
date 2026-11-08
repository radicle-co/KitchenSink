/**
 * A FLOW KNOWS THE ANDROID KEYBOARD IS UP BY THE KEYBOARD'S OWN WINDOW, NEVER BY A SYSTEM-BAR BUTTON.
 *
 * `systemBackGuard` waited for the system bar's `Switch input method` button to come and go around each Back. That button
 * is drawn only by the three-button navigation bar: the x86_64 lane emulator has one, and the arm64 emulator the Mac's
 * Android lanes boot uses gesture navigation, whose bar under a keyboard holds only `input_method_nav_back` (run of
 * 2026-11-08). There the wait for the button to come up failed, and the wait for it to go passed whether or not the
 * keyboard had left, so it guarded nothing. The keyboard's own container, `android:id/inputArea`, is part of the
 * framework layout every keyboard app is drawn in, and it is in the tree only while a keyboard window shows.
 *
 * Over every committed flow, parsed as YAML (comments cannot trip it): no command names `Switch input method`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, committedFlowFiles, parseFlow } from './maestroFlowYaml.js';

/** The navigation-mode-bound button a flow must not use as a keyboard signal. */
const SYSTEM_BAR_IME_SWITCHER = 'Switch input method';

describe('the Android keyboard signal', () => {
    const flows = committedFlowFiles();

    it('has flows to judge', () => {
        expect(flows.length).toBeGreaterThan(50);
    });

    it.each(flows)('%s never waits on the system bar’s Switch input method button', (file) => {
        const commands = JSON.stringify(parseFlow(file, readFileSync(join(REPO_ROOT, file), 'utf8')));

        expect(commands).not.toContain(SYSTEM_BAR_IME_SWITCHER);
    });
});
