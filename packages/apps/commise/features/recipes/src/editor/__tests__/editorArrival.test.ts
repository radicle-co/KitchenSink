/**
 * `editorArrival.ts` — the ONE parser of "where the editor opens", for the web hash and the native route params.
 *
 * What these prove: only a safe non-negative integer address survives (`seedLineKey` throws on anything else, so the
 * edge must refuse it first), a line address is dropped for every section but Ingredients, and `arrivalHash` is the
 * exact inverse of `arrivalFromHash` for every arrival the editor can be asked to open.
 */
import { describe, expect, it } from 'vitest';

import { arrivalFromHash, arrivalHash, arrivalOf, resolveArrival, type EditorArrival } from '../editorArrival.js';
import { seedLineKey } from '../../form/lineKey.js';

describe('arrivalFromHash — the section-only forms (replaces sectionFromHash, A16)', () => {
    it.each<[string, EditorArrival | undefined]>([
        ['#details', { section: 'details' }],
        ['#ingredients', { section: 'ingredients' }],
        ['steps', { section: 'steps' }],
        ['#photos', { section: 'photos' }],
        ['', undefined],
        ['#', undefined],
        ['#Ingredients', undefined],
        ['#nutrition', undefined],
        ['#constructor', undefined],
    ])('%j → %j', (hash, arrival) => {
        expect(arrivalFromHash(hash)).toEqual(arrival);
    });
});

describe('arrivalFromHash — a line address', () => {
    it('reads #ingredients/{version}.{position}', () => {
        expect(arrivalFromHash('#ingredients/3.12')).toEqual({
            section: 'ingredients',
            line: { version: 3, position: 12 },
        });
    });

    it.each(['#steps/1.2', '#details/0.0', '#photos/1.1'])('drops the line for a section that has none: %s', (hash) => {
        expect(arrivalFromHash(hash)?.line).toBeUndefined();
    });

    it.each([
        '#ingredients/x',
        '#ingredients/1',
        '#ingredients/1.',
        '#ingredients/.1',
        '#ingredients/1.2/',
        '#ingredients/1.2.3',
        '#ingredients/-1.2',
        '#ingredients/1.-2',
        '#ingredients/1.5e3',
        '#ingredients/99999999999999999999.1',
        '#ingredients/',
    ])('keeps the section but drops a malformed address: %s', (hash) => {
        expect(arrivalFromHash(hash)).toEqual({ section: 'ingredients' });
    });
});

describe('arrivalOf — native route params, which may arrive unparsed', () => {
    it('accepts a section and a safe address', () => {
        expect(arrivalOf('ingredients', { version: 2, position: 0 })).toEqual({
            section: 'ingredients',
            line: { version: 2, position: 0 },
        });
    });

    it('is undefined without a known section', () => {
        expect(arrivalOf(undefined, { version: 1, position: 1 })).toBeUndefined();
        expect(arrivalOf('nutrition')).toBeUndefined();
        expect(arrivalOf(7)).toBeUndefined();
    });

    it.each<[string, unknown]>([
        ['null', null],
        ['a string', '1.2'],
        ['missing position', { version: 1 }],
        ['negative', { version: -1, position: 0 }],
        ['fractional', { version: 1, position: 0.5 }],
        ['NaN', { version: Number.NaN, position: 0 }],
        ['unsafe', { version: Number.MAX_SAFE_INTEGER + 1, position: 0 }],
        ['stringly typed', { version: '1', position: '2' }],
    ])('drops a bad address (%s) but keeps the section', (_name, line) => {
        expect(arrivalOf('ingredients', line)).toEqual({ section: 'ingredients' });
    });

    it('drops the address for any section but ingredients', () => {
        expect(arrivalOf('steps', { version: 1, position: 1 })).toEqual({ section: 'steps' });
    });
});

describe('arrivalHash', () => {
    it.each<[EditorArrival, string]>([
        [{ section: 'details' }, '#details'],
        [{ section: 'ingredients' }, '#ingredients'],
        [{ section: 'ingredients', line: { version: 4, position: 9 } }, '#ingredients/4.9'],
    ])('%j → %s, and round-trips', (arrival, hash) => {
        expect(arrivalHash(arrival)).toBe(hash);
        expect(arrivalFromHash(hash)).toEqual(arrival);
    });
});

describe('resolveArrival — a link’s address against the draft the editor holds', () => {
    const FIRST = seedLineKey(3, 0);
    const SECOND = seedLineKey(3, 1);
    const held = [FIRST, SECOND];
    const keyAt = (address: { readonly version: number; readonly position: number }) =>
        address.version === 3 ? held[address.position] : undefined;

    it('found: the address names a line the draft still holds', () => {
        expect(resolveArrival({ section: 'ingredients', line: { version: 3, position: 1 } }, keyAt, held)).toEqual({
            section: 'ingredients',
            line: { kind: 'found', key: SECOND },
        });
    });

    it('missing: the position is past the end', () => {
        expect(resolveArrival({ section: 'ingredients', line: { version: 3, position: 9 } }, keyAt, held)).toEqual({
            section: 'ingredients',
            line: { kind: 'missing' },
        });
    });

    it('missing: the recipe moved to another version', () => {
        expect(resolveArrival({ section: 'ingredients', line: { version: 4, position: 0 } }, keyAt, held)).toEqual({
            section: 'ingredients',
            line: { kind: 'missing' },
        });
    });

    it('missing: the key resolves but a resumed draft has lost that line', () => {
        expect(resolveArrival({ section: 'ingredients', line: { version: 3, position: 1 } }, keyAt, [FIRST])).toEqual({
            section: 'ingredients',
            line: { kind: 'missing' },
        });
    });

    it('section only: no line at all, and none is said to be missing', () => {
        expect(resolveArrival({ section: 'steps' }, keyAt, held)).toEqual({ section: 'steps' });
    });
});
