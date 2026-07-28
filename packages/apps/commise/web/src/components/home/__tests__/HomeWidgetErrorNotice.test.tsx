// @vitest-environment jsdom
/**
 * The stand-in a FAILED Home widget shows in place of its body (web) — the mirror of mobile's
 * `HomeWidgetErrorNotice`, which these tests hold web to (FR-044 / §14: the two hosts compose the widget
 * identically, so they must degrade identically).
 *
 * Two things are pinned here, once, for BOTH boundaries that use this fallback (the host's per-widget one in
 * `HomeWidgetSurface.tsx` and the recipe slot's inner one in `RecipeWidgetSlot.tsx`):
 *  - the copy, character-identical to the mobile catalog's `home.widgetError`; and
 *  - that it is ANNOUNCED (`role="alert"`), not merely painted. Web rendered a plain `<p>` with no role at
 *    both boundaries, so a widget failing mid-session was completely silent to assistive tech while mobile
 *    announced it — the accessibility half of the drift, inverted.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { renderWithProviders } from '@commise/test-utils';

import { HomeWidgetErrorNotice } from '../HomeWidgetErrorNotice';

afterEach(cleanup);

describe('HomeWidgetErrorNotice (web)', () => {
    it('explains the loss in the same words mobile uses', () => {
        renderWithProviders(<HomeWidgetErrorNotice />);

        // The literal, not `webMessages.en…` — a test that reads the same catalog the component reads would
        // pass through a copy swap. This is character-identical to mobile's `home.widgetError`, so the two
        // platforms cannot drift apart without one of the surfaces' tests going red.
        expect(screen.getByText('This section couldn’t load.')).toBeTruthy();
    });

    it('announces the failure to assistive tech rather than only painting it', () => {
        renderWithProviders(<HomeWidgetErrorNotice />);

        // `alert`: the notice is inserted only AFTER the widget has already failed mid-session, so without a
        // live region a screen-reader user would have to go looking for it to learn anything went wrong.
        expect(screen.getByRole('alert').textContent).toBe('This section couldn’t load.');
    });

    it('carries the muted small-body treatment both boundaries shared before extraction', () => {
        renderWithProviders(<HomeWidgetErrorNotice />);

        // The visual treatment is part of what this component makes single-sourced (it was duplicated inline
        // at two boundaries); pinning it is what stops one boundary's notice from drifting louder or quieter
        // than the other's. Mobile pins the same pair through the shared tokens (`bodySm` / `palette.slate`).
        const notice = screen.getByRole('alert');

        expect(notice.className).toContain('text-body-sm');
        expect(notice.className).toContain('text-slate');
    });

    it('offers no recovery control it could not honour', () => {
        renderWithProviders(<HomeWidgetErrorNotice />);

        // Deliberate, and matched by mobile: React's `lazyInitializer` invokes the loader only while the
        // payload is Uninitialized — a rejection parks it at `_status = 2` and every later render re-throws
        // the cached `_result` WITHOUT re-invoking the loader. A "try again" that merely reset the boundary
        // would re-throw synchronously against the same module-scope lazy object and read as a dead button.
        expect(screen.queryAllByRole('button')).toHaveLength(0);
        expect(screen.queryAllByRole('link')).toHaveLength(0);
    });
});
