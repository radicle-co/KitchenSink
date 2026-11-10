/**
 * `requireId` (FR-006): the one check every food route applies to its `:id` path param, so a malformed id is the `400
 * INVALID_ID` a caller can act on, never a DAO read that fails as a `500`.
 */
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { newFoodId } from '../../db/ulid.js';
import { requireId } from '../requireCaller.js';

/** The status and code an `HttpException` would answer, or what was thrown instead. */
function refusalOf(run: () => void): unknown {
    try {
        run();
    } catch (error) {
        return error instanceof HttpException
            ? { status: error.getStatus(), body: error.getResponse() }
            : { notAnHttpException: error };
    }

    return 'no refusal';
}

describe('requireId', () => {
    it('admits a food ULID', () => {
        expect(
            refusalOf(() => {
                requireId(newFoodId());
            }),
        ).toBe('no refusal');
    });

    it.each(['', 'not-a-ulid', '01JPR1VATEF00D00000000000', '01JAUTH0REDF00D00000000000', "'; drop table food"])(
        'refuses %j with 400 INVALID_ID',
        (id) => {
            expect(
                refusalOf(() => {
                    requireId(id);
                }),
            ).toMatchObject({ status: 400, body: { code: 'INVALID_ID' } });
        },
    );
});
