import type { AuthBlockMessage } from '@commise/features-account';

interface AccountStateNoticeProps {
    message: AuthBlockMessage;
}

/**
 * Presentational block notice for a security-relevant account state (suspended / impersonation). The copy
 * comes from the shared @commise/features-account block messages so it matches mobile; this leaf owns only
 * the presentation — a real error-toned alert surface (bordered, tinted card) so the blocked state reads as
 * a genuine warning rather than unstyled body text.
 */
export function AccountStateNotice({ message }: AccountStateNoticeProps) {
    return (
        <div
            role="alert"
            aria-labelledby="account-state-title"
            className="flex flex-col gap-2 rounded-2xl border border-error/40 bg-error/10 p-6"
        >
            <h2 id="account-state-title" className="font-display text-heading-md font-semibold text-error">
                {message.title}
            </h2>
            <p className="text-body-md text-charcoal">{message.body}</p>
        </div>
    );
}
