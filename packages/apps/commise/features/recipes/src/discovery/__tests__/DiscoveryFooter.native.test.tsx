/**
 * The native footer of a Discover card (`docs/design/uiOverhaul/buildSpec.md` §4.1): a 20 px avatar disc, "@handle" on one line,
 * and a 44 px Save a copy icon button at the end. The button's name carries the recipe's title, so a screen of them is
 * not a list of identical controls. The icon fills while a copy is being made and stays filled once it exists; a press
 * while saving or saved does nothing and the button stays focusable (`aria-disabled`, never `disabled`); a failure
 * unfills the icon and an inline alert says so.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import type { SaveCopyState } from '../../hooks/useSaveCopy.js';
import { DiscoveryFooter } from '../DiscoveryFooter.native.js';

afterEach(cleanup);

function footer(state: SaveCopyState, over: Partial<React.ComponentProps<typeof DiscoveryFooter>> = {}) {
    const onSave = vi.fn();

    render(
        <LocaleProvider locale="en">
            <DiscoveryFooter
                title="Pasta"
                authorUsername="braise"
                authorDisplayName="Eliza Moreno"
                avatar="shown"
                state={state}
                onSave={onSave}
                {...over}
            />
        </LocaleProvider>,
    );

    return { onSave };
}

/** Whether the glyph was drawn filled: the stand-in reports `none` for an outline and its colour for a fill. */
const glyphFill = () =>
    screen.getByRole('button').querySelector('[data-icon-name]')?.getAttribute('data-icon-fill') === 'none'
        ? 'none'
        : 'currentColor';

/** Text a reader sees: the byline's invisible bidi isolates removed. */
const visible = (text: string | null | undefined): string => (text ?? '').replace(/[\u2068\u2069]/gu, '');

/** Find the one element whose own text reads `expected` once the isolates are removed. */
const byline = (expected: string) =>
    screen.getByText(
        (_content, element) => element?.children.length === 0 && visible(element.textContent) === expected,
    );

describe('DiscoveryFooter (native) — the byline (plan 2026-10-15-010 D11)', () => {
    it('says “@username (Display Name)”, with a disc drawn from the USERNAME that is not read aloud', () => {
        footer({ kind: 'idle' });

        expect(byline('@braise (Eliza Moreno)')).toBeTruthy();
        expect(screen.getByText('B')).toBeTruthy();
    });

    it('says “@username” alone when the author has no display name', () => {
        footer({ kind: 'idle' }, { authorDisplayName: undefined });

        expect(byline('@braise')).toBeTruthy();
    });

    it('says the display name, never prefixed “@”, when the author has no username', () => {
        footer({ kind: 'idle' }, { authorUsername: undefined });

        expect(byline('Eliza Moreno')).toBeTruthy();
        expect(screen.queryByText(/@/u)).toBeNull();
    });

    it('says “Former member”, with no disc, for an erased author — never the pseudonym', () => {
        footer({ kind: 'idle' }, { authorUsername: undefined, authorDisplayName: 'user_01J9ZK8N7QF3B2X4M6T0V5C1AB' });

        expect(byline('Former member')).toBeTruthy();
        expect(screen.queryByText(/user_/u)).toBeNull();
        expect(screen.queryByText('U')).toBeNull();
    });

    it('drops the disc on a compact card, keeping the words', () => {
        footer({ kind: 'idle' }, { avatar: 'hidden' });

        expect(byline('@braise (Eliza Moreno)')).toBeTruthy();
        expect(screen.queryByText('B')).toBeNull();
    });

    it('shows the source instead when the recipe was imported and has no author', () => {
        footer(
            { kind: 'idle' },
            { authorUsername: undefined, authorDisplayName: undefined, sourceAttribution: 'Serious Eats' },
        );

        expect(screen.getByText('From Serious Eats')).toBeTruthy();
    });

    it('never says “From” without a source: a copy has neither an author nor an attribution (W-03)', () => {
        footer(
            { kind: 'idle' },
            { authorUsername: undefined, authorDisplayName: undefined, sourceAttribution: undefined },
        );

        expect(screen.queryByText(/From/u)).toBeNull();
        expect(screen.getByRole('button', { name: 'Save a copy of Pasta' })).toBeTruthy();
    });

    it('says nothing about an author it does not have, and still offers the button', () => {
        footer({ kind: 'idle' }, { authorUsername: undefined, authorDisplayName: undefined });

        expect(screen.queryByText(/@/u)).toBeNull();
        expect(screen.getByRole('button', { name: 'Save a copy of Pasta' })).toBeTruthy();
    });
});

describe('DiscoveryFooter (native) — Save a copy', () => {
    it('idle: named for the recipe, an empty glyph, and a press saves', () => {
        const { onSave } = footer({ kind: 'idle' });

        expect(glyphFill()).toBe('none');

        fireEvent.click(screen.getByRole('button', { name: 'Save a copy of Pasta' }));

        expect(onSave).toHaveBeenCalledOnce();
    });

    it('saving: a filled glyph, busy, and a press does nothing', () => {
        const { onSave } = footer({ kind: 'saving' });
        const button = screen.getByRole('button', { name: 'Saving a copy of Pasta' });

        expect(glyphFill()).toBe('currentColor');
        expect(button.getAttribute('aria-busy')).toBe('true');

        fireEvent.click(button);

        expect(onSave).not.toHaveBeenCalled();
    });

    it('saved: stays filled, its name becomes “Saved a copy of Pasta”, and a press does nothing', () => {
        const { onSave } = footer({ kind: 'saved', copyId: 'copy_1' });
        const button = screen.getByRole('button', { name: 'Saved a copy of Pasta' });

        expect(glyphFill()).toBe('currentColor');
        expect(button.getAttribute('aria-busy')).toBeNull();

        fireEvent.click(button);

        expect(onSave).not.toHaveBeenCalled();
    });

    it('failed: the glyph unfills, an inline alert says so, and a press tries again', () => {
        const { onSave } = footer({ kind: 'failed' });

        expect(glyphFill()).toBe('none');
        expect(screen.getByRole('alert').textContent).toBe('Couldn’t save a copy. Try again.');

        fireEvent.click(screen.getByRole('button', { name: 'Save a copy of Pasta' }));

        expect(onSave).toHaveBeenCalledOnce();
    });

    it('says nothing in an alert while idle, saving or saved', () => {
        for (const state of [{ kind: 'idle' }, { kind: 'saving' }, { kind: 'saved', copyId: 'c' }] as const) {
            footer(state);
            expect(screen.queryByRole('alert')).toBeNull();
            cleanup();
        }
    });
});
