'use client';

/**
 * @module home/HomeWidgetErrorNotice — what a FAILED Home widget shows in place of its body (web).
 *
 * A pure render component (`props → JSX`, no props, no state, no effects) used as the `fallback` of BOTH
 * per-widget error boundaries on this surface: the host's ({@link import('./HomeWidgetSurface').HomeWidgetSurface})
 * and the recipe slot's inner one ({@link import('./RecipeWidgetSlot').RecipeWidgetSlot}). The one-to-one
 * counterpart of mobile's `HomeWidgetErrorNotice` — same copy, same contract (a localized explanation,
 * ANNOUNCED, with no recovery affordance), projected into web's markup and utility classes.
 *
 * It exists as a component rather than the inline `<p>` each boundary previously duplicated because those two
 * fragments were never two pieces of knowledge: they answer the ONE question "what does a broken Home widget
 * look and sound like", carry the same message key and the same treatment, and change for the same reason.
 * Extracting gives that answer a single authoritative representation — the copy, the live-region register, and
 * the muted-caption treatment cannot drift between the boundaries — and pairs the web module one-to-one with
 * the mobile one, so a change to what a failed widget shows has exactly one place to land per platform.
 *
 * NOT offered here: a "try again" control. The widget is reached through a module-scope lazy proxy, and
 * React's `lazyInitializer` invokes the loader only while the payload is Uninitialized: a rejection parks it
 * at `_status = 2` and every later render bare-throws the cached `_result` without re-invoking the loader. A
 * retry that merely reset the boundary would re-throw synchronously and read as a dead button. See the
 * boundary comment in `RecipeWidgetSlot.tsx` for what a real retry would have to do instead.
 *
 * NOT used for the roadmap PLACEHOLDER boundary either, on either platform: a skeleton is already a stand-in
 * for a feature that has not shipped, so a notice there would announce the loss of something the viewer was
 * never promised. That arm keeps `fallback={null}` (the throw is still reported) and is pinned by a test.
 */
import { useMessages } from '@commise/i18n/react';
import type { JSX } from 'react';

import { webMessages } from '@/i18n/messages';

/**
 * The stand-in for a Home widget whose body failed to render.
 *
 * @returns A localized, POLITELY announced one-line notice.
 */
export function HomeWidgetErrorNotice(): JSX.Element {
    const { home } = useMessages(webMessages);

    // A LIVE REGION, but a POLITE one — `role="status"`, not `role="alert"`.
    //
    // The region itself is required: the notice is inserted only AFTER the widget has already failed
    // mid-session, so a plain <p> leaves a viewer using assistive tech to go looking for it to discover
    // anything was wrong. The REGISTER is the judgement call, and it is `status` on three grounds:
    //
    //  1. ARIA reserves `alert` for information "that requires the user's immediate attention", and
    //     assertive INTERRUPTS whatever the screen reader is currently speaking — including the viewer's own
    //     navigation. One widget of a multi-widget Home failing to load is not time-critical: nothing is
    //     lost, nothing is pending, and the rest of Home (including this slot's own "see all recipes" route
    //     out, deliberately preserved) keeps working.
    //  2. This notice carries NO recovery affordance by design — the widget is a module-scope lazy proxy
    //     whose rejection React caches permanently, so there is nothing to retry. Interrupting someone to
    //     announce a condition they cannot act on is the textbook misuse of `assertive`.
    //  3. Both roles satisfy WCAG 2.1 SC 4.1.3 (Status Messages), so politeness costs no conformance — the
    //     failure is still announced, just queued behind the current utterance instead of cutting into it.
    //
    // Mobile's `HomeWidgetErrorNotice` makes the IDENTICAL call (`role="status"` + an Android polite live
    // region), so the two platforms cannot disagree about how loudly a broken widget speaks.
    return (
        <p role="status" className="text-body-sm text-slate">
            {home.surface.widgetError}
        </p>
    );
}
