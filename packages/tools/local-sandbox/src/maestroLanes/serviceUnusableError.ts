/** A service's dependencies are missing: the local stack is not what `local:up` left (a restarted LocalStack). */
export class ServiceUnusableError extends Error {
    constructor(reasons: readonly string[]) {
        super(
            `maestro:lanes: the local stack cannot serve these services - run \`npm run local:up\` in the checkout that ` +
                `owns the stack, then retry:\n${reasons.map((reason) => `  ${reason}`).join('\n')}`,
        );
        this.name = 'ServiceUnusableError';
        Object.setPrototypeOf(this, ServiceUnusableError.prototype);
    }
}

export const isServiceUnusableError = (value: unknown): value is ServiceUnusableError =>
    value instanceof ServiceUnusableError;
