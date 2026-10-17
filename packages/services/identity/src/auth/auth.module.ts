import { Module, Global } from '@nestjs/common';

import { AuthMiddleware } from './middleware/auth.middleware.js';
import { ClerkAuthService } from './clerkAuth.service.js';
import { UsersModule } from '../users/users.module.js';

@Global()
@Module({
    imports: [UsersModule],
    providers: [AuthMiddleware, ClerkAuthService],
    // ClerkAuthService MUST be exported: AuthMiddleware is applied in AppModule.configure(), so Nest
    // resolves its constructor deps (ClerkAuthService, UsersService) from the EXPORTS of AppModule's
    // imported modules. Exporting only AuthMiddleware crash-loops the app on boot with
    // "Nest can't resolve dependencies of the AuthMiddleware (?, UsersService)".
    exports: [AuthMiddleware, ClerkAuthService],
})
export class AuthModule {}
