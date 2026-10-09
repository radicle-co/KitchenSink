// @vitest-environment jsdom
/**
 * The footer of a Discover card (`docs/design/uiOverhaul/buildSpec.md` §4.1): a 20 px avatar disc, "@handle" on one line,
 * and a 44 px Save a copy icon button at the end. The button's name carries the recipe's title, so a screen of them is
 * not a list of identical controls. The icon fills while a copy is being made and stays filled once it exists; a press
 * while saving or saved does nothing and the button stays focusable (`aria-disabled`, never `disabled`); a failure
 * unfills the icon and an inline alert says so.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';

import type { SaveCopyState } from '../../hooks/useSaveCopy.js';
import { DiscoveryFooter } from '../DiscoveryFooter.js';

afterEach(cleanup);

function footer(state: SaveCopyState, over: Partial<React.ComponentProps<typeof DiscoveryFooter>> = {}) {
    const onSave = vi.fn();

    render(
        <LocaleProvider locale="en">
            <DiscoveryFooter title="Pasta" authorHandle="braise.club" state={state} onSave={onSave} {...over} />
        </LocaleProvider>,
    );

    return { onSave };
}

const glyphFill = () => screen.getByRole('button').querySelector('svg')?.getAttribute('fill');

describe('DiscoveryFooter (web) — the author', () => {
    it('says “@handle” and nothing about the avatar', () => {
        footer({ kind: 'idle' });

        expect(screen.getByText('@braise.club')).toBeTruthy();
        // The disc is decoration: its letter is not read, so the handle is said once.
        expect(screen.getByText('B').closest('[aria-hidden="true"]')).toBeTruthy();
    });

    it('shows the source instead when the recipe was imported and has no author handle', () => {
        footer({ kind: 'idle' }, { authorHandle: undefined, sourceAttribution: 'Serious Eats' });

        expect(screen.getByText('From Serious Eats')).toBeTruthy();
    });

    it('says nothing about an author it does not have, and still offers the button', () => {
        footer({ kind: 'idle' }, { authorHandle: undefined });

        expect(screen.queryByText(/@/u)).toBeNull();
        expect(screen.getByRole('button', { name: 'Save a copy of Pasta' })).toBeTruthy();
    });
});

describe('DiscoveryFooter (web) — Save a copy', () => {
    it('idle: named for the recipe, an empty glyph, and a press saves', () => {
        const { onSave } = footer({ kind: 'idle' });

        expect(glyphFill()).toBe('none');

        fireEvent.click(screen.getByRole('button', { name: 'Save a copy of Pasta' }));

        expect(onSave).toHaveBeenCalledOnce();
    });

    it('saving: a filled glyph, busy, aria-disabled yet focusable, and a press does nothing', () => {
        const { onSave } = footer({ kind: 'saving' });
        const button = screen.getByRole('button', { name: 'Saving a copy of Pasta' });

        expect(glyphFill()).toBe('currentColor');
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(button.hasAttribute('disabled')).toBe(false);

        fireEvent.click(button);

        expect(onSave).not.toHaveBeenCalled();
    });

    it('saved: stays filled, its name becomes “Saved a copy of Pasta”, and a press does nothing', () => {
        const { onSave } = footer({ kind: 'saved', copyId: 'copy_1' });
        const button = screen.getByRole('button', { name: 'Saved a copy of Pasta' });

        expect(glyphFill()).toBe('currentColor');
        expect(button.getAttribute('aria-disabled')).toBe('true');
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
