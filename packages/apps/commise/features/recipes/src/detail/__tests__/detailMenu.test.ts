/**
 * The recipe page's ⋯ menu (build spec §6.4), decided once for both platforms: the owner's Version history, the
 * visibility change and Clear checks, with Delete last as the menu's one destructive action; another cook's only
 * Clear checks. Clear checks is offered only while a mark is set, and a free-tier owner is not offered "Make private"
 * (C-004) — the upsell sheet the spec draws for it is not built, so nothing that can only fail is offered.
 */
import { describe, expect, it } from 'vitest';

import { detailMenuOf } from '../detailMenu.js';

describe('detailMenuOf', () => {
    it.each([
        {
            what: 'the owner of a public recipe with marks',
            input: { owner: true, isPublic: true, canGoPrivate: true, hasMarks: true },
            items: ['versions', 'makePrivate', 'clearChecks'],
            destructive: 'delete',
        },
        {
            what: 'the owner of a private recipe, no marks',
            input: { owner: true, isPublic: false, canGoPrivate: false, hasMarks: false },
            items: ['versions', 'makePublic'],
            destructive: 'delete',
        },
        {
            what: 'a free-tier owner of a public recipe',
            input: { owner: true, isPublic: true, canGoPrivate: false, hasMarks: false },
            items: ['versions'],
            destructive: 'delete',
        },
        {
            what: 'another cook with marks',
            input: { owner: false, isPublic: true, canGoPrivate: true, hasMarks: true },
            items: ['clearChecks'],
            destructive: undefined,
        },
        {
            what: 'another cook with no marks',
            input: { owner: false, isPublic: true, canGoPrivate: true, hasMarks: false },
            items: [],
            destructive: undefined,
        },
    ] as const)('$what', ({ input, items, destructive }) => {
        expect(detailMenuOf(input)).toEqual({ items, destructive });
    });
});
