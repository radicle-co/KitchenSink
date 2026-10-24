/**
 * A FLOW THAT WAITS FOR A SNACKBAR WAITS RIGHT AFTER A TAP THAT CANNOT OUTLIVE IT.
 *
 * The editor's finish notices ("Recipe published.", "Changes saved.") are snackbars that last about 6 s
 * (`DEFAULT_SNACKBAR_MS`). After a tap, Maestro waits for the screen to stop changing before the next command starts, and
 * a publish changes the screen for a long time: the editor leaves and the recipe's detail loads. In CI run 39504625987
 * (iOS shard 5, `quantityRange`) the Publish tap took 17.6 s. The publish landed, the snackbar showed and expired INSIDE
 * that tap, and the 40 s wait that followed polled every half second for a notice that had already gone. The recipe on
 * screen was published. `create`'s identical tap, in the same shard, took 4.2 s and passed.
 *
 * The rules, over every committed flow, parsed as YAML (not grepped, so comments and quoting cannot hide a pair):
 *   1. A wait for a finish notice is the first command after a `tapOn`, in the same command list.
 *   2. That tap caps Maestro's settle wait (`waitToSettleTimeoutMs`) at {@link MAX_SETTLE_MS} or less, so the wait
 *      starts while the notice is still on screen.
 *   3. Every notice text named here is the editor's own copy, so a reworded notice cannot leave this guard judging
 *      nothing.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, commandLists, committedFlowFiles, isRecord, parseFlow, textOf } from './maestroFlowYaml.js';

/** The editor's finish notices, as the flows wait for them. */
const FINISH_NOTICES = ['Recipe published.', 'Changes saved.'] as const;

/** Where the editor's copy for them lives. */
const EDITOR_MESSAGES = 'packages/apps/commise/features/recipes/src/editor/messages.ts';

/**
 * The longest a tap before a notice wait may wait for the screen to settle. Under the snackbar's 6 s by enough to leave
 * the wait several polls of a notice that is still showing.
 */
const MAX_SETTLE_MS = 1000;

/** How many notice waits the flows held when this guard was written (8 "Recipe published.", 5 "Changes saved."). */
const MIN_NOTICE_WAITS = 13;

/** The notice a command waits for or asserts, if it is one of {@link FINISH_NOTICES}. Pure. */
function noticeWaitedFor(command: unknown): string | undefined {
    if (!isRecord(command)) {
        return undefined;
    }

    const condition = isRecord(command['extendedWaitUntil'])
        ? command['extendedWaitUntil']['visible']
        : command['assertVisible'];
    const text = textOf(condition);

    return FINISH_NOTICES.find((notice) => notice === text);
}

/** The settle cap a `tapOn` command sets, or `undefined` when it is not a tap or sets none. Pure. */
function settleCapOf(command: unknown): number | undefined {
    if (!isRecord(command) || !isRecord(command['tapOn'])) {
        return undefined;
    }

    const cap = command['tapOn']['waitToSettleTimeoutMs'];

    return typeof cap === 'number' ? cap : undefined;
}

interface NoticeWait {
    readonly file: string;
    readonly notice: string;
    readonly previous: unknown;
}

/** Every finish-notice wait in the committed flows, with the command before it. */
function noticeWaits(): readonly NoticeWait[] {
    const waits: NoticeWait[] = [];

    for (const file of committedFlowFiles()) {
        for (const document of parseFlow(file, readFileSync(join(REPO_ROOT, file), 'utf8'))) {
            for (const list of commandLists(document)) {
                list.forEach((command, index) => {
                    const notice = noticeWaitedFor(command);

                    if (notice !== undefined) {
                        waits.push({ file, notice, previous: index === 0 ? undefined : list[index - 1] });
                    }
                });
            }
        }
    }

    return waits;
}

describe('a finish-notice wait follows a tap that cannot outlive the notice', () => {
    const waits = noticeWaits();

    it('finds the notice waits (a parser change that saw none would otherwise pass)', () => {
        expect(waits.length).toBeGreaterThanOrEqual(MIN_NOTICE_WAITS);
    });

    it('waits for a notice only as the first command after a tapOn', () => {
        const notAfterTap = waits
            .filter((wait) => !isRecord(wait.previous) || !('tapOn' in wait.previous))
            .map((wait) => `${wait.file}: "${wait.notice}"`);

        expect(notAfterTap).toEqual([]);
    });

    it(`caps that tap's settle wait at ${String(MAX_SETTLE_MS)} ms`, () => {
        const uncapped = waits
            .filter((wait) => {
                const cap = settleCapOf(wait.previous);

                return cap === undefined || cap > MAX_SETTLE_MS;
            })
            .map((wait) => `${wait.file}: "${wait.notice}"`);

        expect(uncapped).toEqual([]);
    });

    it("names each notice exactly as the editor's copy spells it", () => {
        const copy = readFileSync(join(REPO_ROOT, EDITOR_MESSAGES), 'utf8');

        expect(FINISH_NOTICES.filter((notice) => !copy.includes(`'${notice}'`))).toEqual([]);
    });
});
