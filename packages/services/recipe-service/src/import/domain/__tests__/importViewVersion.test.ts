/**
 * The view's `version`: a digest of what the view was built from, VERDICTS INCLUDED (ADR-0072 §2, §4). The client compares
 * it with the last one to learn whether anything changed, so a fact that moves the view and not the digest is a stale screen.
 * Every input is a mutation target below: change exactly one and the digest must move.
 */
import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../../../common/sha256.js';
import { importViewVersionOf, type ImportVersionFacts } from '../importViewVersion.js';

const BASE: ImportVersionFacts = {
    header: {
        id: '66666666-6666-4666-8666-000000000001',
        matchMode: 'review',
        visibility: 'private',
        cursorOrdinal: 3,
        reviewClosed: false,
        expectedTotal: 10,
        updatedAt: '2026-10-26T12:00:00.000Z',
    },
    counts: { total: 10, received: 4, parsing: 2, matched: 1, saved: 3 },
    allowance: { limit: 1000, used: 6, resetsAt: '2026-10-27T12:00:00.000Z' },
    pause: null,
    items: [
        {
            ordinal: 0,
            title: 'Soup',
            stage: 'saved',
            review: 'reviewed',
            statement: { kind: 'authored' },
            visibility: null,
            recipeId: '66666666-6666-4666-8666-0000000000a1',
            issue: null,
        },
    ],
    nextAfter: null,
    verdicts: { count: 2, latest: '2026-10-26T12:00:05.000Z' },
};

const versionOf = (patch: Partial<ImportVersionFacts>) => importViewVersionOf({ ...BASE, ...patch }, sha256Hex);

describe('importViewVersionOf', () => {
    it('is stable: the same facts give the same digest, whatever the key order', () => {
        const reordered: ImportVersionFacts = {
            verdicts: { latest: BASE.verdicts.latest, count: BASE.verdicts.count },
            nextAfter: BASE.nextAfter,
            items: BASE.items
                .map((item) => ({ ...item, issue: item.issue, title: item.title }))
                .reverse()
                .reverse(),
            pause: BASE.pause,
            allowance: { resetsAt: BASE.allowance.resetsAt, used: BASE.allowance.used, limit: BASE.allowance.limit },
            counts: {
                saved: BASE.counts.saved,
                matched: BASE.counts.matched,
                parsing: BASE.counts.parsing,
                received: BASE.counts.received,
                total: BASE.counts.total,
            },
            header: {
                updatedAt: BASE.header.updatedAt,
                id: BASE.header.id,
                expectedTotal: BASE.header.expectedTotal,
                matchMode: BASE.header.matchMode,
                visibility: BASE.header.visibility,
                cursorOrdinal: BASE.header.cursorOrdinal,
                reviewClosed: BASE.header.reviewClosed,
            },
        };

        expect(importViewVersionOf(BASE, sha256Hex)).toBe(importViewVersionOf(BASE, sha256Hex));
        expect(importViewVersionOf(reordered, sha256Hex)).toBe(importViewVersionOf(BASE, sha256Hex));
    });

    it('is versioned and opaque', () => {
        expect(importViewVersionOf(BASE, sha256Hex)).toMatch(/^v1:[0-9a-f]{64}$/u);
    });

    const changes: readonly [string, Partial<ImportVersionFacts>][] = [
        ['the header: cursor', { header: { ...BASE.header, cursorOrdinal: 4 } }],
        ['the header: review closed', { header: { ...BASE.header, reviewClosed: true } }],
        ['the header: activity clock', { header: { ...BASE.header, updatedAt: '2026-10-26T12:00:01.000Z' } }],
        ['the header: match mode', { header: { ...BASE.header, matchMode: 'bindBest' } }],
        ['the header: visibility', { header: { ...BASE.header, visibility: 'public' } }],
        ['the counts', { counts: { ...BASE.counts, saved: 4 } }],
        ['the allowance spent', { allowance: { ...BASE.allowance, used: 7 } }],
        ['the allowance reset', { allowance: { ...BASE.allowance, resetsAt: null } }],
        ['the pause', { pause: { reason: 'outOfSlots' } }],
        ['an item stage', { items: [{ ...BASE.items[0]!, stage: 'matched' }] }],
        ['an item issue', { items: [{ ...BASE.items[0]!, issue: { reason: 'needsStatement' } }] }],
        ['an item statement', { items: [{ ...BASE.items[0]!, statement: { kind: 'book', citation: 'x' } }] }],
        ['the page cursor', { nextAfter: 0 }],
        ['⛔ a verdict landing (count)', { verdicts: { count: 3, latest: BASE.verdicts.latest } }],
        ['⛔ a verdict replaced (latest)', { verdicts: { count: 2, latest: '2026-10-26T12:00:06.000Z' } }],
        ['no verdict at all', { verdicts: { count: 0, latest: null } }],
    ];

    it.each(changes)('moves when %s changes', (_name, patch) => {
        expect(versionOf(patch)).not.toBe(importViewVersionOf(BASE, sha256Hex));
    });
});
