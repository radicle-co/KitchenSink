/**
 * The state machine as a table (5.1 to 5.4): `nextState` reads only TRANSITIONS, so an edge that is not enforced is
 * forbidden, and a planned edge is forbidden until it is moved into TRANSITIONS.
 */
import { describe, expect, it } from 'vitest';

import { RecipeSourceType } from '../recipe.types.js';
import { ACTORS, LIFECYCLE_AUDIENCE_STATES, type LifecycleAudienceState } from '../recipeState/recipeStateValues.js';
import { canTransition, nextState, type TransitionFacts } from '../recipeState/nextState.js';
import type { ServerRefusalFacts } from '../recipeState/refusalOf.js';
import { TRANSITIONS } from '../recipeState/transitions.js';

const clean: ServerRefusalFacts = {
    sourceType: RecipeSourceType.USER_CREATED,
    sourceKind: null,
    statementKind: null,
    held: false,
    sourceCorrected: false,
    statementRequired: false,
    attestedFromPerson: false,
};
const cook = (overrides: Partial<TransitionFacts> = {}): TransitionFacts => ({
    actor: 'cook',
    source: clean,
    ...overrides,
});

describe('nextState: lifecycle and audience', () => {
    it.each([
        ['DPr', 'MAKE_PUBLIC', 'DPu'],
        ['DPu', 'MAKE_PRIVATE', 'DPr'],
        ['PPr', 'MAKE_PUBLIC', 'PPu'],
        ['PPu', 'UNPUBLISH', 'DPu'],
        ['PPr', 'UNPUBLISH', 'DPr'],
        ['PPu', 'DELETE', 'Del'],
        ['DPr', 'DELETE', 'Del'],
    ] as const)('%s --%s--> %s for a cook', (from, event, to) => {
        const facts = cook({ publishSheetAccepted: true, privateSlotFree: true });

        expect(nextState('lifecycleAudience', from, event, facts)).toEqual({ ok: true, to });
    });

    it('publishes a draft to the matching audience, and a private one only with a slot', () => {
        const ready = cook({ requirementsMet: true, publishSheetAccepted: true });

        expect(nextState('lifecycleAudience', 'DPu', 'PUBLISH', ready)).toEqual({ ok: true, to: 'PPu' });
        expect(canTransition('lifecycleAudience', 'DPr', 'PUBLISH', ready)).toBe(false);
        expect(nextState('lifecycleAudience', 'DPr', 'PUBLISH', { ...ready, privateSlotFree: true })).toEqual({
            ok: true,
            to: 'PPr',
        });
    });

    it('does not publish without the requirements or without the cook accepting the sheet', () => {
        const base = cook({ privateSlotFree: true });

        expect(canTransition('lifecycleAudience', 'DPr', 'PUBLISH', { ...base, publishSheetAccepted: true })).toBe(
            false,
        );
        expect(canTransition('lifecycleAudience', 'DPr', 'PUBLISH', { ...base, requirementsMet: true })).toBe(false);
    });

    it('refuses MAKE_PUBLIC with the refusal that holds, and names it', () => {
        const held = cook({ source: { ...clean, held: true } });

        expect(nextState('lifecycleAudience', 'DPr', 'MAKE_PUBLIC', held)).toEqual({
            ok: false,
            refusal: 'REFUSAL_SOURCE_CONFLICT',
        });
        expect(canTransition('lifecycleAudience', 'PPr', 'MAKE_PUBLIC', { ...held, publishSheetAccepted: true })).toBe(
            false,
        );
    });

    it('needs the Publish sheet to make a published recipe public, but not a draft', () => {
        expect(canTransition('lifecycleAudience', 'PPr', 'MAKE_PUBLIC', cook())).toBe(false);
        expect(canTransition('lifecycleAudience', 'DPr', 'MAKE_PUBLIC', cook())).toBe(true);
    });

    it('lets a published public recipe go private only for the cook, and only when a slot is free', () => {
        expect(canTransition('lifecycleAudience', 'PPu', 'MAKE_PRIVATE', cook())).toBe(false);
        expect(canTransition('lifecycleAudience', 'PPu', 'MAKE_PRIVATE', cook({ privateSlotFree: true }))).toBe(true);

        for (const actor of ['system', 'staff'] as const) {
            expect(
                canTransition('lifecycleAudience', 'PPu', 'MAKE_PRIVATE', {
                    ...cook({ privateSlotFree: true }),
                    actor,
                }),
            ).toBe(false);
        }
    });

    it('donates a recipe only when elected, with no statement owed, and no hold', () => {
        const donor = { ...cook(), actor: 'system', donationElected: true } as const;

        expect(nextState('lifecycleAudience', 'PPr', 'ERASE_DONATE', donor)).toEqual({ ok: true, to: 'PPu' });
        expect(canTransition('lifecycleAudience', 'DPr', 'ERASE_DONATE', donor)).toBe(true);
        expect(canTransition('lifecycleAudience', 'PPr', 'ERASE_DONATE', { ...donor, donationElected: false })).toBe(
            false,
        );
        expect(
            canTransition('lifecycleAudience', 'PPr', 'ERASE_DONATE', {
                ...donor,
                source: { ...clean, statementRequired: true },
            }),
        ).toBe(false);
        expect(
            canTransition('lifecycleAudience', 'PPr', 'ERASE_DONATE', {
                ...donor,
                source: { ...clean, sourceCorrected: true },
            }),
        ).toBe(false);
        expect(
            canTransition('lifecycleAudience', 'PPr', 'ERASE_DONATE', {
                ...donor,
                source: { ...clean, attestedFromPerson: true },
            }),
        ).toBe(false);
    });

    it('refuses an edge into Public while a refusal holds, whichever event takes it', () => {
        const ready = {
            requirementsMet: true,
            publishSheetAccepted: true,
            privateSlotFree: true,
            donationElected: true,
        };
        const fromPerson = cook({ ...ready, source: { ...clean, statementKind: 'fromPerson' } });
        const corrected = cook({ ...ready, source: { ...clean, sourceCorrected: true } });

        expect(nextState('lifecycleAudience', 'DPu', 'PUBLISH', fromPerson)).toEqual({
            ok: false,
            refusal: 'REFUSAL_FROM_PERSON',
        });
        expect(nextState('lifecycleAudience', 'DPu', 'PUBLISH', corrected)).toEqual({
            ok: false,
            refusal: 'REFUSAL_SOURCE_CORRECTED',
        });
        expect(nextState('lifecycleAudience', 'PPr', 'ERASE_DONATE', { ...corrected, actor: 'system' })).toEqual({
            ok: false,
            refusal: 'REFUSAL_SOURCE_CORRECTED',
        });
        expect(nextState('lifecycleAudience', 'DPr', 'PUBLISH', fromPerson)).toEqual({ ok: true, to: 'PPr' });
    });

    it('forbids every edge out of Deleted, and PUBLIC to a draft that is already public', () => {
        for (const event of [
            'MAKE_PUBLIC',
            'MAKE_PRIVATE',
            'PUBLISH',
            'UNPUBLISH',
            'DELETE',
            'ERASE_DONATE',
        ] as const) {
            expect(
                canTransition('lifecycleAudience', 'Del', event, {
                    ...cook({ requirementsMet: true, publishSheetAccepted: true, privateSlotFree: true }),
                    donationElected: true,
                }),
            ).toBe(false);
        }

        expect(canTransition('lifecycleAudience', 'DPu', 'MAKE_PUBLIC', cook())).toBe(false);
    });

    it('does not let a staff actor do a cook-only edge', () => {
        expect(canTransition('lifecycleAudience', 'DPr', 'MAKE_PUBLIC', { ...cook(), actor: 'staff' })).toBe(false);
    });
});

