/**
 * @module @commise/ui/button — shared, platform-neutral prop + variant contract for the design-system `Button`. The
 * web (`Button.tsx`) and native (`Button.native.tsx`) leaves both implement this exact surface; the bundler resolves
 * the right leaf per platform at import time (`@commise/ui/button`).
 *
 * The Button is the app-wide standard for a labelled action control, and it encodes its invariants at the type level
 * so callers cannot regress them:
 *  1. **The glyph is a MEANING, not an element.** `icon` is an `IconName` from `@commise/ui/icon`, so a screen cannot
 *     draw its own glyph (`docs/design/uiOverhaul/buildSpec.md` §1.7). It is REQUIRED for `primary` and
 *     `destructive`, and optional for `secondary` (a safe choice such as "Keep editing") and the two text-like tiers, `ghost`
 *     (§1.11) and `quiet`.
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
 * `lineControl` edge, an `ink` label); `ghost` is an `actionText` label with no surface at rest; `quiet` is an `ink`
 * label with no surface at rest and its glyph in `actionText`, for an action that must stay available without a
 * surface of its own: Try again (`componentFixes.md` §1) and "Keep … as written"
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). It has no fill on purpose: a tonal fill marks
 * a chip (`componentFixes.md` §4);
 * `destructive` is a danger label, filled with `danger` only in its `confirm` tone.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'destructive';

/** The sizes (§1.6): 52, 44 and 36 visual px. `sm` keeps a 44 px hit area (48 dp on Android). */
export type ButtonSize = 'lg' | 'md' | 'sm';

/**
 * The visual height of each size, in points (§1.6). On Android `md` IS the 48 dp touch floor, so the native leaf grows it
 * there. Exported so a control that cannot be a `Button` — a third-party brand button whose look its owner specifies —
 * can still stand at exactly a button's height beside one.
 */
export const BUTTON_VISUAL_HEIGHT: Readonly<Record<ButtonSize, number>> = { lg: 52, md: 44, sm: 36 };

/** A destructive button's tone: a danger label inline, or the filled surface a confirm dialog's action takes. */
export type DestructiveTone = 'inline' | 'confirm';

/**
 * What colour a secondary button's glyph (and its busy spinner) takes: its label's (`label`, the default) or the action
 * colour, `actionText` (`action`). `action` is the cue on a surfaced step-forward control such as a cooking step's Next,
 * while its label stays `ink` on `paper`: the same split `quiet` makes, on a button with a surface.
 */
export type ButtonGlyphTone = 'label' | 'action';

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
     * Refuses the press because a SIBLING's send is in flight (a list of foods while one is sent). Unlike
     * {@link disabled} it may be raised while the button holds focus, so on WEB the button stays FOCUSABLE —
     * `aria-disabled`, the click cancelled, no busy claim and no spinner (see `busyControlProps`); on NATIVE the
     * `Pressable` is disabled, which keeps screen-reader focus on device. It dims as a disabled button does. It
     * yields to {@link busy} and wins over {@link disabled}.
     */
    readonly refused?: boolean;
    /**
     * Why the action is on offer, or what went wrong: the control's accessible DESCRIPTION, read after its name, never
     * part of it. Web draws it in a visually hidden element beside the button and points `aria-describedby` at it;
     * native hands it over as the `accessibilityHint`, because React Native has no `aria-describedby`.
     */
    readonly description?: string;
    /**
     * Overrides the label-derived accessible name. Use only when the visible label is not a plain string or is
     * insufficient on its own; the visible label must stay contained in it (SC 2.5.3).
     */
    readonly accessibilityLabel?: string;
    /**
     * Whether the region this button opens is open: the control is a DISCLOSURE ("See why"). Web sets `aria-expanded`,
     * native `accessibilityState.expanded`. Stated only for a disclosure: `false` reads COLLAPSED, and absent says
     * nothing about expansion.
     */
    readonly expanded?: boolean;
    /**
     * Sizing across the parent: `fill` fills a column with the label centred, and keeps content width in a row.
     * Defaults to `auto`, which leaves the size to the parent. Passed through to `PressScale`, which owns the box.
     */
    readonly width?: PressScaleWidth;
    /**
     * Which side of the label the glyph (and the busy spinner) sits on. `end` is for a control that opens a menu or a
     * sheet, whose chevron follows the word it belongs to (§4.5 "Sort: {choice}" + `chevron-down`). Defaults to
     * `start`.
     */
    readonly iconPlacement?: 'start' | 'end';
    /**
     * A host asks for focus on the button: keyboard focus on web, the screen-reader cursor on native. A LEVEL, as on
     * `Popover`: it stands until {@link onFocusRequestHandled} acknowledges it, so a button that mounts while the
     * request stands still takes it.
     */
    readonly focusRequested?: boolean;
    /** Called once the button has taken a requested focus; the host clears its request here. */
    readonly onFocusRequestHandled?: () => void;
}

