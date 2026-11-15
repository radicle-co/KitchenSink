import { describe, expect, it } from 'vitest';

import { INT4_CEILING } from '../../recipeRequestBounds.js';
import { durationMinutes } from '../isoDuration.js';

describe('durationMinutes', () => {
    it.each([
        ['PT1H30M', 90],
        ['PT45M', 45],
        ['PT2H', 120],
        ['P1D', 1_440],
        ['P1DT2H', 1_560],
        ['P1W', 10_080],
        ['PT90S', 2],
        ['PT0M', 0],
        ['PT0S', 0],
    ])('reads %s as %i whole minutes', (text, minutes) => {
        expect(durationMinutes(text)).toBe(minutes);
    });

    it('keeps a stated zero as zero, never as absent', () => {
        expect(durationMinutes('PT0M')).toBe(0);
    });

    it.each(['P1M', 'P1Y', 'P1Y2M', 'P1M3D'])('leaves %s absent: a month and a year have no fixed length', (text) => {
        expect(durationMinutes(text)).toBeUndefined();
    });

    it.each(['', '  ', '45 minutes', 'PT', 'P', 'PT-5M', '-PT5M', 'PT1.5.5H', 'pt'])(
        'leaves %j absent, because it is not a duration',
        (text) => {
            expect(durationMinutes(text)).toBeUndefined();
        },
    );

    it('leaves a duration past the int4 ceiling absent', () => {
        expect(durationMinutes(`PT${String(INT4_CEILING + 1)}M`)).toBeUndefined();
        expect(durationMinutes(`PT${String(INT4_CEILING)}M`)).toBe(INT4_CEILING);
    });

    it('leaves a non-string absent', () => {
        expect(durationMinutes(90)).toBeUndefined();
        expect(durationMinutes(null)).toBeUndefined();
        expect(durationMinutes({ '@value': 'PT5M' })).toBeUndefined();
    });

    it('refuses an unreasonably long input without reading it', () => {
        expect(durationMinutes(`PT${'1'.repeat(100_000)}M`)).toBeUndefined();
    });
});