describe('nextState: origin', () => {
    it('answers an origin only while the source lock is open', () => {
        expect(nextState('origin', 'ORIGIN_UNSTATED', 'ANSWER_WEB_PAGE', cook({ sourceLock: 'open' }))).toEqual({
            ok: true,
            to: 'ORIGIN_WEB_PAGE',
        });
        expect(canTransition('origin', 'ORIGIN_UNSTATED', 'ANSWER_BOOK', cook({ sourceLock: 'locked' }))).toBe(false);
        expect(canTransition('origin', 'ORIGIN_UNSTATED', 'ANSWER_BOOK', cook())).toBe(false);
        expect(canTransition('origin', 'ORIGIN_OWN', 'ANSWER_PERSON', cook({ sourceLock: 'downgradeOnly' }))).toBe(
            false,
        );
    });

    it('lets an unconfirmed answer be replaced by another, and never touches Commise-written', () => {
        expect(canTransition('origin', 'ORIGIN_BOOK', 'ANSWER_OWN', cook({ sourceLock: 'open' }))).toBe(true);
        expect(canTransition('origin', 'ORIGIN_COMMISE_WRITTEN', 'ANSWER_OWN', cook({ sourceLock: 'open' }))).toBe(
            false,
        );
        expect(
            canTransition('origin', 'ORIGIN_UNSTATED', 'STAFF_CORRECT_TO_BOOK', {
                ...cook(),
                actor: 'staff',
                staffGrant: true,
                sourceConfirmed: true,
            }),
        ).toBe(true);
        expect(
            canTransition('origin', 'ORIGIN_UNSTATED', 'STAFF_CORRECT_TO_BOOK', {
                ...cook(),
                actor: 'staff',
                staffGrant: true,
                sourceConfirmed: true,
            }),
        ).toBe(true);
    });

    it('lets staff correct only a confirmed answer, and only with the grant', () => {
        const staff = { ...cook(), actor: 'staff', staffGrant: true, sourceConfirmed: true } as const;

        expect(nextState('origin', 'ORIGIN_OWN', 'STAFF_CORRECT_TO_PERSON', staff)).toEqual({
            ok: true,
            to: 'ORIGIN_PERSON',
        });
        expect(
            canTransition('origin', 'ORIGIN_OWN', 'STAFF_CORRECT_TO_PERSON', { ...staff, sourceConfirmed: false }),
        ).toBe(false);
        expect(canTransition('origin', 'ORIGIN_OWN', 'STAFF_CORRECT_TO_PERSON', { ...staff, staffGrant: false })).toBe(
            false,
        );
        expect(canTransition('origin', 'ORIGIN_OWN', 'STAFF_CORRECT_TO_OWN', staff)).toBe(false);
    });

    it('has no edge into Commise-written for anyone', () => {
        const staff = { ...cook(), actor: 'staff', staffGrant: true, sourceConfirmed: true } as const;

        for (const row of TRANSITIONS.filter((candidate) => candidate.axis === 'origin')) {
            const results = row.moves;
            expect(
                results.some((move) => move.to === 'ORIGIN_COMMISE_WRITTEN' || move.from === 'ORIGIN_COMMISE_WRITTEN'),
            ).toBe(false);
        }

        expect(canTransition('origin', 'ORIGIN_COMMISE_WRITTEN', 'STAFF_CORRECT_TO_BOOK', staff)).toBe(false);
    });

    it('lets only a confirmed "I wrote this" move down to a book or paid site, with a citation', () => {
        const down = cook({ sourceConfirmed: true, citationGiven: true, alreadyPrivate: true });

        expect(nextState('origin', 'ORIGIN_OWN', 'DOWNGRADE_BOOK', down)).toEqual({ ok: true, to: 'ORIGIN_BOOK' });
        expect(nextState('origin', 'ORIGIN_OWN', 'DOWNGRADE_PAID_SITE', down)).toEqual({
            ok: true,
            to: 'ORIGIN_PAID_SITE',
        });
        expect(canTransition('origin', 'ORIGIN_OWN', 'DOWNGRADE_BOOK', { ...down, citationGiven: false })).toBe(false);
        expect(canTransition('origin', 'ORIGIN_OWN', 'DOWNGRADE_BOOK', { ...down, sourceConfirmed: false })).toBe(
            false,
        );
        expect(canTransition('origin', 'ORIGIN_OWN', 'DOWNGRADE_BOOK', { ...down, alreadyPrivate: false })).toBe(false);
        expect(
            canTransition('origin', 'ORIGIN_OWN', 'DOWNGRADE_BOOK', {
                ...down,
                alreadyPrivate: false,
                privateSlotFree: true,
            }),
        ).toBe(true);
        expect(canTransition('origin', 'ORIGIN_BOOK', 'DOWNGRADE_BOOK', down)).toBe(false);
    });

    it('lets only a curator with the grant declare public domain, from unstated', () => {
        const curator = { ...cook(), actor: 'curator', curatorGrant: true } as const;

        expect(nextState('origin', 'ORIGIN_UNSTATED', 'CURATOR_DECLARE', curator)).toEqual({
            ok: true,
            to: 'ORIGIN_PUBLIC_DOMAIN',
        });
        expect(canTransition('origin', 'ORIGIN_UNSTATED', 'CURATOR_DECLARE', { ...curator, curatorGrant: false })).toBe(
            false,
        );
        expect(canTransition('origin', 'ORIGIN_BOOK', 'CURATOR_DECLARE', curator)).toBe(false);
    });

    it('detects a paste without changing the origin', () => {
        expect(nextState('origin', 'ORIGIN_UNSTATED', 'PASTE_DETECTED', { ...cook(), actor: 'system' })).toEqual({
            ok: true,
            to: 'ORIGIN_UNSTATED',
        });
    });
});

