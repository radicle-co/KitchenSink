import { describe, expect, it } from 'vitest';

import {
    AccountSuspendedError,
    ImpersonationBlockedError,
    isAccountSuspendedError,
    isImpersonationBlockedError,
} from '../authState.errors.js';

describe('account-state errors', () => {
    it('AccountSuspendedError is identifiable across the prototype chain', () => {
        const error = new AccountSuspendedError();
        expect(isAccountSuspendedError(error)).toBe(true);
        expect(isImpersonationBlockedError(error)).toBe(false);
        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe('account_suspended');
    });

    it('ImpersonationBlockedError is identifiable across the prototype chain', () => {
        const error = new ImpersonationBlockedError();
        expect(isImpersonationBlockedError(error)).toBe(true);
        expect(isAccountSuspendedError(error)).toBe(false);
        expect(error.code).toBe('impersonation_blocked');
    });
});
