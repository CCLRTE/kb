---
name: refresh-kb
description: Refresh and validate a hraness/kb Markdown vault after notes are added, renamed, moved, or materially revised. Use when an agent needs to update the managed catalog, inspect broken or ambiguous wikilinks, review contextual orphans and unlinked title or alias mentions, repair high-confidence semantic connections, or complete a vault health check.
---

# Refresh a knowledge base

Use a refresh-review-check loop. Keep authored prose under deliberate editorial control; only the marked catalog region is tool-owned.

## 1. Locate the vault

- Resolve `<vault>` to the directory containing the managed `index.md`, then
  set the shell-local `KB_ROOT` to that path (`KB_ROOT=kb` from a typical
  repository root, or `KB_ROOT=.` from inside the vault).
- Read the vault's applicable agent instructions and note conventions before editing.
- Preserve note voice, frontmatter, filenames, and link intent unless a reported finding justifies a specific change.

## 2. Refresh the managed catalog

Run:

```sh
kb refresh --root "$KB_ROOT"
```

This command atomically updates only the marked catalog region in `index.md` and reports graph findings. Catalog links are navigation, so they do not count as contextual graph edges.

## 3. Review the advisories

Open every reported source line and the relevant target notes before deciding whether to edit.

- Repair a broken wikilink only when its intended target is clear. Otherwise, report the uncertainty.
- Disambiguate a wikilink with a vault-root path only after confirming the author's intent.
- Treat a contextual orphan as a prompt to inspect the note, not as a demand to add a link.
- Treat an unlinked title or alias mention as a candidate, not proof that the sentence should link.
- Add a contextual wikilink only when it improves the meaning or navigation of the sentence.

Backlinks are derived from explicit contextual wikilinks, and mention candidates are derived analysis. Never inject reciprocal links or generated backlink sections to improve graph counts. Never mutate authored prose automatically or apply link suggestions mechanically in bulk.

Intentional orphans and unlinked mentions may remain. Record the reason instead of manufacturing a connection.

## 4. Re-refresh and check

After any note or link edit, run the refresh command again so the catalog and advisories reflect the final content. Then run the read-only gate:

```sh
kb check --root "$KB_ROOT"
```

Finish only when the check succeeds, the managed catalog is current, and broken or ambiguous links are resolved. Summarize deliberate link edits and any advisories intentionally left in place.
