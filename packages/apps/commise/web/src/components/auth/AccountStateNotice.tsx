import type { AuthBlockMessage } from '@commise/features-account';

interface AccountStateNoticeProps {
    message: AuthBlockMessage;
}

/**
 * Presentational block notice for a security-relevant account state (suspended / impersonation).
 * The copy comes from the shared @commise/features-account block messages so it matches mobile.
 */
export function AccountStateNotice({ message }: AccountStateNoticeProps) {
    return (
        <div role="alert" aria-labelledby="account-state-title">
            <h2 id="account-state-title">{message.title}</h2>
            <p>{message.body}</p>
        </div>
    );
}
