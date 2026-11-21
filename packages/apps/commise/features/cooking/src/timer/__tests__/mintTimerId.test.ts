/** The web timer id (S3a.U3 C3): a UUIDv7 the kept record accepts, new on every call. */
import { describe, expect, it } from 'vitest';

import { mintTimerId } from '../mintTimerId.js';
import { keptSchemaTakesId } from './timerIdFixtures.js';

describe('mintTimerId (web)', () => {
    it('gives an id the kept record takes', () => {
        expect(keptSchemaTakesId(mintTimerId())).toBe(true);
    });

    it('gives a different id each time', () => {
        expect(mintTimerId()).not.toBe(mintTimerId());
    });

    it('is checked against a version 4 id, which the kept record refuses', () => {
        expect(keptSchemaTakesId(crypto.randomUUID())).toBe(false);
    });
});
