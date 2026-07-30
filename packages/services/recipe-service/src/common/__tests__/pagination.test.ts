/**
 * S-R8-test — unit tests for the shared pagination-envelope helper.
 *
 * Pins the ONE correct `hasMore` formula (`offset + rowCount < total`, equivalently
 * `(page - 1) * pageSize + rowCount < total`) against the boundary cases the previously-duplicated
 * `page * pageSize < total` formula got wrong on a SHORT final page, plus the shared page/pageSize
 * clamps `recipes`, `search`, and `collections` all rely on.
 */
import { describe, it, expect } from 'vitest';

import { toPageEnvelope, clampPage, clampPageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../pagination.js';

describe('toPageEnvelope', () => {
    it('reports hasMore=false on the exact-last-FULL-page (rowCount fills the final slot exactly)', () => {
        const envelope = toPageEnvelope({ total: 20, pageSize: 10, page: 2, rowCount: 10 });

        expect(envelope.hasMore).toBe(false);
        expect(envelope).toEqual({ total: 20, page: 2, pageSize: 10, hasMore: false });
    });

    it('reports hasMore=false on a SHORT final page (fewer rows than pageSize, still nothing left)', () => {
        // total=25, pageSize=10, page=3 → offset=20; only 5 rows remain, so rowCount=5 (a short page).
        // The naive `page * pageSize < total` formula (3*10=30 < 25) ALSO gives false here — this is the
        // case the two formulas happen to agree on, so it does not by itself prove correctness; the
        // divergent case below does.
        const envelope = toPageEnvelope({ total: 25, pageSize: 10, page: 3, rowCount: 5 });

        expect(envelope.hasMore).toBe(false);
    });

    it('reports hasMore=true when a next page genuinely exists', () => {
        const envelope = toPageEnvelope({ total: 25, pageSize: 10, page: 2, rowCount: 10 });

        expect(envelope.hasMore).toBe(true);
    });

    it('reports hasMore=false on an empty result', () => {
        const envelope = toPageEnvelope({ total: 0, page: 1, pageSize: 10, rowCount: 0 });

        expect(envelope.hasMore).toBe(false);
    });

    it('diverges from the naive `page * pageSize < total` formula on a short-and-incomplete page — the correct formula trusts the ACTUAL rowCount, not an assumed full page', () => {
        // total=2, page=1, pageSize=2, but only 1 row was actually returned on this page (rowCount=1) —
        // one row of the 2 total is still unaccounted for. The naive formula (page*pageSize=2 < 2) says
        // false (WRONG: it assumes the page was filled to pageSize, so it can't see the missing row).
        // The correct formula (offset(0) + rowCount(1) = 1 < 2) says true, matching reality.
        const envelope = toPageEnvelope({ total: 2, page: 1, pageSize: 2, rowCount: 1 });

        expect(envelope.hasMore).toBe(true);
    });

    it('echoes total/page/pageSize unchanged', () => {
        const envelope = toPageEnvelope({ total: 7, page: 4, pageSize: 3, rowCount: 0 });

        expect(envelope.total).toBe(7);
        expect(envelope.page).toBe(4);
        expect(envelope.pageSize).toBe(3);
    });
});

describe('clampPage', () => {
    it('defaults to 1 when absent or non-finite', () => {
        expect(clampPage(undefined)).toBe(1);
        expect(clampPage(Number.NaN)).toBe(1);
    });

    it('floors to a minimum of 1', () => {
        expect(clampPage(0)).toBe(1);
        expect(clampPage(-3)).toBe(1);
    });

    it('truncates a fractional page and passes through an in-range integer', () => {
        expect(clampPage(4.9)).toBe(4);
        expect(clampPage(4)).toBe(4);
    });
});

describe('clampPageSize', () => {
    it('defaults to DEFAULT_PAGE_SIZE when absent or non-finite', () => {
        expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
        expect(clampPageSize(Number.NaN)).toBe(DEFAULT_PAGE_SIZE);
    });

    it('clamps to a minimum of 1', () => {
        expect(clampPageSize(0)).toBe(1);
        expect(clampPageSize(-5)).toBe(1);
    });

    it('clamps to MAX_PAGE_SIZE', () => {
        expect(clampPageSize(999)).toBe(MAX_PAGE_SIZE);
    });

    it('truncates a fractional in-range page size', () => {
        expect(clampPageSize(7.9)).toBe(7);
    });
});
