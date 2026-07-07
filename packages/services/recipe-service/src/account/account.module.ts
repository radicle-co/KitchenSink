import { Module } from '@nestjs/common';

/**
 * Account module skeleton. The recipe service owns no users table (D2); GDPR erasure of a user's
 * recipe data lives here rather than in a `users` module. Controllers, services, and DAOs are added
 * in a later phase.
 */
@Module({})
export class AccountModule {}