describe('nextState: confirmation and the hold', () => {
    it('confirms a source once, and never un-confirms it', () => {
        expect(nextState('sourceConfirmation', 'SOURCE_UNCONFIRMED', 'CONFIRM_SOURCE', cook())).toEqual({
            ok: true,
            to: 'SOURCE_CONFIRMED',
        });
        expect(canTransition('sourceConfirmation', 'SOURCE_CONFIRMED', 'CONFIRM_SOURCE', cook())).toBe(false);
        expect(TRANSITIONS.filter((row) => row.axis === 'sourceConfirmation').flatMap((row) => row.moves)).toEqual([
            { from: 'SOURCE_UNCONFIRMED', to: 'SOURCE_CONFIRMED' },
        ]);
    });

    it('sets the correction hold by staff only, and enforces no clear until PR 5', () => {
        const staff = { ...cook(), actor: 'staff', staffGrant: true, newAnswerCanOpenPublic: true } as const;

        expect(nextState('holdSourceCorrected', 'unset', 'STAFF_CORRECT', staff)).toEqual({ ok: true, to: 'set' });
        expect(canTransition('holdSourceCorrected', 'unset', 'STAFF_CORRECT', { ...staff, actor: 'cook' })).toBe(false);
        expect(canTransition('holdSourceCorrected', 'set', 'CLEAR_SOURCE_HOLD', staff)).toBe(false);
    });
});

