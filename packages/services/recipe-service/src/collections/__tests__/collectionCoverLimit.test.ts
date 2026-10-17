/**
 * `COLLECTION_COVER_LIMIT` has ONE authority: the wire schema; it also bounds `coverPhotoUrls`. The DAL and the
 * service import it from there; a second declaration in the DAL could drift from the bound the response enforces.
 */
import { describe, expect, it } from 'vitest';

import { COLLECTION_COVER_LIMIT } from '../collections.schema.js';

describe('COLLECTION_COVER_LIMIT', () => {
    it('is exported by the schema module', () => {
        expect(COLLECTION_COVER_LIMIT).toBe(4);
    });
});
