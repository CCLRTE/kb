# CCLRTE/kb

CCLRTE/kb is a local-first command-line tool for an Obsidian-compatible Markdown knowledge base. It keeps notes readable without the tool, derives a trustworthy link graph from explicit wikilinks, and captures web sources as auditable bundles instead of opaque blobs.

The CLI is Bun-first and deterministic. Graph maintenance does not require a model, an API key, a database, or a hosted service.

## Install

[Bun](https://bun.sh/docs/installation) is the required runtime.

Install the CLI from the immutable `v0.1.0` tag:

```sh
bun add --global github:CCLRTE/kb#v0.1.0
kb --help
```

For programmatic use, declare the same pinned source in a project:

```json
{
  "dependencies": {
    "@cclrte/kb": "github:CCLRTE/kb#v0.1.0"
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

HTTP capture works with the installed JavaScript dependencies. Rendered capture additionally needs a local Chromium-compatible browser. Full audio or video localization needs [yt-dlp](https://github.com/yt-dlp/yt-dlp), and some formats also need [FFmpeg](https://ffmpeg.org).

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
| `kb clip <url>` | Capture a source and write an article bundle. `kb capture <url>` is the explicit capture form. |
| `kb inspect <url>` | Run acquisition and extraction without writing a bundle. |
| `kb refresh --root <directory>` | Rebuild the managed catalog atomically and report graph findings. |
| `kb check --root <directory>` | Verify that the catalog is current and that graph policy passes without changing files. |
| `kb graph --root <directory>` | Print the resolved contextual graph, broken or ambiguous links, orphans, and advisory mention candidates. |
| `kb backlinks <note> --root <directory>` | Show incoming contextual links for a note resolved by path, title, or alias. |
| `kb doctor` | Report required and optional local capture capabilities. |
| `kb adapters` | Print the installed platform capability matrix. |

Vault commands default to the current directory and `index.md`; use `--root` and `--index` to select alternatives. Commands that report structured data accept `--json`. Run `kb --help` for the complete top-level surface and `kb clip --help` for capture, authentication, evidence, and resource-bound options.

## Capture as an auditable bundle

A capture is self-contained by default:

```text
articles/<slug>/
  <slug>.md
  capture.json
  assets/
  evidence/       # only when requested
```

The Markdown holds the readable capture. `capture.json` records acquisition attempts, the selected extraction route, requested scope, completeness status, item counts, warnings, asset hashes, and artifact outcomes. Assets are localized with byte limits and content checks. Writes stage beside the destination and install with an atomic rename.

Capture uses bounded structured adapters, HTTP extraction with [Defuddle](https://github.com/kepano/defuddle), and optional browser rendering with [agent-browser](https://github.com/vercel-labs/agent-browser). Explicit browser-cookie import uses CCLRTE's [pinned Sweet Cookie safety fork](https://github.com/CCLRTE/sweet-cookie), which preserves host-only scope and excludes partitioned or container-scoped state that cannot be replayed faithfully. See [Capture web content](docs/capture.md) for acquisition modes, authentication, media, evidence, status meanings, and resource limits.

## Links, backlinks, and refresh

Vault-root wikilinks such as `[[notes/context-engineering|context engineering]]` are the graph's source of truth. `kb` resolves links by path and can use unambiguous titles or aliases for lookup. Broken and ambiguous links remain diagnostics instead of being guessed into place.

Backlinks are derived data. `kb backlinks` and `kb graph` compute them from explicit links; the tool does not inject reciprocal links or backlink sections into source notes. Links in the managed catalog note (`index.md` by default) are navigation and do not count as contextual edges. Title and alias mentions are advisory candidates for a human to review, never automatic edits.

`kb refresh` owns only the marked catalog block in `index.md`. `kb check` performs the same scan without writing, which makes it suitable for CI.

## Safety boundaries

Every URL, redirect, response, browser page, cookie record, subprocess result, and filesystem path is treated as untrusted input. Controlled network lanes deny private and reserved addresses by default, validate DNS, pin accepted addresses, and enforce time, byte, item, and depth limits. Authenticated state is read only when explicitly selected and is not persisted into bundles.

Attached live-browser sessions use the browser's existing network stack and therefore require a separate acknowledgement. Screenshots are pixels, not sanitized documents, and can contain private information. Review authenticated captures and evidence before committing or sharing them.

Read [Security](SECURITY.md) before using authenticated capture or enabling private-network access. The tool does not bypass login, paywall, CAPTCHA, rate-limit, DRM, audience, or platform-policy controls.

## Design and contribution

- [Design](docs/design.md) explains the storage model, graph invariants, capture pipeline, and extension boundaries.
- [Agent workflow](docs/agent-workflow.md) gives coding agents a safe, repeatable vault workflow.
- [Contributing](CONTRIBUTING.md) covers tests, fixtures, compatibility, and the public repository gate.

The repository also ships two reusable Agent Skills under `skills/`: `clip-article` guides auditable capture and `refresh-kb` guides the refresh-review-check loop. Copy or link either directory into the skills location used by your agent runner; both invoke the installed `kb` command and do not depend on a repository checkout path.

The root package exports the deterministic graph, vault, and initialization boundaries for programmatic use. `@cclrte/kb/graph` is a smaller graph-only entrypoint, while `@cclrte/kb/capture` exposes the capture and diagnostic boundaries without loading them into graph-only consumers. Authored Markdown remains the compatibility surface even when another tool consumes those APIs.

CCLRTE/kb is available under the [MIT License](LICENSE).
