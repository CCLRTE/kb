import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageName = "@cclrte/kb";
const importSpecifiers = ["@cclrte/kb","@cclrte/kb/browser-profiles","@cclrte/kb/capture","@cclrte/kb/clip/acquire","@cclrte/kb/clip/args","@cclrte/kb/clip/bounded-byte-buffer","@cclrte/kb/clip/cli","@cclrte/kb/clip/doctor","@cclrte/kb/clip/network","@cclrte/kb/clip/network-proxy","@cclrte/kb/clip/persist","@cclrte/kb/clip/terminal","@cclrte/kb/graph","@cclrte/kb/navigation","@cclrte/kb/query","@cclrte/kb/semantic"];
const binNames = ["kb"];
const verificationPackages = ["@types/bun@^1.3.14","fast-check@^4.8.0","typescript@^6.0.3"];

async function run(command: string[], cwd: string): Promise<void> {
  const process = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(`Command failed (${String(exitCode)}): ${command.join(" ")}`);
}

const repository = process.cwd();
const work = await mkdtemp(join(tmpdir(), "cclrte-package-smoke-"));
try {
  const archive = join(work, "package.tgz");
  const consumer = join(work, "consumer");
  await mkdir(consumer);
  await run([
    process.execPath,
    "pm",
    "pack",
    "--filename",
    archive,
    "--ignore-scripts",
    "--quiet",
  ], repository);
  await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  await run([process.execPath, "add", archive, "--ignore-scripts"], consumer);
  await run(["node", "--input-type=module", "-e", `await import(${JSON.stringify(packageName)})`], consumer);
  for (const binName of binNames) {
    await run([join(consumer, "node_modules", ".bin", binName), "--help"], consumer);
  }
  if (verificationPackages.length > 0) {
    await run([process.execPath, "add", ...verificationPackages, "--ignore-scripts"], consumer);
  }
  await run([
    "node",
    "--input-type=module",
    "-e",
    `await Promise.all(${JSON.stringify(importSpecifiers)}.map((specifier) => import(specifier)))`,
  ], consumer);
  await writeFile(join(consumer, "index.ts"), "import * as surface0 from \"@cclrte/kb\";\nimport * as surface1 from \"@cclrte/kb/browser-profiles\";\nimport * as surface2 from \"@cclrte/kb/capture\";\nimport * as surface3 from \"@cclrte/kb/clip/acquire\";\nimport * as surface4 from \"@cclrte/kb/clip/args\";\nimport * as surface5 from \"@cclrte/kb/clip/bounded-byte-buffer\";\nimport * as surface6 from \"@cclrte/kb/clip/cli\";\nimport * as surface7 from \"@cclrte/kb/clip/doctor\";\nimport * as surface8 from \"@cclrte/kb/clip/network\";\nimport * as surface9 from \"@cclrte/kb/clip/network-proxy\";\nimport * as surface10 from \"@cclrte/kb/clip/persist\";\nimport * as surface11 from \"@cclrte/kb/clip/terminal\";\nimport * as surface12 from \"@cclrte/kb/graph\";\nimport * as surface13 from \"@cclrte/kb/navigation\";\nimport * as surface14 from \"@cclrte/kb/query\";\nimport * as surface15 from \"@cclrte/kb/semantic\";\nvoid [surface0, surface1, surface2, surface3, surface4, surface5, surface6, surface7, surface8, surface9, surface10, surface11, surface12, surface13, surface14, surface15];\n");
  await writeFile(join(consumer, "tsconfig.bundler.json"), "{\n  \"compilerOptions\": {\n    \"target\": \"ES2023\",\n    \"lib\": [\n      \"ES2023\",\n      \"DOM\",\n      \"DOM.Iterable\"\n    ],\n    \"types\": [\n      \"bun\",\n      \"node\"\n    ],\n    \"strict\": true,\n    \"noEmit\": true,\n    \"skipLibCheck\": false,\n    \"module\": \"Preserve\",\n    \"moduleResolution\": \"Bundler\"\n  },\n  \"include\": [\n    \"index.ts\"\n  ]\n}");
  await writeFile(join(consumer, "tsconfig.nodenext.json"), "{\n  \"compilerOptions\": {\n    \"target\": \"ES2023\",\n    \"lib\": [\n      \"ES2023\",\n      \"DOM\",\n      \"DOM.Iterable\"\n    ],\n    \"types\": [\n      \"bun\",\n      \"node\"\n    ],\n    \"strict\": true,\n    \"noEmit\": true,\n    \"skipLibCheck\": false,\n    \"module\": \"NodeNext\",\n    \"moduleResolution\": \"NodeNext\"\n  },\n  \"include\": [\n    \"index.ts\"\n  ]\n}");
  await run([process.execPath, "x", "tsc", "-p", "./tsconfig.bundler.json"], consumer);
  await run([process.execPath, "x", "tsc", "-p", "./tsconfig.nodenext.json"], consumer);
} finally {
  await rm(work, { recursive: true, force: true });
}
