'use client';

/**
 * @module @commise/ui/button — the web design-system {@link Button}.
 *
 * A presentational, labelled action control: the Registry glyph for its meaning beside its label, on the surface its
 * tier and size select (`buttonSurfaceClass`, `docs/design/uiOverhaul/buildSpec.md` §1.10). Consumes the shared
 * {@link ButtonProps} contract; the native leaf (`Button.native.tsx`) mirrors it.
 *
 * The glyph is drawn at the 20 px inline size in `currentColor`, so it always takes its label's colour, inside an
 * `aria-hidden` slot: the visible label (`children`) owns the accessible name. A ghost button may have no glyph; then
 * the slot exists only while busy, to hold the spinner.
 *
 * Two behaviours are shared with the native leaf but expressed in the web idiom:
 *  - **Touch target** — a `min-h-11` (44px) floor at base for comfortable touch, RESET at `md:` so the
 *    mouse density (`py-2.5`, ~40px) is unchanged on desktop. (The WCAG-AA bar 2.5.8/24px is already met;
 *    this is a comfort bump for touch, not a desktop change.)
 *  - **Busy** — the `busy` prop swaps the icon slot for a real spinner in place (no layout shift) and
 *    marks the control unavailable without disabling it natively (see `busyControlProps`); and the whole
 *    button is wrapped in {@link PressScale} for a motion-safe press-scale, which a busy button does not play.
 *
 * `'use client'`: the focus request is an effect, and feature leaves that render this button are reachable from App
 * Router server pages through their package's index (caught by `next build`, not by typecheck).
 *
 * @pattern Discriminated union (`ButtonProps`, illegal tier/glyph/tone combinations unrepresentable) rendered
 *     through the `buttonSurfaceClass` style recipe, composed with the `PressScale` Decorator.
 * @pattern Adapter over the DOM focus API — a level-triggered focus request, acknowledged once taken. It is the one
 *     reason this leaf holds a ref: `.focus()` has no declarative form.
 */
import { useRef, type FC } from 'react';

import { useFocusRequest } from '../focusRequest/useFocusRequest.js';
import { Icon } from '../icon/Icon.js';
import { PressScale } from '../pressScale/index.js';
import { busyControlProps } from './busyControlProps.js';
import { surfaceOf, type ButtonProps } from './props.js';
import { buttonSurfaceClass } from './surfaceClass.js';

/**
 * The in-flight spinner. `currentColor` so it inherits the tier's text colour; `animate-spin` for the
 * rotation. It renders in the SAME `aria-hidden` slot the icon uses, so busy state does not reflow the
 * label. The busy state is announced via the button's `aria-busy`, so the glyph itself stays decorative.
 */
const Spinner: FC = () => (
    <svg
        className="animate-spin"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
    >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
        <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
);

/** The Commise design-system button — the meaning's glyph + label, one surface per tier and size. */
export const Button: FC<ButtonProps> = (props) => {
    const {
        icon,
        children,
        size = 'md',
        onPress,
        type = 'button',
        disabled = false,
        busy = false,
        accessibilityLabel,
        width = 'auto',
        focusRequested = false,
        onFocusRequestHandled,
    } = props;
    const { variant, tone } = surfaceOf(props);
    const surface =
        variant === 'destructive' ? buttonSurfaceClass(variant, size, tone) : buttonSurfaceClass(variant, size);
    const node = useRef<HTMLButtonElement>(null);
    useFocusRequest(focusRequested, () => node.current?.focus(), onFocusRequestHandled);

    return (
        <PressScale width={width}>
            <button
                ref={node}
                type={type}
                // ⛔ BUSY IS NOT NATIVE `disabled` — the control that goes busy is the one just pressed, and a browser
                // drops focus from a disabled control. The rule, and why the click is cancelled, is `busyControlProps`'s.
                {...busyControlProps({ busy, blocked: disabled, onClick: () => onPress?.() })}
                aria-label={accessibilityLabel}
                // `fill`: the wrapper stretches, so the button takes its whole width; `justify-center` centres the label.
                className={width === 'fill' ? `${surface} w-full` : surface}
            >
                {busy || icon !== undefined ? (
                    <span aria-hidden="true" className="inline-flex shrink-0 items-center">
                        {busy || icon === undefined ? <Spinner /> : <Icon name={icon} size={20} />}
                    </span>
                ) : null}
                <span>{children}</span>
            </button>
        </PressScale>
    );
};
