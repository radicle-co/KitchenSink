# local-sandbox

This package builds and runs the local stack: Postgres, LocalStack and the three services in Docker.

## Run a second stack beside the first

Set `LOCAL_SANDBOX_PORT` to the recipe service's host port, for example `LOCAL_SANDBOX_PORT=3100 npm run local:up`.
Every other port moves by the same amount, and the stack gets its own Docker project, containers, images and data.
Unset, empty or 3000 gives today's stack with today's names and ports.

With `LOCAL_SANDBOX_PORT=3100`, the ports are: recipes 3100, identity 3101, food 3102, LocalStack 4666 and Postgres 5532.
The Docker project is `local-sandbox-3100`.

A full run on the second stack uses the same variable on every command:

```
LOCAL_SANDBOX_PORT=3100 npm run local:up
LOCAL_SANDBOX_PORT=3100 npm run test:e2e:android
LOCAL_SANDBOX_PORT=3100 npm run local:down
```

Every door that talks to the stack reads the same variable: `local:up`, `local:down`, `local:maestro` and the Maestro
lanes. Set it the same way for each command. A door aimed at a stack that is not running, or that another checkout runs,
refuses with one line and changes nothing.

To move one port only, set `LOCAL_SANDBOX_HOST_PORTS`, for example `LOCAL_SANDBOX_HOST_PORTS=recipes=3010`. An entry
there wins over the shift from `LOCAL_SANDBOX_PORT`.

## Limits

- One stack per checkout, because the generated `.local-sandbox/` folder belongs to the tree.
- One Maestro run per host at a time, whatever the stack.
- The Mac lanes keep their fixed Mac ports, so they serve one stack at a time.
- `local:dev` and `dev:local` refuse a stack that is not the default, because the host dev servers read each
  service's `.env.development`, which names the default ports.
- A checkout on the older code reads the new three-part lock file as a lock with no holder, so it refuses. It fails
  closed. Once every checkout has this change, the limit is gone.
- The services' LOCAL e2e suites use the default stack's ports from any checkout, with the variable set or not. A session
  on another stack that runs them writes test data into the default stack.
