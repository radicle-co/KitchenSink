/**
 * Mobile's sign-in copy IS the shared copy: the brand line, the sign-up prompt and link, and the two email messages are
 * authored once in `@commise/features-account` (`authSurfaceMessages`) and mobile's call sites read them per locale
 * through `useMessages(authSurfaceMessages)`, exactly as web's `clerkLocalization` does. Mobile's own `auth` dictionary
 * must therefore NOT carry them: a copy spread into the `en` set is `en`-only, so a second locale added to the shared
 * dictionary would never reach mobile.
 */
import { describe, expect, it } from 'vitest';

import { mobileMessages } from '../../src/i18n/messages.js';

describe('mobile auth copy', () => {
    it.each(['brandLine', 'noAccountPrompt', 'signUpLink', 'emailRequired', 'emailInvalid'] as const)(
        'does not restate the shared %s',
        (key) => {
            expect(Object.keys(mobileMessages.en.auth)).not.toContain(key);
        },
    );
});
