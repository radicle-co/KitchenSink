import { describe, expect, it } from 'vitest';

import { isDesignArtifactError } from '../../errors.js';
import { toCardPageSpec } from '../loadCardSpec.js';

const FILE = '/c/Button.card.tsx';

describe('toCardPageSpec', () => {
    it('keeps what the page template and the surface checks read, and drops the functions', () => {
        const spec = toCardPageSpec(
            {
                default: {
                    group: 'Actions',
                    height: 330,
                    platforms: 'both',
                    uses: ['Button'],
                    render: () => null,
                    staging: { phoneViewport: true },
                    notes: { native: 'n' },
                },
            },
            FILE,
        );

        expect(spec).toEqual({
            group: 'Actions',
            height: 330,
            platforms: 'both',
            uses: ['Button'],
            staging: { phoneViewport: true },
            notes: { native: 'n' },
        });
    });

    it('carries the reason of a one-platform card', () => {
        expect(
            toCardPageSpec(
                { default: { group: 'G', height: 100, platforms: 'native', reason: 'no web leaf', uses: [] } },
                FILE,
            ),
        ).toMatchObject({ platforms: 'native', reason: 'no web leaf' });
    });

    it.each([
        ['no default export', {}],
        ['a default that is not an object', { default: 'x' }],
        ['a missing group', { default: { height: 1, platforms: 'both', uses: [] } }],
        ['a non-numeric height', { default: { group: 'G', height: '300', platforms: 'both', uses: [] } }],
        ['an unknown platforms value', { default: { group: 'G', height: 1, platforms: 'tablet', uses: [] } }],
        ['no uses', { default: { group: 'G', height: 1, platforms: 'both' } }],
        ['uses that is not a list of names', { default: { group: 'G', height: 1, platforms: 'both', uses: ['A', 3] } }],
    ])('refuses %s as invalid-card, naming the file', (_label, module) => {
        try {
            toCardPageSpec(module, FILE);
            expect.unreachable();
        } catch (error) {
            expect(isDesignArtifactError(error) && error.code).toBe('invalid-card');
            expect((error as Error).message).toContain(FILE);
        }
    });
});
