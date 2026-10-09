/**
 * @module @commise/ui/button — shared, platform-neutral prop + variant contract for the design-system `Button`. The
 * web (`Button.tsx`) and native (`Button.native.tsx`) leaves both implement this exact surface; the bundler resolves
 * the right leaf per platform at import time (`@commise/ui/button`).
 *
 * The Button is the app-wide standard for a labelled action control, and it encodes its invariants at the type level
 * so callers cannot regress them:
 *  1. **The glyph is a MEANING, not an element.** `icon` is an `IconName` from `@commise/ui/icon`, so a screen cannot
 *     draw its own glyph (`docs/design/uiOverhaul/buildSpec.md` §1.7). It is REQUIRED for `primary`, `secondary` and
 *     `destructive`, and optional only for `ghost` — the one text-like tier (§1.11).
 *  2. **The label owns the accessible name.** `children` is the visible text AND the accessible name; the glyph is
 *     always decorative, so a screen reader announces the label alone and name-based selection is stable.
 *  3. **Only a destructive button has a tone**, and only a confirm dialog asks for the filled one (§1.11). The
 *     discriminated union makes `tone` on any other tier a compile error.
 */
import type { ReactNode } from 'react';

import type { IconName } from '../icon/props.js';
import type { PressScaleWidth } from '../pressScale/props.js';

/**
 * The visual tiers (§1.10). `primary` is the one filled call-to-action of a view; `secondary` is neutral (paper, a
 * `lineControl` edge, an `ink` label); `ghost` is an `actionText` label with no surface at rest; `destructive` is a
 * danger label, filled with `danger` only in its `confirm` tone.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

/** The sizes (§1.6): 52, 44 and 36 visual px. `sm` keeps a 44 px hit area (48 dp on Android). */
export type ButtonSize = 'lg' | 'md' | 'sm';

/** A destructive button's tone: a danger label inline, or the filled surface a confirm dialog's action takes. */
export type DestructiveTone = 'inline' | 'confirm';

/** What every tier shares. */
interface ButtonCommon {
    /** The visible label. Also the accessible name unless {@link accessibilityLabel} overrides it. */
    readonly children: ReactNode;
    /** The size. Defaults to `md`. */
    readonly size?: ButtonSize;
    /** Tap / click handler. */
    readonly onPress?: () => void;
    /**
     * Web form semantics — `submit` makes the control submit its enclosing `<form>`. Ignored on native (there is no
     * form element); native submit buttons wire {@link onPress} instead. Defaults to `button`.
     */
    readonly type?: 'button' | 'submit';
    /**
     * Disables interaction and dims the control, for a rule the press did not cause. On web it yields to
     * {@link busy}: a busy control is the one just pressed, so it stays focusable (see `busyControlProps`).
     */
    readonly disabled?: boolean;
    /**
     * Marks an in-flight action: the control cannot be double-fired and exposes a busy state to assistive tech. A
     * spinner replaces the glyph and the label stays.
     *
     * ⚠️ The platforms reach "cannot double-fire" differently, on purpose. WEB: the button stays FOCUSABLE —
     * `aria-disabled` + `aria-busy`, and the click is cancelled — because a real browser drops focus from a natively
     * disabled control (WCAG 2.2 SC 2.4.3). NATIVE: the `Pressable` is disabled and exposes `accessibilityState.busy`;
     * a disabled `Pressable` keeps screen-reader focus on device.
     */
    readonly busy?: boolean;
    /**
     * Overrides the label-derived accessible name. Use only when the visible label is not a plain string or is
     * insufficient on its own; the visible label must stay contained in it (SC 2.5.3).
     */
    readonly accessibilityLabel?: string;
    /**
     * Sizing across the parent: `fill` fills a column with the label centred, and keeps content width in a row.
     * Defaults to `auto`, which leaves the size to the parent. Passed through to `PressScale`, which owns the box.
     */
    readonly width?: PressScaleWidth;
    /**
     * A host asks for focus on the button: keyboard focus on web, the screen-reader cursor on native. A LEVEL, as on
     * `Popover`: it stands until {@link onFocusRequestHandled} acknowledges it, so a button that mounts while the
     * request stands still takes it.
     */
    readonly focusRequested?: boolean;
    /** Called once the button has taken a requested focus; the host clears its request here. */
    readonly onFocusRequestHandled?: () => void;
}

/** A primary (the default) or secondary button: a glyph is required. */
interface SurfacedButton extends ButtonCommon {
    readonly variant?: 'primary' | 'secondary';
    /** The meaning the button's glyph draws. */
    readonly icon: IconName;
}

/** A destructive button: a glyph is required, and it may take the confirm tone. */
interface DestructiveButton extends ButtonCommon {
    readonly variant: 'destructive';
    /** The meaning the button's glyph draws. */
    readonly icon: IconName;
    /** `inline` (the default) or the filled `confirm` surface, which only a confirm dialog's action takes. */
    readonly tone?: DestructiveTone;
}

/** A ghost button: the one tier whose glyph is optional. */
interface GhostButton extends ButtonCommon {
    readonly variant: 'ghost';
    /** The meaning the button's glyph draws, if it has one. */
    readonly icon?: IconName;
}

/** The cross-platform Button contract shared by the web and native leaves. */
export type ButtonProps = SurfacedButton | DestructiveButton | GhostButton;

/**
 * The surface a set of props asks for: its tier and, for a destructive button, its tone. Pure.
 *
 * @param props - The button's props.
 * @returns The variant (defaulted to `primary`) and the destructive tone (defaulted to `inline`), if any.
 */
export function surfaceOf(props: ButtonProps): { readonly variant: ButtonVariant; readonly tone: DestructiveTone } {
    if (props.variant === 'destructive') {
        return { variant: 'destructive', tone: props.tone ?? 'inline' };
    }

    return { variant: props.variant ?? 'primary', tone: 'inline' };
}
