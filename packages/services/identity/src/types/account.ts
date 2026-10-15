import type { AccountTier } from '@kitchensink/identity-db';

import type { UserId } from './user.js';

export type AccountId = string & { readonly __brand: 'AccountId' };

// The `accounts.subscription_tier` column's type, owned by the DAO that declares it (`@kitchensink/identity-db`).
// It is NOT on the wire: the column is written and read by nothing, and the viewer's paid features are
// `account.paidFeatures`, derived from roles (plan 2026-10-14-009 D6). Re-exported for the existing import sites.
export type { AccountTier };

export interface AccountModel {
    id: AccountId;
    userId: UserId;
    subscriptionTier: AccountTier;
    createdAt: string;
    updatedAt: string;
}

export interface CreateAccountDto {
    userId: UserId;
    subscriptionTier?: AccountTier;
}

export interface UpdateAccountDto {
    subscriptionTier?: AccountTier;
}

export interface UserProfileAccountDto {
    readonly id: string;
    readonly userId: UserId;
    readonly createdAt: string;
    updatedAt: string;
}
