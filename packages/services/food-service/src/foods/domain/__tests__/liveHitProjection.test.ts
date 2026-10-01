/**
 * A live source hit as the picker sees it (curated plan U8 S4, R19): a hit on an item the catalog holds is shown
 * under its owner's root name, with the variant when a variant owns it — never under the source's raw description.
 */
import { describe, expect, it } from 'vitest';

import type { CatalogOwner } from '../../catalogOwnerReader.service.js';
import { liveHitView } from '../liveHitProjection.js';

const HIT = { source: 'usda' as const, externalKey: '174531', name: 'Beef, brisket, flat half, separable lean, raw' };

const ROOT_OWNER: CatalogOwner = {
    kind: 'root',
    id: 'R-1',
    rootId: 'R-1',
    rootName: 'beef brisket',
    seedOwned: true,
    parts: [],
};

describe('liveHitView', () => {
    it('shows a hit the catalog does not hold under the source’s own name, with no id', () => {
        expect(liveHitView(HIT, undefined)).toStrictEqual({ name: HIT.name });
    });

    it('⛔ R19: shows a root-owned hit under the ROOT’s name, never the USDA description', () => {
        expect(liveHitView(HIT, ROOT_OWNER)).toStrictEqual({ name: 'beef brisket', id: 'R-1' });
    });

    it('shows a variant-owned hit under its root’s id and name, carrying the variant', () => {
        const owner: CatalogOwner = {
            kind: 'variant',
            id: 'V-flat',
            rootId: 'R-1',
            rootName: 'beef brisket',
            seedOwned: true,
            parts: [
                { attribute: 'cut', ordinal: 0, text: 'flat' },
                { attribute: 'trim', ordinal: 0, text: 'separable lean' },
            ],
        };

        expect(liveHitView(HIT, owner)).toStrictEqual({
            name: 'beef brisket',
            id: 'R-1',
            variant: {
                id: 'V-flat',
                parts: [
                    { attribute: 'cut', text: 'flat' },
                    { attribute: 'trim', text: 'separable lean' },
                ],
            },
        });
    });

    it('keeps the source name for an owner whose root has no name', () => {
        expect(liveHitView(HIT, { ...ROOT_OWNER, rootName: null })).toStrictEqual({ name: HIT.name, id: 'R-1' });
    });
});
