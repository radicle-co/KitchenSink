/**
 * MOD-020 ValueNormalizers (FR-021, HAZ-040).
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | FR-021 — duration prose to integer minutes | "reads" duration cases |
 * | FR-021 — free-text yield to a positive integer where unambiguous | "reads" servings cases |
 * | FR-021 — absent or ambiguous leaves the field EMPTY and flags it | "absent" + "ambiguous" cases |
 * | HAZ-040 — NO branch returns a default for an absent input | the exhaustive absent-input table |
 *
 * HAZ-040 is the reason these assertions are written against `undefined` rather than against the flag:
 * `prep_time_minutes` and `servings` are nullable columns whose CHECKs (`>= 0`, `> 0`) would accept a
 * fabricated `0` or `4` silently. A test that only asserted `needsReview` would pass on a fabrication.
 */
import { describe, it, expect } from 'vitest';

import { normalizeDurationToMinutes, normalizeServings } from '../valueNormalizers.js';

describe('normalizeDurationToMinutes', () => {
    describe('reads duration prose', () => {
        it.each([
            ['two hours', 120],
            ['twenty minutes', 20],
            ['one and one-half hours', 90],
            ['three-quarters of an hour', 45],
            ['half an hour', 30],
            ['an hour', 60],
            ['forty-five minutes', 45],
            ['one hour', 60],
            ['five minutes', 5],
            ['two days', 2880],
            ['ninety seconds', 2],
        ])('reads %j as %d minutes', (raw, minutes) => {
            const result = normalizeDurationToMinutes(raw);

            expect(result.minutes).toBe(minutes);
            expect(result.needsReview).toBe(false);
        });
    });

    describe('reads numeral durations', () => {
        it.each([
            ['1 1/2 hours', 90],
            ['45 minutes', 45],
            ['1.5 hours', 90],
            ['2 hr', 120],
            ['30 mins', 30],
        ])('reads %j as %d minutes', (raw, minutes) => {
            const result = normalizeDurationToMinutes(raw);

            expect(result.minutes).toBe(minutes);
            expect(result.needsReview).toBe(false);
        });

        it.each([
            ['1 hour 30 minutes', 90],
            ['2 hours 15 minutes', 135],
            ['1 hr 30 min', 90],
            // A conjunction between terms must not end the scan. Measured 2026-08-19: without this,
            // "1 hour and 30 minutes" returned 60 with needsReview FALSE -- a plausible wrong number,
            // silently dropping half the duration, which is the exact failure this module exists to stop.
            ['1 hour and 30 minutes', 90],
            ['one hour and thirty minutes', 90],
            ['1 hour, 30 minutes', 90],
            ['2 hours and 15 minutes', 135],
        ])('sums the compound duration %j to %d minutes', (raw, minutes) => {
            expect(normalizeDurationToMinutes(raw).minutes).toBe(minutes);
        });

        it('does not silently drop a trailing term it failed to reach', () => {
            const result = normalizeDurationToMinutes('1 hour and 30 minutes');

            expect(result.minutes).not.toBe(60);
            expect(result.needsReview).toBe(false);
        });
    });

    describe('a range takes the LOWER bound and flags for review', () => {
        it.each([
            ['15 to 20 minutes', 15],
            ['15-20 minutes', 15],
            ['one to two hours', 60],
            ['2 or 3 hours', 120],
        ])('reads %j as %d minutes and flags it', (raw, minutes) => {
            const result = normalizeDurationToMinutes(raw);

            expect(result.minutes).toBe(minutes);
            expect(result.needsReview).toBe(true);
            expect(result.reviewReasons).toContain('range_narrowed');
        });

        it('does NOT sum the two ends of a range', () => {
            expect(normalizeDurationToMinutes('15 to 20 minutes').minutes).not.toBe(35);
        });
    });

    describe('HAZ-040 — an absent input NEVER yields a default', () => {
        it.each([[undefined], [null], [''], ['   ']])('leaves %j empty and flags it', (raw) => {
            const result = normalizeDurationToMinutes(raw);

            expect(result.minutes).toBeUndefined();
            expect(result.needsReview).toBe(true);
            expect(result.reviewReasons).toContain('absent');
        });

        it('never returns 0 for an absent input, which the >= 0 CHECK would accept', () => {
            for (const raw of [undefined, null, '', '   ']) {
                expect(normalizeDurationToMinutes(raw).minutes).not.toBe(0);
            }
        });
    });

    describe('ambiguous prose leaves the field empty and flags it', () => {
        it.each([['overnight'], ['until done'], ['a while'], ['as long as it takes'], ['several hours']])(
            'leaves %j empty',
            (raw) => {
                const result = normalizeDurationToMinutes(raw);

                expect(result.minutes).toBeUndefined();
                expect(result.needsReview).toBe(true);
                expect(result.reviewReasons).toContain('unreadable');
            },
        );
    });

    describe('a bare number carries no unit, so it is read as minutes and FLAGGED', () => {
        it('reads "45" as 45 minutes but does not claim to be sure', () => {
            const result = normalizeDurationToMinutes('45');

            expect(result.minutes).toBe(45);
            expect(result.needsReview).toBe(true);
            expect(result.reviewReasons).toContain('unit_assumed');
        });
    });

    describe('values the column cannot hold are rejected rather than left to fail at INSERT', () => {
        it('rejects a negative duration', () => {
            const result = normalizeDurationToMinutes('-30 minutes');

            expect(result.minutes).toBeUndefined();
            expect(result.reviewReasons).toContain('out_of_storage_range');
        });

        it('rejects a duration beyond an int4 column', () => {
            const result = normalizeDurationToMinutes('99999999999 hours');

            expect(result.minutes).toBeUndefined();
            expect(result.reviewReasons).toContain('out_of_storage_range');
        });

        it('flags a nonzero duration that rounds down to zero minutes', () => {
            const result = normalizeDurationToMinutes('twenty seconds');

            expect(result.minutes).toBe(0);
            expect(result.needsReview).toBe(true);
            expect(result.reviewReasons).toContain('rounded_to_zero');
        });
    });

    describe('needsReview is exactly "there is at least one reason"', () => {
        it.each([['two hours'], [''], ['overnight'], ['15 to 20 minutes'], ['45'], ['-1 minutes']])(
            'holds for %j',
            (raw) => {
                const result = normalizeDurationToMinutes(raw);
                expect(result.needsReview).toBe(result.reviewReasons.length > 0);
            },
        );
    });

    describe('totality', () => {
        it.each([[''], ['   '], ['-'], ['to'], ['and and and'], ['1/0 hours'], ['NaN hours'], ['a'.repeat(100_000)]])(
            'never throws on %j',
            (raw) => {
                expect(() => normalizeDurationToMinutes(raw)).not.toThrow();
            },
        );

        it('always returns an integer when it returns anything at all', () => {
            for (const raw of ['1.4 minutes', 'ninety seconds', '1 1/3 hours', '2.7 hours']) {
                const { minutes } = normalizeDurationToMinutes(raw);

                if (minutes !== undefined) {
                    expect(Number.isInteger(minutes)).toBe(true);
                }
            }
        });
    });
});

