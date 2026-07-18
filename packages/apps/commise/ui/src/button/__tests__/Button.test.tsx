import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactElement } from 'react';

import { Button } from '../Button.js';

/**
 * Button (web) — the design-system labelled action control.
 *
 * These pin the two type-level invariants at runtime (icon is decorative and never in the accessible name;
 * the label owns the name), the three visual tiers each render a real surface (not naked text), and the
 * interaction/disabled/busy behaviour. The icon passed here is a marker `<svg>` so we can assert it is both
 * rendered AND hidden from the accessibility tree.
 */

const markerIcon: ReactElement = <svg className="marker-icon" />;

describe('Button (web)', () => {
    it('exposes the label as the button accessible name', () => {
        render(
            <Button icon={markerIcon} onPress={vi.fn()}>
                Save changes
            </Button>,
        );

        expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    });

    it('renders the icon but hides it from the accessibility tree (name is the label alone)', () => {
        const { container } = render(
            <Button icon={markerIcon} onPress={vi.fn()}>
                Add step
            </Button>,
        );

        // The icon is present…
        const icon = container.querySelector('.marker-icon');
        expect(icon).not.toBeNull();
        // …but wrapped so it is removed from the accessibility tree — the primitive owns decorativeness,
        // so the caller cannot accidentally leak the glyph into the accessible name.
        expect(icon?.closest('[aria-hidden="true"]')).not.toBeNull();
        // The accessible name is exactly the label, with no icon contribution.
        expect(screen.getByRole('button', { name: 'Add step' })).toBeTruthy();
    });

    it('defaults to type="button" and honours type="submit"', () => {
        const { rerender } = render(
            <Button icon={markerIcon} onPress={vi.fn()}>
                Add ingredient
            </Button>,
        );
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add ingredient' }).type).toBe('button');

        rerender(
            <Button icon={markerIcon} type="submit">
                Create recipe
            </Button>,
        );
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create recipe' }).type).toBe('submit');
    });

    it('fires onPress on click', () => {
        const onPress = vi.fn();
        render(
            <Button icon={markerIcon} onPress={onPress}>
                Add step
            </Button>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Add step' }));
        expect(onPress).toHaveBeenCalledOnce();
    });

    it('does not fire onPress when disabled', () => {
        const onPress = vi.fn();
        render(
            <Button icon={markerIcon} onPress={onPress} disabled>
                Add step
            </Button>,
        );

        const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Add step' });
        expect(button.disabled).toBe(true);
        fireEvent.click(button);
        expect(onPress).not.toHaveBeenCalled();
    });

    it('marks a busy control as aria-busy AND disabled (cannot double-fire)', () => {
        const onPress = vi.fn();
        render(
            <Button icon={markerIcon} onPress={onPress} busy>
                Create recipe
            </Button>,
        );

        const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Create recipe' });
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(button.disabled).toBe(true);
        fireEvent.click(button);
        expect(onPress).not.toHaveBeenCalled();
    });

    it('applies a distinct visible surface per variant (none is naked text)', () => {
        const { rerender, container } = render(
            <Button icon={markerIcon} variant="primary">
                Primary
            </Button>,
        );
        const primaryClass = container.querySelector('button')?.className ?? '';
        // Primary is a filled seafoam CTA (the mockup's seafoam→ocean-dark gradient).
        expect(primaryClass).toContain('seafoam');

        rerender(
            <Button icon={markerIcon} variant="secondary">
                Secondary
            </Button>,
        );
        const secondaryClass = container.querySelector('button')?.className ?? '';
        // Secondary reads as a button via a border, not a fill — and is visually distinct from primary.
        expect(secondaryClass).toContain('border');
        expect(secondaryClass).not.toBe(primaryClass);

        rerender(
            <Button icon={markerIcon} variant="destructive">
                Destructive
            </Button>,
        );
        const destructiveClass = container.querySelector('button')?.className ?? '';
        // Destructive is error-toned and distinct from the other two.
        expect(destructiveClass).toContain('error');
        expect(destructiveClass).not.toBe(primaryClass);
        expect(destructiveClass).not.toBe(secondaryClass);
    });

    it('defaults to the primary variant when none is given', () => {
        const { container } = render(<Button icon={markerIcon}>Default</Button>);
        expect(container.querySelector('button')?.className).toContain('seafoam');
    });
});
