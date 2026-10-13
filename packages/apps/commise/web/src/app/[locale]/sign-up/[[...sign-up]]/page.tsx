import type { Metadata } from 'next';

import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { SignUpForm } from '@/components/auth/SignUpForm';
import { getDictionary } from '@/i18n/getDictionary';
import { withBasePath } from '@/lib/basePath';
import { safeReturnPath, signInPathFor } from '@/lib/signInReturn';

/** The tab's title and the shared link's description, in the request's locale. */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
    const { locale } = await params;
    const { title, description } = getDictionary(locale).pageMetadata.signUp;

    return { title, description };
}

/**
 * The sign-up page. The routing and redirect rules live with the widget they govern, in `SignUpForm`. The
 * `redirect_url` the visitor arrived with is parsed by `safeReturnPath` and carried both ways (see the sign-in page).
 */
export default async function SignUpPage({
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
            <SignUpForm
                signInUrl={withBasePath(signInPathFor(locale, returnTo))}
                forceRedirectUrl={returnTo ?? `/${locale}`}
            />
        </AuthSplitLayout>
    );
}
