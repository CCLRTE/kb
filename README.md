# CCLRTE/kb

CCLRTE/kb is a simple, local-first command-line tool for an Obsidian-compatible Markdown knowledge base for coding agents. It keeps notes readable without the tool, queries typed frontmatter, derives a deterministic link graph from explicit wikilinks, offers optional local semantic recall, and captures web and PDF sources as auditable bundles instead of opaque blobs.

The CLI is Bun-first. Refresh, graph navigation, exact metadata queries, and capture do not require a model, an API key, a database, or a hosted service. Semantic search uses a replaceable local QMD index; Markdown remains the source of truth.

<!-- article:a-durable-knowledge-base-is-a-write-path:start -->
## [A knowledge base for your coding agents](<https://prmte.com/articles/a-durable-knowledge-base-is-a-write-path>)

> Coding agents need memory that survives the chat. CCLRTE/kb keeps it in Markdown and Git, with local search and deterministic structure.

A coding agent can inspect a repository and finish a task, then begin the next session without the decisions, evidence, or rejected approaches that shaped the first one. A longer context window delays that loss. It does not create maintained memory that another agent can inspect and improve.

[CCLRTE/kb is an open-source knowledge base for coding agents](<https://github.com/CCLRTE/kb>). It keeps source records, maintained understanding, plans, and their relationships in ordinary Markdown under Git. Deterministic commands handle exact metadata and links; local semantic search helps when the right note uses different words. The package stays deliberately close to files so a team can change agents, editors, or search tools without migrating its memory.

![Two paths compare a coding-agent session that loses decisions, evidence, and rejected approaches with maintained source records, understanding, plans, and relationships in Markdown under Git.](<https://prmte.com/article-diagrams/a-durable-knowledge-base-is-a-write-path.light.webp>)

*A longer context window delays lost session context. CCLRTE/kb keeps maintained memory in ordinary Markdown under Git.*

The default layout separates authored records from derived views. These directories are useful conventions, not a framework that application code must import:

**Default CCLRTE/kb vault and its derived views**

```text
kb/
├── articles/<slug>/  # captured source, manifest, and local assets
├── notes/            # maintained synthesis
├── plans/            # decisions, progress, and verification
├── riffs/            # voice-preserving source thought
└── index.md          # regenerated catalog

Markdown + frontmatter + wikilinks
              │
              ├── kb list / kb links   # deterministic views
              └── kb search            # local derived QMD index
```

Markdown is the authority in this map. The catalog, backlink view, and semantic database can all be deleted and rebuilt. Obsidian can browse the same files, but it is a compatible editor rather than a runtime dependency. Git supplies history, review, and recovery for the records that agents edit.

### Several systems converged on durable agent memory

This design direction did not begin with one recent proposal. Cognition's [2024 Devin release history](<https://docs.devin.ai/release-notes/2024>) described Knowledge that Devin could recall across future sessions by September 2024 and automatic Repo Knowledge from repository scans by November. On April 3, 2025, [Devin 2.0 introduced Devin Wiki and Devin Search](<https://cognition.com/blog/devin-2>). Cognition then launched the public [DeepWiki service on May 5](<https://cognition.com/blog/deepwiki>), followed on May 22 by a [DeepWiki Model Context Protocol server](<https://cognition.com/blog/deepwiki-mcp-server>) for programmatic retrieval. Those products are codebase-oriented and managed by Cognition, but the chronology matters: they predate the later public LLM-wiki discussion.

In April 2026, Andrej Karpathy published an [LLM Wiki proposal](<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>) with three layers: raw sources, an agent-maintained Markdown wiki, and an instruction schema. Its operations are ingest, query, and lint, with QMD suggested when the collection outgrows an index file. CCLRTE/kb is not an implementation of Cognition's products, and the similar pieces do not establish direct lineage. They show convergence on the same pressure: useful reasoning must become a durable artifact before a session ends.

### Keep the substrate boring and portable

A knowledge base earns trust differently from a chat transcript. Its records need stable paths, reviewable changes, and a format that remains legible when the current agent is gone. Plain Markdown and YAML frontmatter meet that bar with little codebase coupling. The application being developed does not depend on the knowledge-base package, and the vault does not need to know which agent will read it next.

The directory names encode only a few distinctions that affect editing authority. Captured articles preserve what a source said. Notes hold current synthesis and may change as evidence changes. Plans record intended work and its outcome. Riffs preserve a speaker's claims and uncertainty. A different domain can add its own directories and frontmatter without changing the graph or search model.

This low level of opinion has a practical payoff. An agent can start with `index.md`, use standard file tools, or ignore the CLI entirely. Another agent can use the package's commands and skills. Neither path requires a hosted database, a proprietary document format, or knowledge-base hooks inside production code. Optional indexes accelerate retrieval; they do not become another source of truth.

### Make ingestion an auditable write path

Durable memory starts with a reliable way to acquire evidence. `kb clip` can read a public URL, saved HTML, a rendered page, or the page already open in a signed-in browser. The [capture documentation](<https://github.com/CCLRTE/kb/blob/main/docs/capture.md>) defines layered extraction routes for ordinary pages and specialized surfaces. Each route reports what it actually obtained rather than treating any nonempty response as a complete capture.

When the useful page is already visible, `kb clip current --browser-live` reads the active tab through the attached browser session. `kb clip current --cdp 9222` uses a browser's Chrome DevTools Protocol port instead. Both use the authentication already present on the machine and read the current document without navigating it. For ingestion, this is the programmatic equivalent of Save Page. A new source surface needs an extractor, representative fixtures, or the generic rendered-page path; it does not need an action API.

A capture produces readable Markdown beside `capture.json` and any localized assets. The manifest records the source URL, attempted routes, chosen extractor, completeness state, counts, warnings, and artifact hashes. “Complete” refers to the selected bounded representation, not every hidden branch of a service or a future version of the page. Bundle installation is atomic, so an interrupted write does not leave a source record that only looks finished.

Media follows the same evidence rule. Images from ordinary pages, X, LinkedIn, and other rendered surfaces are localized into the bundle, while exposed video posters remain inspectable without downloading the full video. A normal YouTube capture adds available title, description, duration, channel, thumbnail, and transcript context; full audio or video remains an explicit opt-in.

Local PDFs use the same durable bundle idea without pretending a file is a URL. `kb pdf` keeps the original PDF byte-for-byte, infers headings from native layout, extracts every embedded image, and uses local OCR for scans and screenshots. Text-bearing images become inspectable Markdown with page and geometry metadata while the source image remains available; primarily visual images stay embedded. This matters for hybrid documents such as exported reports whose later pages are really Slack messages, diagrams, or photographs.

The bundle is evidence, not the final interpretation. A maintained note can cite several captures, record disagreement, and change when later evidence warrants it. The captures stay available for audit. This source-versus-synthesis boundary prevents an agent from silently replacing what a page said with what the agent now believes it meant.

### Use structure before semantic guesswork

Some retrieval questions have exact answers. Frontmatter values such as `type`, `status`, `area`, dates, aliases, and tags are parsed into bounded scalar, list, and nested-object values. `kb list` can filter repeated fields with AND semantics, match tags case-insensitively, follow dotted metadata paths, and sort with a stable path tie-breaker. The parser makes these queries deterministic; it does not impose one domain schema on every vault.

Links answer a different exact question: which relationships did an author state? Vault-root wikilinks are contextual edges. The scanner resolves them by path, title, or alias and reports broken or ambiguous targets rather than guessing. Backlinks reverse resolved links at read time. Generated catalog links in `index.md` do not count as context, and a title mentioned in prose is only a review candidate until an author links it.

**Exact metadata filtering and bounded link traversal**

```shell
kb list --root . --where type=plan --where status=in-progress --tag browser --sort area --order asc --json
kb links plans/browser-ingestion --root . --direction both --depth 2 --limit 25 --json
```

The first command finds active browser plans in a reproducible order. The second walks both incoming and outgoing contextual links for at most two hops and 25 notes. Depth is explicit, cycles are handled, the default result cap is 50 notes, and the traversal never expands through semantic similarity. This bounded traversal lets an agent gather nearby decisions without pulling the whole vault into context.

### Let semantic search find language, not truth

Exact structure cannot find a note whose author used an unexpected phrase. For that lane, CCLRTE/kb embeds [QMD, a local search engine for Markdown](<https://github.com/tobi/qmd>). `kb search` defaults to QMD's vector-only search path. It uses the recommended English-optimized `embeddinggemma-300M-Q8_0` model, roughly a 300 MB download, without loading QMD's query-expansion or reranking models. The model and index stay local.

**Prewarm the local index and search by meaning**

```shell
kb index --root .
kb search "why current-tab capture does not navigate" --root . --json
```

`kb index` builds or incrementally refreshes the derived database. `kb search` also checks for changed Markdown before searching, then joins each hit back to its authored metadata, tags, backlinks, and contextual edge counts. The database lives in a local cache outside the vault and can be rebuilt from the files. Keyword BM25 search remains available with `--mode keyword` when exact terms are a better fit.

A vector score means that two passages occupy a nearby region in an embedding model's representation. It does not mean the passage is current, correct, or supported by its sources. An agent should use semantic results to discover candidate notes, metadata to narrow them, links to inspect stated relationships, and the Markdown plus cited captures to verify the answer.

### Write plans and operating rules back into the vault

A plan shown only in chat has the same session boundary as the reasoning that produced it. The package's `plan-kb` skill writes the plan as a normal file with an outcome, status, area, assumptions, dependencies, decisions, and a verification method. During execution, the same file accumulates deviations, review findings, command evidence, and the final result. Completed plans remain as history; current operating truth moves into code, documentation, or maintained notes.

CCLRTE/kb ships five Agent Skills with the installed package. `save-url-kb` selects an acquisition route and records completeness. `save-pdf-kb` turns local PDFs into Markdown while preserving native text, image text, visual assets, and file provenance. `query-kb` chooses among exact metadata, graph traversal, and semantic search. `refresh-kb` regenerates the catalog and reviews link diagnostics without manufacturing edges. `plan-kb` keeps execution knowledge durable. Their shared `-kb` suffix makes the skill family easy to scan and invoke consistently. The [agent workflow documentation](<https://github.com/CCLRTE/kb/blob/main/docs/agent-workflow.md>) defines how those skills meet the same CLI contracts across agent runners.

### Adopt the parts that prevent repeated rediscovery

A small vault may need only Markdown, Git, an index, and ordinary file search. Add deterministic metadata queries when filenames stop answering exact questions. Add link traversal when relationships matter. Add QMD when vocabulary drift makes exact search miss useful notes. Add browser clipping when important evidence lives on signed-in or rendered surfaces. Add PDF ingestion when documents mix native text, scans, screenshots, and visual evidence. Each layer is optional because the lower layer remains readable on its own.

The limits are equally modular. Capture records what a selected surface exposed; it does not decide whether the source deserves trust. A wikilink records a relationship, not agreement. Metadata encodes an author's classification, not an objective fact. Semantic similarity supplies candidates, not conclusions. The durable part is the inspectable record and the discipline of revising it. With those in place, the next coding agent can begin from maintained evidence and decisions instead of reconstructing them from a previous chat.
<!-- article:a-durable-knowledge-base-is-a-write-path:end -->

## Install

[Bun](https://bun.sh/docs/installation) is the required runtime.

Install the CLI from the immutable `v0.3.2` tag:

```sh
bun add --global github:CCLRTE/kb#v0.3.2
kb --help
```

For programmatic use, declare the same pinned source in a project:

```json
{
  "dependencies": {
    "@cclrte/kb": "github:CCLRTE/kb#v0.3.2"
  }
}
```

Contributors can install from a checkout instead:

```sh
git clone https://github.com/CCLRTE/kb.git
cd kb
bun install --frozen-lockfile
bun link
kb --help
```

HTTP capture works with the installed JavaScript dependencies. Rendered capture additionally needs a local Chromium-compatible browser. [yt-dlp](https://github.com/yt-dlp/yt-dlp) adds YouTube metadata, thumbnails, and transcripts; full audio or video localization is opt-in and some formats also need [FFmpeg](https://ffmpeg.org). PDF ingestion uses the open-source Poppler tools `pdfinfo` and `pdftohtml`; [Tesseract](https://github.com/tesseract-ocr/tesseract) adds local OCR for scans and screenshots.

Semantic search uses [QMD](https://github.com/tobi/qmd) and its recommended compact local EmbeddingGemma model. The first `kb index` or semantic `kb search` downloads the model (about 300 MB); keyword search and every structural command work without it.

## Start a vault

```sh
kb init my-kb
cd my-kb
kb clip https://example.com/article --output articles
kb refresh --root .
kb check --root .
```

`kb init` creates an `index.md` front door plus `articles/`, `notes/`, `plans/`, and `riffs/` boundaries. The generated Markdown remains ordinary Markdown: open it in Obsidian, edit it in a text editor, search it with standard tools, and version it with Git.

## Command surface

| Command | Purpose |
| --- | --- |
| `kb init [directory]` | Create a new vault without merging into or overwriting an existing path; the default directory is `kb`. |
| `kb clip <url\|current>` | Capture a source and write an article bundle. `current` reads an attached active tab without navigating it; `kb capture <url>` is the explicit URL form. |
| `kb inspect <url>` | Run acquisition and extraction without writing a bundle. |
| `kb pdf <file> [--slug <slug>]` | Convert a local PDF into Markdown while retaining the original file, extracted images, OCR-derived text, and page provenance. |
| `kb refresh --root <directory>` | Rebuild the managed catalog atomically and report graph findings. |
| `kb check --root <directory>` | Verify that the catalog is current and that graph policy passes without changing files. |
| `kb graph --root <directory>` | Print the resolved contextual graph, broken or ambiguous links, orphans, and advisory mention candidates. |
| `kb backlinks <note> --root <directory>` | Show incoming contextual links for a note resolved by path, title, or alias. |
| `kb links <note> --root <directory>` | Traverse incoming, outgoing, or bidirectional contextual links with explicit depth and node limits. |
| `kb list --root <directory>` | Filter typed, nested frontmatter and tags; sort by metadata, title, path, or graph counts. `kb notes` is an alias. |
| `kb index --root <directory>` | Build or incrementally refresh the optional local QMD embedding index. |
| `kb search <query> --root <directory>` | Search locally by semantic similarity, or use `--mode keyword` for full-text retrieval. |
| `kb doctor` | Report required and optional local capture capabilities. |
| `kb adapters` | Print the installed platform capability matrix. |

Vault commands default to the current directory and `index.md`; use `--root` and `--index` to select alternatives. Commands that report structured data accept `--json`. Run `kb --help` for the complete top-level surface and `kb clip --help` for capture, authentication, evidence, and resource-bound options.

## Capture reference

Use the current browser tab without navigating it:

```sh
kb clip current --browser-live --output articles
kb clip current --cdp 9222 --output articles
```

For `--browser-live`, first enable Chrome's local debugging connection at `chrome://inspect/#remote-debugging` (Chrome 144+). If Chrome was launched with an explicit loopback debugging port, pass that numeric port to `--cdp` instead.

To open a URL with state from a path-backed Chromium profile, pass its path. The capture runs against a temporary copy, leaving the source profile unchanged. A named profile selects reusable agent-browser-managed state instead:

```sh
kb clip https://example.com/private --browser-profile <path> --output articles
```

Each web capture writes readable Markdown, `capture.json`, localized assets, and optional evidence under `articles/<slug>/`. Unless media is disabled, YouTube captures add the title, description, duration, channel, thumbnail, and a locally extracted transcript when available; other video surfaces retain a poster or thumbnail instead of downloading the video by default. See [Capture web content](docs/capture.md) for scopes, saved files, browser modes, media, evidence, completeness states, and limits.

PDF capture uses the same bundle boundary:

```sh
kb pdf "/absolute/path/to/document.pdf" --output articles
```

The bundle includes byte-identical `source.pdf`, readable Markdown, `capture.json`, and content-addressed extracted images. A reviewed second pass also retains its hash-bound `annotations.json`. See [Capture PDF documents](docs/pdf.md) for heading inference, OCR, screenshot metadata, completeness, and review.

## Graph reference

Vault-root wikilinks such as `[[notes/context-engineering|context engineering]]` are the graph's source of truth. `kb graph`, `kb backlinks`, and `kb links` derive relationships without injecting reciprocal links into authored notes. `kb refresh` owns only the marked catalog block in `index.md`; `kb check` verifies the same state without writing.

Frontmatter retains nested objects, arrays, finite numbers with safe integer precision, booleans, strings, and nulls. `kb list --where type=plan --tag ingestion --sort metadata.updated --order desc` answers exact questions from that authored data. Unquoted `true`, `false`, `null`, and numeric filter values are typed; keep the quotes inside the argument to match a string with the same spelling, for example `kb list --where 'external_id="9007199254740993"'`. QMD search is a discovery layer: each match is joined back to the live metadata and graph view, and similarity never becomes a link automatically.

The package exports its full programmatic surface from `@cclrte/kb`; focused entry points from `@cclrte/kb/graph`, `@cclrte/kb/navigation`, `@cclrte/kb/query`, and `@cclrte/kb/semantic`; web-capture orchestration and diagnostics from `@cclrte/kb/capture`; PDF ingestion from `@cclrte/kb/pdf`; and reusable disposable-profile helpers from `@cclrte/kb/browser-profiles`. Embedders that need the CLI's lower-level ingestion machinery can use the explicit capture-primitive subpaths listed in `package.json`, including `@cclrte/kb/clip/acquire`, `@cclrte/kb/clip/args`, and `@cclrte/kb/clip/network-proxy`.

## Agent skills

The repository and packed package ship five reusable Agent Skills under `skills/`: `save-url-kb` for auditable web ingestion, `save-pdf-kb` for local PDF conversion, `refresh-kb` for graph maintenance, `query-kb` for choosing exact, structural, keyword, or semantic retrieval, and `plan-kb` for creating and growing durable implementation plans. Copy or link a skill directory into the location used by your agent runner. They invoke the installed `kb` command and do not depend on a repository checkout path.

See [Design](docs/design.md), [Agent workflow](docs/agent-workflow.md), [PDF capture](docs/pdf.md), and [Contributing](CONTRIBUTING.md) for the durable contracts and development gate. CCLRTE/kb is available under the [MIT License](LICENSE).
