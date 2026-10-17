/**
 * Unit tests for `answeredRootIds` (ADR-0040, food half): which ids a food-service answer discloses to its caller, and
 * so which test-picked roots a real cook's answer must hold. Written RED-first.
 *
 * One cell per field an answer can name a root in. A reader that dropped a field (the forward target, a variant's
 * root) shows here as a missing id, which is a root the purge could delete while a real cook's recipe binds it.
 */
import { describe, expect, it } from 'vitest';

import type { AddResponse, BatchResponse, FoodRefEntry, StatusResponse } from '../../foods.schema.js';
import { idsOfAdd, idsOfBatch, idsOfFood, idsOfRefEntries, idsOfStatus } from '../answeredRootIds.js';

describe('idsOfAdd', () => {
    it('names the root the add answered', () => {
        const response: AddResponse = { id: 'R1', status: 'PENDING' };

        expect(idsOfAdd(response)).toStrictEqual(['R1']);
    });

    it('also names the live entry a retired root forwards to', () => {
        const response: AddResponse = { id: 'R1', status: 'RESOLVED', forwardedTo: { kind: 'root', id: 'R2' } };

        expect(idsOfAdd(response)).toStrictEqual(['R1', 'R2']);
    });
});

describe('idsOfBatch', () => {
    it('names every item and every forward target, in order', () => {
        const response: BatchResponse = {
            items: [
                { id: 'R1', status: 'PENDING' },
                { id: 'R2', status: 'RESOLVED', name: 'kale', forwardedTo: { kind: 'root', id: 'R3' } },
            ],
        };

        expect(idsOfBatch(response)).toStrictEqual(['R1', 'R2', 'R3']);
    });

    it('names nothing for an empty batch', () => {
        expect(idsOfBatch({ items: [] })).toStrictEqual([]);
    });
});

describe('idsOfRefEntries', () => {
    const found = (extra: Partial<Extract<FoodRefEntry, { outcome: 'found' }>>): FoodRefEntry => ({
        outcome: 'found',
        ref: { kind: 'root', id: 'R1' },
        name: 'kale',
        status: 'RESOLVED',
        ...extra,
    });

    it('names a found ref, its forward target and a variant’s root', () => {
        const entries: FoodRefEntry[] = [
            found({}),
            found({ ref: { kind: 'variant', id: 'V1' }, variant: { rootId: 'R2', parts: [] as never } }),
            found({ forwardedTo: { kind: 'root', id: 'R3' } }),
        ];

        expect(idsOfRefEntries(entries)).toStrictEqual(['R1', 'V1', 'R2', 'R1', 'R3']);
    });

    it('names an absent ref too: the caller was answered that id', () => {
        expect(idsOfRefEntries([{ outcome: 'absent', ref: { kind: 'root', id: 'R9' } }])).toStrictEqual(['R9']);
    });
});

describe('idsOfFood', () => {
    it('names the requested id alone for a live food', () => {
        expect(idsOfFood({ id: 'R1' })).toStrictEqual(['R1']);
    });

    it('also names the live root or variant a retired root forwards to', () => {
        expect(idsOfFood({ id: 'R1', forwardedTo: { kind: 'root', id: 'R2' } })).toStrictEqual(['R1', 'R2']);
    });
});

describe('idsOfStatus', () => {
    it('names the requested id when no record is attached', () => {
        const response: StatusResponse = { id: 'R1', status: 'PENDING' };

        expect(idsOfStatus(response)).toStrictEqual(['R1']);
    });

    it('names the forward target of the record a RESOLVED status carries', () => {
        const response = {
            id: 'R1',
            status: 'RESOLVED',
            food: { id: 'R1', forwardedTo: { kind: 'root', id: 'R2' } },
        } as StatusResponse;

        expect(idsOfStatus(response)).toStrictEqual(['R1', 'R2']);
    });
});
