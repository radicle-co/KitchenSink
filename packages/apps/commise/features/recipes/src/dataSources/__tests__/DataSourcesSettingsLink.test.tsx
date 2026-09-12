// @vitest-environment jsdom
/**
 * The web settings way in to the Data sources page (design §S16): a section headed "Food data", one line on what is
 * there, and a link titled with the page's name, to the address the app's router owns.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// `next/link` renders a plain anchor here; the router itself is the web app's to test (Playwright).
vi.mock('next/link', () => ({
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
        <a href={href} {...rest}>
            {children}
        </a>
    ),
}));

import { DataSourcesSettingsLink } from '../DataSourcesSettingsLink.js';

afterEach(cleanup);

describe('DataSourcesSettingsLink (web)', () => {
    it('is a region named "Food data", saying what the page holds', () => {
        render(<DataSourcesSettingsLink href="/en/legal/sources" />);

        const section = screen.getByRole('region', { name: 'Food data' });

        expect(section.textContent).toContain(
            'Where the nutrition figures come from, and the licenses they’re used under.',
        );
    });

    it('links to the page by its name, at the address it was given', () => {
        render(<DataSourcesSettingsLink href="/en/legal/sources" />);

        expect(screen.getByRole('link', { name: 'Data sources' }).getAttribute('href')).toBe('/en/legal/sources');
    });

    it('takes the host’s card classes, so it matches its siblings', () => {
        render(<DataSourcesSettingsLink href="/en/legal/sources" className="host-card" />);

        expect(screen.getByRole('region', { name: 'Food data' }).className).toContain('host-card');
    });
});
