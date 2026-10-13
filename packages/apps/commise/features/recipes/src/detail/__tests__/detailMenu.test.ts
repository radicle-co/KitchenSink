/**
 * The recipe page's ⋯ menu (build spec §6.4), decided once for both platforms: the owner's Version history, the
 * visibility change and Clear checks, with Delete last as the menu's one destructive action; another cook's only
 * Clear checks. Clear checks is offered only while a mark is set, and "Make private" is offered to every
 * owner — entitlement is the host's (`useGatedPrivate`), not the menu's.
 */
import { describe, expect, it } from 'vitest';

import { detailMenuOf } from '../detailMenu.js';

describe('detailMenuOf', () => {
    it.each([
        {
            what: 'the owner of a public recipe with marks',
            input: { owner: true, isPublic: true, hasMarks: true },
            items: ['versions', 'makePrivate', 'clearChecks'],
            destructive: 'delete',
        },
        {
            what: 'the owner of a private recipe, no marks',
            input: { owner: true, isPublic: false, hasMarks: false },
            items: ['versions', 'makePublic'],
            destructive: 'delete',
        },
        {
            what: 'any owner of a public recipe is offered Make private; the host decides Premium (owner 2026-10-13)',
            input: { owner: true, isPublic: true, hasMarks: false },
            items: ['versions', 'makePrivate'],
            destructive: 'delete',
        },
        {
            what: 'another cook with marks',
            input: { owner: false, isPublic: true, hasMarks: true },
            items: ['clearChecks'],
            destructive: undefined,
        },
        {
            what: 'another cook with no marks',
            input: { owner: false, isPublic: true, hasMarks: false },
            items: [],
            destructive: undefined,
        },
    ] as const)('$what', ({ input, items, destructive }) => {
        expect(detailMenuOf(input)).toEqual({ items, destructive });
    });
});
