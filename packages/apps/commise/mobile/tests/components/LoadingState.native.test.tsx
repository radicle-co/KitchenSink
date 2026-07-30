/**
 * Component tests for the mobile `LoadingState` affordance (rendered via react-native-web under jsdom).
 *
 * A bare `ActivityIndicator` is a spinning shape with no name: a screen-reader user hears nothing, and a
 * sighted user cannot tell "fetching your recipe" from "stuck". This affordance is the one place that
 * decision lives, so every loading surface announces WHAT is loading and shows a visible caption.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LoadingState } from '../../src/components/LoadingState.js';

afterEach(cleanup);

describe('LoadingState', () => {
    it('exposes ONE progressbar named by the contextual label', () => {
        render(<LoadingState label="Loading recipe…" />);

        expect(screen.getAllByRole('progressbar')).toHaveLength(1);
        expect(screen.getByRole('progressbar', { name: 'Loading recipe…' })).toBeTruthy();
    });

    it('shows the label as a visible caption (not screen-reader-only)', () => {
        render(<LoadingState label="Loading recipe…" />);

        expect(screen.getByText('Loading recipe…')).toBeTruthy();
    });

    it('hides the decorative spinner from assistive tech so the state is announced once', () => {
        render(<LoadingState label="Loading recipe…" />);

        // The spinner itself is an unnamed `progressbar` in react-native-web; leaving it exposed would
        // announce a second, nameless progress element beside the labelled one.
        const spinners = screen.getAllByRole('progressbar', { hidden: true });
        expect(spinners.length).toBeGreaterThan(1);
        expect(spinners.some((node) => node.closest('[aria-hidden="true"]') !== null)).toBe(true);
    });
});
