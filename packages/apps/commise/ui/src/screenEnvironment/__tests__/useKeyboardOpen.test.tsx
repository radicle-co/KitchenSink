/**
 * Web's keyboard reading (buildSpec §3.4, §3.6): a text field focused on a coarse pointer — never a checkbox, a button,
 * a read-only field, or any field on a fine pointer, where no on-screen keyboard rises.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { JSX } from 'react';

import { isTextEntry, useKeyboardOpen } from '../useKeyboardOpen.js';

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

const Probe = (): JSX.Element => <output>{useKeyboardOpen() ? 'open' : 'closed'}</output>;

describe('isTextEntry', () => {
    const element = (html: string): Element | null => {
        const host = document.createElement('div');
        host.innerHTML = html;

        return host.firstElementChild;
    };

    it.each([
        ['a text input', '<input type="text">', true],
        ['a search input', '<input type="search">', true],
        ['a number input', '<input type="number">', true],
        ['a textarea', '<textarea></textarea>', true],
        ['a checkbox', '<input type="checkbox">', false],
        ['a read-only input', '<input type="text" readonly>', false],
        ['a button', '<button>Go</button>', false],
        ['nothing', '', false],
    ])('%s', (_name, html, expected) => {
        expect(isTextEntry(element(html))).toBe(expected);
    });
});

describe('useKeyboardOpen (web)', () => {
    it('opens when a text field takes focus on a coarse pointer, and closes when focus leaves', () => {
        vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }));
        render(
            <>
                <input aria-label="Search" />
                <Probe />
            </>,
        );

        expect(screen.getByText('closed')).toBeTruthy();
        act(() => screen.getByLabelText('Search').focus());
        expect(screen.getByText('open')).toBeTruthy();
        act(() => screen.getByLabelText('Search').blur());
        expect(screen.getByText('closed')).toBeTruthy();
    });

    it('stays closed, and does not throw, where the browser has no matchMedia at all', () => {
        vi.stubGlobal('matchMedia', undefined);
        render(
            <>
                <input aria-label="Search" />
                <Probe />
            </>,
        );

        act(() => screen.getByLabelText('Search').focus());
        expect(screen.getByText('closed')).toBeTruthy();
    });

    it('stays closed on a fine pointer: a desktop keyboard raises nothing on screen', () => {
        vi.stubGlobal('matchMedia', () => ({ matches: false }));
        render(
            <>
                <input aria-label="Search" />
                <Probe />
            </>,
        );

        act(() => screen.getByLabelText('Search').focus());
        expect(screen.getByText('closed')).toBeTruthy();
    });
});
