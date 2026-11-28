/**
 * PLANNED is not enforced: no (axis, event) pair of the enforced table appears in it, and nothing but the doc
 * generator imports it (the repoGuards check holds that).
 */
import { describe, expect, it } from 'vitest';

import { LABELLED_NAMES } from '../recipeState/labelledNames.js';
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

describe('SAVE_AS_PRIVATE is enforced since heldPublicSave U8 (ADR-0103)', () => {
    it('is a live cook edge from a published public recipe to a published private one, behind a free slot, and no longer planned', () => {
        expect(TRANSITIONS.filter((row) => row.id === 'SAVE_AS_PRIVATE')).toEqual([
            {
                id: 'SAVE_AS_PRIVATE',
                group: 'MAKE_PRIVATE_PUBLISHED',
                axis: 'lifecycleAudience',
                event: 'SAVE_AS_PRIVATE',
                actors: ['cook'],
                guard: 'privateSlotFree',
                moves: [{ from: 'PPu', to: 'PPr' }],
            },
        ]);
        expect(PLANNED.some((row) => row.eventId === 'SAVE_AS_PRIVATE')).toBe(false);
    });
});

describe('PLANNED: held means hidden (ADR-0105)', () => {
    const NEW_IDS = [
        'SAVE_CANNOT_STAY_PUBLIC',
        'SAVE_AND_HIDE',
        'SAVE_WHILE_HIDDEN',
        'CREATE_CANNOT_GO_PUBLIC',
        'CREATE_PRIVATE_NO_SLOT',
        'PUBLISH_DRAFT_NO_SLOT',
        'HIDE_AFTER_CHECK',
        'SOURCE_HOLD_LIFTED_BY_REWRITE',
        'EARNED_REWRITE_CLEARS_HOLD',
        'MAKE_PUBLIC_TOO_CLOSE_PRIVATE',
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

    it('holds the ten new rows, in order, and none of the deleted ones', () => {
        expect(ids.filter((id) => NEW_IDS.includes(id))).toEqual(NEW_IDS);
        expect(ids.filter((id) => DELETED_IDS.includes(id))).toEqual([]);
    });

    it('has no row that moves a recipe to a private state with an actor other than the cook', () => {
        const actorsOf = (actor: string): string[] => actor.split(',').map((name) => name.trim());
        const offenders = PLANNED.filter(
            (row) => /\b(PPr|DPr)\b/.test(row.to) && !actorsOf(row.actor).every((name) => name === 'cook'),
        ).map((row) => row.eventId);

        expect(offenders).toEqual([]);
    });

    it('refuses a save of a recipe a staff correction holds, as it refuses any save that cannot stay public', () => {
        const row = PLANNED.find((entry) => entry.eventId === 'SAVE_CANNOT_STAY_PUBLIC');

        const hidden = PLANNED.find((entry) => entry.eventId === 'SAVE_WHILE_HIDDEN');

        expect(row?.from).toBe('PPu, readable');
        expect(row?.guard).not.toContain('staff correction');
        expect(hidden?.guard).toContain('sourceCorrected');
        expect(hidden?.to).toContain('REFUSAL_SAVE_CANNOT_STAY_PUBLIC');
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

    it('answers a not-approved publish of a public draft with the draft door, never with REFUSAL_CONTENT_NOT_APPROVED', () => {
        const publish = PLANNED.find((row) => row.eventId === 'CREATE_CANNOT_GO_PUBLIC');
        const makePublic = PLANNED.find((row) => row.eventId === 'MAKE_PUBLIC_NOT_APPROVED');

        expect(publish?.from).toContain('DPu');
        expect(publish?.to).toContain('draft door');
        expect(publish?.to).not.toContain('REFUSAL_CONTENT_NOT_APPROVED');
        expect(makePublic?.from).toBe('PPr');
        expect(makePublic?.guard).toContain('REFUSAL_CONTENT_NOT_APPROVED');
        expect(LABELLED_NAMES.VIEW_DRAFT_DOOR.shapes).toContain('.title');
        expect(LABELLED_NAMES.VIEW_SAVE_REFUSED.shapes).toContain('.why.notApproved');
    });

    it('clears a correction hold on an earned rewrite only by a system clear, for a third-party answer', () => {
        const row = PLANNED.find((entry) => entry.eventId === 'EARNED_REWRITE_CLEARS_HOLD');

        expect(row?.from).toContain('HOLD_SOURCE_CORRECTED');
        expect(row?.actor).toBe('system');
        expect(row?.guard).toContain('corrected answer is third-party');
        expect(row?.guard).not.toContain('evidence');
        expect(row?.guard).toContain('clear record');
        expect(row?.to).toContain('exactly this recipe');
        expect(row?.pending).toContain('PR 5');
        expect(PLANNED.find((entry) => entry.eventId === 'SOURCE_HOLD_LIFTED_BY_REWRITE')?.from).not.toContain(
            'HOLD_SOURCE_CORRECTED',
        );
    });
});
