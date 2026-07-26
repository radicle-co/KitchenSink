import { resolveMessages } from '@commise/i18n';
import { AppShell } from '@/components/app/AppShell';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { authMessages } from '@/components/auth/messages';
import { pageContainer, pageHeading, sectionCard, sectionHeading } from '@/components/auth/authChrome';

/**
 * The `/settings` route content, kept OUT of `page.tsx` so the route segment exports only Next.js-valid
 * fields and so the AppShell wiring can be unit-tested directly.
 *
 * U3: settings now renders inside the shared {@link AppShell} (nav on desktop AND narrow — the bare,
 * nav-less route was a defect) with the design-system card idiom, and all copy resolves through
 * {@link authMessages}. The sign-out control is the shared DS `Button` via {@link LogoutButton}.
 */
export function SettingsContent({ locale }: { locale: string }): React.ReactElement {
    const { settings } = resolveMessages(authMessages, locale);

    return (
        <AppShell activeId="profile">
            <div className={pageContainer}>
                <h1 className={pageHeading}>{settings.title}</h1>
                <section aria-labelledby="session-heading" className={sectionCard}>
                    <h2 id="session-heading" className={sectionHeading}>
                        {settings.sessionHeading}
                    </h2>
                    <div className="flex justify-start">
                        <LogoutButton />
                    </div>
                </section>
            </div>
        </AppShell>
    );
}
