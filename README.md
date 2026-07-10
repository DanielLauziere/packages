# packages

Shared TypeScript packages used by the Next.js and React Native apps.

## Packages

### `ticket-engine`

Core ticket calculation and apply engine. Shared between the web admin, guest portal, and mobile app.

**Scripts:**

| Command | Description |
|---------|-------------|
| `yarn test` | Run all tests (vitest) |
| `yarn test:watch` | Run tests in watch mode |
| `yarn build` | Compile TypeScript to JS (outputs to `dist/`) |
| `yarn typecheck` | Type-check without emitting files |
| `yarn clean` | Remove `dist/` directory |

**VSCode beaker:** Open the repo root (`packages/`) in VSCode — the vitest extension auto-discovers all 71 tests. Click the flask icon in the activity bar to run, debug, or view individual tests.

**Usage:**

```ts
import { calculateLocationTickets } from '@omni/ticket-engine'

const result = calculateLocationTickets({ tickets, ticketMenuItems, menuItems, ... })
```

**Development:**

```sh
cd ticket-engine
yarn install
yarn test          # run all tests
yarn typecheck     # verify types
```

## Go parity

The Go implementation of `CalculateLocationTickets` lives in `src/services/ticketService.go` in the [omni](https://github.com/daniellauziere/omni) repo. The TypeScript version in `ticket-engine` must produce identical output for identical input. Run tests in both repos to verify:

```sh
# TypeScript (this repo)
cd packages/ticket-engine && yarn test

# Go
cd ../omni && go test ./src/services/...
```