/**
 * @module @commise/features-recipes/wizard/icons — the wizard chrome's action-button glyphs (web).
 *
 * Small, hand-inlined stroked line icons (Feather set, 24x24), matching `../form/icons.tsx`'s convention
 * (fixed, tiny set — a dependency would cost more than it saves, YAGNI) and mirroring the native leaf's
 * Feather names one-to-one (`save`, `eye`, `chevron-left`, `chevron-right`).
 *
 * Each glyph is decorative: the shared `@commise/ui` Button already wraps it `aria-hidden`, and it carries
 * `aria-hidden` itself too, so it never contributes to the button's accessible name.
 */
import type { FC, SVGProps } from 'react';

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

/** Save — the "Save Draft" top-bar action. */
export const SaveIcon: FC = () => (
    <Glyph d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8" />
);

/**
 * Arrow-left — the sticky header's BACK affordance (U32), which below `lg` replaces the overflow menu's
 * `Cancel` item. Deliberately distinct from {@link ChevronLeftIcon}: the chevron means "one step back inside
 * this wizard", the arrow means "leave the wizard". Mirrors the native leaf's `Feather` name `arrow-left`.
 *
 * ⚠️ This REPLACED `EyeIcon` (the deleted Preview action) rather than being added beside it — the sheet's
 * export count is pinned by `oneFileOneThing.test.ts`'s icon-set ruling, so a net addition here is a gate
 * failure, not a silent growth.
 */
export const ArrowLeftIcon: FC = () => <Glyph d="M19 12H5M12 19l-7-7 7-7" />;

/** Chevron-left — the footer "Prev" nav. */
export const ChevronLeftIcon: FC = () => <Glyph d="M15 18l-6-6 6-6" />;

/** Chevron-right — the footer "Next" nav. */
export const ChevronRightIcon: FC = () => <Glyph d="M9 18l6-6-6-6" />;

/** Check — the footer "Publish" primary (mirrors the native leaf's `Feather` name `check`). */
export const CheckIcon: FC = () => <Glyph d="M20 6L9 17l-5-5" />;

/** X — the overflow menu's "Cancel" item (mirrors the native leaf's `Feather` name `x`). */
export const XIcon: FC = () => <Glyph d="M18 6L6 18M6 6l12 12" />;

/**
 * More-vertical (kebab) — the header's overflow ("More actions") trigger (U6). Three stacked dots; mirrors
 * the native leaf's `Feather` name `more-vertical`. Decorative like the rest of the set: `aria-hidden`, so the
 * trigger's own `aria-label` owns the accessible name. Rendered directly (not via {@link Glyph}) because the
 * dots are `<circle>`s, not a single stroked path.
 */
export const MoreVerticalIcon: FC = () => (
    <svg
        aria-hidden="true"
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <circle cx="12" cy="12" r="1" />
        <circle cx="12" cy="5" r="1" />
        <circle cx="12" cy="19" r="1" />
    </svg>
);
