# Working in a CCLRTE/kb vault

This guide gives coding agents a conservative workflow for reading and maintaining a vault. The Markdown is the durable record. Tool output, catalogs, backlinks, and mention candidates are views over that record.

## Orient before editing

1. Read `index.md` and the nearest `AGENTS.md` files.
2. Search filenames, frontmatter titles, aliases, and note text before creating a new identity.
3. Read the notes that already own the concept or source in question.
4. Use `kb graph --root .` or `kb backlinks <note> --root .` when an existing relationship is unclear.

Update an existing note when the identity is unambiguous. Create a new note when the subject has a distinct durable identity, not merely because a search phrase differs.

## Preserve authority boundaries

- Captured articles preserve what the source said and how it was acquired. Put later interpretation in a maintained note.
- Riffs preserve the speaker's first-person claims and uncertainty. Clean transcription noise without converting the riff into an essay by someone else.
- Maintained notes own synthesis, comparison, and current understanding.
- Plans own proposed work, decisions, execution state, and verification evidence.

Do not silently rewrite a capture to match a later conclusion. Link the source to the maintained interpretation instead.

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

Inspect an unfamiliar or sensitive source before writing it:

```sh
kb inspect https://example.com/article
kb inspect https://example.com/article --json
```

Capture only public content or content the user is entitled and permitted to automate:

```sh
kb clip https://example.com/article --output articles
```

Review the Markdown and `capture.json` together. Preserve the recorded status, warnings, counts, acquisition attempts, and artifact outcomes. `partial` is a useful result, not a defect to hide. Do not infer thread completeness from visible prose alone.

Never commit cookies, authorization values, browser profiles, raw authenticated DOM, HAR files, or unreviewed private screenshots. Select cookie stores or browser state only when the task requires them. Do not enable private-network access or attach to a live browser unless the user has explicitly chosen that boundary.

## Finish every change

After adding, renaming, moving, or materially revising notes:

```sh
kb refresh --root .
kb graph --root .
kb check --root .
```

Review broken and ambiguous links first. Then inspect orphans and high-confidence title or alias mentions in context. Add a suggested link only when it improves the prose. Finish with a clean `kb check` and inspect the resulting diff so the managed catalog is the only derived Markdown change.
