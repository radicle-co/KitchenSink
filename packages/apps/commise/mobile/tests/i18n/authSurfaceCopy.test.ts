/**
 * Mobile's sign-in copy IS the shared copy: the brand line, the sign-up prompt and link, and the two email messages are
 * authored once in `@commise/features-account` (`authSurfaceMessages`) and mobile's `auth` block re-exposes them, so the
 * two platforms cannot word the same sign-in surface two ways. A literal restated in the mobile dictionary would fail
 * here the day it differs.
 */
import { authSurfaceMessages } from '@commise/features-account';
import { describe, expect, it } from 'vitest';

import { mobileMessages } from '../../src/i18n/messages.js';

describe('mobile auth copy', () => {
    it.each(['brandLine', 'noAccountPrompt', 'signUpLink', 'emailRequired', 'emailInvalid'] as const)(
        'takes %s from the shared sign-in copy',
        (key) => {
            expect(mobileMessages.en.auth[key]).toBe(authSurfaceMessages.en[key]);
        },
    );
});
