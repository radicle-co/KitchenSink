/**
 * `AuthScreenFrame` — the shell the three signed-out screens (sign-in, sign-up, the social finish step) share: safe
 * area, keyboard avoidance and a scroll that keeps a tap on a control working while the keyboard is up.
 *
 * What is pinned, and why each is a real failure rather than taste:
 *
 * - The children render INSIDE the shell, so a screen that forgot the frame would lose all three behaviours at once.
 * - The content padding is the design system's own spacing (5 across, 6 down; sections 5 apart), because the beach-glow canvas behind it
 *   shows through and the three screens must hold the same margins.
 * - The root is TRANSPARENT: an opaque fill occludes the root `AppCanvas` gradient (issue #145).
 * - Every screen that adopts it keeps ONE copy of these rules; the screens' own suites cover what they put inside.
 */
import { nativeTokens } from '@commise/ui/native';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AuthScreenFrame } from '../../src/components/auth/AuthScreenFrame.js';

afterEach(cleanup);

describe('AuthScreenFrame', () => {
    it('renders its children inside the shell', () => {
        render(
            <AuthScreenFrame>
                <span>inside</span>
            </AuthScreenFrame>,
        );

        expect(screen.getByText('inside')).toBeTruthy();
    });

    it('pads the content with the design system spacing', () => {
        render(
            <AuthScreenFrame>
                <span>inside</span>
            </AuthScreenFrame>,
        );

        const content = window.getComputedStyle(screen.getByText('inside').parentElement as HTMLElement);

        expect(content.paddingLeft).toBe(`${nativeTokens.spacing[5]}px`);
        expect(content.paddingTop).toBe(`${nativeTokens.spacing[6]}px`);
    });

    it('is transparent, so the AppCanvas gradient behind it shows through', () => {
        const { container } = render(
            <AuthScreenFrame>
                <span>inside</span>
            </AuthScreenFrame>,
        );

        const root = container.firstElementChild as HTMLElement;

        expect(window.getComputedStyle(root).backgroundColor).toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/u);
    });
});
