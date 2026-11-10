/**
 * `foodPageStateOf` (private foods spec section 4.1): one wire answer in, exactly one of the twelve page states out, so the view
 * is an exhaustive switch. The author's `publicationState` is the only authority on states 5 to 11; a food that carries
 * none is somebody else's public food (state 12); a missing food and another cook's private or withdrawn food are the
 * same `NotFoundError`, so the page says nothing about which (state 2).
 */
import { FoodServiceClientError, NotFoundError, UnexpectedResponseError } from '@kitchensink/food-service-client';
import type { FoodResponse, PublicationRequestDetail, PublicationStateValue } from '@kitchensink/schema-food';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { foodPageStateOf, type FoodPageInput, type FoodPageState } from '../foodPageState.js';

const FOOD: FoodResponse = {
    id: 'f1',
    name: 'Oat milk',
    description: null,
    kind: 'generic',
    status: 'RESOLVED',
    nutrients: [],
    portions: [],
    provenance: {},
    variants: [],
};
const DETAIL: PublicationRequestDetail = {
    request: {
        id: 'r1',
        foodId: 'f1',
        versionNumber: 2,
        status: 'declined',
        declineReason: 'Too low',
        createdAt: '2026-11-09T10:00:00.000Z',
        decidedAt: '2026-11-09T11:00:00.000Z',
    },
    snapshot: {
        name: 'Oat',
        description: null,
        macros: { calories: 1, proteinG: 1, carbsG: 1, fatG: 1 },
        portions: [],
    },
};

const ready = (food: FoodResponse, extra: Partial<FoodPageInput> = {}): FoodPageInput => ({
    read: { phase: 'ready', result: { status: 'RESOLVED', food } },
    request: undefined,
    online: true,
    ...extra,
});

describe('FoodPageState', () => {
    it('has one author state per `publicationState` value and no other, so a new value is a compile error', () => {
        expectTypeOf<
            Extract<FoodPageState, { readonly request: unknown }>['kind']
        >().toEqualTypeOf<PublicationStateValue>();
    });
});

describe('foodPageStateOf', () => {
    it('1: a read still in flight is loading', () => {
        expect(
            foodPageStateOf({ read: { phase: 'pending', parked: false }, request: undefined, online: true }).kind,
        ).toBe('loading');
    });

    it('2: a NotFoundError is not found, for a missing id, another cook’s private food and a withdrawn food alike', () => {
        const input: FoodPageInput = {
            read: { phase: 'error', error: new NotFoundError('f1') },
            request: undefined,
            online: true,
        };

        expect(foodPageStateOf(input).kind).toBe('notFound');
    });

    it('3: any other failure is an error the cook can retry', () => {
        for (const error of [
            new UnexpectedResponseError(500, 'x'),
            new FoodServiceClientError('boom'),
            new Error('x'),
        ]) {
            expect(foodPageStateOf({ read: { phase: 'error', error }, request: undefined, online: true }).kind).toBe(
                'error',
            );
        }
    });

    it('4: a failed read with no connection, and no copy to show, is offline', () => {
        const input: FoodPageInput = {
            read: { phase: 'error', error: new Error('network') },
            request: undefined,
            online: false,
        };

        expect(foodPageStateOf(input).kind).toBe('offline');
    });

    it('4: a read TanStack parked with no connection is offline, not a spinner that never ends', () => {
        // The app's reads are `offlineFirst` with retry: offline, the first attempt fails and the retry parks, so the read
        // stays pending until the connection returns. Without this the page would load for as long as the device is offline.
        expect(
            foodPageStateOf({ read: { phase: 'pending', parked: true }, request: undefined, online: false }).kind,
        ).toBe('offline');
    });

    it('a read still in its first attempt is loading even offline: only a PARKED read is offline (as `PendingSlot`)', () => {
        // Mobile reads an unsure connection as offline, so a cold open must not flash the offline notice before it tried.
        expect(
            foodPageStateOf({ read: { phase: 'pending', parked: false }, request: undefined, online: false }).kind,
        ).toBe('loading');
        expect(
            foodPageStateOf({ read: { phase: 'pending', parked: true }, request: undefined, online: true }).kind,
        ).toBe('loading');
    });

    it('a 202 (a food still resolving) is an error, never one of the author states', () => {
        const input: FoodPageInput = {
            read: { phase: 'ready', result: { status: 'PENDING', id: 'f1' } },
            request: undefined,
            online: true,
        };

        expect(foodPageStateOf(input).kind).toBe('error');
    });

    it.each<[PublicationStateValue, string]>([
        ['private', 'private'],
        ['asked', 'asked'],
        ['notApproved', 'notApproved'],
        ['public', 'public'],
        ['editWaiting', 'editWaiting'],
        ['editNotApproved', 'editNotApproved'],
        ['withdrawn', 'withdrawn'],
    ])('5 to 11: publicationState %s is the %s state, carrying the food and the newest request', (word, kind) => {
        const state = foodPageStateOf(ready({ ...FOOD, publicationState: word }, { request: DETAIL }));

        expect(state.kind).toBe(kind);
        expect(state).toMatchObject({ food: { id: 'f1' }, request: DETAIL, actionsDisabled: false });
    });

    it('12: a food with no publicationState is another cook’s public food: facts only', () => {
        const state = foodPageStateOf(ready(FOOD));

        expect(state.kind).toBe('othersPublic');
    });

    it('a cached copy shown with no connection disables the actions but keeps the state', () => {
        const state = foodPageStateOf(ready({ ...FOOD, publicationState: 'private' }, { online: false }));

        expect(state).toMatchObject({ kind: 'private', actionsDisabled: true });
    });

    it('withdrawn and another cook’s public food have no actions to disable', () => {
        expect(foodPageStateOf(ready({ ...FOOD, publicationState: 'withdrawn' }, { online: false }))).toMatchObject({
            actionsDisabled: false,
        });
    });
});
