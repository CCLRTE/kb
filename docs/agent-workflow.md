# Working in a CCLRTE/kb vault

This guide gives coding agents a conservative workflow for reading and maintaining a vault. The Markdown is the durable record. Tool output, catalogs, backlinks, and mention candidates are views over that record.

## Orient before editing

1. Read `index.md` and the nearest `AGENTS.md` files.
2. Search filenames, frontmatter titles, aliases, and note text before creating a new identity.
3. Read the notes that already own the concept or source in question.
4. Use the narrowest view that answers the question:
   - `kb list` for exact frontmatter or tag filters.
   - `kb links <note>` or `kb backlinks <note>` for authored relationships.
   - `kb search` when the same idea may be expressed in different words.
   - `kb graph` for whole-vault diagnostics.

Update an existing note when the identity is unambiguous. Create a new note when the subject has a distinct durable identity, not merely because a search phrase differs.

## Query before reading broadly

Use typed metadata for exact selection and sorting:

```sh
kb list --where type=plan --where status=in-progress --sort metadata.updated --order desc
kb list --tag retrieval --sort inbound --order desc --json
```

Filters can address nested fields with dotted paths. Repeat `--where`, `--has`, or `--tag` to require every condition. Unquoted `true`, `false`, `null`, and numeric values are typed; retain inner quotes to select a string with the same spelling, as in `--where 'external_id="9007199254740993"'`. JSON output includes the live metadata, tags, backlinks, and inbound and outbound contextual counts for each result.

Use bounded traversal to understand explicit context around a note:

```sh
kb links plans/improve-ingestion --direction both --depth 2 --limit 25
```

Traversal defaults to at most 50 notes and reports when that cap truncates a high-degree neighborhood. Lower the limit for agent context discipline; raise it deliberately when the structural question requires a wider view.

Use semantic search for recall rather than exact selection:

```sh
kb search "capturing a signed-in virtualized page"
kb search "browser profile" --mode keyword
```

Semantic mode uses QMD's recommended compact local embedding model. The first semantic query downloads it and builds a local cache; subsequent queries incrementally index changed Markdown. `kb index` can prewarm that cache. Search results suggest what to read next—they do not create links or establish that a claim is correct.

## Preserve authority boundaries

- Captured articles preserve what the source said and how it was acquired. Put later interpretation in a maintained note.
- Riffs preserve the speaker's first-person claims and uncertainty. Clean transcription noise without converting the riff into an essay by someone else.
- Maintained notes own synthesis, comparison, and current understanding.
- Plans own proposed work, decisions, execution state, and verification evidence.

Do not silently rewrite a capture to match a later conclusion. Link the source to the maintained interpretation instead.

## Grow durable plans

Before creating a plan, use `kb list --where type=plan` and search the vault for an existing artifact that owns the outcome. Prefer extending that file to creating a parallel progress log.

A durable plan records an observable outcome, context, scope and non-goals, constraints, decisions, dependency-ordered work, verification, and recovery. Keep its frontmatter easy to query—at minimum `type: plan`, an area, and one status from `proposed`, `accepted`, `in-progress`, `blocked`, `completed`, `superseded`, or `cancelled`. Add dated findings, decisions, review evidence, and the final result to the same file as the work develops.

The packaged `write-plan` Agent Skill provides the complete authoring workflow. It treats a plan as a growing implementation record, not a disposable checklist or a directory of satellite status documents.

## Link for meaning

Use vault-root wikilinks without `.md`, for example:

```md
The capture strategy follows [[notes/bounded-acquisition|bounded acquisition]] so incomplete threads remain visible as incomplete.
```

Use ordinary Markdown links for external URLs. Add an internal link where the relationship helps a reader understand the sentence. Do not add bare reciprocal links, manufactured `Related` lists, or links whose only purpose is to improve graph counts.

Backlinks are derived from explicit wikilinks. Never paste generated backlink sections into notes. Catalog links in `index.md` are navigation and do not establish contextual relationships. Mention candidates are prompts for review, not instructions to edit.

## Capture a source

Check the local environment and the installed adapters before relying on optional capabilities:

```sh
kb doctor
kb adapters
```

Inspect an unfamiliar source before writing it:

```sh
kb inspect https://example.com/article
kb inspect https://example.com/article --json
```

Capture a URL or the page already open in the signed-in browser:

```sh
kb clip https://example.com/article --output articles
kb clip current --browser-live --output articles
```

Review the Markdown and `capture.json` together. Preserve the recorded status, warnings, counts, acquisition attempts, and artifact outcomes. `partial` is a useful result, not a defect to hide. Do not infer thread completeness from visible prose alone.

The capture command reads content and writes a local bundle. It does not post, like, follow, send, delete, or submit on the source service.

## Finish every change

After adding, renaming, moving, or materially revising notes:

```sh
kb refresh --root .
kb graph --root .
kb check --root .
```

Review broken and ambiguous links first. Then inspect orphans and high-confidence title or alias mentions in context. Add a suggested link only when it improves the prose. Finish with a clean `kb check` and inspect the resulting diff so the managed catalog is the only derived Markdown change.
