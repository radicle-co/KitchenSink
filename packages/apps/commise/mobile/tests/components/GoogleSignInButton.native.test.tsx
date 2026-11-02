/**
 * The Google sign-in label's text size (designer rulings 2026-11-01, ADR-0080 §8). It is drawn in our own Button
 * label's role, `cardTitle`, so our two sign-in buttons read alike; it does not chase the letter size of Apple's system
 * button. On iOS it sits beside that button, which does not grow, so it stays at its 1× size; on Android there is no
 * pair, so it follows the 1.5× navigation chrome cap. Google's colours are no design-system role, so the label is React Native's own text, with system scaling
 * off and its size AND leading set from the scale here (React Native leaves a set leading uncapped on Android).
 */
import { cleanup, screen } from '@testing-library/react';
import { nativeTokens } from '@commise/ui/native';
import { withPlatformOs } from '@commise/ui/testing/platform-os';
import { render } from '@commise/ui/testing/tamagui';
import { afterEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ fontScale: 1 }));

// The system text size (Android font scale, iOS Dynamic Type). react-native-web always answers 1.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => ({ ...actual.useWindowDimensions(), fontScale: env.fontScale }),
    };
});

const { GoogleSignInButton } = await import('../../src/components/auth/GoogleSignInButton.js');

afterEach(() => {
    cleanup();
    env.fontScale = 1;
});

/** The label's own style: React Native's web build writes it inline, and jsdom's computed style drops the leading. */
function labelStyle(): CSSStyleDeclaration {
    return screen.getByText('Continue with Google').style;
}

// Our Button's label role (`ButtonLabel.native.tsx`): the designer's ruling is that the two read alike.
const { fontSize, lineHeight } = nativeTokens.type.cardTitle;

describe('GoogleSignInButton label size', () => {
    it('stays at its 1× size on iOS, beside Apple’s button, however large the system text', () => {
        env.fontScale = 3;

        withPlatformOs('ios', () => {
            render(<GoogleSignInButton label="Continue with Google" onPress={vi.fn()} disabled={false} busy={false} />);
        });

        expect(labelStyle().fontSize).toBe(`${String(fontSize)}px`);
        expect(labelStyle().lineHeight).toBe(`${String(lineHeight)}px`);
    });

    it('grows to the 1.5× chrome cap on Android, its leading with it', () => {
        env.fontScale = 3;

        withPlatformOs('android', () => {
            render(<GoogleSignInButton label="Continue with Google" onPress={vi.fn()} disabled={false} busy={false} />);
        });

        expect(labelStyle().fontSize).toBe(`${String(fontSize * 1.5)}px`);
        expect(labelStyle().lineHeight).toBe(`${String(lineHeight * 1.5)}px`);
    });

    it('follows the system scale below the cap on Android', () => {
        env.fontScale = 1.2;

        withPlatformOs('android', () => {
            render(<GoogleSignInButton label="Continue with Google" onPress={vi.fn()} disabled={false} busy={false} />);
        });

        expect(labelStyle().fontSize).toBe(`${String(fontSize * 1.2)}px`);
    });
});
