/**
 * THE PULL SCENARIO'S FIXTURE IS FOUND BEFORE IT IS CREATED.
 *
 * ⛔ The defect, measured on run 34782454327 (pr-91): `pullFromSource.load.js` built a source collection and
 * a clone per VU on EVERY run, as persistent pool identities that nothing ever reclaims. Each run added two
 * collections per VU name against `MAX_COLLECTIONS_PER_OWNER` (50, REQ-049b), so a long-lived preview crossed
 * the cap: the service logged 18 `POST /api/v1/collections -> 409 COLLECTION_LIMIT_REACHED`, the scenario
 * counted exactly 18 `http_req_failed` of 58, and `abortOnFail` stopped it at 30 s having measured nothing.
 *
 * So a VU looks its fixture up by NAME first and creates only what is missing. These tests pin the picker's
 * contract: a name is matched EXACTLY (VU 1 must never adopt VU 11's collection, which a sibling VU of the same
 * pool user is driving), a CLONE is recognised by pointing at the source it pairs with, and a clone is never
 * mistaken for a source.
 */
import { describe, expect, it } from 'vitest';

import { reusableClonePair } from '../k6/collectionFixture.js';

const NAME = 'Pull load source 1';

/** A `GET /api/v1/collections` body, newest first, as the service pages it. */
const listing = (...rows: readonly { id: string; name: string; sourceCollectionId?: string }[]) => ({
    data: rows,
    total: rows.length,
    page: 1,
    pageSize: 100,
    hasMore: false,
});

describe('reusableClonePair', () => {
    it('finds nothing in an empty library, so the VU creates both halves', () => {
        expect(reusableClonePair(listing(), NAME)).toEqual({ sourceId: null, cloneId: null });
    });

    it('reuses an existing source AND the clone that points at it — no create at all', () => {
        const body = listing(
            { id: 'clone-a', name: NAME, sourceCollectionId: 'source-a' },
            { id: 'source-a', name: NAME },
        );

        expect(reusableClonePair(body, NAME)).toEqual({ sourceId: 'source-a', cloneId: 'clone-a' });
    });

    it('reuses a source with no clone, and reports the clone missing so only the clone is created', () => {
        expect(reusableClonePair(listing({ id: 'source-a', name: NAME }), NAME)).toEqual({
            sourceId: 'source-a',
            cloneId: null,
        });
    });

    it('prefers a source that already HAS a clone over one that does not, so a healed library stops growing', () => {
        // The state a capped preview is in today: many leftover runs, some of which died between the two creates.
        const body = listing(
            { id: 'source-orphan', name: NAME },
            { id: 'clone-b', name: NAME, sourceCollectionId: 'source-b' },
            { id: 'source-b', name: NAME },
        );

        expect(reusableClonePair(body, NAME)).toEqual({ sourceId: 'source-b', cloneId: 'clone-b' });
    });

    it('matches the name EXACTLY — VU 1 never adopts VU 11’s collection', () => {
        const body = listing(
            { id: 'clone-11', name: 'Pull load source 11', sourceCollectionId: 'source-11' },
            { id: 'source-11', name: 'Pull load source 11' },
        );

        expect(reusableClonePair(body, NAME)).toEqual({ sourceId: null, cloneId: null });
    });

    it('never treats a clone as a source, even when the source it points at is gone', () => {
        // `source_collection_id` is `ON DELETE SET NULL`, but a clone of a DIFFERENT collection keeps its pointer —
        // adopting it as a source would pull from a collection this VU does not own.
        const body = listing({ id: 'clone-x', name: NAME, sourceCollectionId: 'someone-elses-source' });

        expect(reusableClonePair(body, NAME)).toEqual({ sourceId: null, cloneId: null });
    });

    it('REFUSES a body with no data array rather than reading it as an empty library and creating past the cap', () => {
        expect(() => reusableClonePair({ errors: [{ code: 'TOO_MANY_REQUESTS' }] }, NAME)).toThrow(/data/);
    });
});
