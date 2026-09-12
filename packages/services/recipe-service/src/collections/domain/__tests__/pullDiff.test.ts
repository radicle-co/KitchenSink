/**
 * W8-a.8 — unit + mutation tests for the pure pull-from-source diff (`computePullDiff`).
 *
 * The single source of the "what does pulling change?" set arithmetic, shared by BOTH the read-only
 * preview and the commit (so a drift check compares like-for-like). Pins the three-way partition and its
 * determinism mutation-resistantly: a source recipe absent from the clone is `added`; one present in both
 * is `unchanged`; one in the clone but not the source is `removed` (informational — a pull is additive and
 * never deletes it). The result is sorted so an echoed preview and a live recomputation compare byte-equal.
 */
import { describe, it, expect } from 'vitest';

import { computePullDiff } from '../pullDiff.js';

describe('computePullDiff', () => {
    it('partitions source ∪ clone into added / unchanged / removed', () => {
        // source: r1 r2 r3 ; clone: r2 r3 r4 → add r1; r2/r3 already present; r4 is clone-only.
        const diff = computePullDiff(['r1', 'r2', 'r3'], ['r2', 'r3', 'r4']);

        expect(diff.added).toEqual(['r1']);
        expect(diff.unchanged).toEqual(['r2', 'r3']);
        expect(diff.removed).toEqual(['r4']);
    });

    it('added = source \\ clone exactly (not "everything in source")', () => {
        expect(computePullDiff(['r1', 'r2'], ['r1']).added).toEqual(['r2']);
    });

    it('is empty-added when the clone already contains the whole source (pull is a no-op)', () => {
        const diff = computePullDiff(['r1', 'r2'], ['r1', 'r2', 'r3']);

        expect(diff.added).toEqual([]);
        expect(diff.unchanged).toEqual(['r1', 'r2']);
        expect(diff.removed).toEqual(['r3']);
    });

    it('treats a source recipe gone (absent from sourceIds — e.g. now private/draft/deleted) as NOT added', () => {
        // The caller passes the visibility+status+tombstone-scoped source membership; a vanished recipe is
        // simply not in sourceIds, so it never appears in `added` (no disclosure, no re-add).
        const diff = computePullDiff(['r1'], ['r1', 'r2']);

        expect(diff.added).toEqual([]);
        expect(diff.removed).toEqual(['r2']); // r2 is clone-only (the source no longer offers it)
    });

    it('sorts every bucket so an echoed preview and a live recompute compare byte-equal (drift check)', () => {
        const a = computePullDiff(['r3', 'r1', 'r2'], []);
        const b = computePullDiff(['r2', 'r3', 'r1'], []);

        expect(a.added).toEqual(['r1', 'r2', 'r3']);
        expect(a).toEqual(b); // order-independent inputs → identical output
    });

    it('dedupes repeated ids within an input (a membership set is logically a set)', () => {
        const diff = computePullDiff(['r1', 'r1'], ['r1']);

        expect(diff.added).toEqual([]);
        expect(diff.unchanged).toEqual(['r1']);
    });
});
