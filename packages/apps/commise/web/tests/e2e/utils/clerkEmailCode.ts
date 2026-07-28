import { expect, test, type Page } from '@playwright/test';

/**
 * Which Clerk attempt resource is being verified. Clerk sends the email code with a `prepare_*` POST
 * against the in-flight attempt, and the two flows differ in BOTH the collection and the suffix — these
 * are the calls observed live against the sandbox dev instance (clerk-js 5.127.1, api 2025-11-10):
 *
 *   sign-in: POST /v1/client/sign_ins/sia_…/prepare_second_factor   (the code is the SECOND factor,
 *            sent after `attempt_first_factor` clears the password)
 *   sign-up: POST /v1/client/sign_ups/sua_…/prepare_verification
 *
 * Hence the matcher keys on the shared `prepare_` prefix rather than either full name: it must not care
 * which factor slot Clerk routes the email code through.
 */
type ClerkAttempt = 'sign_ins' | 'sign_ups';

/** The fixed code every `+clerk_test` address accepts on a Clerk development instance. */
const CLERK_TEST_CODE = '424242';

/** How long to wait for Clerk's send to land. Must stay BELOW the enclosing per-test budget. */
const SEND_TIMEOUT_MS = 30_000;

/**
 * How long to wait for Clerk to ANSWER the submitted code — advance, or show its not-prepared error.
 * Neither outcome is a failure here: if neither settles, the caller's own landing assertion decides, so
 * this only needs to be long enough for the error banner to render on a slow runner.
 */
const ANSWER_TIMEOUT_MS = 10_000;

interface SubmitEmailCodeOptions {
    /** The attempt collection this flow verifies against — selects the `prepare_*` URL to wait for. */
    readonly attempt: ClerkAttempt;
    /** The click that makes Clerk SEND the code. Invoked AFTER the response waiter is armed. */
    readonly triggerSend: () => Promise<void>;
    /**
     * Asserts the code-entry step is on screen (its heading differs per flow: "check your email" for
     * sign-in, "verify your email" for sign-up). Runs between the trigger and the send barrier so a
     * form that never advanced fails on the heading, which reads far better than a response timeout.
     */
    readonly expectStep: () => Promise<void>;
}

/**
 * Drive Clerk's email-code step: send the code, wait for the SEND to land, then enter it — and recover
 * if it still went in early.
 *
 * This exists because both auth flows carry the identical, non-obvious piece of knowledge: Clerk sends
 * the code with an ASYNC `prepare_*` POST against the attempt, and submitting the six digits before that
 * request resolves lands on Clerk's own error — "You need to send a verification code before attempting
 * to verify." — after which the form never advances. `waitForLoadState('networkidle')` is NOT a barrier
 * for it: it settles too early on a slow runner, which is why this passed locally every time and flaked
 * only in CI. The fix is to arm a response waiter BEFORE the click that triggers the send.
 *
 * The whole choreography lives here so sign-in and sign-up cannot drift apart on it:
 *   1. arm the `prepare_*` waiter, then trigger the send (order matters — arming after the click races);
 *   2. await the send, then fill the code;
 *   3. submit explicitly if the step is still up, rather than trusting Clerk's OTP auto-submit;
 *   4. wait for Clerk to ANSWER that attempt — advance, or render its not-prepared error;
 *   5. recover if the answer was the error — waiting out Clerk's Resend countdown and re-arming the same
 *      barrier around the re-send, so the recovery cannot re-run the race it is recovering from.
 *
 * The response matcher is `.catch()`-guarded on purpose: a Clerk endpoint rename must degrade to the
 * recovery in (5) rather than fail the suite outright. That fallback is also exactly how a real defect
 * could hide, so a miss is reported LOUDLY — a console warning plus a test annotation in the HTML
 * report — instead of passing silently.
 *
 * @sideEffect Drives the page: clicks, fills the OTP field, and waits on network responses.
 */
export async function submitClerkEmailCode(page: Page, options: SubmitEmailCodeOptions): Promise<void> {
    const { attempt, triggerSend, expectStep } = options;
    const preparePattern = new RegExp(`/v1/client/${attempt}/[^/]+/prepare_`);

    /**
     * A promise that settles when Clerk's send lands — `undefined` if it never did. MUST be created
     * before the action that triggers the send: a waiter armed afterwards can miss a response that has
     * already come back.
     */
    const armSendWaiter = (): Promise<unknown> =>
        page
            .waitForResponse((response) => preparePattern.test(response.url()) && response.ok(), {
                timeout: SEND_TIMEOUT_MS,
            })
            .catch(() => undefined);

    const codeSent = armSendWaiter();

    await triggerSend();
    await expectStep();

    if ((await codeSent) === undefined) {
        report(
            `Clerk's ${attempt} prepare_* response was never observed (pattern ${preparePattern.source}). ` +
                'The send barrier did NOT hold, so this flow is relying on the recovery path — treat a green ' +
                'run as unproven and check whether Clerk renamed the endpoint.',
        );
    }

    const codeField = page.getByRole('textbox', { name: /verification code/i });
    const notPrepared = page.getByText(/need to send a verification code/i);

    /**
     * Submit the code without depending on Clerk's OTP auto-submit, which fires from a change handler on
     * the 6th digit and does not always run. Guarded because on the common path the auto-submit has
     * already navigated away and the button is detached.
     */
    const submitIfPresent = async (): Promise<void> => {
        const verifyContinue = page.getByRole('button', { name: 'Continue' });

        if (await verifyContinue.isVisible().catch(() => false)) {
            await verifyContinue.click().catch(() => undefined);
        }
    };

    await codeField.fill(CLERK_TEST_CODE);
    await submitIfPresent();

    // Now that an attempt has definitely been made, wait for Clerk to ANSWER it. Racing the two possible
    // answers is what makes the recovery below reachable: `isVisible()` alone is an instantaneous probe
    // that runs before Clerk has rendered its error, so a recovery gated on it is dead code — verified by
    // forcing the race, which reproduced the error banner while the branch never fired.
    const answered = await Promise.race([
        notPrepared
            .waitFor({ state: 'visible', timeout: ANSWER_TIMEOUT_MS })
            .then(() => 'not-prepared' as const)
            .catch(() => 'unknown' as const),
        codeField
            .waitFor({ state: 'detached', timeout: ANSWER_TIMEOUT_MS })
            .then(() => 'advanced' as const)
            .catch(() => 'unknown' as const),
    ]);

    if (answered === 'not-prepared') {
        report(
            `Clerk reported "need to send a verification code" on the ${attempt} flow — the code was entered ` +
                'before the send resolved and the recovery path had to re-send it.',
        );

        const resend = page.getByRole('button', { name: /resend/i });

        // Clerk disables Resend for a countdown after each send, so wait for it to re-enable rather than
        // clicking blind. Arm the barrier around the re-send too: it is another async `prepare_*`, so
        // filling straight after the click would re-run the very race this branch is recovering from.
        await expect(resend).toBeEnabled({ timeout: 60_000 });

        const codeResent = armSendWaiter();

        await resend.click();
        await codeResent;
        await codeField.fill(CLERK_TEST_CODE);
        await submitIfPresent();
    }
}

/**
 * Surface a degraded path in BOTH places a human looks: the run output and the HTML report. A silent
 * fallback is how the original defect stayed hidden behind a passing retry.
 *
 * @sideEffect Writes to the console and mutates the current test's annotations.
 */
function report(message: string): void {
    console.warn(`[clerk email code] ${message}`);
    test.info().annotations.push({ type: 'clerk-email-code-degraded', description: message });
}
