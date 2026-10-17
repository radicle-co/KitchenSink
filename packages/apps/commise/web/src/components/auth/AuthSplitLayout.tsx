/**
 * @module components/auth/AuthSplitLayout — the frame around the sign-in and sign-up forms
 * (`docs/design/uiOverhaul/buildSpec.md` §8).
 *
 * Below 1024 px the form is a column centred on the canvas wash, with 24 px of side padding (a 272 px column at 320 px).
 * From 1024 px the page is a 50/50 split: a food photograph on the start half and the form, centred, on the end half.
 * The photograph is decoration: `aria-hidden`, no text alternative, `object-fit: cover`, and `display: none` below the
 * split so a phone never fetches it. ⚠️ Never `priority`: Next turns it into a preload `<link>` that a phone obeys even
 * though the image is hidden. Lazy, a hidden image is not fetched. The form is the front door and nothing else (FR-045a); this is not a welcome page.
 *
 * Presentational: props → JSX. It fetches nothing and owns no state.
 */
import Image from 'next/image';
import type { FC, ReactNode } from 'react';

/** Props for {@link AuthSplitLayout}. */
export interface AuthSplitLayoutProps {
    /** The Clerk form. */
    readonly children: ReactNode;
}

/** The frame. */
export const AuthSplitLayout: FC<AuthSplitLayoutProps> = ({ children }) => (
    <main className="min-h-screen lg:grid lg:grid-cols-2">
        <div aria-hidden="true" className="relative hidden lg:block">
            <Image src="/images/auth/authFood.jpg" alt="" fill sizes="50vw" className="object-cover" />
        </div>
        <div className="flex min-h-screen items-center justify-center px-6 py-12">{children}</div>
    </main>
);
