/**
 * The resume notice (web): device changes waiting on a published recipe, with Save changes and Discard. It paints
 * `surfaceMuted` and holds two controls, so it states that surface (`componentFixes.md` §10), and, as every notice, takes
 * the 18 px `lg` corner (`componentFixes.md` §10a: `rounded-md` was drift).
 *
 * Mutation lens: paint the muted fill without stating it, or put the corner back to `rounded-md`, and a test fails.
 */
import { surfaceToneOf } from '@commise/ui/testing/surface-tone-of';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResumeNotice } from '../ResumeNotice.js';

afterEach(cleanup);

const renderNotice = (discardUnavailable?: string): void => {
    render(
        <ResumeNotice
            body="You have changes from 10:42 that aren’t saved to your recipe."
            saveLabel="Save changes"
            discardLabel="Discard"
            onSave={vi.fn()}
            onDiscard={vi.fn()}
            {...(discardUnavailable === undefined ? {} : { discardUnavailable })}
        />,
    );
};

describe('ResumeNotice (web)', () => {
    it('states the muted surface, and both of its controls read it', () => {
        renderNotice();

        expect(surfaceToneOf(screen.getByRole('button', { name: 'Save changes' }))).toBe('muted');
        expect(surfaceToneOf(screen.getByRole('button', { name: 'Discard' }))).toBe('muted');
    });

    it('draws the notice corner (18 px, lg), not the md step', () => {
        renderNotice();
        const tokens = screen.getByRole('region').className.split(/\s+/u);

        expect(tokens).toContain('rounded-lg');
        expect(tokens).not.toContain('rounded-md');
    });

    it('still says why Discard is unavailable', () => {
        renderNotice('Saving…');

        expect(screen.getByRole('status').textContent).toBe('Saving…');
    });
});
