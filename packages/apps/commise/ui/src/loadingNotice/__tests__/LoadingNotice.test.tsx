/**
 * Component tests for the web `LoadingNotice` (`docs/design/uiOverhaul/specSharedSystem.md` §18): a status region named
 * by its visible caption, a decorative spinner, and the 400 ms hold through `EnterTransition`.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LoadingNotice } from '../LoadingNotice.js';

afterEach(cleanup);

describe('LoadingNotice (web)', () => {
    it('is a status region named by its visible caption', () => {
        render(<LoadingNotice label="Loading recipe…" />);

        const status = screen.getByRole('status', { name: 'Loading recipe…' });

        expect(status.textContent).toBe('Loading recipe…');
    });

    it('⛔ names the region by reference to its caption, never by a second copy of it', () => {
        render(<LoadingNotice label="Loading recipe…" />);

        expect(screen.getByRole('status').hasAttribute('aria-label')).toBe(false);
        expect(screen.getByRole('status').getAttribute('aria-labelledby')).toBe(screen.getByText('Loading recipe…').id);
    });

    it('hides the decorative spinner from assistive tech', () => {
        render(<LoadingNotice label="Loading recipe…" />);

        const spinner = screen.getByRole('status').querySelector('svg');

        expect(spinner?.getAttribute('aria-hidden')).toBe('true');
    });

    it('spins the spinner only when motion is safe', () => {
        render(<LoadingNotice label="Loading recipe…" />);

        const spinner = screen.getByRole('status').querySelector('svg');

        expect(spinner?.getAttribute('class')).toContain('motion-safe:animate-spin');
        expect(spinner?.getAttribute('class')).not.toMatch(/(^|\s)animate-spin/);
    });

    it('marks no node busy: the notice replaces its region, so nothing stays to be busy', () => {
        const { container } = render(<LoadingNotice label="Loading recipe…" />);

        expect(container.querySelector('[aria-busy]')).toBeNull();
    });

    it('holds for 400 ms before it enters, with no timer of its own', () => {
        render(<LoadingNotice label="Loading recipe…" />);

        const wrapper = screen.getByRole('status').parentElement as HTMLElement;

        expect(wrapper.style.animationDelay).toBe('400ms');
    });

    it('wraps a long caption rather than truncating it', () => {
        render(<LoadingNotice label="Loading a recipe with a very long name…" />);

        const className = screen.getByRole('status').getAttribute('class') ?? '';

        expect(className).toContain('flex-wrap');
        expect(className).not.toContain('truncate');
    });
});
