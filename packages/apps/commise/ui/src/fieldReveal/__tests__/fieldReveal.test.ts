/**
 * The field reveal's Specification and its state machine (`docs/design/rowEditorOpenDecisions.md` E1, item 7
 * condition 2): whether a field and three option rows fit in the visible area, where the host scrolls when they do not,
 * how tall the blank space is that gives that scroll room, and the `closed → armed → revealing → revealed → closed`
 * lifetime of one opening.
 */
import { describe, expect, it } from 'vitest';

import {
    REVEAL_CLOSED,
    REVEAL_GAP_DP,
    fitsBelow,
    revealReducer,
    revealTarget,
    spacerHasRoom,
    spacerHeight,
    type RevealEvent,
    type RevealState,
} from '../fieldReveal.js';
import type { RevealRequest, RevealTarget } from '../fieldRevealContext.js';

/** Three 48 dp option rows under a 4 dp margin and 4 dp of padding: the Combobox leaf's own budget. */
const THREE_ROWS = 4 + 4 + 3 * 48;

const field = (): RevealTarget => ({ measureLayout: () => undefined });

describe('fitsBelow', () => {
    // The field's top at 20 and its 48 dp height leave 20 + 48 + 152 = 220 dp to the three rows' end.
    it.each([
        ['the three rows end exactly at the bottom', { top: 20, height: 48 }, 220, true],
        ['the third row is cut by one dp', { top: 20, height: 48 }, 219, false],
        ['there is room to spare', { top: 0, height: 48 }, 600, true],
        ['the field is above the visible area', { top: -1, height: 48 }, 600, false],
        ['nothing is laid out yet', { top: 0, height: 48 }, 0, false],
    ] as const)('%s', (_case, box, viewport, fits) => {
        expect(fitsBelow(box, THREE_ROWS, viewport)).toBe(fits);
    });
});

describe('revealTarget', () => {
    it('scrolls the field to the top of the visible area, the gap above it', () => {
        expect(revealTarget({ top: 300, offset: 500 })).toBe(800 - REVEAL_GAP_DP);
        expect(REVEAL_GAP_DP).toBe(8);
    });

    it('never asks for an offset above the content', () => {
        expect(revealTarget({ top: 4, offset: 0 })).toBe(0);
    });
});

describe('spacerHeight and spacerHasRoom', () => {
    it('is 0 until the space has been laid out once, so its first frame adds nothing', () => {
        expect(spacerHeight(800, 295, null)).toBe(0);
    });

    it('makes the content end exactly where the target needs it: target + viewport', () => {
        expect(spacerHeight(800, 295, 900)).toBe(195);
        expect(spacerHasRoom(800, 295, { y: 900, height: 195 })).toBe(true);
    });

    it('shrinks by what the rows above it add, so the content end does not move', () => {
        expect(spacerHeight(800, 295, 950)).toBe(145);
    });

    it('is 0 when the content below the field is already long enough', () => {
        expect(spacerHeight(800, 295, 2000)).toBe(0);
        expect(spacerHasRoom(800, 295, { y: 2000, height: 0 })).toBe(true);
    });

    it('rounds up and forgives a sub-dp layout, so a rounded frame still scrolls', () => {
        expect(spacerHeight(800.4, 295, 900)).toBe(196);
        expect(spacerHasRoom(800, 295, { y: 900, height: 194.5 })).toBe(true);
        expect(spacerHasRoom(800, 295, { y: 900, height: 190 })).toBe(false);
    });
});

describe('revealReducer', () => {
    const a = field();
    const b = field();
    const request = (target: RevealTarget): RevealRequest => ({ field: target, below: THREE_ROWS });
    const armed: RevealState = { kind: 'armed', request: request(a) };
    const revealing: RevealState = { kind: 'revealing', request: request(a), target: 400, spacerTop: null };
    const laidOut: RevealState = { kind: 'revealing', request: request(a), target: 400, spacerTop: 900 };
    const revealed: RevealState = { kind: 'revealed', request: request(a), target: 400, spacerTop: 900 };

    const cases: readonly (readonly [string, RevealState, RevealEvent, RevealState])[] = [
        ['a request arms a closed host', REVEAL_CLOSED, { kind: 'requested', request: request(a) }, armed],
        ['a misfit starts the reveal', armed, { kind: 'misfit', field: a, target: 400 }, revealing],
        ['the space records where it was laid out', revealing, { kind: 'spacerLaidOut', top: 900 }, laidOut],
        ['the scroll ends the reveal', laidOut, { kind: 'scrolled', field: a }, revealed],
        [
            'the space keeps following the rows once revealed',
            revealed,
            { kind: 'spacerLaidOut', top: 950 },
            { ...revealed, spacerTop: 950 },
        ],
        ['its own release closes an armed host', armed, { kind: 'released', field: a }, REVEAL_CLOSED],
        ['its own release closes a revealing host', revealing, { kind: 'released', field: a }, REVEAL_CLOSED],
        ['its own release closes a revealed host', revealed, { kind: 'released', field: a }, REVEAL_CLOSED],
        [
            'a new opening re-arms a revealed host',
            revealed,
            { kind: 'requested', request: request(b) },
            {
                kind: 'armed',
                request: request(b),
            },
        ],
        ['a release from a different field is ignored', armed, { kind: 'released', field: b }, armed],
        ['a misfit for a different field is ignored', armed, { kind: 'misfit', field: b, target: 400 }, armed],
        [
            'a late misfit after the reveal started is ignored',
            revealing,
            { kind: 'misfit', field: a, target: 9 },
            revealing,
        ],
        [
            'a misfit on a closed host is ignored',
            REVEAL_CLOSED,
            { kind: 'misfit', field: a, target: 400 },
            REVEAL_CLOSED,
        ],
        ['a scroll before the reveal is ignored', armed, { kind: 'scrolled', field: a }, armed],
        ['a second scroll is ignored: one move per opening', revealed, { kind: 'scrolled', field: a }, revealed],
        ['a scroll for a different field is ignored', laidOut, { kind: 'scrolled', field: b }, laidOut],
        ['a space laid out while armed is ignored', armed, { kind: 'spacerLaidOut', top: 900 }, armed],
        ['a release on a closed host is ignored', REVEAL_CLOSED, { kind: 'released', field: a }, REVEAL_CLOSED],
    ];

    it.each(cases)('%s', (_case, state, event, next) => {
        expect(revealReducer(state, event)).toEqual(next);
    });

    it('keeps the same state object when nothing changes, so the host does not re-render', () => {
        expect(revealReducer(laidOut, { kind: 'spacerLaidOut', top: 900 })).toBe(laidOut);
        expect(revealReducer(armed, { kind: 'released', field: b })).toBe(armed);
    });
});
