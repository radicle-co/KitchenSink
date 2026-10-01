/**
 * @module @commise/features-recipes/form/icons — the recipe-form action-button glyphs (web).
 *
 * Small, hand-inlined stroked line icons (Feather set, 24×24) matching the mockups — a plus for the "add"
 * actions, a trash for "remove", a check for submit, an x for cancel. Hand-inlined rather than a new icon
 * dependency: the set is fixed and tiny, so a dependency would cost more than it saves (YAGNI), and these
 * mirror the native leaf's Feather names one-to-one.
 *
 * Each glyph is **decorative**: the shared `@commise/ui` Button already wraps it `aria-hidden`, and it
 * carries `aria-hidden` itself as well, so it never contributes to the button's accessible name (the label
 * owns that). Consumers pass the element to `Button`'s `icon` prop.
 */
import type { FC, SVGProps } from 'react';

/** Shared presentation for every form glyph: a 16px stroked line icon, hidden from assistive tech. */
const Glyph: FC<SVGProps<SVGSVGElement> & { readonly d: string }> = ({ d, ...props }) => (
    <svg
        aria-hidden="true"
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
    >
        <path d={d} />
    </svg>
);

/** Plus — the "add ingredient / add step" actions, and the recipes FAB. */
export const PlusIcon: FC<SVGProps<SVGSVGElement>> = (props) => <Glyph d="M12 5v14M5 12h14" {...props} />;

/** Trash — the "remove ingredient / remove step" destructive actions. */
export const TrashIcon: FC = () => (
    <Glyph d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 5v6m4-6v6" />
);

/** Check — the primary submit (create / save). */
export const CheckIcon: FC = () => <Glyph d="M20 6 9 17l-5-5" />;

/** X — the cancel action. */
export const XIcon: FC = () => <Glyph d="M18 6 6 18M6 6l12 12" />;

/** Info — slot 1's state glyph on a row with nothing to fix (plan 002 V1). A circle, distinct by SHAPE from Alert. */
export const InfoIcon: FC = () => <Glyph d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" />;

/** Alert — slot 1's state glyph on a row the cook can act on (plan 002 V1). A triangle, distinct by SHAPE from Info. */
export const AlertIcon: FC = () => (
    <Glyph d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
);

/** Retry — the "Try again" actions (a failed nutrition read, a failed lookup). */
export const RetryIcon: FC = () => <Glyph d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />;