describe('TRANSITIONS', () => {
    it('has at most one enforced row for an axis, a from-state and an event', () => {
        const seen = new Set<string>();

        for (const row of TRANSITIONS) {
            for (const move of row.moves) {
                const key = `${row.axis}|${move.from}|${row.event}`;

                expect(seen.has(key)).toBe(false);
                seen.add(key);
            }
        }
    });
});

describe('nextState: who may take which edge (each row of the table)', () => {
    it('lets the erasure actor DELETE, and nobody outside the row', () => {
        expect(canTransition('lifecycleAudience', 'PPu', 'DELETE', { ...cook(), actor: 'erasure' })).toBe(true);
        expect(canTransition('lifecycleAudience', 'PPu', 'DELETE', { ...cook(), actor: 'import' })).toBe(false);
        expect(canTransition('lifecycleAudience', 'PPu', 'DELETE', { ...cook(), actor: 'staff' })).toBe(false);
    });

    it('lets the cook, the system and staff CONFIRM_SOURCE, and no curator', () => {
        for (const actor of ['cook', 'system', 'staff'] as const) {
            expect(
                canTransition('sourceConfirmation', 'SOURCE_UNCONFIRMED', 'CONFIRM_SOURCE', { ...cook(), actor }),
            ).toBe(true);
        }

        expect(
            canTransition('sourceConfirmation', 'SOURCE_UNCONFIRMED', 'CONFIRM_SOURCE', {
                ...cook(),
                actor: 'curator',
            }),
        ).toBe(false);
    });

    it('sets the correction hold only with the staff grant, and only when the new answer can open Public', () => {
        const staff = { ...cook(), actor: 'staff', staffGrant: true, newAnswerCanOpenPublic: true } as const;

        expect(canTransition('holdSourceCorrected', 'unset', 'STAFF_CORRECT', staff)).toBe(true);
        expect(canTransition('holdSourceCorrected', 'unset', 'STAFF_CORRECT', { ...staff, staffGrant: false })).toBe(
            false,
        );
        expect(
            canTransition('holdSourceCorrected', 'unset', 'STAFF_CORRECT', {
                ...cook(),
                actor: 'staff',
                newAnswerCanOpenPublic: true,
            }),
        ).toBe(false);
        expect(
            canTransition('holdSourceCorrected', 'unset', 'STAFF_CORRECT', { ...staff, newAnswerCanOpenPublic: false }),
        ).toBe(false);
    });
});