describe('normalizeServings', () => {
    describe('reads unambiguous yields', () => {
        it.each([
            ['4', 4],
            ['serves four', 4],
            ['Serves 6', 6],
            ['for six persons', 6],
            ['enough for twelve', 12],
            ['4 servings', 4],
            ['makes two dozen', 24],
            ['yield: eight', 8],
        ])('reads %j as %d', (raw, servings) => {
            const result = normalizeServings(raw);

            expect(result.servings).toBe(servings);
            expect(result.needsReview).toBe(false);
        });
    });

    describe('a range takes the LOWER bound and flags for review', () => {
        it.each([
            ['4-6', 4],
            ['4 to 6', 4],
            ['serves 6 to 8', 6],
            ['four to six', 4],
        ])('reads %j as %d and flags it', (raw, servings) => {
            const result = normalizeServings(raw);

            expect(result.servings).toBe(servings);
            expect(result.needsReview).toBe(true);
            expect(result.reviewReasons).toContain('range_narrowed');
        });
    });

    describe('HAZ-040 — an absent input NEVER yields a default', () => {
        it.each([[undefined], [null], [''], ['   ']])('leaves %j empty and flags it', (raw) => {
            const result = normalizeServings(raw);

            expect(result.servings).toBeUndefined();
            expect(result.needsReview).toBe(true);
            expect(result.reviewReasons).toContain('absent');
        });

        it('never returns the seductive default of 4 for an absent input', () => {
            for (const raw of [undefined, null, '', '   ']) {
                expect(normalizeServings(raw).servings).not.toBe(4);
            }
        });
    });

    describe('ambiguous yields leave the field empty and flag it', () => {
        it.each([['a crowd'], ['a lot'], ['plenty'], ['as many as you like'], ['a family']])(
            'leaves %j empty rather than reading the article as a count of one',
            (raw) => {
                const result = normalizeServings(raw);

                expect(result.servings).toBeUndefined();
                expect(result.needsReview).toBe(true);
            },
        );
    });

    describe('values the column cannot hold are rejected', () => {
        it.each([['0'], ['0 servings'], ['-4'], ['serves zero']])('rejects the non-positive yield %j', (raw) => {
            const result = normalizeServings(raw);

            expect(result.servings).toBeUndefined();
            expect(result.needsReview).toBe(true);
        });

        it('rejects a yield beyond an int4 column', () => {
            const result = normalizeServings('99999999999 servings');

            expect(result.servings).toBeUndefined();
            expect(result.reviewReasons).toContain('out_of_storage_range');
        });

        it('refuses a fractional yield rather than rounding one into existence', () => {
            const result = normalizeServings('4.5');

            expect(result.servings).toBeUndefined();
            expect(result.reviewReasons).toContain('not_a_whole_number');
        });
    });

    describe('needsReview is exactly "there is at least one reason"', () => {
        it.each([['4'], [''], ['a crowd'], ['4-6'], ['0'], ['4.5']])('holds for %j', (raw) => {
            const result = normalizeServings(raw);
            expect(result.needsReview).toBe(result.reviewReasons.length > 0);
        });
    });

    describe('totality', () => {
        it.each([[''], ['   '], ['-'], ['to'], ['1/0'], ['NaN'], ['a'.repeat(100_000)]])(
            'never throws on %j',
            (raw) => {
                expect(() => normalizeServings(raw)).not.toThrow();
            },
        );

        it('always returns a positive integer when it returns anything at all', () => {
            const inputs = ['4', 'serves four', '4-6', '0', '-4', '4.5', 'a crowd', '', '99999999999'];

            for (const raw of inputs) {
                const { servings } = normalizeServings(raw);

                if (servings !== undefined) {
                    expect(Number.isInteger(servings)).toBe(true);
                    expect(servings).toBeGreaterThan(0);
                }
            }
        });
    });
});
