import type { AuthorizerContext } from '../../types/index.js';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type { AuthorizerContext };

export const CurrentAuthorizerContext = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): AuthorizerContext => {
        const request = ctx.switchToHttp().getRequest<{ user?: AuthorizerContext }>();

        if (!request.user) {
            throw new Error('Missing authorizer context — ensure AuthMiddleware is applied');
        }

        return request.user;
    },
);
