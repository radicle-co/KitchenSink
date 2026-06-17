import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';

vi.mock('../src/database/dao/index.js', () => ({
    UserDAO: vi.fn(),
    AccountDAO: vi.fn(),
}));
vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));

import { ResolveUserService } from '../src/users/resolveUser.js';
import { AccountDAO, UserDAO } from '../src/database/dao/index.js';
import * as Sentry from '@sentry/nestjs';

const activeUser = { id: '01USER00000000000000000000', email: 'a@b.com', status: 'active' };

describe('ResolveUserService.resolveUser', () => {
    let svc: ResolveUserService;
    let findById: ReturnType<typeof vi.fn>;
    let findByUserId: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        findById = vi.fn();
        findByUserId = vi.fn();
        vi.mocked(UserDAO).mockImplementation(function () {
            return { findById } as never;
        });
        vi.mocked(AccountDAO).mockImplementation(function () {
            return { findByUserId } as never;
        });
        svc = new ResolveUserService({} as never);
    });

    it('returns user + account when both exist', async () => {
        const account = { id: 'acc-1', userId: activeUser.id };
        findById.mockResolvedValue(activeUser);
        findByUserId.mockResolvedValue(account);

        await expect(svc.resolveUser(activeUser.id)).resolves.toEqual({ user: activeUser, account });
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('throws 404 NotFound when the user genuinely does not exist (no signal)', async () => {
        findById.mockResolvedValue(undefined);

        await expect(svc.resolveUser('usr_absent')).rejects.toBeInstanceOf(NotFoundException);
        expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('throws 403 Forbidden for a suspended user', async () => {
        findById.mockResolvedValue({ ...activeUser, status: 'suspended' });

        await expect(svc.resolveUser(activeUser.id)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('present user with no account: fails LOUD (500 + paging signal), not a silent 404', async () => {
        findById.mockResolvedValue(activeUser);
        findByUserId.mockResolvedValue(undefined);

        await expect(svc.resolveUser(activeUser.id)).rejects.toBeInstanceOf(InternalServerErrorException);
        expect(Sentry.captureException).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({
                tags: { 'auth.provisioning': 'failed' },
                contexts: { auth: { appUserId: activeUser.id, outcome: 'account_missing' } },
            }),
        );
    });
});
