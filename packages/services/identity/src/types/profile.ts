import type { UserId } from './user.js';

export type ProfileId = string & { readonly __brand: 'ProfileId' };

export interface ProfileReadDto {
    id: ProfileId;
    userId: UserId;
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    updatedAt: string;
}

export interface CreateProfileDto {
    userId: UserId;
    displayName: string;
    avatarUrl?: string | null;
    bio?: string | null;
}

export interface UpdateProfileDto {
    displayName?: string;
    avatarUrl?: string | null;
    bio?: string | null;
    updatedAt?: string;
}

// `UserProfile` is the RESPONSE BODY of `GET`/`PATCH /api/v1/users/me`, so it is AUTHORED as zod in
// `../users/users.schema.ts` and published via `@kitchensink/schema-identity` (CODING_STANDARDS §15.2) —
// re-exported here for this module's existing import sites, and no longer composed from the branded internal
// DTOs. That composition is what made web, mobile AND the shared `@commise/features-account` package declare a
// dependency on this whole NestJS service package just to name the viewer's profile.
export type { UserProfile } from '../users/users.schema.js';
