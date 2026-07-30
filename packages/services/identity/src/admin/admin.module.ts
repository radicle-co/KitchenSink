import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { ScopesGuard } from '../auth/guards/scopes.guard.js';

@Module({
    controllers: [AdminController],
    // ScopesGuard is referenced by class in `@UseGuards(ScopesGuard)` on AdminController, so Nest
    // instantiates it through DI (it needs `Reflector`, injected from `@nestjs/core`) — it must be a
    // provider of this module (or an imported one) or DI resolution fails at boot.
    providers: [AdminService, ScopesGuard],
    exports: [AdminService],
})
export class AdminModule {}
