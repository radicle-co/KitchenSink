/**
 * THE SHARED DISCARD STEP TAPS DISCARD ONLY ONCE NOTHING CAN GO ON THE WIRE, AND PROVES THE CONFIRM CLOSED.
 *
 * Owner ruling 2026-10-17, "Don't allow users to delete while saving": while a write of the recipe is on the wire, the
 * editor's Discard draft item AND its confirm's Discard button are disabled. `recipes/common/discardDraft.yaml` waited on
 * the menu item only, so a create that went on the wire between the two taps left the tap on a disabled Discard. That is
 * the likely cause of local run 9's failure (2026-10-22, Android, createAuthoredFood): the confirm was still open 17 s
 * after the tap, with its Discard enabled again by then.
 *
 * The step's own proof hid that: it waited for 'Close editor' to be gone, and on Android an open dialog is a window of
 * its own, so the editor under it is not in the hierarchy at all. The wait passed in 0.6 s with the confirm still open,
 * and the failure surfaced one step later as "My recipes is not visible".
 *
 * So the step (1) waits for the header's settled save status before it opens the menu: 'Saved' means the server holds
 * the current draft, so no checkpoint has anything to send; (2) waits for the confirm to close before it waits for the
 * editor to go; and (3) a caller that runs it offline, where the header never says 'Saved', names its own settled status.
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

const STEP = `${FLOW_ROOT}/recipes/common/discardDraft.yaml`;

/** The step's top-level commands: the document after the `appId` header. */
function stepCommands(): readonly unknown[] {
    const documents = parseFlow(STEP, readFileSync(join(REPO_ROOT, STEP), 'utf8'));
    const commands = documents.at(-1);

    if (!Array.isArray(commands)) {
        throw new Error(`${STEP} has no command list`);
    }

    return commands;
}

/** The text a `tapOn` names, or none. Pure. */
const tapped = (command: unknown): string | undefined =>
    isRecord(command) && 'tapOn' in command ? textOf(command['tapOn']) : undefined;

/** The text an `extendedWaitUntil` waits to see (`visible`) or to be gone (`notVisible`), or none. Pure. */
function waitedFor(command: unknown, kind: 'visible' | 'notVisible'): string | undefined {
    const wait = isRecord(command) ? command['extendedWaitUntil'] : undefined;

    return isRecord(wait) ? textOf(wait[kind]) : undefined;
}

/** The index of the first command a predicate accepts, or -1. Pure. */
const indexWhere = (commands: readonly unknown[], accepts: (command: unknown) => boolean): number =>
    commands.findIndex(accepts);

describe('recipes/common/discardDraft.yaml discards only a settled draft and proves its confirm closed', () => {
    const commands = stepCommands();
    const openMenu = indexWhere(commands, (c) => tapped(c) === 'More editor actions');
    const confirm = indexWhere(commands, (c) => tapped(c) === 'Discard');

    it('opens the menu and taps the confirm', () => {
        expect(openMenu).toBeGreaterThanOrEqual(0);
        expect(confirm).toBeGreaterThan(openMenu);
    });

    it("waits for the header's settled status, by default 'Saved', before it opens the menu", () => {
        const settled = indexWhere(commands, (c) => waitedFor(c, 'visible')?.includes('SETTLED') === true);

        expect(settled).toBeGreaterThanOrEqual(0);
        expect(settled).toBeLessThan(openMenu);
        expect(waitedFor(commands[settled], 'visible')).toContain("'Saved'");
    });

    it('names its settled status with no `$`, which Maestro mangles inside an interpolated value', () => {
        const settled = commands.find((c) => waitedFor(c, 'visible')?.includes('SETTLED') === true);

        expect(waitedFor(settled, 'visible')?.replace(/\$\{|\}$/g, '')).not.toContain('$');
    });

    it('waits for the confirm to close before it waits for the editor to go', () => {
        const confirmGone = indexWhere(commands, (c) => waitedFor(c, 'notVisible') === 'Discard this draft?');
        const editorGone = indexWhere(commands, (c) => waitedFor(c, 'notVisible') === 'Close editor');

        expect(confirmGone).toBeGreaterThan(confirm);
        expect(editorGone).toBeGreaterThan(confirmGone);
    });
});

