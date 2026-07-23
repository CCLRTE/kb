---
name: query-kb
description: Search and navigate a CCLRTE/kb Markdown vault using local semantic retrieval, exact frontmatter and tag filters, deterministic sorting, backlinks, and graph relationships. Use when an agent needs to find prior knowledge, plans, captures, decisions, related notes, or evidence before answering, planning, or changing code.
---

# Query the knowledge base

Use the cheapest precise view first, then broaden. Markdown files remain the
authority; search scores, metadata rows, and graph results are derived views.

## Locate the vault

- Resolve `<vault>` to the directory containing the managed `index.md`, then
  set the shell-local `KB_ROOT` to that path (`KB_ROOT=kb` from a typical
  repository root, or `KB_ROOT=.` from inside the vault).
- Read the vault's applicable agent instructions and note conventions.
- Pass the resolved path to every `--root`; do not scan a repository root merely
  because that is where the agent session started.

## Choose the retrieval lane

- Known frontmatter field or tag such as type, status, or area: use `kb list`.
- Known note title, path, or alias: use `kb links` or `kb backlinks`, which
  resolve note identities before returning authored relationships.
- Concept expressed with different vocabulary: use `kb search`.
- Broad orientation: read `index.md`, then follow the smallest useful link trail.

```sh
kb list --root "$KB_ROOT" --where type=plan --where status=in-progress --sort area --json
kb list --root "$KB_ROOT" --tag retrieval --sort title --json
kb backlinks "Plan title or path" --root "$KB_ROOT" --json
kb links "Plan title or path" --root "$KB_ROOT" --direction both --depth 1 --limit 25 --json
kb search "why browser capture uses the current tab" --root "$KB_ROOT" --json
```

Repeated filters use AND semantics. Metadata paths may be dotted. String and
tag comparisons are case-insensitive; array metadata matches by membership.
Missing sort values come last, with path as the deterministic tie-breaker.
`--where` addresses authored frontmatter only; it does not filter derived H1
titles or file paths. Unquoted `true`, `false`, `null`, and numeric filter
values are typed. Keep quotes inside the argument to match a string with the
same spelling, for example `--where 'external_id="9007199254740993"'`.

## Use semantic search as discovery

`kb search` incrementally updates a local QMD index and defaults to QMD's small
embedding-only model. The first semantic query downloads the model; later
queries reuse the local cache. Prewarm explicitly when useful:

```sh
kb index --root "$KB_ROOT"
```

Use `--mode keyword` for exact BM25 retrieval without loading an embedding
model. Treat semantic rank as a lead, not a fact. Open the returned Markdown,
read enough surrounding context, and confirm claims against linked sources or
capture manifests.

## Combine meaning with structure

1. Use semantic search to discover candidate identities.
2. Use `kb list` to narrow by authored metadata such as `type`, `status`,
   `area`, or `tags`.
3. Use `kb links` at depth 1 to inspect immediate explicit relationships and
   `kb backlinks` for a focused inbound view. Increase depth only when the
   first neighborhood is insufficient. Traversal defaults to 50 notes and
   reports truncation; lower `--limit` for tighter agent context or raise it
   deliberately when a high-degree hub is genuinely relevant.
4. Read the authoritative notes and cited captures before synthesizing.

A title match may identify a prerequisite, prior version, or supporting note
rather than the artifact that owns the current outcome. Confirm status and
ownership in the candidate Markdown before answering or editing it.

Do not infer an edge from semantic similarity, or a conclusion from a tag. Do
not write generated backlink sections into notes. If the query exposes stale
metadata or a broken link, repair the authored Markdown and finish with
`kb refresh --root "$KB_ROOT"` and `kb check --root "$KB_ROOT"`.
