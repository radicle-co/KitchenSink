// @vitest-environment jsdom
/**
 * The web `usePinnedFooter`'s two options (`docs/design/compactHeightLayout.md` A1, §3.2, §4.4): a VIEWPORT frame, for a
 * page whose pinned top row is stuck to the viewport (the recipe wizard), and the FOCUS CARRY, so the footer control
 * that had focus takes it again after a flip remounts the footer (SC 2.4.3). The element frame the Sheet reads is
 * covered by `sheet/__tests__/SheetFooterPinning.test.tsx`.
 *
 * jsdom lays nothing out, so each node states its height through a `data-height` attribute, and the viewport its
 * height through `clientHeight`; the `ResizeObserver` is a stub the test fires.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import type { FC } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePinnedFooter, type FooterFocusCarry } from '../usePinnedFooter.js';

const reports = new Set<() => void>();

class ResizeObserverStub {
    private readonly report: () => void;

    public constructor(callback: ResizeObserverCallback) {
        this.report = () => callback([], this);
    }

    public observe(): void {
        reports.add(this.report);
    }

    public unobserve(): void {
        reports.delete(this.report);
    }

    public disconnect(): void {
        reports.delete(this.report);
    }
}

/** Play the browser reporting a size to every observer. */
const reportSizes = (): void => {
    act(() => {
        for (const report of reports) {
            report();
        }
    });
};

type Slot = 'previous' | 'primary';

const CARRY: FooterFocusCarry<Slot> = {
    attribute: 'data-slot',
    parse: (value) => (value === 'previous' || value === 'primary' ? value : null),
};

/** A page: a band stuck to the viewport, content, and a footer that sits in the band's flow when `inBand`. */
const Page: FC<{
    readonly top: number;
    readonly footer: number;
    readonly inBand?: boolean;
    readonly stray?: boolean;
}> = ({ top, footer, inBand = false, stray = false }) => {
    const { unpinned, refocus, refocusHandled, topRef, footerRef } = usePinnedFooter({
        frame: 'viewport',
        focusCarry: CARRY,
    });
    const bar = (
        <div ref={footerRef} data-height={footer}>
            <span data-slot="previous">
                <button type="button">Previous</button>
            </span>
            <span data-slot={stray ? 'elsewhere' : 'primary'}>
                <button type="button" onFocus={refocusHandled}>
                    Next
                </button>
            </span>
        </div>
    );

    return (
        <>
            <div ref={topRef} data-height={inBand && !unpinned ? top + footer : top}>
                <button type="button">Back</button>
                <span data-slot="previous">
                    <button type="button">Previous step</button>
                </span>
                {inBand && !unpinned ? bar : null}
            </div>
            <p>{unpinned ? 'unpinned' : 'pinned'}</p>
            <p>{`refocus: ${refocus ?? 'none'}`}</p>
            {inBand && !unpinned ? null : bar}
        </>
    );
};

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return new DOMRect(0, 0, 390, Number(this.getAttribute('data-height') ?? 0));
    });
});

afterEach(() => {
    cleanup();
    reports.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const viewport = (height: number): void => {
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(height);
};

describe('usePinnedFooter — a viewport frame', () => {
    it('unpins once the top row and the footer take more than half the viewport, measuring no frame node', () => {
        viewport(360);
        render(<Page top={137} footer={121} />);

        reportSizes();

        expect(screen.getByText('unpinned')).toBeTruthy();
    });

    it('measures again when the window resizes', () => {
        viewport(844);
        render(<Page top={137} footer={121} />);
        reportSizes();
        expect(screen.getByText('pinned')).toBeTruthy();

        viewport(360);
        act(() => {
            window.dispatchEvent(new Event('resize'));
        });

        expect(screen.getByText('unpinned')).toBeTruthy();
    });

    it('counts a footer in the top row’s own flow once, so 128 + 52 in a 400 viewport stays pinned', () => {
        viewport(400);
        render(<Page top={128} footer={52} inBand />);

        // Each report must find it pinned: counting the footer twice unpins it, and the moved footer then measures
        // small enough to pin again, a flip-flop a single final check would miss.
        reportSizes();
        expect(screen.getByText('pinned')).toBeTruthy();
        reportSizes();
        expect(screen.getByText('pinned')).toBeTruthy();
    });
});

describe('usePinnedFooter — focus carried across a flip (SC 2.4.3)', () => {
    it('names the footer control that had focus when the footer moved, until that control takes focus', () => {
        viewport(844);
        render(<Page top={137} footer={121} />);
        reportSizes();
        screen.getByRole('button', { name: 'Next' }).focus();

        viewport(360);
        reportSizes();

        expect(screen.getByText('refocus: primary')).toBeTruthy();

        // The control takes focus again, as the caller's `focusRequested` level makes it do in the moved footer.
        act(() => {
            screen.getByRole('button', { name: 'Next' }).blur();
            screen.getByRole('button', { name: 'Next' }).focus();
        });

        expect(screen.getByText('refocus: none')).toBeTruthy();
    });

    it('names nothing when focus is outside the footer', () => {
        viewport(844);
        render(<Page top={137} footer={121} />);
        reportSizes();
        screen.getByRole('button', { name: 'Back' }).focus();

        viewport(360);
        reportSizes();

        expect(screen.getByText('refocus: none')).toBeTruthy();
    });

    it('names nothing for a named slot outside the footer', () => {
        viewport(844);
        render(<Page top={137} footer={121} />);
        reportSizes();
        screen.getByRole('button', { name: 'Previous step' }).focus();

        viewport(360);
        reportSizes();

        expect(screen.getByText('refocus: none')).toBeTruthy();
    });

    it('names nothing for a slot value the parser does not know', () => {
        viewport(844);
        render(<Page top={137} footer={121} stray />);
        reportSizes();
        screen.getByRole('button', { name: 'Next' }).focus();

        viewport(360);
        reportSizes();

        expect(screen.getByText('refocus: none')).toBeTruthy();
    });

    it('names nothing on a measure that does not move the footer', () => {
        viewport(844);
        render(<Page top={137} footer={121} />);
        reportSizes();
        screen.getByRole('button', { name: 'Next' }).focus();

        viewport(800);
        reportSizes();

        expect(screen.getByText('refocus: none')).toBeTruthy();
    });
});
