export type UserId = string & { readonly __brand: 'UserId' };

/** @implements REQ-001 REQ-005 REQ-006 REQ-009 REQ-039 REQ-040 REQ-CN-008 FR-001 FR-005 FR-006 FR-009 FR-039 FR-040 ARCH-001 ARCH-003 ARCH-024 MOD-001 MOD-003 MOD-024 */
export type UserSub = UserId;

/** @implements REQ-013 REQ-014 REQ-015 REQ-017 REQ-018 REQ-019 REQ-025 REQ-CN-003 FR-013 FR-014 FR-015 FR-017 FR-018 FR-019 FR-025 ARCH-011 ARCH-012 ARCH-015 MOD-011 MOD-012 MOD-015 */
export type UserStatus = 'active' | 'suspended' | 'tombstoned' | 'erased';

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

export interface UserUpdateInput {
    displayName?: string;
    avatarUrl?: string | null;
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
