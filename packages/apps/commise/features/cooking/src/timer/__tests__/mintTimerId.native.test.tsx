/**
 * The native timer id (S3a.U3 C3). Hermes has no `crypto` global, so the leaf draws its 16 random bytes from
 * `expo-crypto`. The stub answers real random bytes and records the count asked for.
 */
import { describe, expect, it, vi } from 'vitest';

const getRandomBytes = vi.hoisted(() => vi.fn());

vi.mock('expo-crypto', () => ({ getRandomBytes }));

import { mintTimerId } from '../mintTimerId.native.js';
import { keptSchemaTakesId } from './timerIdFixtures.js';

getRandomBytes.mockImplementation((count: number) => crypto.getRandomValues(new Uint8Array(count)));

describe('mintTimerId (native)', () => {
    it('draws 16 bytes from expo-crypto and gives an id the kept record takes', () => {
        getRandomBytes.mockClear();

        const id = mintTimerId();

        expect(getRandomBytes).toHaveBeenCalledWith(16);
        expect(keptSchemaTakesId(id)).toBe(true);
    });

    it('gives a different id each time', () => {
        expect(mintTimerId()).not.toBe(mintTimerId());
    });
});
