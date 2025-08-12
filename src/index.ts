import { Command } from "commander";
import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { z } from "zod";

const ProcessSchema = z.object({
  label: z.string(),
  command: z.string(),
  cwd: z.string().default("."),
});
const ConfigSchema = z.object({
  team: z.string().optional(),
  project: z.string().optional(),
  envPrefix: z.string().default("env"),
  startIndex: z.number().int().min(1).default(1),
  count: z.number().int().min(1).default(1),
  convex: z
    .object({
      configureOnCreate: z.boolean().default(false),
    })
    .default({}),
  vite: z
    .object({
      basePort: z.number().int().default(5173),
      hostPattern: z.string().default("${name}.localhost"),
      strictPort: z.boolean().default(true),
    })
    .default({}),
  worktree: z
    .object({
      basePath: z.string().default("../${repo}_${name}"),
      branchPattern: z.string().default("${name}"),
    })
    .default({}),
  processes: z.array(ProcessSchema),
  ensureInstall: z.string().default("pnpm install --silent"),
});

type Config = z.infer<typeof ConfigSchema>;

async function getRepoRoot(): Promise<string> {
  const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"]);
  return stdout.trim();
}

async function getRepoName(): Promise<string> {
  const root = await getRepoRoot();
  return path.basename(root);
}

const render = (tmpl: string, vars: Record<string, string | number | boolean>) =>
  tmpl.replace(/\$\{(\w+)\}/g, (_, k) => String(vars[k]));

async function loadConfig(): Promise<Config> {
  const cfgPath = path.resolve("pde.config.json");
  const raw = await fs.readFile(cfgPath, "utf8");
  return ConfigSchema.parse(JSON.parse(raw));
}

async function ensureWorktree(env: { name: string; branch: string; dir: string }) {
  await execa("git", ["fetch"], { stdio: "inherit" });
  await execa("git", ["worktree", "add", env.dir, "-b", env.branch, "origin/main"], { stdio: "inherit" });
}

async function ensureInstall(dir: string, cmd: string) {
  try {
    await fs.access(path.join(dir, "node_modules"));
  } catch {
    await execa("bash", ["-lc", cmd], { cwd: dir, stdio: "inherit" });
  }
}

async function headlessConvexConfigureOnce(dir: string, team?: string, project?: string) {
  if (!team || !project) return;
  await execa(
    "bash",
    [
      "-lc",
      // Keep available for opt-in only. This intentionally provisions using Convex defaults.
      `pnpm dlx convex dev --once --configure existing --team ${team} --project ${project}`,
    ],
    { cwd: dir, stdio: "inherit" },
  );
}

async function generateWorkspace(
  repo: string,
  envs: Array<{ name: string; dir: string; port: number; host: string }>,
  cfg: Config,
) {
  const tasks: any[] = [];
  const compounds: any[] = [];

  for (const env of envs) {
    tasks.push({
      label: `setup:ensure install ${env.name}`,
      type: "shell",
      command: `[ -d node_modules ] && echo '${env.name} deps already installed' || ${cfg.ensureInstall}`,
      options: { cwd: env.dir },
      problemMatcher: [],
    });

    for (const p of cfg.processes) {
      const strict = cfg.vite.strictPort ? " --strictPort" : "";
      const command = render(p.command, { name: env.name, port: env.port, host: env.host, strict });
      tasks.push({
        label: `${env.name}:${p.label}`,
        type: "shell",
        command,
        options: { cwd: env.dir },
        problemMatcher: [],
        presentation: { panel: "dedicated" },
      });
    }

    tasks.push({
      label: `${env.name}:all`,
      type: "shell",
      command: `echo starting ${env.name}...`,
      dependsOn: [
        `setup:ensure install ${env.name}`,
        ...cfg.processes.map((p) => `${env.name}:${p.label}`),
      ],
      dependsOrder: "sequence",
      problemMatcher: [],
    });

    compounds.push({
      label: `${env.name}:all`,
      dependsOn: [
        `setup:ensure install ${env.name}`,
        ...cfg.processes.map((p) => `${env.name}:${p.label}`),
      ],
      dependsOrder: "sequence",
    });
  }

  tasks.push({
    label: "all:run everything",
    type: "shell",
    command: "echo starting all...",
    dependsOn: envs.map((e) => `${e.name}:all`),
    dependsOrder: "parallel",
    problemMatcher: [],
  });
  compounds.push({
    label: "all:run everything",
    dependsOn: envs.map((e) => `${e.name}:all`),
    dependsOrder: "parallel",
  });

  const workspace = {
    folders: [{ name: repo, path: process.cwd() }, ...envs.map((e) => ({ name: e.name, path: e.dir }))],
    settings: { "git.openRepositoryInParentFolders": "always" },
    tasks: { version: "2.0.0", tasks, compounds },
  };
  const wsFile = path.resolve(`${repo}-worktrees.code-workspace`);
  await fs.writeFile(wsFile, JSON.stringify(workspace, null, 2) + os.EOL, "utf8");
  console.log(`Wrote ${wsFile}`);
}

const program = new Command();
program.name("fleet").description("Worktree fleet orchestrator").version("0.1.0");

program
  .command("create")
  .option("--count <n>", "number of envs", (v) => parseInt(v, 10))
  .option("--prefix <str>", "name prefix")
  .action(async (opts) => {
    const cfg = await loadConfig();
    const repo = await getRepoName();
    const count = opts.count ?? cfg.count;
    const prefix = opts.prefix ?? cfg.envPrefix;

    const envs = Array.from({ length: count }, (_, i) => {
      const index = cfg.startIndex + i;
      const name = `${prefix}${index}`;
      const branch = render(cfg.worktree.branchPattern, { name, index });
      const dir = path.resolve(render(cfg.worktree.basePath, { repo, name, index }));
      const port = cfg.vite.basePort + i;
      const host = render(cfg.vite.hostPattern, { name, index });
      return { name, index, branch, dir, port, host };
    });

    for (const env of envs) {
      await ensureWorktree(env);
      await ensureInstall(env.dir, cfg.ensureInstall);
      if (cfg.convex.configureOnCreate) {
        await headlessConvexConfigureOnce(env.dir, cfg.team, cfg.project);
      }
    }

    await generateWorkspace(repo, envs, cfg);
  });

program
  .command("destroy")
  .option("--count <n>", "number of envs", (v) => parseInt(v, 10))
  .option("--prefix <str>", "name prefix")
  .action(async (opts) => {
    const cfg = await loadConfig();
    const repo = await getRepoName();
    const count = opts.count ?? cfg.count;
    const prefix = opts.prefix ?? cfg.envPrefix;

    for (let i = 0; i < count; i++) {
      const index = cfg.startIndex + i;
      const name = `${prefix}${index}`;
      const branch = render(cfg.worktree.branchPattern, { name, index });
      const dir = path.resolve(render(cfg.worktree.basePath, { repo, name, index }));
      await execa("git", ["worktree", "remove", "--force", dir], { stdio: "inherit" }).catch(() => {});
      await execa("git", ["branch", "-D", branch], { stdio: "inherit" }).catch(() => {});
    }
  });

program.parseAsync(process.argv);
