/**
 * THE RATE-LIMIT DEFAULTS HAVE ONE AUTHORITATIVE REPRESENTATION.
 *
 * ⛔ THEY USED TO HAVE TWO, and nothing compared them. `config.types.ts` declared each limit's default on
 * its zod field (`.default(30)`) while `throttle.config.ts` passed its own fallback to
 * `throttleLimitFromEnv('RATE_LIMIT_WRITE', 30)`. Two copies of one number, in different layers, with no
 * guard — so raising one and missing the other would leave the service enforcing a limit its own config
 * schema says is something else, and which value won would depend on which path a reader consulted.
 *
 * That is the duplication DRY exists for: one piece of KNOWLEDGE ("how many requests per minute does this
 * category allow by default"), one owner. `RATE_LIMIT_DEFAULTS` is the owner; both layers read it.
 *
 * The assertion is SET EQUALITY over the whole record rather than a field-by-field list, so a limit added
 * to one side and not the other fails here — a hand-kept list of names could not detect its own
 * incompleteness, which is the failure mode `natEgressConsumers.test.ts` documents.
 */
import { describe, expect, it } from 'vitest';

import { rateLimitConfigSchema } from '../../../config/config.types.js';
import { RATE_LIMIT_DEFAULTS } from '../throttleDefaults.js';
import { analyticsLimit, exportLimit, photoLimit, readLimit, searchLimit, writeLimit } from '../throttle.config.js';

describe('rate-limit defaults', () => {
    it('are the same numbers the env schema falls back to', () => {
        // Both sides are DERIVED: the left from zod's own defaulting, the right from the shared record.
        // Neither is a transcription of the other.
        expect(rateLimitConfigSchema.parse({})).toEqual({ ...RATE_LIMIT_DEFAULTS });
    });

    it('are the numbers the throttler actually enforces when the env is unset', () => {
        expect({
            RATE_LIMIT_READ: readLimit,
            RATE_LIMIT_WRITE: writeLimit,
            RATE_LIMIT_SEARCH: searchLimit,
            RATE_LIMIT_PHOTO_UPLOAD: photoLimit,
            RATE_LIMIT_EXPORT: exportLimit,
            RATE_LIMIT_ANALYTICS: analyticsLimit,
        }).toEqual({ ...RATE_LIMIT_DEFAULTS });
    });

    it('lets a cook fill a recipe to its documented photo cap within one minute', () => {
        // ⛔ THE DEFECT THIS NUMBER WAS RAISED FOR. `MAX_RECIPE_PHOTOS` is 10 and each photo costs TWO
        // photo-budget requests (presign + confirm), so a cook filling a recipe to the maximum the product
        // itself advertises issues 20. At the old budget of 10/min they were throttled exactly halfway —
        // and because mutations do not retry, that surfaced as a failed upload, not a wait.
        const requestsPerPhoto = 2;
        const maxPhotosPerRecipe = 10;

        expect(RATE_LIMIT_DEFAULTS.RATE_LIMIT_PHOTO_UPLOAD).toBeGreaterThanOrEqual(
            requestsPerPhoto * maxPhotosPerRecipe,
        );
    });
});
