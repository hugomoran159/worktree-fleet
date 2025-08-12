## panels-dev-env (pde)

Small CLI to spin up multiple isolated local environments for a single repo using Git worktrees. It creates branches like `agent1`, `agent2`, …; installs dependencies if missing; optionally performs a headless Convex configuration; and generates a VS Code multi-root workspace with tasks to run everything.

### Features

- **Worktrees**: `git worktree` per environment (branch defaults to the env name)
- **Auto install**: Runs `pnpm install` once per worktree if `node_modules` is missing
- **Headless Convex setup (optional)**: Writes `.env.local` once if you provide `team` and `project`
- **VS Code workspace**: Compound tasks to start all environments in parallel
- **Templated commands**: Interpolate values like `${name}`, `${port}`, `${host}`, `${strict}`

## Requirements

- Git repo with a remote `origin/main` (the tool tracks `origin/main` by default)
- Node.js 18+
- pnpm 8+
- Optional: Convex (the CLI runs via `pnpm dlx convex`, so no global install required)

## Installation

You can run the CLI without publishing to npm.

### Option A. Use a local clone (no publish)

```bash
# from your project repo root
node ../panels-dev-env/dist/index.js pde create --count 3 --prefix agent
```

### Option B. Run directly from GitHub via pnpm dlx (no publish)

```bash
pnpm dlx github:<your-gh-user>/panels-dev-env pde create --count 3 --prefix agent
```

### Option C. After publishing to npm

```bash
pnpm dlx panels-dev-env pde create --count 3 --prefix agent
```

## Quickstart

1) In your project repo (the one you want to create environments for), create `pde.config.json`:

```json
{
  "team": "your_convex_team_slug",
  "project": "your_convex_project_slug",
  "envPrefix": "agent",
  "startIndex": 1,
  "count": 3,
  "vite": {
    "basePort": 5173,
    "hostPattern": "${name}.localhost",
    "strictPort": true
  },
  "worktree": {
    "basePath": "../${repo}_${name}",
    "branchPattern": "${name}"
  },
  "processes": [
    {
      "label": "frontend",
      "command": "pnpm --filter app-frontend run build:panels && pnpm --filter app-frontend exec vite -- --port ${port} --host ${host}${strict}",
      "cwd": "."
    },
    {
      "label": "convex",
      "command": "pnpm dlx convex dev",
      "cwd": "."
    }
  ],
  "ensureInstall": "pnpm install --silent"
}
```

- Set `team` and `project` to skip Convex prompts and write `.env.local` once.
- Ports will be `basePort`, `basePort+1`, …; hosts use `hostPattern` (e.g. `agent1.localhost`).

2) From the project root, run the CLI:

```bash
# local build
node ../panels-dev-env/dist/index.js create --count 3 --prefix agent

# or via GitHub
pnpm dlx github:<your-gh-user>/panels-dev-env pde create --count 3 --prefix agent
```

3) Open the generated workspace file `<repo>-worktrees.code-workspace` in VS Code and run:

- Run Task → `all:run everything`

You’ll get N watchers/processes across the environments. Vite can bind to unique ports/hosts when you template them.

## Commands

### `pde create`

Creates `count` environments using Git worktrees, ensures dependencies, optionally configures Convex, and writes a VS Code workspace with tasks.

Options:

- `--count <n>`: number of environments (overrides config `count`)
- `--prefix <str>`: name prefix (overrides config `envPrefix`)

Behavior per env:

1. `git fetch`
2. `git worktree add <dir> -b <branch> origin/main`
3. If `<dir>/node_modules` is missing → run `ensureInstall` (`pnpm install --silent` by default)
4. If `team` and `project` are set → `pnpm dlx convex dev --once --configure existing ...` to generate `.env.local`
5. Update `<repo>-worktrees.code-workspace` with per-env tasks and compounds

### `pde destroy`

Removes the most recent N environments created by `create` and deletes their branches.

Options:

- `--count <n>`: number of environments
- `--prefix <str>`: name prefix

For each env, runs:

- `git worktree remove --force <dir>`
- `git branch -D <branch>`

## Configuration (`pde.config.json`)

```ts
type Process = {
  label: string;          // task label
  command: string;        // shell command with templates
  cwd?: string;           // working dir (default '.')
};

type Config = {
  team?: string;          // Convex team slug (optional)
  project?: string;       // Convex project slug (optional)
  envPrefix?: string;     // default: "env"
  startIndex?: number;    // default: 1
  count?: number;         // default: 1
  vite?: {
    basePort?: number;        // default: 5173
    hostPattern?: string;     // default: "${name}.localhost"
    strictPort?: boolean;     // default: true
  };
  worktree?: {
    basePath?: string;        // default: "../${repo}_${name}"
    branchPattern?: string;   // default: "${name}"
  };
  processes: Process[];       // required
  ensureInstall?: string;     // default: "pnpm install --silent"
}
```

### Template variables

Available in different parts of the config:

- `worktree.basePath`: `${repo}`, `${name}`, `${index}`
- `worktree.branchPattern`: `${name}`, `${index}`
- `vite.hostPattern`: `${name}`, `${index}`
- `processes[*].command`: `${name}`, `${port}`, `${host}`, `${strict}`

Notes:

- `port` is assigned as `vite.basePort + i` where `i` is the zero-based env offset.
- `host` is `vite.hostPattern` rendered with the env variables.
- `strict` expands to `" --strictPort"` when `vite.strictPort` is true, otherwise an empty string.

## VS Code workspace

The CLI writes `<repo>-worktrees.code-workspace` with:

- A folder for the base repo plus one per environment
- Per-env tasks:
  - `setup:ensure install <env>`
  - One task per configured `processes[*]`
  - `<env>:all` compound task
- A root compound task: `all:run everything`

## CI usage

Prepare one environment for tests without watchers:

```bash
pde create --count 1 --prefix ci
# run your tests pointing at the created worktree path
```

## Troubleshooting

- **`ENOENT: pde.config.json not found`**: Run the CLI from your project repo root (where `pde.config.json` lives).
- **`origin/main` not found**: The tool currently tracks `origin/main`. Ensure your remote branch exists or rebase/rename accordingly.
- **Install didn’t run**: The installer runs only if `node_modules` is missing in a worktree. Delete `node_modules` to force a fresh install or run the `setup:ensure install <env>` task.
- **Convex prompts**: Provide `team` and `project` in `pde.config.json` to run headless configuration once per worktree.

## Local development

```bash
pnpm install
pnpm run dev       # tsx for local iteration
pnpm run build     # produces dist/index.js and friends
```

Optionally add a GitHub remote and push:

```bash
git branch -M main
git remote add origin git@github.com:<your-gh-user>/panels-dev-env.git
git push -u origin main
```

After publishing to npm:

```bash
pnpm publish --access public
```


