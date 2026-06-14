import { Module, Global } from '@nestjs/common';

import { AuthMiddleware } from './middleware/auth.middleware.js';
import { ClerkAuthService } from './clerk-auth.service.js';
import { UsersModule } from '../users/users.module.js';

@Global()
@Module({
    imports: [UsersModule],
    providers: [AuthMiddleware, ClerkAuthService],
    exports: [AuthMiddleware],
})
export class AuthModule {}
