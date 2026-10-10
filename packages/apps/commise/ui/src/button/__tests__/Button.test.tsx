import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Button } from '../Button.js';
import { buttonSurfaceClass } from '../surfaceClass.js';

/**
 * Button (web) — the design-system labelled action control.
 *
 * These pin the type-level invariants at runtime (the glyph is the Registry's, decorative and never in the accessible
 * name; the label owns the name), that each tier renders exactly the shared surface recipe, and the
 * interaction/disabled/busy behaviour. ⚠️ Slice 2 of the UI overhaul made `icon` a MEANING from `@commise/ui/icon`
 * rather than a caller-drawn element, so these assert the Lucide glyph the button draws (`lucide-plus`).
 */

/** The Registry glyph a button drew, by its Lucide class (`lucide-plus`), or `null` for none. */
const glyphIn = (container: HTMLElement): string | null =>
    [...(container.querySelector('svg.lucide')?.classList ?? [])].find((token) => /^lucide-./u.test(token)) ?? null;

/** A meaning from the icon Registry; its Lucide glyph is `plus`. */
const plusMeaning = 'plus';

describe('Button (web)', () => {
    it('exposes the label as the button accessible name', () => {
        render(
            <Button icon={plusMeaning} onPress={vi.fn()}>
                Save changes
            </Button>,
        );

        expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    });

    it('renders the icon but hides it from the accessibility tree (name is the label alone)', () => {
        const { container } = render(
            <Button icon={plusMeaning} onPress={vi.fn()}>
                Add step
            </Button>,
        );

        // The Registry's glyph for the meaning is present…
        expect(glyphIn(container)).toBe('lucide-plus');
        const icon = container.querySelector('svg.lucide');
        // …but wrapped so it is removed from the accessibility tree — the primitive owns decorativeness,
        // so the caller cannot accidentally leak the glyph into the accessible name.
        expect(icon?.closest('[aria-hidden="true"]')).not.toBeNull();
        // The accessible name is exactly the label, with no icon contribution.
        expect(screen.getByRole('button', { name: 'Add step' })).toBeTruthy();
    });

    it('defaults to type="button" and honours type="submit"', () => {
        const { rerender } = render(
            <Button icon={plusMeaning} onPress={vi.fn()}>
                Add ingredient
            </Button>,
        );
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add ingredient' }).type).toBe('button');

        rerender(
            <Button icon={plusMeaning} type="submit">
                Create recipe
            </Button>,
        );
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create recipe' }).type).toBe('submit');
    });

    it('fires onPress on click', async () => {
        const user = userEvent.setup();
        const onPress = vi.fn();
        render(
            <Button icon={plusMeaning} onPress={onPress}>
                Add step
            </Button>,
        );

        await user.click(screen.getByRole('button', { name: 'Add step' }));
        expect(onPress).toHaveBeenCalledOnce();
    });

    it('does not fire onPress when disabled', async () => {
        const user = userEvent.setup();
        const onPress = vi.fn();
        render(
            <Button icon={plusMeaning} onPress={onPress} disabled>
                Add step
            </Button>,
        );

        const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Add step' });
        expect(button.disabled).toBe(true);
        await user.click(button);
        expect(onPress).not.toHaveBeenCalled();
    });

    // ⛔ REWRITTEN: a busy control used to be natively `disabled`. The control that goes busy is the one the user
    // just pressed, and a real browser drops focus to <body> the moment a focused control becomes disabled
    // (WCAG 2.2 SC 2.4.3) — jsdom does not, which is why this asserts the attributes as well as the press. A busy
    // control stays FOCUSABLE, says it is unavailable (`aria-disabled`) and in flight (`aria-busy`), and still
    // cannot double-fire: the click is cancelled.
    it('⛔ a busy control that is also disabled keeps focus — busy wins, as the control just pressed', () => {
        render(
            <Button icon={plusMeaning} disabled busy>
                Clone
            </Button>,
        );

        const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Clone' });
        expect(button.disabled).toBe(false);
        expect(button.getAttribute('aria-disabled')).toBe('true');
    });

    it('marks a busy control aria-busy AND aria-disabled, keeps it focusable, and cannot double-fire', async () => {
        const user = userEvent.setup();
        const onPress = vi.fn();
        render(
            <Button icon={plusMeaning} onPress={onPress} busy>
                Create recipe
            </Button>,
        );

        const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Create recipe' });
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(button.disabled).toBe(false);
        await user.click(button);
        expect(onPress).not.toHaveBeenCalled();
    });

    it('⛔ a busy SUBMIT button does not let Enter in a field submit the form a second time', async () => {
        // HTML implicit submission fires a click on the form's default button when Enter is pressed in a field.
        // Native `disabled` used to stop that; the busy click handler must cancel it (`preventDefault`), or a
        // cook pressing Enter twice saves twice.
        const user = userEvent.setup();
        const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
        render(
            <form onSubmit={onSubmit}>
                <label>
                    Title
                    <input />
                </label>
                <Button icon={plusMeaning} type="submit" busy>
                    Save recipe
                </Button>
            </form>,
        );

        await user.type(screen.getByLabelText('Title'), 'Soup{Enter}');

        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('renders a real spinner when busy, swapping the icon slot in place (no layout shift)', () => {
        const { container, rerender } = render(
            <Button icon={plusMeaning} onPress={vi.fn()}>
                Create recipe
            </Button>,
        );
        // Idle: the meaning's glyph is shown, no spinner.
        expect(glyphIn(container)).toBe('lucide-plus');
        expect(container.querySelector('.animate-spin')).toBeNull();

        rerender(
            <Button icon={plusMeaning} onPress={vi.fn()} busy>
                Create recipe
            </Button>,
        );
        // Busy: a real animated spinner takes the icon's place (icon gone → the slot is reused, not added,
        // so the label does not reflow) and the visible label is unchanged.
        expect(container.querySelector('.animate-spin')).not.toBeNull();
        expect(glyphIn(container)).toBeNull();
        expect(screen.getByRole('button', { name: 'Create recipe' })).toBeTruthy();
    });

    /**
     * E2 I12 — rewritten to prove the POINTER rule: the old version pinned the width-only `md:min-h-0`, which gave a
     * touch iPad a 41 px target. The floor is now reset only for a fine pointer at md: and up.
     */
    it('gets a 44px min touch height that only a fine pointer at md: resets (desktop height unchanged)', () => {
        const { container } = render(<Button icon={plusMeaning}>Save</Button>);
        const classes = (container.querySelector('button')?.className ?? '').split(/\s+/u);
        // Touch, at every width, gets the comfortable 44px min target…
        expect(classes).toContain('min-h-11');
        // …and only a mouse at md:+ resets it, so the desktop density (py-2.5) is preserved exactly.
        expect(classes).toContain('md:pointer-fine:min-h-0');
        expect(classes).not.toContain('md:min-h-0');
    });

    it('adopts the PressScale primitive so it scales on press (motion-safe)', () => {
        const { container } = render(<Button icon={plusMeaning}>Save</Button>);
        // The button is wrapped by PressScale — the OUTERMOST element is an ancestor span carrying the
        // motion-safe press-scale utility (suppressed under reduce-motion), and the <button> lives inside.
        const wrapper = container.firstElementChild;
        expect(wrapper?.tagName).toBe('SPAN');
        expect(wrapper?.className).toContain('motion-safe:not-has-aria-disabled:active:scale-[0.98]');
        expect(wrapper?.querySelector('button')).not.toBeNull();
    });

    it('renders EXACTLY the shared buttonSurfaceClass recipe for every tier and size, so a link cannot drift', () => {
        // The helper is what non-<button> controls (navigation links, Radix slots) apply. Pinning equality here means a
        // change to the Button surface is impossible to make in one place only.
        for (const size of ['lg', 'md', 'sm'] as const) {
            for (const variant of ['primary', 'secondary'] as const) {
                const { container, unmount } = render(
                    <Button icon={plusMeaning} variant={variant} size={size}>
                        Tier
                    </Button>,
                );

                expect(container.querySelector('button')?.className).toBe(buttonSurfaceClass(variant, size));
                unmount();
            }

            const ghost = render(
                <Button variant="ghost" size={size}>
                    Tier
                </Button>,
            );
            expect(ghost.container.querySelector('button')?.className).toBe(buttonSurfaceClass('ghost', size));
            ghost.unmount();

            for (const tone of ['inline', 'confirm'] as const) {
                const { container, unmount } = render(
                    <Button icon="trash" variant="destructive" tone={tone} size={size}>
                        Tier
                    </Button>,
                );

                expect(container.querySelector('button')?.className).toBe(
                    buttonSurfaceClass('destructive', size, tone),
                );
                unmount();
            }
        }
    });

    it('defaults to the primary tier at md', () => {
        const { container } = render(<Button icon={plusMeaning}>Default</Button>);

        expect(container.querySelector('button')?.className).toBe(buttonSurfaceClass('primary', 'md'));
    });

    it('defaults a destructive button to its inline tone', () => {
        const { container } = render(
            <Button icon="trash" variant="destructive">
                Delete
            </Button>,
        );

        expect(container.querySelector('button')?.className).toBe(buttonSurfaceClass('destructive', 'md', 'inline'));
    });

    it('lets a ghost button have no glyph at all, and still be a named button', () => {
        const { container } = render(<Button variant="ghost">Show all</Button>);

        expect(glyphIn(container)).toBeNull();
        expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
        expect(screen.getByRole('button', { name: 'Show all' })).toBeTruthy();
    });

    it('draws a ghost button’s glyph when it is given one', () => {
        const { container } = render(
            <Button variant="ghost" icon="x">
                Clear
            </Button>,
        );

        expect(glyphIn(container)).toBe('lucide-x');
    });

    it('shows the spinner on a busy ghost button that has no glyph', () => {
        const { container } = render(
            <Button variant="ghost" busy>
                Load more
            </Button>,
        );

        expect(container.querySelector('.animate-spin')).not.toBeNull();
    });

    it('draws its glyph at the 20px inline size, in the colour of its label', () => {
        const { container } = render(<Button icon={plusMeaning}>Add</Button>);
        const svg = container.querySelector('svg.lucide');

        expect(svg?.getAttribute('width')).toBe('20');
        expect(svg?.getAttribute('stroke')).toBe('currentColor');
    });
});

/**
 * `width` (R9, `docs/design/rowEditorOpenDecisions.md`). jsdom has no layout, so these pin the class contract; the
 * measured widths are `variantSurfaceReflow.spec.ts`'s and `recipeFilterSheet.spec.ts`'s.
 */
describe('Button (web) — width', () => {
    const tokensOf = (element: Element | null | undefined): string[] => (element?.className ?? '').split(/\s+/u);

    it('hugs its content when no width is given: the inline wrapper, and no width on the button', () => {
        const { container } = render(<Button icon={plusMeaning}>Save</Button>);

        expect(tokensOf(container.firstElementChild)).toContain('inline-flex');
        expect(tokensOf(container.firstElementChild)).not.toContain('self-stretch');
        expect(tokensOf(container.querySelector('button'))).not.toContain('w-full');
    });

    it('fills its slot under fill: the wrapper stretches and the button takes its whole width, label centred', () => {
        const { container } = render(
            <Button icon={plusMeaning} variant="secondary" width="fill">
                Back to recipes
            </Button>,
        );

        const wrapper = tokensOf(container.firstElementChild);
        expect(wrapper).toEqual(expect.arrayContaining(['flex', 'self-stretch']));
        expect(wrapper).not.toContain('inline-flex');

        const button = tokensOf(screen.getByRole('button', { name: 'Back to recipes' }));
        // The tier's surface is untouched; only the width is added.
        expect(button).toEqual(expect.arrayContaining([...buttonSurfaceClass('secondary').split(' '), 'w-full']));
        expect(button).toContain('justify-center');
    });
});

describe('Button (web) — a focus request', () => {
    const requested = (focusRequested: boolean, onFocusRequestHandled = vi.fn()) => (
        <div>
            <Button icon="plus" focusRequested={focusRequested} onFocusRequestHandled={onFocusRequestHandled}>
                Add ingredient
            </Button>
            <button type="button">Elsewhere</button>
        </div>
    );

    it('moves focus to the button and acknowledges, once', () => {
        const handled = vi.fn();
        const { rerender } = render(requested(false, handled));

        expect(document.activeElement).toBe(document.body);

        rerender(requested(true, handled));
        rerender(requested(true, handled));

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add ingredient' }));
        expect(handled).toHaveBeenCalledTimes(1);
    });

    it('takes a request it mounts with', () => {
        const handled = vi.fn();

        render(requested(true, handled));

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add ingredient' }));
        expect(handled).toHaveBeenCalledTimes(1);
    });
});
