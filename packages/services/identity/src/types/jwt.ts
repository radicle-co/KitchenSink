import type { UserId } from './user.js';

export interface ClerkSessionClaims {
    sub: string;
    app_user_id: UserId;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
    iat: number;
    exp: number;
    iss: string;
    azp?: string;
}

export type ClerkClaims = ClerkSessionClaims;

export interface AuthorizerContext {
    userId: UserId;
    email: string;
    clerkUserId: string;
    scopes: string[];
    permissions: string[];
    tokenType: 'user';
    /**
     * Whether the caller is a member of the fixed Clerk TEST POOL (ADR-0040) — copied from the verified claim
     * (`public_metadata.testPrincipal === true`, read by `@kitchensink/clerk-verify`), never from anything a
     * client can supply. REQUIRED with no default on purpose: every construction site must state it, so a new
     * one cannot silently mark a test principal as a real user and bypass containment.
     */
    testPrincipal: boolean;
}

export interface ApiGatewayAuthorizerResult {
    principalId: string;
    policyDocument: {
        Version: '2012-10-17';
        Statement: Array<{
            Action: 'execute-api:Invoke';
            Effect: 'Allow' | 'Deny';
            Resource: string | string[];
        }>;
    };
    context: AuthorizerContext;
}
