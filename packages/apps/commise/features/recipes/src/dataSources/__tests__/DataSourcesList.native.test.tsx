/**
 * The native Data sources list (plan R55, design §S16): the populated and empty states of a settled read, in the
 * service's order. The fixture order is deliberately not alphabetical, so a list that sorted would fail.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { CIQUAL_SOURCE, SWISS_SOURCE, makeDataSource } from '../__fixtures__/makeDataSource.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { DataSourcesList } from '../DataSourcesList.native.js';

afterEach(cleanup);

describe('DataSourcesList (native)', () => {
    it('renders one card per source, in the order the service sent them', () => {
        render(<DataSourcesList sources={[makeDataSource(), SWISS_SOURCE, CIQUAL_SOURCE]} onOpen={vi.fn()} />);

        expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
            makeDataSource().publisher,
            SWISS_SOURCE.publisher,
            CIQUAL_SOURCE.publisher,
        ]);
    });

    it('says so, rather than rendering nothing, when no source is cited', () => {
        render(<DataSourcesList sources={[]} onOpen={vi.fn()} />);

        expect(screen.getByText('No data sources to show yet.')).toBeTruthy();
        expect(screen.queryAllByRole('heading')).toHaveLength(0);
    });
});
