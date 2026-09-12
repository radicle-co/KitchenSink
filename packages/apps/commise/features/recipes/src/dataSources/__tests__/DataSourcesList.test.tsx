// @vitest-environment jsdom
/**
 * The web Data sources list (plan R55, design §S16): the populated and empty states of a settled read.
 *
 * ⛔ The order is the service's — the register's dataset order, USDA first — and the list never sorts it again. The
 * fixture order below is deliberately not alphabetical, so a list that sorted would fail.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { CIQUAL_SOURCE, SWISS_SOURCE, makeDataSource } from '../__fixtures__/makeDataSource.js';
import { DataSourcesList } from '../DataSourcesList.js';

afterEach(cleanup);

describe('DataSourcesList (web)', () => {
    it('renders one card per source, in the order the service sent them', () => {
        render(<DataSourcesList sources={[makeDataSource(), SWISS_SOURCE, CIQUAL_SOURCE]} />);

        expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
            'USDA',
            'Swiss Food Composition Database',
            'Ciqual',
        ]);
    });

    it('says so, rather than rendering nothing, when no source is cited', () => {
        render(<DataSourcesList sources={[]} />);

        expect(screen.getByText('No data sources to show yet.')).toBeTruthy();
        expect(screen.queryAllByRole('region')).toHaveLength(0);
    });
});
