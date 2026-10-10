import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { AccessibilityInfo, Platform } from 'react-native';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { Button } from '../Button.native.js';
import { role, roleDark } from '../../tokens/colors.js';
import { nativeTokens } from '../../tokens/native.js';

/** The system colour scheme the next render sees (`null`: the platform states none). */
const scheme = vi.hoisted(() => ({ current: null as 'light' | 'dark' | null }));

// react-native-web does not implement `sendAccessibilityEvent`; the focus request reads its calls. The colour scheme
// is the system's, stubbed per test (`useTheme`).
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useColorScheme: () => scheme.current,
        AccessibilityInfo: { ...actual.AccessibilityInfo, sendAccessibilityEvent: vi.fn() },
    };
});

/**
 * Button (native) — rendered via react-native-web under jsdom, with the icon Registry's glyphs served by the
 * `lucideNativeStub` stand-in (which publishes the Lucide glyph name and colour it was drawn with).
 *
 * ⚠️ REWRITTEN in slice 2 of the UI overhaul (`docs/design/uiOverhaul/buildSpec.md` §1.4, §1.6, §1.10): the
 * coral-outlined secondary and its slate label were overruled by the owner ("Coral leaves every control"). Secondary
 * is neutral, there is a ghost tier, three sizes, a confirm tone for destructive, the label is the `label` type role
 * (a face per weight, never a `fontWeight`), Android's touch floor is 48 dp, and disabled is 40%.
 */

afterEach(() => {
    cleanup();
    scheme.current = null;
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
});

/** Render under a given React Native platform, restoring react-native-web's own `web` afterwards. */
function onPlatform(os: 'ios' | 'android'): () => void {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

    return () => Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
}

/** Every element in `root`, itself first. */
const allIn = (root: HTMLElement): HTMLElement[] => [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];

/** The descendant whose resolved style (react-native-web compiles a StyleSheet to atomic CSS) has this min-height. */
function withMinHeight(root: HTMLElement, minHeight: string): HTMLElement | null {
    return allIn(root).find((el) => getComputedStyle(el).minHeight === minHeight) ?? null;
}

/** The painted pill: the element carrying the surface's radius. */
function pillOf(button: HTMLElement): HTMLElement {
    const pill = allIn(button).find((el) => Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) > 0);

    if (pill === undefined) {
        throw new Error('The button paints no rounded surface.');
    }

    return pill;
}

/** The stand-in glyph a button drew. */
const glyphIn = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-commise-stub="icon"]');

/** `#RRGGBB` → the `rgb(r, g, b)` spelling jsdom's `getComputedStyle` normalises colours to. */
function rgb(hex: string): string {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

    return `rgb(${r}, ${g}, ${b})`;
}

/** The tiers that take a glyph, with the colour their label and glyph share. */
const TIERS = [
    { variant: 'primary', tone: undefined, label: role.onAction },
    { variant: 'secondary', tone: undefined, label: role.ink },
    { variant: 'destructive', tone: 'inline', label: role.dangerText },
    { variant: 'destructive', tone: 'confirm', label: role.onAction },
] as const;