describe('nextState: the staff correction targets (ORIGIN_PUBLIC_DOMAIN and ORIGIN_UNSTATED are not answers)', () => {
    const staff = { ...cook(), actor: 'staff', staffGrant: true, sourceConfirmed: true } as const;
    const events = (axis: string): string[] => TRANSITIONS.filter((row) => row.axis === axis).map((row) => row.event);

    it('has a target for exactly the five answers the wire accepts', () => {
        expect(
            events('origin')
                .filter((event) => event.startsWith('STAFF_CORRECT_TO_'))
                .sort((a, b) => a.localeCompare(b)),
        ).toEqual([
            'STAFF_CORRECT_TO_BOOK',
            'STAFF_CORRECT_TO_OWN',
            'STAFF_CORRECT_TO_PAID_SITE',
            'STAFF_CORRECT_TO_PERSON',
            'STAFF_CORRECT_TO_WEB_PAGE',
        ]);
    });

    it('has no STAFF_CORRECT_TO_UNSTATED or STAFF_CORRECT_TO_PUBLIC_DOMAIN, and refuses them if asked', () => {
        expect(events('origin')).not.toContain('STAFF_CORRECT_TO_UNSTATED');
        expect(events('origin')).not.toContain('STAFF_CORRECT_TO_PUBLIC_DOMAIN');
        expect(canTransition('origin', 'ORIGIN_BOOK', 'STAFF_CORRECT_TO_UNSTATED', staff)).toBe(false);
        expect(canTransition('origin', 'ORIGIN_BOOK', 'STAFF_CORRECT_TO_PUBLIC_DOMAIN', staff)).toBe(false);
    });

    it('corrects from public domain and from unstated, which are from-states', () => {
        expect(canTransition('origin', 'ORIGIN_PUBLIC_DOMAIN', 'STAFF_CORRECT_TO_BOOK', staff)).toBe(true);
        expect(canTransition('origin', 'ORIGIN_UNSTATED', 'STAFF_CORRECT_TO_OWN', staff)).toBe(true);
    });

    it('never lets a cook answer over public domain (the edge is unreachable), but lets the curator declare it', () => {
        const open = cook({ sourceLock: 'open' });

        expect(canTransition('origin', 'ORIGIN_PUBLIC_DOMAIN', 'ANSWER_OWN', open)).toBe(false);
        expect(canTransition('origin', 'ORIGIN_UNSTATED', 'ANSWER_OWN', open)).toBe(true);
        expect(
            TRANSITIONS.filter((row) => row.id.startsWith('ANSWER_'))
                .flatMap((row) => row.moves)
                .some((move) => move.from === 'ORIGIN_PUBLIC_DOMAIN'),
        ).toBe(false);
    });
});

