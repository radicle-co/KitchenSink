import type { Metadata } from 'next';

import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { SignInForm } from '@/components/auth/SignInForm';
import { getDictionary } from '@/i18n/getDictionary';
import { withBasePath } from '@/lib/basePath';
import { safeReturnPath, signUpPathFor } from '@/lib/signInReturn';

/** The tab's title and the shared link's description, in the request's locale. */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    const { locale } = await params;
    const { title, description } = getDictionary(locale).pageMetadata.signIn;

    return { title, description };
}

/**
 * The sign-in page. The routing, redirect and sign-up-link rules live with the widget they govern, in `SignInForm`.
 *
 * Where a completed sign-in lands is the `redirect_url` the protected page sent (W-01), parsed by `safeReturnPath`: a
 * value it refuses is NOT forwarded and the visitor lands on the locale root. The sign-up link carries the same
 * destination, so registering does not lose it.
 */
export default async function SignInPage({
    params,
    searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ redirect_url?: string | string[] }>;
}) {
    const { locale } = await params;
    const returnTo = safeReturnPath((await searchParams).redirect_url, locale);

    return (
        <AuthSplitLayout>
            <SignInForm
                signUpUrl={withBasePath(signUpPathFor(locale, returnTo))}
                forceRedirectUrl={returnTo ?? `/${locale}`}
            />
        </AuthSplitLayout>
    );
}
