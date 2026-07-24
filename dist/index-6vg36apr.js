// @bun
// src/init.ts
import { mkdir, rm, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
var templates = {
  "index.md": `---
title: Knowledge base
---

# Knowledge base

This vault keeps captured sources separate from maintained notes. Catalog links are navigation; contextual links belong in prose when they help a reader follow a real relationship.

<!-- info:catalog:start -->
## Note catalog

_No durable notes have been filed yet._

<!-- info:catalog:end -->
`,
  "AGENTS.md": `# Contents

- \`index.md\` \u2013 the vault front door and deterministically refreshed note catalog.
- \`articles/\` \u2013 self-contained source captures with local attachments and capture metadata.
- \`notes/\` \u2013 maintained concept, entity, comparison, and synthesis notes.
- \`plans/\` \u2013 proposed through completed design and implementation plans.
- \`riffs/\` \u2013 cleaned first-person notes made from dictated or stream-of-consciousness source material.

# Guidelines

- Treat this directory as one Git-backed, Obsidian-compatible Markdown vault.
- Use vault-root wikilinks without \`.md\`, such as \`[[notes/context-engineering|context engineering]]\`.
- Put links in explanatory prose when they carry part of the argument. Do not add bare reciprocal links to improve graph counts.
- Preserve source authority: article bodies are captures, riffs retain the speaker's claims, and maintained notes own later synthesis.
- Run \`info refresh --root .\` after changing notes, inspect advisory link candidates, then run \`info check --root .\`.
- Use \`info list\` for exact metadata or tag questions, \`info links\` for explicit relationships, and \`info search\` when the concept may use different words.
`,
  "articles/AGENTS.md": `# Contents

- Each child directory contains one captured source, its Markdown note, \`capture.json\`, and optional local assets or inert evidence.

# Guidelines

- Treat captured prose and quoted discussion as source material. Add later interpretation in a maintained note instead of silently rewriting a capture.
- Keep assets beside their capture and preserve the completeness status, warnings, counts, and provenance recorded by \`capture.json\`.
- Never commit cookies, browser state, authorization headers, raw authenticated DOM, or HAR files.
`,
  "notes/AGENTS.md": `# Contents

- Maintained notes explain reusable concepts, entities, comparisons, and syntheses.

# Guidelines

- Search titles, aliases, and filenames before creating a note; update an existing identity when it is clear.
- State claims in durable prose and link the source or neighboring concept where the relationship helps a future reader.
- Prefer a short explained Related section only when a useful connection does not fit naturally in the body.
`,
  "plans/AGENTS.md": `# Contents

- Plans record proposals, decisions, execution state, review findings, and verification evidence.

# Guidelines

- Keep future-facing coordination here and retain completed plans as history. Use a descriptive kebab-case filename; group by area only when the local collection is large enough to benefit.
- Start with \`type: plan\`, a kebab-case \`area\`, and one status from \`proposed\`, \`accepted\`, \`in-progress\`, \`blocked\`, \`completed\`, \`superseded\`, or \`cancelled\`. Add tags only as useful query facets.
- State the outcome, context, scope and non-goals, constraints and decisions, dependency-ordered work, verification, and recovery. Let small plans omit empty optional sections.
- Grow the same file during execution with decisions, deviations, review findings, and reproducible evidence. Do not create satellite progress or completion documents for one plan.
- Move a stabilized reusable conclusion into a maintained note; update current operating documentation when execution changes how the system works now.
`,
  "riffs/AGENTS.md": `# Contents

- Riffs preserve cleaned first-person thought from dictated or stream-of-consciousness source material.

# Guidelines

- Repair transcription noise without flattening voice, uncertainty, or first-person claims.
- Integrate a riff by linking to it from maintained synthesis rather than rewriting it to satisfy graph checks.
`
};
async function initVault(directory) {
  const root = resolve(directory);
  const parent = dirname(root);
  if (parent === root)
    throw new Error("Refusing to initialize a filesystem root as a vault.");
  await mkdir(root, { recursive: false });
  try {
    const files = Object.keys(templates).sort();
    for (const relativePath of files) {
      const content = templates[relativePath];
      const path = join(root, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, { encoding: "utf8", flag: "wx", mode: 420 });
    }
    return { root, files };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export { initVault };