describe('nextState: a failure says why', () => {
    const ready = { requirementsMet: true, publishSheetAccepted: true, privateSlotFree: true } as const;

    it('answers noEdge for an edge that is not in the table, and actor for the wrong actor', () => {
        expect(nextState('lifecycleAudience', 'Del', 'MAKE_PUBLIC', cook())).toEqual({ ok: false, cause: 'noEdge' });
        expect(nextState('lifecycleAudience', 'DPr', 'MAKE_PUBLIC', { ...cook(), actor: 'staff' })).toEqual({
            ok: false,
            cause: 'actor',
        });
    });

    it.each([
        [
            'publish without the requirements',
            { ...ready, requirementsMet: false },
            'DPu',
            'PUBLISH',
            'REFUSAL_PUBLISH_REQUIREMENTS',
        ],
        [
            'publish without the sheet',
            { ...ready, publishSheetAccepted: false },
            'DPu',
            'PUBLISH',
            'REFUSAL_PUBLIC_CONFIRMATION_REQUIRED',
        ],
        [
            'publish private with no slot',
            { ...ready, privateSlotFree: false },
            'DPr',
            'PUBLISH',
            'REFUSAL_NO_PRIVATE_SLOT',
        ],
        [
            'make a published recipe public without the sheet',
            { ...ready, publishSheetAccepted: false },
            'PPr',
            'MAKE_PUBLIC',
            'REFUSAL_PUBLIC_CONFIRMATION_REQUIRED',
        ],
        [
            'make a published recipe private with no slot',
            { privateSlotFree: false },
            'PPu',
            'MAKE_PRIVATE',
            'REFUSAL_NO_PRIVATE_SLOT',
        ],
    ] as const)('names the refusal when you %s', (_label, extra, from, event, refusal) => {
        expect(nextState('lifecycleAudience', from, event, cook(extra))).toEqual({ ok: false, refusal });
    });

    it('names REFUSAL_SOURCE_LOCKED when the source lock is not open', () => {
        expect(nextState('origin', 'ORIGIN_UNSTATED', 'ANSWER_BOOK', cook({ sourceLock: 'locked' }))).toEqual({
            ok: false,
            refusal: 'REFUSAL_SOURCE_LOCKED',
        });
    });

    it('names no refusal for a guard the model has no refusal for, and says it was the guard', () => {
        expect(nextState('lifecycleAudience', 'PPr', 'ERASE_DONATE', { ...cook(), actor: 'system' })).toEqual({
            ok: false,
            cause: 'guard',
        });
        expect(nextState('origin', 'ORIGIN_UNSTATED', 'CURATOR_DECLARE', { ...cook(), actor: 'curator' })).toEqual({
            ok: false,
            cause: 'guard',
        });
    });

    it('prefers the refusalOf refusal to a guard failure for an edge into Public', () => {
        expect(nextState('lifecycleAudience', 'DPu', 'PUBLISH', cook({ source: { ...clean, held: true } }))).toEqual({
            ok: false,
            refusal: 'REFUSAL_SOURCE_CONFLICT',
        });
    });
});

describe('nextState: Commise never makes a recipe private (ADR-0105, AE9)', () => {
    const PRIVATE_STATES = ['DPr', 'PPr'] as const;

    it('has no enforced row that moves a recipe to a private state for an actor other than the cook', () => {
        const offenders = TRANSITIONS.filter((row) => row.axis === 'lifecycleAudience')
            .filter((row) => row.moves.some((move) => (PRIVATE_STATES as readonly string[]).includes(move.to)))
            .filter((row) => row.actors.some((actor) => actor !== 'cook'))
            .map((row) => row.id);

        expect(offenders).toEqual([]);
    });

    it('accepts no FORCE_PRIVATE event from any state, for any actor, with every fact set', () => {
        const everything = cook({ privateSlotFree: true, publishSheetAccepted: true, requirementsMet: true });

        for (const from of Object.keys(LIFECYCLE_AUDIENCE_STATES) as LifecycleAudienceState[]) {
            for (const actor of ACTORS) {
                expect(nextState('lifecycleAudience', from, 'FORCE_PRIVATE', { ...everything, actor })).toEqual({
                    ok: false,
                    cause: 'noEdge',
                });
            }
        }
    });

    it('refuses MAKE_PRIVATE of a published public recipe when no private slot is free', () => {
        expect(nextState('lifecycleAudience', 'PPu', 'MAKE_PRIVATE', cook({ privateSlotFree: false }))).toEqual({
            ok: false,
            refusal: 'REFUSAL_NO_PRIVATE_SLOT',
        });
        expect(nextState('lifecycleAudience', 'PPu', 'MAKE_PRIVATE', cook())).toEqual({
            ok: false,
            refusal: 'REFUSAL_NO_PRIVATE_SLOT',
        });
    });
});
