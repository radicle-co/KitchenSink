import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { AccessibilityInfo, Platform } from 'react-native';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { Button } from '../Button.native.js';
import { BUTTON_VISUAL_HEIGHT, type ButtonProps, type ButtonSize } from '../props.js';
import { buttonSurfaceClass } from '../surfaceClass.js';
import { dimmedOpacity } from '../../tokens/scale.js';

// A value no literal in the leaf could match: the dimmed opacity must be READ from the shared token.
vi.mock('../../tokens/scale.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../tokens/scale.js')>()),
    dimmedOpacity: 0.25,
}));
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

/** Tiers drawn with a glyph here: the colour of the label, and of the glyph (which only `quiet` takes apart). */
const TIERS = [
    { variant: 'primary', tone: undefined, label: role.onAction, glyph: role.onAction },
    { variant: 'secondary', tone: undefined, label: role.ink, glyph: role.ink },
    { variant: 'quiet', tone: undefined, label: role.ink, glyph: role.actionText },
    { variant: 'destructive', tone: 'inline', label: role.dangerText, glyph: role.dangerText },
    { variant: 'destructive', tone: 'confirm', label: role.onAction, glyph: role.onAction },
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

    // ⚠️ REWRITTEN (`componentFixes.md` §1): "the glyph is in its label's colour, for every tier" stopped being true for
    // quiet, whose label is `ink` and whose glyph is `actionText`. Every other tier still agrees with its label.
    it('draws the glyph in its tier’s glyph colour — its label’s, except quiet’s actionText', () => {
        for (const { variant, tone, label, glyph } of TIERS) {
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

            expect(glyphIn(container)?.dataset['iconColor'], `${variant} ${String(tone)}`).toBe(glyph);
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

    it('does not fire onPress when disabled, and dims to the shared dimmed opacity', () => {
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
        // The opacity comes from the shared token (mocked to a different value below), never a literal here.
        expect(getComputedStyle(pillOf(button)).opacity).toBe(String(dimmedOpacity));
        expect(dimmedOpacity).toBe(0.25);
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

    it('does not fire onPress when refused, dims, and claims no busy state', () => {
        const onPress = vi.fn();
        render(
            <Button variant="ghost" icon="search" onPress={onPress} refused>
                Search for a food
            </Button>,
        );

        const button = screen.getByRole('button', { name: 'Search for a food' });
        fireEvent.click(button);

        expect(onPress).not.toHaveBeenCalled();
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(button.getAttribute('aria-busy')).not.toBe('true');
        expect(getComputedStyle(pillOf(button)).opacity).toBe(String(dimmedOpacity));
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

    // `componentFixes.md` §1: text only, in `--ink` (it was `--ink-muted`), with the same 44 px target.
    it('paints quiet as text only: no fill and no edge, in ink, as a named button', () => {
        render(<Button variant="quiet">Keep as written</Button>);

        const button = screen.getByRole('button', { name: 'Keep as written' });
        const pill = getComputedStyle(pillOf(button));

        expect(pill.backgroundColor).toBe('rgba(0, 0, 0, 0)');
        expect(pill.borderTopWidth).toBe('0px');
        expect(getComputedStyle(screen.getByText('Keep as written')).color).toBe(rgb(role.ink));
    });

    it('repaints the quiet label and glyph from the dark roles when the system is dark', () => {
        scheme.current = 'dark';
        const { container } = render(
            <Button variant="quiet" icon="refreshCw">
                Keep as written
            </Button>,
        );

        expect(getComputedStyle(screen.getByText('Keep as written')).color).toBe(rgb(roleDark.ink));
        expect(glyphIn(container)?.dataset['iconColor']).toBe(roleDark.actionText);
    });

    it('draws the busy spinner in the quiet glyph colour, actionText, on the same pressable', () => {
        const { rerender } = render(
            <Button variant="quiet" icon="refreshCw">
                Try again
            </Button>,
        );
        const button = screen.getByRole('button', { name: 'Try again' });

        rerender(
            <Button variant="quiet" icon="refreshCw" busy>
                Try again
            </Button>,
        );

        expect(screen.getByRole('button', { name: 'Try again' })).toBe(button);
        expect(screen.getByRole('progressbar', { hidden: true }).outerHTML).toContain(
            `stroke: ${rgb(role.actionText)}`,
        );
    });

    it('gives quiet a 44 pt target on iOS and 48 dp on Android', () => {
        for (const [os, floor] of [
            ['ios', 44],
            ['android', 48],
        ] as const) {
            const restore = onPlatform(os);

            try {
                const { unmount } = render(<Button variant="quiet">Keep as written</Button>);
                const button = screen.getByRole('button', { name: 'Keep as written' });

                expect(getComputedStyle(pillOf(button)).minHeight, os).toBe(`${String(floor)}px`);
                unmount();
            } finally {
                restore();
            }
        }
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

    // REWRITTEN for owner ruling B1 (2026-10-26): the label is the 16/20/600 `cardTitle` role, not the 14/600 `label`.
    it('sets the label in the cardTitle role’s registered face, never a face plus a weight', () => {
        render(<Button icon="plus">Add</Button>);

        const label = getComputedStyle(screen.getByText('Add'));

        expect(label.fontFamily).toBe(nativeTokens.type.cardTitle.fontFamily);
        expect(label.fontSize).toBe('16px');
        expect(label.fontSize).not.toBe(`${String(nativeTokens.type.label.fontSize)}px`);
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

    // The type-scale ruling (2026-10-25) set the label's leading at 20 px (it was 16.8). The pill is
    // `max(minHeight, 8 + leading + 8)`, so a label that outgrew the small variant would stretch every small button;
    // 8 + 20 + 8 = 36 is exactly the small height, so none does. A one-line label never sets the height of any size.
    it('keeps a one-line label inside every size: padding plus the label leading never exceeds the size’s height', () => {
        const chrome = nativeTokens.spacing[2] * 2 + (nativeTokens.type.cardTitle.lineHeight ?? 0);

        for (const height of Object.values(BUTTON_VISUAL_HEIGHT)) {
            expect(chrome).toBeLessThanOrEqual(height);
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

describe('Button (native) — iconPlacement (A-018)', () => {
    it('draws the glyph BEFORE the label by default', () => {
        render(
            <Button variant="ghost" icon="chevronDown">
                Sort
            </Button>,
        );
        const label = screen.getByText('Sort');
        const glyph = glyphIn(screen.getByRole('button')) as HTMLElement;

        expect(glyph.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('draws the glyph AFTER the label with iconPlacement="end", still decorative', () => {
        render(
            <Button variant="ghost" icon="chevronDown" iconPlacement="end">
                Sort
            </Button>,
        );
        const label = screen.getByText('Sort');
        const glyph = glyphIn(screen.getByRole('button')) as HTMLElement;

        expect(label.compareDocumentPosition(glyph) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(glyph.closest('[aria-hidden="true"]')).not.toBeNull();
    });
});

/**
 * Web and native share ONE horizontal padding (`surfaceClass.ts`, "`px-3 md:px-5`"). Measured in Chromium at 320 px,
 * three actions at 20-24 px of inline padding need 383 px against 288 available, so the label wraps and the primary
 * action is clipped off the right edge. Web moved to `px-3`; the native leaf kept `spacing[5]` (24 dp), so every
 * three-action row on a 320 dp phone overflowed. The native padding is read from the rendered pill and compared with
 * the web surface's own base `px-*` step, so neither platform can move alone.
 *
 * Only the BASE step is shared. Web's `md:px-5` is a wide-viewport density, and native has no viewport breakpoint on a
 * button, so a phone always takes the narrow value.
 */
describe('Button (native) — horizontal padding equals web’s', () => {
    /** Tailwind v4's default `--spacing` base: `px-N` is N x 0.25rem, which is N x 4 px at the 16 px root. */
    const TAILWIND_SPACING_PX = 4;

    /** The px a web surface pads each side with at the narrowest width: its one unprefixed `px-N` step. */
    function webBasePaddingPx(className: string): number {
        const steps = className
            .split(/\s+/u)
            .map((token) => /^px-(\d+(?:\.\d+)?)$/u.exec(token)?.[1])
            .filter((step): step is string => step !== undefined);

        expect(steps, className).toHaveLength(1);

        return Number(steps[0]) * TAILWIND_SPACING_PX;
    }

    const SIZES: readonly ButtonSize[] = ['lg', 'md', 'sm'];

    /** Every tier and destructive tone, as the props that ask for it and the web surface it wears. */
    const SURFACES: readonly {
        readonly name: string;
        readonly props: (size: ButtonSize) => ButtonProps;
        readonly web: (size: ButtonSize) => string;
    }[] = [
        {
            name: 'primary',
            props: (size) => ({ icon: 'plus', size, children: 'Padded' }),
            web: (size) => buttonSurfaceClass('primary', { size }),
        },
        {
            name: 'secondary',
            props: (size) => ({ icon: 'plus', variant: 'secondary', size, children: 'Padded' }),
            web: (size) => buttonSurfaceClass('secondary', { size }),
        },
        {
            name: 'ghost',
            props: (size) => ({ variant: 'ghost', size, children: 'Padded' }),
            web: (size) => buttonSurfaceClass('ghost', { size }),
        },
        {
            name: 'quiet',
            props: (size) => ({ variant: 'quiet', size, children: 'Padded' }),
            web: (size) => buttonSurfaceClass('quiet', { size }),
        },
        {
            name: 'destructive inline',
            props: (size) => ({ icon: 'trash', variant: 'destructive', size, children: 'Padded' }),
            web: (size) => buttonSurfaceClass('destructive', { size, tone: 'inline' }),
        },
        {
            name: 'destructive confirm',
            props: (size) => ({ icon: 'trash', variant: 'destructive', tone: 'confirm', size, children: 'Padded' }),
            web: (size) => buttonSurfaceClass('destructive', { size, tone: 'confirm' }),
        },
    ];

    it('pads every tier and size on each side by the web surface’s base px step', () => {
        for (const { name, props, web } of SURFACES) {
            for (const size of SIZES) {
                const { unmount } = render(<Button {...props(size)} />);
                const pill = getComputedStyle(pillOf(screen.getByRole('button', { name: 'Padded' })));
                const expected = `${String(webBasePaddingPx(web(size)))}px`;

                expect(pill.paddingLeft, `${name} ${size}`).toBe(expected);
                expect(pill.paddingRight, `${name} ${size}`).toBe(expected);
                unmount();
            }
        }
    });

    // The guard above compares two moving parts; this pins the agreed value, so both cannot drift together.
    it('is the 12 px step, so three actions fit a 320 px row', () => {
        expect(webBasePaddingPx(buttonSurfaceClass('primary'))).toBe(12);
        expect(nativeTokens.spacing[3]).toBe(12);
    });
});

/** ADDED for the visible "See why" disclosure: `expanded` reaches the accessibility state, and only when stated. */
describe('Button (native) — expanded', () => {
    afterEach(cleanup);

    it('states expanded true and false for a disclosure, and nothing otherwise', () => {
        const { rerender } = render(
            <Button variant="ghost" expanded={false}>
                See why
            </Button>,
        );

        expect(screen.getByRole('button', { name: 'See why' }).getAttribute('aria-expanded')).toBe('false');

        rerender(
            <Button variant="ghost" expanded>
                See why
            </Button>,
        );

        expect(screen.getByRole('button', { name: 'See why' }).getAttribute('aria-expanded')).toBe('true');

        rerender(<Button variant="ghost">See why</Button>);

        expect(screen.getByRole('button', { name: 'See why' }).hasAttribute('aria-expanded')).toBe(false);
    });
});
