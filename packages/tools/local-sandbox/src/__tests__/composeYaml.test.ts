/**
 * The generated compose file, for the default stack and a shifted one. The expectations are literals, so a change to
 * today's names or ports cannot pass by changing both sides. Names and ports are compared, not the bytes of the file.
 */
import { describe, expect, it } from 'vitest';

import { planCompose } from '../composePlan.js';
import { composeYaml } from '../composeYaml.js';
import { stackFrom } from '../stackPorts.js';

const requirements = {
    localstackServices: ['s3', 'sqs'],
    containers: ['postgres:18'],
    services: [],
    unsupported: [],
    undecided: [],
};

function yamlFor(env: Record<string, string>): string {
    const stack = stackFrom(env);
    const plan = planCompose(requirements, {
        databases: ['kitchensink_identity'],
        stack,
        serviceContainers: [
            {
                name: 'recipes',
                image: stack.imageTag('kitchensink-recipe-service'),
                hostPort: stack.hostPort('recipes', 3000),
                containerPort: 3000,
                environment: {},
            },
        ],
    });

    return composeYaml(plan, stack);
}

describe('composeYaml: the default stack is exactly today', () => {
    const yaml = yamlFor({});

    it('names the project, the containers and the volume as before', () => {
        expect(yaml).toContain('name: local-sandbox\n');
        expect(yaml).toContain('container_name: local-sandbox-postgres');
        expect(yaml).toContain('container_name: local-sandbox-localstack');
        expect(yaml).toContain('container_name: local-sandbox-recipes');
        expect(yaml).toContain('local-sandbox-pgdata:');
    });

    it("publishes today's ports and uses today's image tag", () => {
        expect(yaml).toContain("- '4566:4566'");
        expect(yaml).toContain("- '5432:5432'");
        expect(yaml).toContain("- '3000:3000'");
        expect(yaml).toContain('image: local-sandbox/kitchensink-recipe-service:local\n');
    });
});

describe('composeYaml: the 3100 stack (AE2)', () => {
    const yaml = yamlFor({ LOCAL_SANDBOX_PORT: '3100' });

    it('has its own project name, container names and image tag', () => {
        expect(yaml).toContain('name: local-sandbox-3100\n');
        expect(yaml).toContain('container_name: local-sandbox-3100-postgres');
        expect(yaml).toContain('container_name: local-sandbox-3100-localstack');
        expect(yaml).toContain('container_name: local-sandbox-3100-recipes');
        expect(yaml).toContain('image: local-sandbox/kitchensink-recipe-service:local-3100\n');
    });

    it('moves only the host side of each port', () => {
        expect(yaml).toContain("- '4666:4566'");
        expect(yaml).toContain("- '5532:5432'");
        expect(yaml).toContain("- '3100:3000'");
    });

    it('names no container, port or tag of the default stack', () => {
        expect(yaml).not.toMatch(/container_name: local-sandbox-(postgres|localstack|recipes)/u);
        expect(yaml).not.toContain("'4566:4566'");
        expect(yaml).not.toContain("'5432:5432'");
        expect(yaml).not.toContain(':local\n');
    });
});
