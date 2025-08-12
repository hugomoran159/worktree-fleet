"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/index.ts
var import_commander = require("commander");
var import_execa = require("execa");
var import_promises = __toESM(require("fs/promises"), 1);
var import_node_path = __toESM(require("path"), 1);
var import_node_os = __toESM(require("os"), 1);
var import_zod = require("zod");
var ProcessSchema = import_zod.z.object({
  label: import_zod.z.string(),
  command: import_zod.z.string(),
  cwd: import_zod.z.string().default(".")
});
var ConfigSchema = import_zod.z.object({
  team: import_zod.z.string().optional(),
  project: import_zod.z.string().optional(),
  envPrefix: import_zod.z.string().default("env"),
  startIndex: import_zod.z.number().int().min(1).default(1),
  count: import_zod.z.number().int().min(1).default(1),
  vite: import_zod.z.object({
    basePort: import_zod.z.number().int().default(5173),
    hostPattern: import_zod.z.string().default("${name}.localhost"),
    strictPort: import_zod.z.boolean().default(true)
  }).default({}),
  worktree: import_zod.z.object({
    basePath: import_zod.z.string().default("../${repo}_${name}"),
    branchPattern: import_zod.z.string().default("${name}")
  }).default({}),
  processes: import_zod.z.array(ProcessSchema),
  ensureInstall: import_zod.z.string().default("pnpm install --silent")
});
async function getRepoRoot() {
  const { stdout } = await (0, import_execa.execa)("git", ["rev-parse", "--show-toplevel"]);
  return stdout.trim();
}
async function getRepoName() {
  const root = await getRepoRoot();
  return import_node_path.default.basename(root);
}
var render = (tmpl, vars) => tmpl.replace(/\$\{(\w+)\}/g, (_, k) => String(vars[k]));
async function loadConfig() {
  const cfgPath = import_node_path.default.resolve("pde.config.json");
  const raw = await import_promises.default.readFile(cfgPath, "utf8");
  return ConfigSchema.parse(JSON.parse(raw));
}
async function ensureWorktree(env) {
  await (0, import_execa.execa)("git", ["fetch"], { stdio: "inherit" });
  await (0, import_execa.execa)("git", ["worktree", "add", env.dir, "-b", env.branch, "origin/main"], { stdio: "inherit" });
}
async function ensureInstall(dir, cmd) {
  try {
    await import_promises.default.access(import_node_path.default.join(dir, "node_modules"));
  } catch {
    await (0, import_execa.execa)("bash", ["-lc", cmd], { cwd: dir, stdio: "inherit" });
  }
}
async function headlessConvexConfigureOnce(dir, team, project) {
  if (!team || !project) return;
  await (0, import_execa.execa)("bash", [
    "-lc",
    `pnpm dlx convex dev --once --configure existing --team ${team} --project ${project} --dev-deployment cloud`
  ], { cwd: dir, stdio: "inherit" });
}
async function generateWorkspace(repo, envs, cfg) {
  const tasks = [];
  const compounds = [];
  for (const env of envs) {
    tasks.push({
      label: `setup:ensure install ${env.name}`,
      type: "shell",
      command: `[ -d node_modules ] && echo '${env.name} deps already installed' || ${cfg.ensureInstall}`,
      options: { cwd: env.dir },
      problemMatcher: []
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
        presentation: { panel: "dedicated" }
      });
    }
    tasks.push({
      label: `${env.name}:all`,
      type: "shell",
      command: `echo starting ${env.name}...`,
      dependsOn: [
        `setup:ensure install ${env.name}`,
        ...cfg.processes.map((p) => `${env.name}:${p.label}`)
      ],
      dependsOrder: "sequence",
      problemMatcher: []
    });
    compounds.push({
      label: `${env.name}:all`,
      dependsOn: [
        `setup:ensure install ${env.name}`,
        ...cfg.processes.map((p) => `${env.name}:${p.label}`)
      ],
      dependsOrder: "sequence"
    });
  }
  tasks.push({
    label: "all:run everything",
    type: "shell",
    command: "echo starting all...",
    dependsOn: envs.map((e) => `${e.name}:all`),
    dependsOrder: "parallel",
    problemMatcher: []
  });
  compounds.push({
    label: "all:run everything",
    dependsOn: envs.map((e) => `${e.name}:all`),
    dependsOrder: "parallel"
  });
  const workspace = {
    folders: [{ name: repo, path: process.cwd() }, ...envs.map((e) => ({ name: e.name, path: e.dir }))],
    settings: { "git.openRepositoryInParentFolders": "always" },
    tasks: { version: "2.0.0", tasks, compounds }
  };
  const wsFile = import_node_path.default.resolve(`${repo}-worktrees.code-workspace`);
  await import_promises.default.writeFile(wsFile, JSON.stringify(workspace, null, 2) + import_node_os.default.EOL, "utf8");
  console.log(`Wrote ${wsFile}`);
}
var program = new import_commander.Command();
program.name("pde").description("Panels dev environments (worktree orchestrator)").version("0.1.0");
program.command("create").option("--count <n>", "number of envs", (v) => parseInt(v, 10)).option("--prefix <str>", "name prefix").action(async (opts) => {
  const cfg = await loadConfig();
  const repo = await getRepoName();
  const count = opts.count ?? cfg.count;
  const prefix = opts.prefix ?? cfg.envPrefix;
  const envs = Array.from({ length: count }, (_, i) => {
    const index = cfg.startIndex + i;
    const name = `${prefix}${index}`;
    const branch = render(cfg.worktree.branchPattern, { name, index });
    const dir = import_node_path.default.resolve(render(cfg.worktree.basePath, { repo, name, index }));
    const port = cfg.vite.basePort + i;
    const host = render(cfg.vite.hostPattern, { name, index });
    return { name, index, branch, dir, port, host };
  });
  for (const env of envs) {
    await ensureWorktree(env);
    await ensureInstall(env.dir, cfg.ensureInstall);
    await headlessConvexConfigureOnce(env.dir, cfg.team, cfg.project);
  }
  await generateWorkspace(repo, envs, cfg);
});
program.command("destroy").option("--count <n>", "number of envs", (v) => parseInt(v, 10)).option("--prefix <str>", "name prefix").action(async (opts) => {
  const cfg = await loadConfig();
  const repo = await getRepoName();
  const count = opts.count ?? cfg.count;
  const prefix = opts.prefix ?? cfg.envPrefix;
  for (let i = 0; i < count; i++) {
    const index = cfg.startIndex + i;
    const name = `${prefix}${index}`;
    const branch = render(cfg.worktree.branchPattern, { name, index });
    const dir = import_node_path.default.resolve(render(cfg.worktree.basePath, { repo, name, index }));
    await (0, import_execa.execa)("git", ["worktree", "remove", "--force", dir], { stdio: "inherit" }).catch(() => {
    });
    await (0, import_execa.execa)("git", ["branch", "-D", branch], { stdio: "inherit" }).catch(() => {
    });
  }
});
program.parseAsync(process.argv);
