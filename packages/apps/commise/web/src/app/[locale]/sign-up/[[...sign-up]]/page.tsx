import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { SignUpForm } from '@/components/auth/SignUpForm';
import { withBasePath } from '@/lib/basePath';

/**
 * The sign-up page. The routing and redirect rules live with the widget they govern, in `SignUpForm`.
 */
export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;

    return (
        <AuthSplitLayout>
            <SignUpForm signInUrl={withBasePath(`/${locale}/sign-in`)} forceRedirectUrl={`/${locale}`} />
        </AuthSplitLayout>
    );
}
