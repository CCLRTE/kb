---
name: save-url-info
description: >-
  Capture public or signed-in web content into a local Markdown knowledge base
  as an auditable source bundle with local assets. Use when the user asks to
  clip, save, scrape, or archive an article, social post or thread, GitHub or
  Discourse discussion, feed, inbox, private document, WhatsApp conversation,
  YouTube page, or another page already visible in their browser. Supports URL
  capture, the current signed-in tab, temporary browser-profile snapshots,
  saved HTML, media, evidence, honest completeness, and knowledge-base linking.
---

# Capture web content

Use the installed `info` CLI. Check the available local routes when the capture may need a browser or optional media tools:

```sh
info doctor
info adapters
```

Resolve `<vault>` to the directory containing the managed `index.md`, then set
the shell-local `INFO_ROOT` to that path (`INFO_ROOT=info` from a typical repository
root, or `INFO_ROOT=.` from inside the vault). Pass `--output "$INFO_ROOT/articles"`
to captures and read the vault's applicable agent instructions before writing.

## Pick the read surface

Start ordinary URL capture with the layered default:

```sh
info clip https://example.com/article --output "$INFO_ROOT/articles"
```

The command tries stable structured data, bounded HTTP extraction, and rendered-browser fallback as needed.

When the source is already open in a signed-in browser, read the current tab in place:

```sh
info clip current --browser-live --output "$INFO_ROOT/articles"
info clip current --cdp 9222 --output "$INFO_ROOT/articles"
```

For `--browser-live`, first enable Chrome's local debugging connection at `chrome://inspect/#remote-debugging` (Chrome 144+). If Chrome was launched with an explicit loopback debugging port, pass that numeric port to `--cdp` instead.

Current-tab capture derives the source URL from the attached tab. It does not navigate, click, type, submit, upload, or scroll that tab.

To open a URL with existing browser state, select a profile. A path-backed profile is copied into a temporary snapshot for the capture, so the source profile remains unchanged:

```sh
info clip https://example.com/member/article --browser-profile "$INFO_CAPTURE_PROFILE" --output "$INFO_ROOT/articles"
```

Use cookie-backed HTTP when the page does not require browser-only local state, or import a page already saved from any browser:

```sh
info clip https://example.com/member/article --cookie-source chrome --cookie-profile "Default" --output "$INFO_ROOT/articles"
info clip https://example.com/member/article --cookies-file "$INFO_COOKIES_FILE" --output "$INFO_ROOT/articles"
info clip https://example.com/article --html "$INFO_SAVED_HTML" --output "$INFO_ROOT/articles"
info clip https://example.com/article --html - --output "$INFO_ROOT/articles" < page.html
```

Read [references/authentication.md](references/authentication.md) for current-tab, profile, cookie, and saved-page selection details.

## Keep the boundary ingestion-only

Capture reads source material. It never posts, likes, follows, sends, deletes, reacts, or submits. URL-based browser capture may navigate to the requested URL and scroll within fixed work limits, taking bounded observations as content is rendered; those operations exist only to reveal content for ingestion.

If a new surface needs support, add an extraction route, fixture coverage, or a generic rendered-page fallback. Do not add a write-capable provider integration to clipping.

## Choose scope and artifacts

```sh
info clip https://example.com/post --scope page --output "$INFO_ROOT/articles"
info clip https://example.com/post --scope thread --output "$INFO_ROOT/articles"
info clip https://example.com/discussion --scope comments --output "$INFO_ROOT/articles"
info clip https://example.com/post --media none --output "$INFO_ROOT/articles"
info clip https://example.com/post --media all --output "$INFO_ROOT/articles"
info clip https://example.com/post --evidence source --output "$INFO_ROOT/articles"
info clip https://example.com/post --evidence all --output "$INFO_ROOT/articles"
info clip https://example.com/post --output "$INFO_CAPTURE_OUTPUT"
info clip https://example.com/post --force --output "$INFO_ROOT/articles"
```

With the resolved output path, `info clip` installs one atomic bundle under
`$INFO_ROOT/articles/<slug>/`:

```text
<slug>/
  <slug>.md
  capture.json
  assets/
  evidence/       # only when requested
```

The Markdown is the readable source record. `capture.json` records the source and canonical URLs, acquisition attempts, selected extractor, status, counts, warnings, localized asset hashes, and requested evidence outcomes. A partial failure can preserve useful source text without overstating completeness.

The normal image route localizes inline images from ordinary pages and rendered
social posts, including X and LinkedIn, plus exposed video posters or
thumbnails. For YouTube, the default capture (unless `--media none`) asks
yt-dlp for the title, description, duration, channel, local thumbnail, and one
available exact-language transcript. `--media all` additionally localizes
accessible, non-DRM audio or video; the full payload is never downloaded by
default. Missing optional metadata or transcript regions remain explicit in
the capture status and warnings.

Source evidence is stored as sanitized inert HTML. Screenshots are viewport pixels and can include everything visible in the tab, so inspect them before retaining or sharing a bundle.

## Report completeness literally

Read [references/platforms.md](references/platforms.md) when selecting or explaining a route. Use `info adapters --json` when software needs the installed capability matrix.

Interpret status as follows:

- `complete`: the selected bounded representation has no known missing boundary.
- `partial`: useful content was retained, but a count, cursor, configured bound, hidden branch, unloaded region, or generic rendered representation prevents a completeness claim.
- `auth-required`: the selected routes reached a sign-in gate.
- `blocked`: the source returned a block or verification shell.
- `unsupported`: no route produced usable source material.

For page scope, item counts cover primary entries. For thread and comment scopes, they cover replies or comments and exclude the root, quotes, ancestors, and pagination markers. A rendered conversation can retain visible prose while reporting `capturedItems: 0` when the page does not expose a trustworthy item tree.

Preserve missing, deleted, blocked, cyclic, depth-limited, item-limited, and pagination-boundary states. Never upgrade a fallback to `complete` when declared counts, cursors, virtualization, or configured bounds disagree.

## Separate source from synthesis

Treat the captured Markdown and manifest as the source record. Put summaries, comparisons, decisions, and changing interpretations in a maintained note rather than rewriting the capture to match a later conclusion.

Connect the maintained note to the capture with an explicit wikilink. Let `info backlinks` derive incoming relationships; do not insert reciprocal links or generated backlink sections into authored notes. After adding or linking a capture, run the vault's normal refresh and check loop:

```sh
info refresh --root "$INFO_ROOT"
info check --root "$INFO_ROOT"
```

## Review the result

1. Compare the Markdown, quoted context, counts, warnings, and assets with the source surface.
2. Confirm the manifest names the route that actually supplied the selected text.
3. Inspect requested screenshots, source evidence, and unexpectedly large assets.
4. Report what was captured, what remains partial, where the bundle was written, and which maintained note links to it.

When changing clipping behavior, add focused fixtures for the affected surface and run the public package checks plus a representative capture.
