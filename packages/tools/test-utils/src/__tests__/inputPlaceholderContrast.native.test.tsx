/**
 * The native Input's placeholder against the WCAG AA body-text floor, measured the way the app renders it.
 *
 * MOVED from `@commise/ui`'s `Input.native.test.tsx` (ADR-0091): it measures with this package's `placeholderContrast`,
 * and `@commise/ui` cannot declare this package without a dependency cycle, since this package depends on it. An
 * undeclared import is an edge the changed-only selector cannot see, so the test lives where both are declared.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FieldLabel, Input } from '@commise/ui/input';

import { DesignSystemFrame } from '../DesignSystemFrame.js';
import { placeholderContrast } from '../renderedContrast.js';

afterEach(cleanup);

describe('Input (native) placeholder', () => {
    it('draws the PLACEHOLDER above the WCAG AA body-text floor on its paper field', () => {
        render(
            <DesignSystemFrame>
                <FieldLabel forId="email" label="Email" />
                <Input id="email" value="" onChangeText={vi.fn()} placeholder="you@example.com" />
            </DesignSystemFrame>,
        );

        expect(placeholderContrast(screen.getByRole('textbox', { name: 'Email' }))).toBeGreaterThanOrEqual(4.5);
    });
});
