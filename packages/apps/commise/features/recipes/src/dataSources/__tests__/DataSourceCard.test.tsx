// @vitest-environment jsdom
/**
 * The web Data sources card (plan R55, design §S16): one source, under its name, with its licence, edition and credit.
 *
 * Every variant a source can arrive in is covered: a short name or none, converted or not, and an address that must
 * not become a link. The credit is asserted word for word and in its own language, because that is a licence term,
 * not presentation (CC BY 4.0 §3(a)(1), WCAG 2.2 SC 3.1.2).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { CIQUAL_SOURCE, SWISS_SOURCE, makeDataSource } from '../__fixtures__/makeDataSource.js';
import { DataSourceCard } from '../DataSourceCard.js';

afterEach(cleanup);

describe('DataSourceCard (web)', () => {
    // `buildSpec.md` §9.2: the heading is the PUBLISHER, the dataset's name under it in `body` 600.
    it('is a region named by its heading, the publisher, with the dataset name under it', () => {
        render(<DataSourceCard source={makeDataSource()} />);

        const card = screen.getByRole('region', {
            name: 'U.S. Department of Agriculture, Agricultural Research Service',
        });

        expect(
            within(card).getByRole('heading', {
                level: 2,
                name: 'U.S. Department of Agriculture, Agricultural Research Service',
            }),
        ).toBeTruthy();
        expect(within(card).getByText('FoodData Central').className).toContain('font-semibold');
    });

    it('names the dataset once, whether or not it has a short name', () => {
        render(<DataSourceCard source={SWISS_SOURCE} />);

        expect(screen.getAllByText('Swiss Food Composition Database')).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 2, name: SWISS_SOURCE.publisher })).toBeTruthy();
    });

    // Below 600 each term stacks above its value; from 600 they sit in two columns, the term 120 px wide.
    it('stacks a term above its value below 600 px of card width and sets them in two columns from 600', () => {
        render(<DataSourceCard source={makeDataSource()} />);

        const term = screen.getAllByRole('term')[0];
        const entry = term?.parentElement;

        expect(entry?.className).toContain('flex-col');
        expect(entry?.className).toContain('@regular:flex-row');
        expect(term?.className).toContain('@regular:w-30');
    });

    it('lists the edition, the licence and the credit as terms and values', () => {
        render(<DataSourceCard source={makeDataSource()} />);

        const terms = screen.getAllByRole('term').map((term) => term.textContent);

        expect(terms).toEqual(['Edition', 'License', 'Credit']);
        expect(
            screen.getByText('SR Legacy 2018-04, Foundation 2026-04-30, FNDDS 2021-2023, Branded 2026-04-30'),
        ).toBeTruthy();
    });

    it('shows the credit word for word, marked with its own language', () => {
        render(<DataSourceCard source={CIQUAL_SOURCE} />);

        const credit = screen.getByText('Anses. 2025. Table de composition nutritionnelle des aliments Ciqual.');

        expect(credit.getAttribute('lang')).toBe('fr');
    });

    it('links the licence by its title, opening in a new tab without handing over this page', () => {
        render(<DataSourceCard source={makeDataSource()} />);

        const licence = screen.getByRole('link', { name: 'CC0 1.0 Universal, license for USDA (opens in a new tab)' });

        expect(licence.getAttribute('href')).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
        expect(licence.getAttribute('target')).toBe('_blank');
        expect(licence.getAttribute('rel')).toBe('noopener noreferrer');
        expect(licence.textContent).toContain('CC0 1.0 Universal');
    });

    it('links the source’s website by name', () => {
        render(<DataSourceCard source={makeDataSource()} />);

        const website = screen.getByRole('link', { name: 'Source website, USDA (opens in a new tab)' });

        expect(website.getAttribute('href')).toBe('https://fdc.nal.usda.gov/');
        expect(website.textContent).toContain('Source website');
    });

    it('marks every outbound link with the arrow, hidden from assistive technology, and says it opens a new tab', () => {
        render(<DataSourceCard source={makeDataSource()} />);

        for (const link of screen.getAllByRole('link')) {
            expect(link.querySelector('[aria-hidden="true"]')?.textContent).toContain('↗');
            expect(link.getAttribute('aria-label')).toContain('(opens in a new tab)');
            expect(link.getAttribute('target')).toBe('_blank');
        }
    });

    it('says the values were converted for a source the service marks converted', () => {
        render(<DataSourceCard source={CIQUAL_SOURCE} />);

        expect(screen.getByText('We converted some of its values to the units this app uses.')).toBeTruthy();
    });

    it('says nothing about conversion for a source the service does not mark converted', () => {
        render(<DataSourceCard source={makeDataSource({ converted: false })} />);

        expect(screen.queryByText('We converted some of its values to the units this app uses.')).toBeNull();
    });

    it('shows a licence whose address is not http(s) as its title alone, never as a link', () => {
        render(
            <DataSourceCard
                source={makeDataSource({ licenceUrl: 'javascript:alert(1)', homepage: 'ftp://x.example' })}
            />,
        );

        expect(screen.queryAllByRole('link')).toHaveLength(0);
        expect(screen.getByText('CC0 1.0 Universal')).toBeTruthy();
    });
});
