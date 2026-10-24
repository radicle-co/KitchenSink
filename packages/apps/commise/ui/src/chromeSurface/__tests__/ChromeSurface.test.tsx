/**
 * The web bar material (D12, `darkTheme.md` §3.4): the `bar` fill under a 12 px blur behind the bar's content, with the
 * hairline on the edge that meets content, solid under reduced transparency or more contrast, and nothing when hidden.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { ChromeSurface } from '../ChromeSurface.js';

afterEach(cleanup);

const surface = (container: HTMLElement): HTMLElement => {
    const node = container.firstElementChild;

    if (!(node instanceof HTMLElement)) {
        throw new Error('no surface');
    }

    return node;
};

describe('ChromeSurface (web)', () => {
    it('paints the bar material under a small blur, behind the content and hidden from assistive tech', () => {
        const node = surface(render(<ChromeSurface edge="top" />).container);

        expect(node.getAttribute('aria-hidden')).toBe('true');
        expect(node.className).toMatch(/(^| )bg-bar( |$)/);
        expect(node.className).toContain('backdrop-blur-[12px]');
        expect(node.className).toContain('-z-10');
        expect(node.className).toContain('pointer-events-none');
    });

    it('puts the hairline on the edge that meets content', () => {
        expect(surface(render(<ChromeSurface edge="top" />).container).className).toMatch(/(^| )border-t( |$)/);
        cleanup();
        expect(surface(render(<ChromeSurface edge="bottom" />).container).className).toMatch(/(^| )border-b( |$)/);
    });

    it('goes solid paperRaised under reduced transparency and more contrast (Safari has no reduced-transparency query)', () => {
        const { className } = surface(render(<ChromeSurface edge="top" />).container);

        expect(className).toContain('[@media(prefers-reduced-transparency:reduce)]:bg-paper-raised');
        expect(className).toContain('contrast-more:bg-paper-raised');
    });

    it('paints nothing while hidden', () => {
        const node = surface(render(<ChromeSurface edge="bottom" visible={false} />).container);

        expect(node.className).not.toContain('bg-bar');
        expect(node.getAttribute('data-material')).toBe('none');
    });
});
