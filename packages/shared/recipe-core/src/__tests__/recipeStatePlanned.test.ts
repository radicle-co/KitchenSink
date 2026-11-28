/**
 * PLANNED is not enforced: no (axis, event) pair of the enforced table appears in it, and nothing but the doc
 * generator imports it (the repoGuards check holds that).
 */
import { describe, expect, it } from 'vitest';

import { PLANNED } from '../recipeState/plannedTransitions.js';
import { TRANSITIONS } from '../recipeState/transitions.js';

const plannedAxisOf = (axis: string): string => (axis.startsWith('hold') ? 'holds' : axis);

describe('PLANNED', () => {
    it('shares no axis and event with an enforced edge', () => {
        const enforced = new Set(TRANSITIONS.map((row) => `${plannedAxisOf(row.axis)}:${row.event}`));
        const shared = PLANNED.map((row) => `${row.axis}:${row.eventId}`).filter((pair) => enforced.has(pair));

        expect(shared).toEqual([]);
    });

    it('names the work that builds each row, and gives each row a typed axis and event id', () => {
        for (const row of PLANNED) {
            expect(row.pending).not.toBe('');
            expect(row.eventId).toMatch(/^[A-Z][A-Z0-9_]+$/);
            expect(['holds', 'lifecycleAudience', 'origin', 'rewrittenFact', 'stepsCredit', 'bulk']).toContain(
                row.axis,
            );
        }
    });

    it('holds the clear of the correction hold until PR 5 builds it', () => {
        expect(PLANNED.find((row) => row.eventId === 'CLEAR_SOURCE_HOLD')?.pending).toBe('PR 5');
    });
});

describe('PLANNED: held means hidden (ADR-0105)', () => {
    const NEW_IDS = [
        'SAVE_CANNOT_STAY_PUBLIC',
        'SAVE_AS_PRIVATE',
        'SAVE_AND_HIDE',
        'SAVE_WHILE_HIDDEN',
        'CREATE_CANNOT_GO_PUBLIC',
        'PUBLISH_DRAFT_NO_SLOT',
        'HIDE_AFTER_CHECK',
        'SOURCE_HOLD_LIFTED_BY_REWRITE',
    ];
    const DELETED_IDS = [
        'SAVE_TOO_CLOSE',
        'SAVE_TOO_CLOSE_NO_SLOT',
        'MAKE_PUBLIC_TOO_CLOSE',
        'REVIEW_FOUND_TOO_CLOSE',
        'FORCE_PRIVATE_AFTER_REVIEW',
        'SAVE_SOURCE_HELD',
        'RERUN_CHECK_FAILS_IN_SAVE',
        'RERUN_CHECK_FAILS_LATER',
        'SITE_CLAIM_NOT_CONFIRMED',
    ];
    const ids = PLANNED.map((row) => row.eventId);

    it('holds the eight new rows, in order, and none of the deleted ones', () => {
        expect(ids.filter((id) => NEW_IDS.includes(id))).toEqual(NEW_IDS);
        expect(ids.filter((id) => DELETED_IDS.includes(id))).toEqual([]);
    });

    it('has no row that moves a recipe to a private state with an actor other than the cook', () => {
        const offenders = PLANNED.filter((row) => /^(PPr|DPr)\b/.test(row.to) && row.actor !== 'cook').map(
            (row) => row.eventId,
        );

        expect(offenders).toEqual([]);
    });

    it("makes Save and hide the cook's own choice, with no free private slot", () => {
        const row = PLANNED.find((entry) => entry.eventId === 'SAVE_AND_HIDE');

        expect(row?.actor).toBe('cook');
        expect(row?.guard).toContain('no free private slot');
    });

    it('lets a save of an already hidden recipe open the sheet, and saves only on an explicit Save and hide with no slot', () => {
        const row = PLANNED.find((entry) => entry.eventId === 'SAVE_WHILE_HIDDEN');

        expect(row?.from).toContain('PPu');
        expect(row?.to).toContain('REFUSAL_SAVE_CANNOT_STAY_PUBLIC');
        expect(row?.to).toContain('Save and hide');
    });

    it('widens the rewrite guards to own and unstated origins with the evidence rule holding (G1)', () => {
        for (const id of ['COOK_EDIT_PASSES', 'KEEP_AI_REWRITE']) {
            expect(PLANNED.find((row) => row.eventId === id)?.guard).toMatch(/own or unstated/);
        }
    });

    it('keeps the clear of the correction hold readable-again for a public recipe', () => {
        expect(PLANNED.find((row) => row.eventId === 'CLEAR_SOURCE_HOLD')?.to).toContain('Readable again');
    });
});
