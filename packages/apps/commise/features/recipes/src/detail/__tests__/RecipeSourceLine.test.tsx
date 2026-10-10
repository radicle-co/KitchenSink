// @vitest-environment jsdom
/**
 * Component tests for the web recipe-source (provenance) line.
 *
 * Every state is covered, not just the happy one: no source at all, attribution only, URL only, both, and —
 * the state that matters most — a URL whose scheme is not http(s), which must NEVER become a link and must
 * never be shown as raw text either. The link's outbound-safety attributes are asserted, because "it
 * renders" is not the requirement; "it cannot be weaponised" is.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { RecipeSourceLine } from '../RecipeSourceLine.js';

afterEach(cleanup);

describe('RecipeSourceLine (web) — absent source', () => {
    it('renders NOTHING when the recipe has neither a URL nor an attribution', () => {
        const { container } = render(<RecipeSourceLine />);

        // Not an empty label, not a "Source: —" row: nothing at all.
        expect(container.innerHTML).toBe('');
    });

    it('renders NOTHING when the only source is a URL that must not be linked', () => {
        const { container } = render(<RecipeSourceLine sourceUrl="javascript:alert(1)" />);

        expect(container.innerHTML).toBe('');
    });
});

describe('RecipeSourceLine (web) — attribution without a URL', () => {
    it('renders the attribution as plain text under a Source label, with no link', () => {
        render(<RecipeSourceLine sourceAttribution="Grandma’s cookbook" />);

        expect(screen.getByText('Source')).toBeTruthy();
        expect(screen.getByText('Grandma’s cookbook')).toBeTruthy();
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('still renders the attribution when the URL is unusable, but never as a link', () => {
        // The provenance the author stated is real information; the hostile URL is the only thing dropped.
        render(<RecipeSourceLine sourceUrl="data:text/html,<script>alert(1)</script>" sourceAttribution="Some Blog" />);

        expect(screen.getByText('Some Blog')).toBeTruthy();
        expect(screen.queryByRole('link')).toBeNull();
        // And the rejected URL is not leaked into the page as text either.
        expect(screen.queryByText(/data:text\/html/)).toBeNull();
    });
});

describe('RecipeSourceLine (web) — a linkable source', () => {
    it('links a URL, labelled by its host when there is no attribution', () => {
        render(<RecipeSourceLine sourceUrl="https://www.seriouseats.com/recipes/lamb" />);

        const link = screen.getByRole('link', { name: /www\.seriouseats\.com/ });
        expect(link.getAttribute('href')).toBe('https://www.seriouseats.com/recipes/lamb');
    });

    it('labels the LINK with the verified host, and renders the attribution beside it as text', () => {
        render(
            <RecipeSourceLine sourceUrl="https://www.seriouseats.com/recipes/lamb" sourceAttribution="Serious Eats" />,
        );

        // The attribution is untrusted free text: a recipe that CLAIMS "Serious Eats" while pointing at
        // evil.example must not be able to borrow that name as the label of the thing you click. So the
        // clickable label is the host the parser verified, and the claim sits next to it as plain text.
        const link = screen.getByRole('link', { name: 'www.seriouseats.com' });

        expect(link.getAttribute('href')).toBe('https://www.seriouseats.com/recipes/lamb');
        expect(screen.getByText('Serious Eats').tagName).not.toBe('A');
    });

    it('does not let a lying attribution label the link', () => {
        render(<RecipeSourceLine sourceUrl="https://evil.example/x" sourceAttribution="Serious Eats" />);

        // The visible, clickable text is where the link ACTUALLY goes.
        expect(screen.getByRole('link').textContent).toBe('evil.example');
    });

    it('opens in a new context WITHOUT handing the destination a window handle or the referrer', () => {
        render(<RecipeSourceLine sourceUrl="https://example.com/recipe" />);

        const link = screen.getByRole('link');
        const rel = link.getAttribute('rel') ?? '';

        expect(link.getAttribute('target')).toBe('_blank');
        // `noopener` is the reverse-tabnabbing guard (the opened page must not reach `window.opener`);
        // `noreferrer` withholds the viewer's current URL; `nofollow ugc` refuses to lend the recipe
        // author's arbitrary URL this site's link equity.
        expect(rel).toContain('noopener');
        expect(rel).toContain('noreferrer');
        expect(rel).toContain('nofollow');
    });

    it('renders the parser’s href, not the raw string it was given', () => {
        render(<RecipeSourceLine sourceUrl="  HTTPS://Example.COM/Recipes?q=a b  " />);

        const href = screen.getByRole('link').getAttribute('href') ?? '';

        expect(href.startsWith('https://example.com/Recipes')).toBe(true);
        expect(href).not.toContain(' ');
    });
});
