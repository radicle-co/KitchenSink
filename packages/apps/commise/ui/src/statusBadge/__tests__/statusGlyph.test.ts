/**
 * `STATUS_GLYPH` is the glyph a recipe status draws wherever it is shown beside its word (the badge, the cover chip, the
 * detail status row). It is read from the status tones, so a glyph is stated once.
 */
import { describe, expect, it } from 'vitest';

import { statusTone } from '../../tokens/tones.js';
import { BADGE_GLYPH, STATUS_GLYPH } from '../props.js';

describe('STATUS_GLYPH', () => {
    it('gives each recipe status the glyph its tone owns', () => {
        expect(STATUS_GLYPH).toEqual({
            draft: statusTone.draft.icon,
            hidden: statusTone.hidden.icon,
            private: statusTone.private.icon,
            public: statusTone.public.icon,
        });
        expect(new Set(Object.values(STATUS_GLYPH)).size).toBe(4);
    });

    it('is what the badge draws for those four statuses', () => {
        for (const status of ['draft', 'hidden', 'private', 'public'] as const) {
            expect(BADGE_GLYPH[status]).toBe(STATUS_GLYPH[status]);
        }
    });
});
