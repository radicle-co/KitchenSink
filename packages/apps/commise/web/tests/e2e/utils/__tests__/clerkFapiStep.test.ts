/**
 * `clerkFapiStep` names the email-code step a browser response belongs to — and nothing else from its URL — and
 * `isTerminalRefusal` decides which refusals end the flow.
 *
 * They exist so `submitClerkEmailCode` can fail at a refused step with a legible reason instead of timing out on
 * a heading 15 s later and then spending a SECOND verification in its Resend recovery. The URL is the only place
 * the step is written down, and the same URL's query carries the dev-browser JWT, so the name is built from path
 * segments only.
 */
import { describe, expect, it } from 'vitest';

import { clerkFapiStep, isTerminalRefusal } from '../clerkFapiStep';

const FAPI = 'https://nice-fowl-6.clerk.accounts.dev/v1/client';

describe('clerkFapiStep', () => {
    it('names the sign-in second-factor send and attempt', () => {
        expect(
            clerkFapiStep(`${FAPI}/sign_ins/sia_1/prepare_second_factor?__clerk_db_jwt=dev_secret`, 'sign_ins'),
        ).toBe('sign_ins prepare_second_factor');
        expect(clerkFapiStep(`${FAPI}/sign_ins/sia_1/attempt_second_factor?_clerk_js_version=5`, 'sign_ins')).toBe(
            'sign_ins attempt_second_factor',
        );
    });

    it('names the sign-up verification send and attempt', () => {
        expect(clerkFapiStep(`${FAPI}/sign_ups/sua_1/prepare_verification`, 'sign_ups')).toBe(
            'sign_ups prepare_verification',
        );
        expect(clerkFapiStep(`${FAPI}/sign_ups/sua_1/attempt_verification`, 'sign_ups')).toBe(
            'sign_ups attempt_verification',
        );
    });

    it('ignores the OTHER flow’s attempt, the create, and every unrelated call', () => {
        expect(clerkFapiStep(`${FAPI}/sign_ups/sua_1/prepare_verification`, 'sign_ins')).toBeNull();
        expect(clerkFapiStep(`${FAPI}/sign_ins?__clerk_db_jwt=dev`, 'sign_ins')).toBeNull();
        expect(clerkFapiStep(`${FAPI}/sessions/sess_1/tokens`, 'sign_ins')).toBeNull();
        expect(clerkFapiStep('https://pr-91.sandbox.commise.app/en/sign-in', 'sign_ins')).toBeNull();
    });

    it('never returns anything from the query string or the attempt id', () => {
        const step = clerkFapiStep(
            `${FAPI}/sign_ins/sia_1/prepare_second_factor?__clerk_db_jwt=dev_secret`,
            'sign_ins',
        );

        expect(step).not.toContain('dev_secret');
        expect(step).not.toContain('sia_1');
    });
});

describe('isTerminalRefusal', () => {
    it('ends the flow on ANY refused send — a Resend would only spend another verification into the same refusal', () => {
        expect(isTerminalRefusal('sign_ins prepare_second_factor', 429)).toBe(true);
        expect(isTerminalRefusal('sign_ups prepare_verification', 422)).toBe(true);
        expect(isTerminalRefusal('sign_ups prepare_verification', 503)).toBe(true);
    });

    it('ends the flow on a THROTTLED or failed check', () => {
        expect(isTerminalRefusal('sign_ins attempt_second_factor', 429)).toBe(true);
        expect(isTerminalRefusal('sign_ins attempt_second_factor', 500)).toBe(true);
    });

    it('does NOT end it on a check refused for being early — that is the race the Resend recovery exists for', () => {
        // "You need to send a verification code before attempting to verify." answers a 4xx on the ATTEMPT, and
        // `submitClerkEmailCode` recovers from it by re-sending. Treating it as terminal would delete that recovery.
        expect(isTerminalRefusal('sign_ins attempt_second_factor', 400)).toBe(false);
        expect(isTerminalRefusal('sign_ups attempt_verification', 422)).toBe(false);
    });

    it('never treats a success as a refusal', () => {
        expect(isTerminalRefusal('sign_ins prepare_second_factor', 200)).toBe(false);
        expect(isTerminalRefusal('sign_ins attempt_second_factor', 204)).toBe(false);
    });
});
