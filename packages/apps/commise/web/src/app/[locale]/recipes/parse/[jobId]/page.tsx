import type { Route } from 'next';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app/AppShell';
import { ParseJobReviewContainer } from '@/components/recipes/ParseJobReviewContainer';

export const dynamic = 'force-dynamic';

/**
 * Parse-review route (`/[locale]/recipes/parse/[jobId]`).
 *
 * ⛔ THE JOB ID IS IN THE URL, and that is what makes the server's 24-hour TTL mean anything. The service
 * spends a TTL constant, a sweep, a seven-day purge grace and a wire `expiresAt` field on ONE affordance —
 * leave the review open overnight, come back, and see an honest `expired` job rather than a `404`. Holding
 * the id in React state instead would discard it on a refresh, and every one of those server affordances
 * would become unreachable code that no user could ever observe.
 *
 * Owner scoping is entirely server-side: a stranger's job answers `404`, deliberately indistinguishable
 * from an absent one, so this page needs no ownership check of its own — only that a viewer is signed in.
 */
export default async function ParseJobReviewPage({
    params,
}: {
    params: Promise<{ locale: string; jobId: string }>;
}): Promise<React.ReactElement> {
    const { locale, jobId } = await params;
    const { userId } = await auth();

    if (!userId) {
        redirect(`/${locale}/sign-in` as Route);
    }

    return (
        <AppShell activeId="recipes" titleId="recipeParseReview">
            <ParseJobReviewContainer locale={locale} jobId={jobId} />
        </AppShell>
    );
}
