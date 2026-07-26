/**
 * @module components/auth/icons — the action-button glyphs for the web auth surface (U3).
 *
 * Small hand-inlined stroked line icons (Feather set, 24×24) matching the recipe form's idiom
 * (`@commise/features-recipes/form/icons`): a check for save, a log-out arrow for sign-out, a warning
 * triangle for the (recoverable) close action, a trash for the (irreversible) erase action.
 *
 * Each glyph is DECORATIVE: the shared `@commise/ui` Button wraps its `icon` prop `aria-hidden`, and each
 * glyph carries `aria-hidden` itself as well, so it never contributes to the button's accessible name — the
 * visible label owns it, keeping name-based selection (RTL / Playwright) stable regardless of glyph.
 */
import type { FC, SVGProps } from 'react';

/** Shared presentation for every auth glyph: a 16px stroked line icon, hidden from assistive tech. */
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

/** Check — the profile-edit submit (save changes). */
export const CheckIcon: FC = () => <Glyph d="M20 6 9 17l-5-5" />;

/** Log-out — the session sign-out control. */
export const LogOutIcon: FC = () => <Glyph d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />;

/** Warning triangle — the RECOVERABLE close-account control (a caution, not a destruction). */
export const AlertTriangleIcon: FC = () => (
    <Glyph d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
);

/** Trash — the IRREVERSIBLE erase-data control. */
export const TrashIcon: FC = () => (
    <Glyph d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 5v6m4-6v6" />
);
