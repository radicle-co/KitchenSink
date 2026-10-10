import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { SignInForm } from '@/components/auth/SignInForm';
import { withBasePath } from '@/lib/basePath';

/**
 * The sign-in page. The routing, redirect and sign-up-link rules live with the widget they govern, in `SignInForm`.
 */
export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;

    return (
        <AuthSplitLayout>
            <SignInForm signUpUrl={withBasePath(`/${locale}/sign-up`)} forceRedirectUrl={`/${locale}`} />
        </AuthSplitLayout>
    );
}
