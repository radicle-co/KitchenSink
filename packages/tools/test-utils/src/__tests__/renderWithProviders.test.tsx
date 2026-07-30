import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import type { LocalizedMessages } from '@commise/i18n';
import { useMessages } from '@commise/i18n/react';

import { renderWithProviders } from '../renderWithProviders.js';

interface Copy {
    readonly greeting: string;
}

const messages: LocalizedMessages<Copy> = {
    en: { greeting: 'Hello' },
    es: { greeting: 'Hola' },
};

/** Reads a dictionary through `useMessages` — throws if rendered outside a `LocaleProvider`. */
function Greeting() {
    return <span>{useMessages(messages).greeting}</span>;
}

describe('renderWithProviders', () => {
    it('supplies a LocaleProvider so a component calling useMessages renders instead of throwing', () => {
        renderWithProviders(<Greeting />);

        expect(screen.getByText('Hello')).toBeTruthy();
    });

    it('defaults to the "en" locale when none is supplied', () => {
        renderWithProviders(<Greeting />);

        expect(screen.getByText('Hello')).toBeTruthy();
    });

    it('honors an explicit locale option', () => {
        renderWithProviders(<Greeting />, { locale: 'es' });

        expect(screen.getByText('Hola')).toBeTruthy();
    });

    it('returns RTL RenderResult (container is queryable)', () => {
        const result = renderWithProviders(<Greeting />);

        expect(result.container.textContent).toBe('Hello');
    });
});
