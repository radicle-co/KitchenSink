import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { LocalizedMessages } from '../dictionary.js';
import { LocaleProvider, useLocale, useMessages } from '../react.js';

interface Copy {
    readonly greeting: string;
}

const messages: LocalizedMessages<Copy> = {
    en: { greeting: 'Hello' },
    es: { greeting: 'Hola' },
};

function ShowLocale() {
    return <span>{useLocale()}</span>;
}

function ShowGreeting() {
    return <span>{useMessages(messages).greeting}</span>;
}

describe('LocaleProvider / useLocale / useMessages', () => {
    it('defaults to the default locale with no provider', () => {
        render(<ShowLocale />);

        expect(screen.getByText('en')).toBeDefined();
    });

    it('exposes the provided locale', () => {
        render(
            <LocaleProvider locale="es">
                <ShowLocale />
            </LocaleProvider>,
        );

        expect(screen.getByText('es')).toBeDefined();
    });

    it('useMessages resolves the active locale', () => {
        render(
            <LocaleProvider locale="es">
                <ShowGreeting />
            </LocaleProvider>,
        );

        expect(screen.getByText('Hola')).toBeDefined();
    });

    it('useMessages falls back to en for an unshipped locale', () => {
        render(
            <LocaleProvider locale="fr">
                <ShowGreeting />
            </LocaleProvider>,
        );

        expect(screen.getByText('Hello')).toBeDefined();
    });
});
