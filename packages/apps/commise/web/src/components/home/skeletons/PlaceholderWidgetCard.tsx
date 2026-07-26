'use client';

/**
 * @module home/skeletons/PlaceholderWidgetCard — the shared shell of a roadmap skeleton placeholder (web).
 *
 * Owns the one design decision every placeholder shares: how a widget for an unshipped feature (005–009)
 * presents itself (FR-046 / R6 as amended by CR-001). Each roadmap skeleton composes this and supplies only
 * its own shape.
 *
 * ## The accessibility decision, stated deliberately
 *
 * A skeleton normally means "content is loading, wait". A ROADMAP placeholder means something different:
 * "this feature does not exist yet". Announcing it as busy (`aria-busy`) or as a loading region would be a
 * lie, and a screen-reader user would wait for data that is never coming. Hiding the whole tile
 * (`aria-hidden`) is the opposite failure: a sighted viewer sees a labelled panel and learns the roadmap; a
 * screen-reader user perceives silence — an information asymmetry (WCAG 1.1.1 / 1.3.1).
 *
 * So the split is by INFORMATION CONTENT, not by convenience:
 *  - The heading and the "Coming soon" badge carry the information, and are **exposed** to everyone.
 *  - The grey blocks carry none — they are a picture of a layout — and are `aria-hidden`.
 *
 * The badge is deliberately **visible**, not `sr-only`: a sighted viewer staring at grey rectangles has no
 * way to distinguish "coming soon" from "stuck loading" either. Telling everyone the same thing in the same
 * place is simpler and more honest than a visually-hidden string that only some users get.
 *
 * There is also **no pulse animation** here, unlike the recipe widget's loading skeleton. A pulse signals
 * "in progress"; nothing is in progress. Its absence keeps the semantics honest and, as a bonus, leaves
 * nothing for `prefers-reduced-motion` to have to suppress.
 */
import { useMessages } from '@commise/i18n/react';
import { GlassCard } from '@commise/ui/surface';
import { useId, type JSX, type ReactNode } from 'react';

import { webMessages } from '@/i18n/messages';

/** Props for {@link PlaceholderWidgetCard}. */
export interface PlaceholderWidgetCardProps {
    /** The REAL widget's heading (what the viewer will eventually see here). */
    readonly title: string;
    /** The skeleton shape. Rendered inside an `aria-hidden` wrapper — pass presentation only, never content. */
    readonly children: ReactNode;
}

/**
 * The shell of a roadmap skeleton placeholder: a glass card carrying the real widget's heading, a visible
 * "Coming soon" badge, and the caller's shape.
 *
 * @param props - The widget `title` and its skeleton `children`.
 * @returns A labelled region presenting the coming widget without inventing any of its data.
 */
export function PlaceholderWidgetCard({ title, children }: PlaceholderWidgetCardProps): JSX.Element {
    const { home } = useMessages(webMessages);
    const headingId = useId();

    // U8 — the frosted-glass treatment is the shared `GlassCard` primitive (single-sourced with native), so
    // the translucent-over-blur surface can never drift from the design system. The box (radius/border/pad/
    // shadow) stays on the card via `className`; the deliberate `<section aria-labelledby>` semantics — the
    // labelled roadmap region every placeholder relies on — live INSIDE it, unchanged.
    return (
        <GlassCard
            tier="card"
            className="rounded-[var(--radius-lg)] border border-white/20 p-5 shadow-[var(--shadow-md)]"
        >
            <section aria-labelledby={headingId} className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                    <h3 id={headingId} className="font-semibold tracking-tight text-charcoal">
                        {title}
                    </h3>
                    {/* Not `bg-pearl`: that shade is reserved for skeleton SHAPES, which are aria-hidden. The
                        badge is real content and must stay exposed, so it is visually distinct from the shapes. */}
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-slate">
                        {home.roadmap.comingSoon}
                    </span>
                </div>

                {children}
            </section>
        </GlassCard>
    );
}