/** A primary (the default) button: a glyph is required. */
interface PrimaryButton extends ButtonCommon {
    readonly variant?: 'primary';
    /** The meaning the button's glyph draws. */
    readonly icon: IconName;
    /** Secondary only: a glyph on the `action` fill already takes the label's colour. */
    readonly glyphTone?: never;
}

/**
 * A secondary button: the glyph is optional. A neutral safe choice such as "Keep editing" is text only, because a glyph on
 * it (an `x`) reads as close or discard, the opposite of keeping the person's work (designer ruling 2026-11-03).
 */
interface SecondaryButton extends ButtonCommon {
    readonly variant: 'secondary';
    /** The meaning the button's glyph draws, if it has one. */
    readonly icon?: IconName;
    /**
     * The colour of the glyph and the busy spinner. Defaults to `label`, so the glyph matches the `ink` label. `action`
     * draws it in `actionText` while the label and the surface stay as they are; a disabled or refused button drops the
     * cue back to the label's colour ({@link glyphToneOf}).
     */
    readonly glyphTone?: ButtonGlyphTone;
}

/** A destructive button: a glyph is required, and it may take the confirm tone. */
interface DestructiveButton extends ButtonCommon {
    readonly variant: 'destructive';
    /** The meaning the button's glyph draws. */
    readonly icon: IconName;
    /** `inline` (the default) or the filled `confirm` surface, which only a confirm dialog's action takes. */
    readonly tone?: DestructiveTone;
    /** Secondary only: a danger glyph stays in its label's colour. */
    readonly glyphTone?: never;
}

/** A ghost or quiet button: the text-like tiers, whose glyph is optional. */
interface TextButton extends ButtonCommon {
    readonly variant: 'ghost' | 'quiet';
    /** The meaning the button's glyph draws, if it has one. */
    readonly icon?: IconName;
    /** Secondary only: ghost is already all `actionText`, and quiet's glyph always is. */
    readonly glyphTone?: never;
}

/** The cross-platform Button contract shared by the web and native leaves. */
export type ButtonProps = PrimaryButton | SecondaryButton | DestructiveButton | TextButton;

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

/**
 * The glyph tone a set of props asks for, in its current state: the ONE policy for when a Button glyph is steel beyond
 * `quiet`. The web recipe (`buttonGlyphClass`) and the native leaf (`glyphRoleOf`) each read it and only turn its answer
 * into their own colour form. Only the secondary tier's type admits `glyphTone`, so only a secondary button can answer
 * `action`. A disabled or refused button shows no action cue, so its glyph takes the label's colour; a busy one keeps
 * the tone, because busy wins over both (as everywhere on the button) and its spinner is the glyph. Pure.
 *
 * @param props - The button's props.
 * @returns `action` only for a secondary button that asks for it and is not dimmed; otherwise `label`.
 */
export function glyphToneOf(props: ButtonProps): ButtonGlyphTone {
    const dimmed = props.busy !== true && (props.disabled === true || props.refused === true);

    return props.glyphTone === 'action' && !dimmed ? 'action' : 'label';
}
