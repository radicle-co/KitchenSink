/**
 * The carousel's paging rule, over the space of offsets a strip can report: on a slide, between two (below and above the
 * midpoint, and on it), before the start, past the end, and with no pitch or no slide yet.
 */
import { describe, expect, it } from 'vitest';

import { pageAt } from '../photoPaging.js';

describe('pageAt', () => {
    it.each([
        { offset: 0, pitch: 400, count: 3, page: 0 },
        { offset: 400, pitch: 400, count: 3, page: 1 },
        { offset: 800, pitch: 400, count: 3, page: 2 },
        { offset: 199, pitch: 400, count: 3, page: 0 },
        { offset: 200, pitch: 400, count: 3, page: 1 },
        { offset: 599, pitch: 400, count: 3, page: 1 },
        { offset: 650, pitch: 400, count: 3, page: 2 },
        { offset: -80, pitch: 400, count: 3, page: 0 },
        { offset: 5000, pitch: 400, count: 3, page: 2 },
        { offset: 400, pitch: 0, count: 3, page: 0 },
        { offset: 400, pitch: -400, count: 3, page: 0 },
        { offset: 400, pitch: 400, count: 0, page: 0 },
        { offset: 400, pitch: 400, count: 1, page: 0 },
    ])('offset $offset at pitch $pitch over $count slides → page $page', ({ offset, pitch, count, page }) => {
        expect(pageAt(offset, pitch, count)).toBe(page);
    });
});
