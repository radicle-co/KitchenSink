/**
 * @module components/AuthGate — the app-wide authentication gate (the root's render map).
 *
 * Selects the surface for the CURRENT `AuthState` derived by `@commise/features-account` (the same
 * derivation web uses, so the two platforms cannot disagree on which sessions are blocked): a named loading
 * affordance while the session resolves, the sign-in form when signed out, a localized notice for a blocked or
 * failed session, and the app itself once authenticated.
 *
 * ⚠️ Owner decision, 2026-07-28: there is NO welcome/landing screen. A signed-out session used to open on a
 * branded welcome hero whose two CTAs led into sign-up and sign-in; that screen is deleted, here and on web
 * (whose locale root now redirects a signed-out caller straight to `/sign-in`). Sign-UP stays reachable from
 * the sign-in form's own control, which is now its ONLY entry point on mobile.
 *
 * ⛔ THE SIGNED-IN APP IS A COLUMN, NOT A BARE FRAGMENT: `SyncNoticeHost` — the offline / syncing notice and the
 * unreadable-work notice (ADR-0057) — is a sibling ABOVE the app, in flow, so the app simply gets less height while a
 * notice shows (`docs/design/offlineNotice.md` §7). Mobile mounted no host at all before, so a cook offline on a phone
 * was told nothing. It is signed-in only: the signed-out surfaces have no cook and no queue. `SyncProvider` sits above
 * `AuthGate` (in `RecipeServiceGate`), so the host reads a real queue here.
 *
 * Plan 012: either form's "Continue with Apple / Google" may end at a sign-up still missing fields the provider did not
 * supply (the username, and with Apple possibly the names). The gate then shows `CompleteSignUpScreen` with the sign-up
 * the provider hook RETURNED; "Start over" comes back to the sign-in form. It is a signed-out SURFACE, not a route.
 */
import { authBlockMessages } from '@commise/features-account';
import { offlineNoticeMessages } from '@commise/features-core/offline';
import { useMessages } from '@commise/i18n/react';
import { SyncNoticeHost } from '@commise/query/sync-notice-host';
import { nativeTokens } from '@commise/ui/native';
import { useTheme } from '@commise/ui/theme';
import type { JSX, ReactNode } from 'react';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../hooks/useAuth';
import { mobileMessages } from '../i18n/messages';
import type { PendingSignUp } from '../hooks/useSocialSignIn';
import { CompleteSignUpScreen } from '../screens/CompleteSignUpScreen';
import { LoginScreen } from '../screens/login';
import { SignUpScreen } from '../screens/signup';
import { LoadingState } from './LoadingState';

/** Props for {@link AuthGate}. */
interface AuthGateProps {
    /** The authenticated app, rendered only once the session resolves to an unblocked signed-in user. */
    readonly children: ReactNode;
}

/**
 * The signed-out surfaces. The union deliberately has NO welcome/landing member: with the hero deleted, "the app opens
 * on a landing screen" is not a state this gate can represent, so the decision is enforced by the type rather than only
 * by the initial value below. The finish step carries the pending sign-up, so it cannot exist without one.
 */
type Screen =
    | { readonly kind: 'login' }
    | { readonly kind: 'signup' }
    | { readonly kind: 'completeSignUp'; readonly pending: PendingSignUp };

const LOGIN: Screen = { kind: 'login' };

/**
 * The signed-out surfaces: sign-in, sign-up, and the finish step a provider sign-up may need (plan 012).
 *
 * ⚠️ Its own component on purpose: which surface is up is SIGNED-OUT state, so it must not outlive a session. Mounted
 * only while the gate is unauthenticated, it unmounts when a session starts and remounts on the sign-in form after a
 * sign-out — so a finish step holding the last session's sign-up can never reappear.
 */
function SignedOutSurfaces(): JSX.Element {
    const [screen, setScreen] = useState<Screen>(LOGIN);
    const needsFields = (pending: PendingSignUp) => setScreen({ kind: 'completeSignUp', pending });

    switch (screen.kind) {
        case 'signup':
            return <SignUpScreen onBack={() => setScreen(LOGIN)} onNeedsFields={needsFields} />;
        case 'completeSignUp':
            return (
                <CompleteSignUpScreen
                    signUp={screen.pending.signUp}
                    fields={screen.pending.fields}
                    onStartOver={() => setScreen(LOGIN)}
                />
            );
        case 'login':
            return <LoginScreen onSignUp={() => setScreen({ kind: 'signup' })} onNeedsFields={needsFields} />;
    }
}

/**
 * The authentication gate.
 *
 * @param props - The authenticated app to render behind the gate.
 * @returns The surface matching the current auth state.
 */
export function AuthGate({ children }: AuthGateProps): JSX.Element {
    const { auth, common } = useMessages(mobileMessages);
    const blockCopy = useMessages(authBlockMessages);
    const { state } = useAuth();
    const { colors } = useTheme();
    const offline = useMessages(offlineNoticeMessages);
    const title = [styles.title, { color: colors.ink }];
    const body = [styles.body, { color: colors.inkMuted }];

    switch (state.status) {
        case 'loading':
            // The app's very first paint: a nameless spinner here reads as "frozen". `LoadingState` names it
            // ("Checking your session…") for assistive tech AND sighted viewers.
            return <LoadingState label={auth.sessionLoading} />;
        case 'unauthenticated':
            return <SignedOutSurfaces />;
        case 'blocked':
            return (
                <View style={styles.center}>
                    <Text style={title}>{blockCopy[state.reason.code].title}</Text>
                    <Text style={body}>{blockCopy[state.reason.code].body}</Text>
                </View>
            );
        case 'error':
            // The heading is app copy and MUST come from the dictionary; `state.error.message` is the
            // provider's own diagnostic and is passed through as-is.
            return (
                <View style={styles.center}>
                    <Text style={title}>{common.somethingWentWrong}</Text>
                    <Text style={body}>{state.error.message}</Text>
                </View>
            );
        case 'authenticated':
            return (
                <View style={styles.app}>
                    <SyncNoticeHost copy={offline} />
                    {children}
                </View>
            );
    }
}

const styles = StyleSheet.create({
    // Fills the canvas, so the app below the notices keeps the whole remaining height as it had as a direct child.
    app: { flex: 1 },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: nativeTokens.spacing[5],
        gap: nativeTokens.spacing[2],
    },
    title: { fontSize: nativeTokens.fontSize.headingMd, fontWeight: '600' },
    body: { fontSize: nativeTokens.fontSize.bodySm, textAlign: 'center' },
});
