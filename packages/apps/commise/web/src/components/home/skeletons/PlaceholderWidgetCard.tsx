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
 * That second half is the CALLER's to apply, and deliberately so: this shell does not wrap `children` in an
 * `aria-hidden` container, because not every placeholder's children are pure shape. `MealPlanWidgetSkeleton`
 * renders REAL, locale-formatted weekday names alongside the unknown meal thumbnails, and `aria-hidden` on an
 * ancestor cannot be undone by a descendant — a blanket wrapper here would silence data the viewer legitimately
 * has. Each skeleton therefore hides its own shapes and keeps whatever is real exposed.
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
import { useId, type JSX, type ReactNode } from 'react';

import { webMessages } from '@/i18n/messages';

/** Props for {@link PlaceholderWidgetCard}. */
export interface PlaceholderWidgetCardProps {
    /** The REAL widget's heading (what the viewer will eventually see here). */
    readonly title: string;
    /**
     * The skeleton shape. Rendered as-is: the caller marks its own shape nodes `aria-hidden`, so a placeholder
     * whose children include something REAL (the meal-plan weekday names) can still expose it. Anything left
     * exposed here must be information the viewer genuinely has — never invented data.
     */
    readonly children: ReactNode;
}

/**
 * The shell of a roadmap skeleton placeholder: a level-1 card carrying the real widget's heading, a visible "Soon"
 * badge, and the caller's shape.
 *
 * The card is `paper` under a 1 px `lineDivider` with `shadow-sm` (`buildSpec.md` §1.6), never glass: owner D12 keeps
 * glass off cards, and the translucent white tier this used had no dark value, so dark mode drew light ink on light
 * glass at about 1.1:1 (`evaluateFinal.md` F1). Both fills are colour roles and re-theme with the dark block.
 *
 * @param props - The widget `title` and its skeleton `children`.
 * @returns A labelled region presenting the coming widget without inventing any of its data.
 */
export function PlaceholderWidgetCard({ title, children }: PlaceholderWidgetCardProps): JSX.Element {
    const { home } = useMessages(webMessages);
    const headingId = useId();

    return (
        <section
            aria-labelledby={headingId}
            className="flex h-full flex-col gap-4 rounded-md border border-line-divider bg-paper p-4 shadow-sm"
        >
            <div className="flex items-center justify-between gap-3">
                <h3 id={headingId} className="min-w-0 text-card-title text-ink">
                    {title}
                </h3>
                {/* Not `bg-surface-muted`: that shade is reserved for skeleton SHAPES, which are aria-hidden. The
                    badge is real content and must stay exposed, so it is visually distinct from the shapes. */}
                <span className="shrink-0 rounded-sm border border-line-divider px-2 py-0.5 text-caption text-ink-muted">
                    {home.roadmap.soon}
                </span>
            </div>

            {children}
        </section>
    );
}
