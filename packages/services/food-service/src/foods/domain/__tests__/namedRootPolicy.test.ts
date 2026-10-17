/**
 * What a remote pick does with the live catalog root that already carries its name (ADR-0055 point 10; the lead's
 * ruling on S7.6): a root holding a record answers the pick, and a placeholder is completed with the picked item, so a
 * cook's pick is never bound to a root with no data. One case per member of `foodStatusEnum`.
 */
import { describe, expect, it } from 'vitest';

import type { FoodStatus } from '../../dao/food.dao.js';
import { answersItsName, namedRootActionOf, type NamedRootAction } from '../namedRootPolicy.js';

describe('namedRootActionOf', () => {
    it.each<[FoodStatus, NamedRootAction]>([
        ['RESOLVED', { kind: 'answer' }],
        ['PENDING', { kind: 'complete', reactivateFrom: undefined }],
        ['AWAITING_RETRY', { kind: 'complete', reactivateFrom: undefined }],
        ['UNRESOLVED', { kind: 'complete', reactivateFrom: undefined }],
        // `RESOLVED` is not reachable from a terminal status (FR-028a), so the completion reactivates it first.
        ['NOT_FOUND', { kind: 'complete', reactivateFrom: 'NOT_FOUND' }],
        ['FAILED', { kind: 'complete', reactivateFrom: 'FAILED' }],
    ])('%s → %j', (status, action) => {
        expect(namedRootActionOf(status)).toStrictEqual(action);
    });

    it.each<FoodStatus>(['DELETING', 'WITHDRAWN'])(
        'refuses %s as a defect: only an authored food is ever in it, and an authored food holds no catalog name',
        (status) => {
            expect(() => namedRootActionOf(status)).toThrow(/authored/u);
        },
    );
});

describe('answersItsName — what search hides a remote hit by and a pick answers (R66)', () => {
    it.each<[FoodStatus, boolean]>([
        ['RESOLVED', true],
        ['PENDING', false],
        ['AWAITING_RETRY', false],
        ['UNRESOLVED', false],
        ['NOT_FOUND', false],
        ['FAILED', false],
    ])('%s → %s', (status, answers) => {
        expect(answersItsName(status)).toBe(answers);
    });
});