describe('Button (native)', () => {
    it('renders an accessible button whose name is the label', () => {
        render(
            <Button icon="check" onPress={vi.fn()}>
                Save changes
            </Button>,
        );

        expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    });

    it('draws the Registry glyph for its meaning, decorative, so the label alone is the name', () => {
        const { container } = render(
            <Button icon="plus" onPress={vi.fn()}>
                Add step
            </Button>,
        );

        expect(glyphIn(container)?.dataset['iconName']).toBe('plus');
        expect(glyphIn(container)?.closest('[aria-hidden="true"]')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Add step' })).toBeTruthy();
    });

    it('draws the glyph in its label’s colour, for every tier', () => {
        for (const { variant, tone, label } of TIERS) {
            const { container, unmount } = render(
                variant === 'destructive' ? (
                    <Button icon="trash" variant={variant} tone={tone}>
                        Tier
                    </Button>
                ) : (
                    <Button icon="plus" variant={variant}>
                        Tier
                    </Button>
                ),
            );

            expect(glyphIn(container)?.dataset['iconColor'], `${variant} ${String(tone)}`).toBe(label);
            expect(getComputedStyle(screen.getByText('Tier')).color, `${variant} ${String(tone)}`).toBe(rgb(label));
            unmount();
        }
    });

    it('fires onPress when pressed', () => {
        const onPress = vi.fn();
        render(
            <Button icon="plus" onPress={onPress}>
                Add ingredient
            </Button>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Add ingredient' }));
        expect(onPress).toHaveBeenCalledOnce();
    });

    it('does not fire onPress when disabled, and dims to 40%', () => {
        const onPress = vi.fn();
        render(
            <Button icon="plus" onPress={onPress} disabled>
                Add step
            </Button>,
        );

        const button = screen.getByRole('button', { name: 'Add step' });
        fireEvent.click(button);

        expect(onPress).not.toHaveBeenCalled();
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(getComputedStyle(pillOf(button)).opacity).toBe('0.4');
    });

    it('does not fire onPress when busy (in-flight guard), and announces busy', () => {
        const onPress = vi.fn();
        render(
            <Button icon="plus" onPress={onPress} busy>
                Add step
            </Button>,
        );

        const button = screen.getByRole('button', { name: 'Add step' });
        fireEvent.click(button);

        expect(onPress).not.toHaveBeenCalled();
        expect(button.getAttribute('aria-busy')).toBe('true');
    });

    it('does not announce busy on an idle button', () => {
        render(<Button icon="plus">Add step</Button>);

        expect(screen.getByRole('button', { name: 'Add step' }).getAttribute('aria-busy')).not.toBe('true');
    });

    it('shows a real spinner in place of the glyph when busy (no layout shift), still labelled', () => {
        const { container, rerender } = render(
            <Button icon="plus" onPress={vi.fn()}>
                Create recipe
            </Button>,
        );

        expect(glyphIn(container)).not.toBeNull();
        expect(screen.queryByRole('progressbar', { hidden: true })).toBeNull();

        rerender(
            <Button icon="plus" onPress={vi.fn()} busy>
                Create recipe
            </Button>,
        );

        expect(screen.getByRole('progressbar', { hidden: true })).toBeTruthy();
        expect(glyphIn(container)).toBeNull();
        expect(screen.getByRole('button', { name: 'Create recipe' })).toBeTruthy();
    });

    // REWRITTEN in slice 2 (owner: primary is ONE flat fill, `modernizeB.md` §3): the brand gradient is gone.
    it('paints the primary tier as one flat action fill, with no gradient', () => {
        const { container } = render(<Button icon="plus">Get started</Button>);

        expect(getComputedStyle(pillOf(screen.getByRole('button', { name: 'Get started' }))).backgroundColor).toBe(
            rgb(role.action),
        );
        expect(container.querySelector('[data-commise-stub="linear-gradient"]')).toBeNull();
    });

    // D15: the surface, the label and the glyph come from `useTheme()` at render, so the dark scheme repaints them.
    it('repaints every tier from the dark roles when the system is dark', () => {
        scheme.current = 'dark';
        const { container } = render(
            <Button icon="x" variant="secondary">
                Cancel
            </Button>,
        );
        const pill = getComputedStyle(pillOf(screen.getByRole('button', { name: 'Cancel' })));

        expect(pill.backgroundColor).toBe(rgb(roleDark.paper));
        expect(pill.borderTopColor).toBe(rgb(roleDark.lineControl));
        expect(getComputedStyle(screen.getByText('Cancel')).color).toBe(rgb(roleDark.ink));
        expect(glyphIn(container)?.dataset['iconColor']).toBe(roleDark.ink);
    });

    it('paints secondary neutral: paper, a 1px lineControl edge and an ink label', () => {
        render(
            <Button icon="x" variant="secondary">
                Cancel
            </Button>,
        );

        const pill = getComputedStyle(pillOf(screen.getByRole('button', { name: 'Cancel' })));

        expect(pill.backgroundColor).toBe(rgb(role.paper));
        expect(pill.borderTopWidth).toBe('1px');
        expect(pill.borderTopColor).toBe(rgb(role.lineControl));
        expect(document.querySelector('[data-commise-stub="linear-gradient"]')).toBeNull();
    });

    it('paints ghost with no fill and no edge, in actionText', () => {
        render(<Button variant="ghost">Show all</Button>);

        const pill = getComputedStyle(pillOf(screen.getByRole('button', { name: 'Show all' })));

        expect(pill.backgroundColor).toBe('rgba(0, 0, 0, 0)');
        expect(pill.borderTopWidth).toBe('0px');
        expect(getComputedStyle(screen.getByText('Show all')).color).toBe(rgb(role.actionText));
    });

    it('lets a ghost button have no glyph, and shows the spinner there when busy', () => {
        const { container, rerender } = render(<Button variant="ghost">Load more</Button>);

        expect(glyphIn(container)).toBeNull();

        rerender(
            <Button variant="ghost" busy>
                Load more
            </Button>,
        );

        expect(screen.getByRole('progressbar', { hidden: true })).toBeTruthy();
    });

    it('fills destructive with danger only in its confirm tone; inline is a danger label on the neutral surface', () => {
        const { rerender } = render(
            <Button icon="trash" variant="destructive">
                Delete recipe
            </Button>,
        );

        const inline = getComputedStyle(pillOf(screen.getByRole('button', { name: 'Delete recipe' })));
        expect(inline.backgroundColor).toBe(rgb(role.paper));
        expect(inline.borderTopColor).toBe(rgb(role.lineControl));

        rerender(
            <Button icon="trash" variant="destructive" tone="confirm">
                Delete recipe
            </Button>,
        );

        expect(getComputedStyle(pillOf(screen.getByRole('button', { name: 'Delete recipe' }))).backgroundColor).toBe(
            rgb(role.danger),
        );
    });

    it('sets the label in the label role’s registered face, never a face plus a weight', () => {
        render(<Button icon="plus">Add</Button>);

        const label = getComputedStyle(screen.getByText('Add'));

        expect(label.fontFamily).toBe(nativeTokens.type.label.fontFamily);
        expect(label.fontSize).toBe(`${String(nativeTokens.type.label.fontSize)}px`);
        expect(['', 'normal', '400']).toContain(label.fontWeight);
    });

    it('sizes lg at 52, md at 44 and sm at 36 visual points on iOS', () => {
        const restore = onPlatform('ios');

        try {
            for (const [size, visual] of [
                ['lg', 52],
                ['md', 44],
                ['sm', 36],
            ] as const) {
                const { unmount } = render(
                    <Button icon="plus" size={size}>
                        Sized
                    </Button>,
                );

                const pill = getComputedStyle(pillOf(screen.getByRole('button', { name: 'Sized' })));

                expect(pill.minHeight, size).toBe(`${String(visual)}px`);
                // E2 I2 — half the height, not a full pill: a wrapped label stays inside the curve.
                expect(Number.parseFloat(pill.borderTopLeftRadius), size).toBe(visual / 2);
                unmount();
            }
        } finally {
            restore();
        }
    });

    it('gives the 36pt sm button a 44pt hit area on iOS', () => {
        const restore = onPlatform('ios');

        try {
            render(
                <Button icon="plus" size="sm">
                    Small
                </Button>,
            );

            expect(withMinHeight(screen.getByRole('button', { name: 'Small' }), '44px')).not.toBeNull();
        } finally {
            restore();
        }
    });

    it('raises the md button and the sm hit area to 48 dp on Android (spec §1.6)', () => {
        const restore = onPlatform('android');

        try {
            const { unmount } = render(<Button icon="plus">Medium</Button>);
            expect(getComputedStyle(pillOf(screen.getByRole('button', { name: 'Medium' }))).minHeight).toBe('48px');
            unmount();

            render(
                <Button icon="plus" size="sm">
                    Small
                </Button>,
            );
            expect(withMinHeight(screen.getByRole('button', { name: 'Small' }), '48px')).not.toBeNull();
            expect(getComputedStyle(pillOf(screen.getByRole('button', { name: 'Small' }))).minHeight).toBe('36px');
        } finally {
            restore();
        }
    });

    it('adopts PressScale so the pill carries a press-scale transform (resting = neutral)', () => {
        render(<Button icon="check">Save changes</Button>);

        expect(screen.getByRole('button', { name: 'Save changes' }).style.transform).toBe('scale(1)');
    });

    /** `width` (R9, `docs/design/rowEditorOpenDecisions.md`): passed to the `PressScale` that owns the pressable. */
    it('leaves its size to the parent when no width is given', () => {
        render(<Button icon="check">Done</Button>);

        expect(screen.getByRole('button', { name: 'Done' }).style.alignSelf).toBe('');
    });

    it('stretches across its parent under fill', () => {
        render(
            <Button icon="check" width="fill">
                Done
            </Button>,
        );

        expect(screen.getByRole('button', { name: 'Done' }).style.alignSelf).toBe('stretch');
    });
});

describe('Button (native) — a focus request', () => {
    const requested = (focusRequested: boolean, onFocusRequestHandled = vi.fn()) => (
        <Button icon="plus" focusRequested={focusRequested} onFocusRequestHandled={onFocusRequestHandled}>
            Add ingredient
        </Button>
    );

    it('moves the screen-reader cursor to the button and acknowledges, once', () => {
        const handled = vi.fn();
        const { rerender } = render(requested(false, handled));

        expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();

        rerender(requested(true, handled));
        rerender(requested(true, handled));

        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledTimes(1);
        expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
            screen.getByRole('button', { name: 'Add ingredient' }),
            'focus',
        );
        expect(handled).toHaveBeenCalledTimes(1);
    });
});
