import type { UserId } from './user.js';

export type AccountId = string & { readonly __brand: 'AccountId' };

// AUTHORED as zod in `../users/users.schema.ts` and published via `@kitchensink/schema-identity`
// (CODING_STANDARDS §15.2). Re-exported here for the DAO's existing import sites.
export type { AccountTier } from '../users/users.schema.js';

import type { AccountTier } from '../users/users.schema.js';

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
    subscriptionTier: AccountTier;
    readonly createdAt: string;
    updatedAt: string;
}
