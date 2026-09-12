/**
 * ProfileScrubPolicy (Specification A) unit tests — the ONE authoritative field-scrub rule for the two
 * lifecycle events. Maps CR-002 requirements to behaviours:
 *   R2  — closure keeps {id, name}; scrubs email → ULID placeholder, avatar (col + S3), keeps companion rows.
 *   R3  — erasure keeps {id} only; name/email/avatar destroyed; companion rows purged.
 *   KTD — email placeholder is ULID-keyed (NEVER Clerk-`sub`-keyed) and never-deliverable.
 */
import { describe, it, expect } from 'vitest';

import { computeProfileScrub, scrubbedEmail } from '../profileScrubPolicy.js';

const USER_ID = '01J000000000000000000ULID';

describe('scrubbedEmail', () => {
    it('keys the closure placeholder on the app ULID, not the Clerk sub, in the reserved .invalid TLD', () => {
        expect(scrubbedEmail(USER_ID, 'closure')).toBe(`${USER_ID}@closed.invalid`);
    });

    it('keys the erasure placeholder on the app ULID in the reserved .invalid TLD', () => {
        expect(scrubbedEmail(USER_ID, 'erasure')).toBe(`${USER_ID}@erased.invalid`);
    });

    it('never emits a deliverable address (always the RFC 2606 .invalid TLD)', () => {
        expect(scrubbedEmail(USER_ID, 'closure').endsWith('.invalid')).toBe(true);
        expect(scrubbedEmail(USER_ID, 'erasure').endsWith('.invalid')).toBe(true);
    });
});

describe('computeProfileScrub', () => {
    describe('closure (tombstone) — keep {id, name}', () => {
        const directive = computeProfileScrub('closure', USER_ID);

        it('tombstones the users row: email → ULID placeholder, picture null, status tombstoned', () => {
            expect(directive.userColumns.email).toBe(`${USER_ID}@closed.invalid`);
            expect(directive.userColumns.picture).toBeNull();
            expect(directive.userColumns.status).toBe('tombstoned');
        });

        it('KEEPS the name (no name key in the SET — the column is left untouched)', () => {
            expect(Object.prototype.hasOwnProperty.call(directive.userColumns, 'name')).toBe(false);
        });

        it('keeps the companion rows and scrubs the profile avatar (recovery restores displayName)', () => {
            expect(directive.purgeCompanionRows).toBe(false);
            expect(directive.profileScrub).toEqual({ avatarUrl: null });
        });

        it('removes the avatar S3 object and reports the tombstoned state', () => {
            expect(directive.removeAvatarObject).toBe(true);
            expect(directive.state).toBe('tombstoned');
        });
    });

    describe('erasure — keep {id} only', () => {
        const directive = computeProfileScrub('erasure', USER_ID);

        it('reduces the users row: email → placeholder, picture null, name destroyed, status erased', () => {
            expect(directive.userColumns.email).toBe(`${USER_ID}@erased.invalid`);
            expect(directive.userColumns.picture).toBeNull();
            expect(directive.userColumns.name).toBeNull();
            expect(directive.userColumns.status).toBe('erased');
        });

        it('purges the companion rows (destroying displayName + avatarUrl) — no separate profile scrub', () => {
            expect(directive.purgeCompanionRows).toBe(true);
            expect(directive.profileScrub).toBeNull();
        });

        it('removes the avatar S3 object and reports the erased state', () => {
            expect(directive.removeAvatarObject).toBe(true);
            expect(directive.state).toBe('erased');
        });
    });
});
