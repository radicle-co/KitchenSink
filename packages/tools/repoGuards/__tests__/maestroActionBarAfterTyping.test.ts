/**
 * A FLOW CLOSES THE KEYBOARD BEFORE IT TAPS THE EDITOR'S ACTION BAR.
 *
 * While the soft keyboard is open on a phone, the editor's action bar unpins and scrolls with the form as its last item
 * (build spec §7.1, A-006; `RecipeEditorView.native.tsx`, `keyboardShown && !wide`). So right after typing, 'Save changes'
 * and 'Publish' are off the bottom of the page, and a tap on them finds nothing. `offline/offlineSave.yaml` and
 * `offline/offlineSurvivesRestart.yaml` typed a title and tapped 'Save changes' at once, and failed at that tap on every
 * local Android run with the sandbox up (2026-10-23, both as committed and with the clear-state change).
 *
 * The rule, over every committed flow, parsed as YAML: in one command list, a `tapOn` of an action-bar control that
 * comes after an `inputText` or `eraseText` must have a tap or a keyboard-closing command between them: the shared
 * `common/closeEditorKeyboard.yaml`, the tap on the first section's heading it makes, or `hideKeyboard`. Any other tap
 * counts as closing it, because a choice in a picker closes its sheet and the keyboard with it (`recipes/cuisineField`).
 * So the rule misses a tap on a second text field that keeps the keyboard up, and typing inside a sub-flow it calls.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    FLOW_ROOT,
    REPO_ROOT,
    commandLists,
    committedFlowFiles,
    isRecord,
    namesFlow,
    parseFlow,
    textOf,
} from './maestroFlowYaml.js';

/** The editor action bar's controls a flow taps (`messages.ts` `saveChanges` / `publish`). */
const ACTION_BAR_CONTROLS: ReadonlySet<string> = new Set(['Save changes', 'Publish']);

/** Whether a command types into a field. Pure. */
const types = (command: unknown): boolean => isRecord(command) && ('inputText' in command || 'eraseText' in command);

/** Whether a command closes the soft keyboard, or taps something else that may (see the header). Pure. */
function closesKeyboard(command: unknown): boolean {
    if (command === 'hideKeyboard') {
        return true;
    }

    if (!isRecord(command)) {
        return false;
    }

    if ('hideKeyboard' in command || 'tapOn' in command) {
        return true;
    }

    const run = command['runFlow'];
    const file = typeof run === 'string' ? run : isRecord(run) ? run['file'] : undefined;

    return typeof file === 'string' && namesFlow(file, 'closeEditorKeyboard.yaml');
}

/**
 * Every tap on an action-bar control made while the keyboard a flow opened is still up, as the control's name. Pure.
 *
 * @param file - The flow's path, for the parse error.
 * @param source - The flow's YAML.
 * @returns One entry per offending tap, and how many action-bar taps were judged.
 */
export function tapsBehindKeyboard(
    file: string,
    source: string,
): { readonly offenders: readonly string[]; readonly judged: number } {
    const offenders: string[] = [];
    let judged = 0;

    for (const document of parseFlow(file, source)) {
        for (const list of commandLists(document)) {
            let keyboardUp = false;

            for (const command of list) {
                const tapped = isRecord(command) ? textOf(command['tapOn']) : undefined;

                if (tapped !== undefined && ACTION_BAR_CONTROLS.has(tapped)) {
                    judged += 1;

                    if (keyboardUp) {
                        offenders.push(tapped);
                    }
                }

                keyboardUp = types(command) ? true : closesKeyboard(command) ? false : keyboardUp;
            }
        }
    }

    return { offenders, judged };
}

const flow = (body: string): string => `appId: test\n---\n${body}`;

describe('tapsBehindKeyboard (the rule, on inline flows)', () => {
    it('refuses a tap on Save changes right after typing', () => {
        expect(tapsBehindKeyboard('inline', flow("- inputText: ' edit'\n- tapOn: 'Save changes'\n")).offenders).toEqual(
            ['Save changes'],
        );
    });

    it('refuses the map form, and Publish, and typing by erasing', () => {
        expect(
            tapsBehindKeyboard('inline', flow("- eraseText: 20\n- tapOn:\n    text: 'Publish'\n")).offenders,
        ).toEqual(['Publish']);
    });

    it.each([
        ['the shared step', '- runFlow: ../recipes/common/closeEditorKeyboard.yaml\n'],
        ['the heading tap', "- tapOn: 'About the recipe'\n"],
        ['a picker choice', "- tapOn:\n    text: 'Use “Nyonya”.*'\n"],
        ['hideKeyboard', '- hideKeyboard\n'],
    ])('allows the tap once %s closed the keyboard', (_name: string, closing: string) => {
        expect(
            tapsBehindKeyboard('inline', flow(`- inputText: ' edit'\n${closing}- tapOn: 'Save changes'\n`)).offenders,
        ).toEqual([]);
    });

    it('allows a tap with no typing before it', () => {
        expect(
            tapsBehindKeyboard('inline', flow("- tapOn: 'Edit recipe'\n- tapOn: 'Save changes'\n")).offenders,
        ).toEqual([]);
    });
});

describe('no committed flow taps the action bar behind the keyboard', () => {
    const results = committedFlowFiles().map((file) => ({
        file,
        ...tapsBehindKeyboard(file, readFileSync(join(REPO_ROOT, file), 'utf8')),
    }));

    it('judges the action-bar taps (offline/offlineSave.yaml among them), so the scan is not blind', () => {
        expect(results.find(({ file }) => file === `${FLOW_ROOT}/offline/offlineSave.yaml`)?.judged).toBeGreaterThan(0);
    });

    it('finds none', () => {
        expect(results.flatMap(({ file, offenders }) => offenders.map((tapped) => `${file}: ${tapped}`))).toEqual([]);
    });
});
