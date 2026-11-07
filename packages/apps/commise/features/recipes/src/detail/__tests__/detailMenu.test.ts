/**
 * The recipe page's ⋯ menu (build spec §6.4), decided once for both platforms: the owner's Version history, the
 * visibility change and Clear checks, with Delete last as the menu's one destructive action; another cook's only
 * Clear checks. Clear checks is offered only while a mark is set. "Make private" is offered when the host says Private
 * is offered (`offersPrivate`: granted or upsell — under `hidden` no paid feature and no upsell is visible, owner ruling
 * 2026-10-13); what choosing it does is the host's (`useGatedPrivate`). "Make public" is offered on a private
 * recipe, whatever the paid-feature state, except a book or paid-site recipe, which can never be public (`mayBePublic`).
 */
import { describe, expect, it } from 'vitest';

import { detailMenuOf } from '../detailMenu.js';

describe('detailMenuOf', () => {
    it.each([
        {
            what: 'the owner of a public recipe with marks',
            input: { owner: true, isPublic: true, hasMarks: true, offersPrivate: true, mayBePublic: true },
            items: ['versions', 'makePrivate', 'clearChecks'],
            destructive: 'delete',
        },
        {
            what: 'the owner of a private recipe, no marks',
            input: { owner: true, isPublic: false, hasMarks: false, offersPrivate: true, mayBePublic: true },
            items: ['versions', 'makePublic'],
            destructive: 'delete',
        },
        {
            what: 'an owner of a public recipe is offered Make private when Private is offered; the host decides Pro',
            input: { owner: true, isPublic: true, hasMarks: false, offersPrivate: true, mayBePublic: true },
            items: ['versions', 'makePrivate'],
            destructive: 'delete',
        },
        {
            what: 'another cook with marks',
            input: { owner: false, isPublic: true, hasMarks: true, offersPrivate: true, mayBePublic: true },
            items: ['clearChecks'],
            destructive: undefined,
        },
        {
            what: 'another cook with no marks',
            input: { owner: false, isPublic: true, hasMarks: false, offersPrivate: true, mayBePublic: true },
            items: [],
            destructive: undefined,
        },
        {
            what: '⛔ an owner of a public recipe is NOT offered Make private when Private is not offered (hidden, loading)',
            input: { owner: true, isPublic: true, hasMarks: false, offersPrivate: false, mayBePublic: true },
            items: ['versions'],
            destructive: 'delete',
        },
        {
            what: 'an owner of a private recipe is still offered Make public when Private is not offered',
            input: { owner: true, isPublic: false, hasMarks: false, offersPrivate: false, mayBePublic: true },
            items: ['versions', 'makePublic'],
            destructive: 'delete',
        },
        {
            what: '⛔ the owner of a private BOOK or paid-site recipe is offered no Make public: it can never be public',
            input: { owner: true, isPublic: false, hasMarks: false, offersPrivate: true, mayBePublic: false },
            items: ['versions'],
            destructive: 'delete',
        },
        {
            what: 'a book recipe keeps its other entries (Clear checks, Delete)',
            input: { owner: true, isPublic: false, hasMarks: true, offersPrivate: false, mayBePublic: false },
            items: ['versions', 'clearChecks'],
            destructive: 'delete',
        },
    ] as const)('$what', ({ input, items, destructive }) => {
        expect(detailMenuOf(input)).toEqual({ items, destructive });
    });
});
