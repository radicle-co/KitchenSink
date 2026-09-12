// The WIRE shapes below are AUTHORED as zod in `../users/users.schema.ts` and published via
// `@kitchensink/schema-identity` (CODING_STANDARDS §15.2). They are re-exported here because this module is
// where every existing import site expects them — but they are no longer DEFINED here, so the lifecycle
// vocabulary a client compiles against and the one the service uses cannot drift apart.
//
// `UserId` stays a SERVER-SIDE brand and is deliberately NOT published: it exists so service code cannot pass
// an account id where a user id belongs, an invariant a client can neither establish nor benefit from. It
// remains assignable to the wire's plain `string`, so the handlers still satisfy the published shapes.
export type { UserStatus, UserUpdateInput } from '../users/users.schema.js';

import type { UserStatus } from '../users/users.schema.js';

export type UserId = string & { readonly __brand: 'UserId' };

/** @implements REQ-001 REQ-005 REQ-006 REQ-009 REQ-039 REQ-040 REQ-CN-008 FR-001 FR-005 FR-006 FR-009 FR-039 FR-040 ARCH-001 ARCH-003 ARCH-024 MOD-001 MOD-003 MOD-024 */
export type UserSub = UserId;

/** @implements REQ-005 REQ-006 REQ-039 FR-005 FR-006 FR-039 ARCH-003 MOD-003 */
export interface UserReadDto {
    id: UserId;
    email: string;
    status: UserStatus;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

/** @implements REQ-005 REQ-039 FR-005 FR-039 ARCH-003 MOD-003 */
export interface CreateUserDto {
    id: UserId;
    email: string;
    status?: UserStatus;
}

/** @implements REQ-006 REQ-040 FR-006 FR-040 ARCH-024 MOD-024 */
export interface UpdateUserDto {
    email?: string;
    status?: UserStatus;
    deletedAt?: string | null;
}

export interface UserProfileUserDto {
    readonly id: UserId;
    readonly email: string;
    displayName: string;
    avatarUrl: string | null;
    status: UserStatus;
    readonly createdAt: string;
    updatedAt: string;
}