/** Whether a command runs the discard step, and the env it passes. Pure. */
function discardCall(command: unknown): { readonly env: Record<string, unknown> } | undefined {
    if (!isRecord(command) || !('runFlow' in command)) {
        return undefined;
    }

    const run = command['runFlow'];
    const file = typeof run === 'string' ? run : isRecord(run) ? run['file'] : undefined;

    if (typeof file !== 'string' || !namesFlow(file, 'discardDraft.yaml')) {
        return undefined;
    }

    return { env: isRecord(run) && isRecord(run['env']) ? run['env'] : {} };
}

/** Whether a command turns airplane mode on or off, and which. Pure. */
function airplane(command: unknown): 'enabled' | 'disabled' | undefined {
    const mode = isRecord(command) ? command['setAirplaneMode'] : undefined;

    return mode === 'enabled' || mode === 'disabled' ? mode : undefined;
}

describe('a flow that discards offline names the status its header settles in', () => {
    const offlineCalls: string[] = [];
    const missing: string[] = [];

    for (const file of committedFlowFiles()) {
        for (const document of parseFlow(file, readFileSync(join(REPO_ROOT, file), 'utf8'))) {
            for (const list of commandLists(document)) {
                let offline = false;

                for (const command of list) {
                    offline = airplane(command) === undefined ? offline : airplane(command) === 'enabled';
                    const call = discardCall(command);

                    if (call !== undefined && offline) {
                        offlineCalls.push(file);

                        if (typeof call.env['SETTLED'] !== 'string') {
                            missing.push(file);
                        }
                    }
                }
            }
        }
    }

    it('finds the offline discard (offline/discardWhileOffline.yaml), so the scan is not blind', () => {
        expect(offlineCalls).toContain(`${FLOW_ROOT}/offline/discardWhileOffline.yaml`);
    });

    it('passes SETTLED from every offline call', () => {
        expect(missing).toEqual([]);
    });
});

/** Whether a command types the recipe's title: the shared step, or a tap on the Title field. Pure. */
function typesTitle(command: unknown): boolean {
    if (!isRecord(command)) {
        return false;
    }

    const run = command['runFlow'];
    const file = typeof run === 'string' ? run : isRecord(run) ? run['file'] : undefined;

    return (typeof file === 'string' && namesFlow(file, 'typeTitle.yaml')) || textOf(command['tapOn']) === 'Title';
}

describe('a flow that discards a draft it gave no title names the status its header settles in', () => {
    // A server write needs a title (`checkpointPolicy.ts`, the draft floor), so an untitled draft never leaves the device
    // and its header stays 'Saved on this device' (local run 11, 2026-10-22: pasteList and addStepFocus waited for
    // 'Saved' and failed on both platforms). A flow that types its title some other way (landscape.yaml, through the
    // field's placeholder) states its settled status itself, and a wrong statement fails at the wait.
    const untitled: string[] = [];
    const missing: string[] = [];

    for (const file of committedFlowFiles()) {
        const documents = parseFlow(file, readFileSync(join(REPO_ROOT, file), 'utf8'));
        const commands = documents.flatMap((document) => [...commandLists(document)].flat());
        const calls = commands.map(discardCall).filter((call) => call !== undefined);

        if (calls.length === 0 || file.endsWith('/discardDraft.yaml') || commands.some(typesTitle)) {
            continue;
        }

        untitled.push(file);

        if (calls.some((call) => typeof call.env['SETTLED'] !== 'string')) {
            missing.push(file);
        }
    }

    it('finds the untitled discards (recipes/pasteList.yaml among them), so the scan is not blind', () => {
        expect(untitled).toContain(`${FLOW_ROOT}/recipes/pasteList.yaml`);
    });

    it('passes SETTLED from every one', () => {
        expect(missing).toEqual([]);
    });
});
