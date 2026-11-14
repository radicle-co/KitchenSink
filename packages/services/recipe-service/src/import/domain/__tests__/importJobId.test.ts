/**
 * The id an item's parse job is created under (ADR-0072 §2).
 *
 * A job created under an id the importer derives from (import, ordinal, generation) is what makes a retry after a crash find
 * the SAME job instead of making a second paid one. The mutations: an id that ignores the generation (a replacement for an
 * expired job would collide with its predecessor), or one that is not a valid UUID (the column and `z.uuid()` refuse it).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { sha256Hex } from '../../../common/sha256.js';
import { importJobIdOf } from '../importJobId.js';

const IMPORT = '66666666-6666-4666-8666-000000000001';
const jobId = (importId: string, ordinal: number, generation: number) =>
    importJobIdOf(importId, ordinal, generation, sha256Hex);

describe('importJobIdOf', () => {
    it('is deterministic: the same item and generation always give the same id', () => {
        expect(jobId(IMPORT, 4, 0)).toBe(jobId(IMPORT, 4, 0));
    });

    it('⛔ differs by import, by ordinal AND by generation', () => {
        const ids = new Set([
            jobId(IMPORT, 4, 0),
            jobId(IMPORT, 5, 0),
            jobId(IMPORT, 4, 1),
            jobId('66666666-6666-4666-8666-000000000002', 4, 0),
        ]);

        expect(ids.size).toBe(4);
    });

    it('does not confuse (ordinal 1, generation 12) with (ordinal 11, generation 2)', () => {
        expect(jobId(IMPORT, 1, 12)).not.toBe(jobId(IMPORT, 11, 2));
    });

    it('is a valid UUID the column and the wire both accept (an RFC 9562 version 8, custom, id)', () => {
        const id = jobId(IMPORT, 4, 0);

        expect(z.uuid().safeParse(id).success).toBe(true);
        expect(id[14]).toBe('8');
        expect(['8', '9', 'a', 'b']).toContain(id[19]);
    });
});
