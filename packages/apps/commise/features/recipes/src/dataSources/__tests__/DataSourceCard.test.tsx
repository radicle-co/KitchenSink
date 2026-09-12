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
    it('is a region named by its heading, the short name, with the full name and publisher under it', () => {
        render(<DataSourceCard source={makeDataSource()} />);

        const card = screen.getByRole('region', { name: 'USDA' });

        expect(within(card).getByRole('heading', { level: 2, name: 'USDA' })).toBeTruthy();
        expect(within(card).getByText('FoodData Central')).toBeTruthy();
        expect(within(card).getByText('U.S. Department of Agriculture, Agricultural Research Service')).toBeTruthy();
    });

    it('heads a source with no short name by its name, and does not repeat it', () => {
        render(<DataSourceCard source={SWISS_SOURCE} />);

        expect(screen.getByRole('heading', { level: 2, name: 'Swiss Food Composition Database' })).toBeTruthy();
        expect(screen.getAllByText('Swiss Food Composition Database')).toHaveLength(1);
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

        const licence = screen.getByRole('link', { name: 'CC0 1.0 Universal, license for USDA' });

        expect(licence.getAttribute('href')).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
        expect(licence.getAttribute('target')).toBe('_blank');
        expect(licence.getAttribute('rel')).toBe('noopener noreferrer');
        expect(licence.textContent).toContain('CC0 1.0 Universal');
    });

    it('links the source’s website by name', () => {
        render(<DataSourceCard source={makeDataSource()} />);

        const website = screen.getByRole('link', { name: 'Source website, USDA' });

        expect(website.getAttribute('href')).toBe('https://fdc.nal.usda.gov/');
        expect(website.textContent).toContain('Source website');
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
