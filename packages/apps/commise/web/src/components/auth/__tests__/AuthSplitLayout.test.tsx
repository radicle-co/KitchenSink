// @vitest-environment jsdom
/**
 * The frame around the sign-in and sign-up forms (`docs/design/uiOverhaul/buildSpec.md` §8): a centred column below
 * 1024 px, and a 50/50 split from there with a decorative food photograph on the start half. The photo is `aria-hidden`
 * and has no text alternative because it conveys nothing, and it is `display: none` below 1024 so a phone never downloads
 * the half it cannot show. The layout is a plain frame: it fetches nothing and is not "a welcome screen" — the form is
 * the front door (FR-045a).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { imageProps } = vi.hoisted(() => ({ imageProps: [] as Record<string, unknown>[] }));

vi.mock('next/image', () => ({
    default: (props: { src: string; alt: string }) => {
        imageProps.push(props);

        return <span data-image={props.src} data-alt={props.alt} />;
    },
}));

import { AuthSplitLayout } from '../AuthSplitLayout';

afterEach(() => {
    cleanup();
    imageProps.length = 0;
});

describe('AuthSplitLayout', () => {
    it('holds the form in the page’s one <main>', () => {
        render(
            <AuthSplitLayout>
                <p>the form</p>
            </AuthSplitLayout>,
        );

        expect(screen.getByRole('main')).toBeTruthy();
        expect(screen.getByRole('main').textContent).toContain('the form');
    });

    it('shows the photograph only from 1024 px, hidden from assistive technology, with no alt text', () => {
        const { container } = render(
            <AuthSplitLayout>
                <p>the form</p>
            </AuthSplitLayout>,
        );
        const photo = container.querySelector('[data-image]');
        const panel = photo?.closest('[aria-hidden="true"]');

        expect(photo?.getAttribute('data-alt')).toBe('');
        expect(panel).not.toBeNull();
        expect(panel?.className).toContain('hidden');
        expect(panel?.className).toContain('lg:block');
    });

    // `priority` makes Next emit a preload `<link>`, which a phone obeys although the image is `display: none`: the very
    // download the panel's `hidden` is there to avoid. Without it the image is lazy, and a lazy hidden image is not fetched.
    it('does not preload the photograph, so a phone never downloads the half it cannot show', () => {
        render(<AuthSplitLayout>x</AuthSplitLayout>);

        expect(imageProps).toHaveLength(1);
        expect(imageProps[0]).not.toHaveProperty('priority', true);
        expect(imageProps[0]).not.toHaveProperty('loading', 'eager');
    });

    it('is a two-column grid from 1024 and one column below', () => {
        render(<AuthSplitLayout>x</AuthSplitLayout>);

        expect(screen.getByRole('main').className).toContain('lg:grid-cols-2');
    });

    it('pads the form 24 px at the sides, which is a 272 px column at 320 px', () => {
        render(
            <AuthSplitLayout>
                <p>the form</p>
            </AuthSplitLayout>,
        );

        expect(screen.getByText('the form').parentElement?.className).toContain('px-6');
    });
});
