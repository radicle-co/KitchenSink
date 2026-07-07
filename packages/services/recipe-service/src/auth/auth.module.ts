import { Module } from '@nestjs/common';

/**
 * Auth module skeleton. Owns Clerk session-token verification and the read-through auth middleware
 * that surfaces `principal.userId` (the app-user ULID from the Clerk `external_id` claim). Wiring is
 * added in a later phase.
 */
@Module({})
export class AuthModule {}
