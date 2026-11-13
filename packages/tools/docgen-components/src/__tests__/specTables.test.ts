/**
 * The build spec's generated tables (`docs/design/uiOverhaul/buildSpec.md` §1.4 and §1.5): the renderers and the
 * splice that puts them between their markers.
 *
 * The fixtures cover every shape a token can take (a per-class size that varies and one that does not, a role that
 * takes the size of its line, a figure, a palette value shared by two names), so a broken mapping fails by name. The
 * real tokens are compared with the committed file in the integration tier.
 */
import { describe, expect, it } from 'vitest';

import { isDocgenError } from '../errors.js';
import { colorRoleTable, endMarker, spliceRegion, startMarker, typeRoleTable } from '../specTables.js';

const FACES = { display: '"Manrope", Inter, system-ui, sans-serif', body: 'Inter, system-ui, sans-serif' };
const WEIGHTS = { normal: 400, medium: 500, semibold: 600, bold: 600 };

/** The body rows of a rendered table: every line after the header and its rule. */
function rows(table: string): readonly string[] {
    return table.split('\n').slice(2);
}

describe('typeRoleTable', () => {
    const table = typeRoleTable(
        {
            largeTitle: {
                face: 'display',
                size: { narrow: 28, regular: 28, wide: 28 },
                weight: 'semibold',
                lineHeight: 32,
            },
            heroTitle: { face: 'display', size: { narrow: 18, regular: 28, wide: 28 }, weight: 'bold', lineHeight: 32 },
            body: { face: 'body', size: 16, weight: 'normal', lineHeight: 24 },
            figureInline: { face: 'body', size: 'inherit', weight: 'semibold', lineHeight: 'inherit', figure: true },
            figureStat: { face: 'body', size: 18, weight: 'semibold', lineHeight: 24, figure: true },
        },
        FACES,
        WEIGHTS,
    );

    it('writes one row per role, in declaration order', () => {
        expect(rows(table).map((row) => row.split('|')[1]?.trim())).toEqual([
            '`largeTitle`',
            '`heroTitle`',
            '`body`',
            '`figureInline`',
            '`figureStat`',
        ]);
    });

    it('names the face family, not the role face key or the whole stack', () => {
        expect(rows(table)[0]).toContain('| Manrope |');
        expect(rows(table)[2]).toContain('| Inter |');
    });

    it('writes a per-class size that never varies as one number, and one that varies per class', () => {
        expect(rows(table)[0]).toBe('| `largeTitle` | Manrope | 28 | 600 | 32 | |');
        expect(rows(table)[1]).toBe('| `heroTitle` | Manrope | 18 narrow, 28 regular, 28 wide | 600 | 32 | |');
    });

    it('writes the weight as its number, so `bold` shows the 600 it really paints', () => {
        expect(rows(table)[2]).toBe('| `body` | Inter | 16 | 400 | 24 | |');
    });

    it('marks a figure role and writes the size of its line for a role with none of its own', () => {
        expect(rows(table)[3]).toBe(
            '| `figureInline` | Inter | size of its line | 600 | size of its line | tabular, lining |',
        );
        expect(rows(table)[4]).toBe('| `figureStat` | Inter | 18 | 600 | 24 | tabular, lining |');
    });
});

describe('colorRoleTable', () => {
    const palette = { steel: '#325C7F', charcoal: '#1F2A33', ink2: '#1F2A33', snow: '#FFFFFF' };
    const table = colorRoleTable(
        { action: '#325C7F', ink: '#1F2A33', selectedFill: '#E4EEF7', scrim: 'rgba(10, 16, 24, 0.42)' },
        { action: '#7FA8CC', ink: '#EBEFF2', selectedFill: '#1F3548', scrim: 'rgba(0, 0, 0, 0.66)' },
        palette,
    );

    it('writes each role with its light and dark value, and names a palette entry that matches exactly one name', () => {
        expect(rows(table)[0]).toBe('| `action` | `#325C7F` (`steel`) | `#7FA8CC` |');
    });

    it('names no palette entry when two names share the value, because either label would be a guess', () => {
        expect(rows(table)[1]).toBe('| `ink` | `#1F2A33` | `#EBEFF2` |');
    });

    it('writes a designer literal and a translucent tint as they are', () => {
        expect(rows(table)[2]).toBe('| `selectedFill` | `#E4EEF7` | `#1F3548` |');
        expect(rows(table)[3]).toBe('| `scrim` | `rgba(10, 16, 24, 0.42)` | `rgba(0, 0, 0, 0.66)` |');
    });

    it('carries no contrast column: `redesignContrast.test.ts` owns the ratios', () => {
        expect(table.split('\n')[0]).toBe('| Role | Light | Dark |');
    });

    it('throws a DocgenError for a role with no dark value, so an empty cell is never pinned as correct', () => {
        let thrown: unknown;

        try {
            colorRoleTable({ action: '#325C7F' }, {}, palette);
        } catch (error) {
            thrown = error;
        }

        expect(isDocgenError(thrown)).toBe(true);
    });
});

describe('spliceRegion', () => {
    const document = [
        'Before, untouched.',
        '',
        startMarker('typeRoles'),
        '',
        '| stale |',
        '',
        endMarker('typeRoles'),
        '',
        'After, untouched.',
        '',
    ].join('\n');

    it('replaces only the text between the markers, and keeps every byte outside them', () => {
        const spliced = spliceRegion(document, 'typeRoles', '| fresh |');

        expect(spliced).toBe(document.replace('| stale |', '| fresh |'));
    });

    it('is idempotent, so a second run over its own output changes nothing', () => {
        const once = spliceRegion(document, 'typeRoles', '| fresh |');

        expect(spliceRegion(once, 'typeRoles', '| fresh |')).toBe(once);
    });

    it.each([
        ['the start marker is missing', document.replace(startMarker('typeRoles'), '')],
        ['the end marker is missing', document.replace(endMarker('typeRoles'), '')],
        ['the region appears twice', `${document}${document}`],
        ['the end marker comes first', [endMarker('typeRoles'), '| stale |', startMarker('typeRoles')].join('\n')],
    ])('throws a DocgenError when %s, so deleting the markers cannot turn the guard into a no-op', (_case, broken) => {
        let thrown: unknown;

        try {
            spliceRegion(broken, 'typeRoles', '| fresh |');
        } catch (error) {
            thrown = error;
        }

        expect(isDocgenError(thrown)).toBe(true);
    });
});
