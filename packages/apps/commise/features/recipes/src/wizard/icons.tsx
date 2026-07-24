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

/** Eye — the "Preview" top-bar action. */
export const EyeIcon: FC = () => (
    <Glyph d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
);

/** Chevron-left — the footer "Prev" nav. */
export const ChevronLeftIcon: FC = () => <Glyph d="M15 18l-6-6 6-6" />;

/** Chevron-right — the footer "Next" nav. */
export const ChevronRightIcon: FC = () => <Glyph d="M9 18l6-6-6-6" />;
