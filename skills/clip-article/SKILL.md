---
name: clip-article
description: >-
  Capture web content into a local Markdown knowledge base as auditable bundles
  with local assets. Use when the user asks to clip, scrape, save, or archive
  an article, social post or thread, discussion, subscriber page they can
  access, or rendered browser page. Supports public APIs, bounded HTTP,
  explicit signed-in browser state, saved HTML, media, evidence, and honest
  completeness reporting.
---

# Capture web content

Check the installed capture surface before using browser state or optional media tools:

```sh
kb doctor
kb adapters
```

Use the layered default first:

```sh
kb clip https://example.com/article
```

The command tries stable structured APIs, bounded HTTP extraction, and a rendered browser when the platform or result needs it. By default it writes an atomic bundle under `kb/articles/<slug>/` containing `<slug>.md`, `capture.json`, and any localized assets.

Inspect without writing:

```sh
kb inspect https://example.com/article
kb inspect https://example.com/article --json
```

## Use authenticated state deliberately

Use signed-in state only when public capture is incomplete or access-gated. Set path variables to private absolute paths outside the repository before running these examples.

```sh
kb clip https://example.com/member/article --browser-profile "$KB_CAPTURE_PROFILE"
kb clip https://example.com/member/article --cookie-source chrome --cookie-profile "Default"
kb clip https://example.com/member/article --cookie-source firefox --cookie-profile "work"
kb clip https://example.com/member/article --cookies-file "$KB_COOKIES_FILE"
kb clip https://example.com/member/article --browser-live --trust-attached-browser-egress
kb clip https://example.com/member/article --cdp 9222 --trust-attached-browser-egress
```

Select at most one browser session (`--browser-profile`, `--browser-live`, or `--cdp`) and at most one cookie input (`--cookie-source` or `--cookies-file`). A browser session may be combined with one cookie input when later image or media downloads also need authentication, because attached browser state is not exported.

Cookie capture is request-filtered and retained in memory. Owned fresh sessions preserve each validated cookie's host or domain, path, `Secure`, `HttpOnly`, `SameSite`, and expiry attributes. Cookie values travel to the browser helper over stdin, not process arguments. Attribute-less Cookie and cURL inputs are narrowed to the exact host and target path, made `Secure` on HTTPS, defaulted to `HttpOnly` and `SameSite=Strict`, and reported with a warning.

Prefer a dedicated per-site profile. A broad personal profile can expose unrelated signed-in state to target-controlled subresources. A path-backed persistent profile can also be changed by page activity.

Owned browser sessions run through a loopback filtering proxy that validates and pins DNS for every request. Attached `--browser-live` and `--cdp` sessions use an existing browser network stack and therefore require `--trust-attached-browser-egress`. They navigate, click eligible disclosure controls, and scroll the active tab. This acknowledgement does not enable private-network access in controlled HTTP, browser, asset, structured-data, or media lanes. `--allow-private-network` is a separate, broad opt-in.

Never probe cookie stores merely to discover capabilities. Read [references/authentication.md](references/authentication.md) before using signed-in state, subscriber content, screenshots, or HAR-derived clients.

## Import saved HTML

For a page already rendered in any browser, save its HTML and import it without browser automation:

```sh
kb clip https://example.com/article --html "$KB_SAVED_HTML"
kb clip https://example.com/article --html - < page.html
```

## Choose scope and artifacts

```sh
kb clip https://example.com/post --scope page
kb clip https://example.com/post --scope thread
kb clip https://example.com/post --media none
kb clip https://example.com/post --media all
kb clip https://example.com/post --evidence source
kb clip https://example.com/post --evidence all
kb clip https://example.com/post --output "$KB_CAPTURE_OUTPUT"
kb clip https://example.com/post --force
```

`--media all` uses yt-dlp only for accessible, non-DRM media and routes its downloader through the same DNS-pinning proxy. Source evidence is sanitized into inert HTML with credential-shaped values redacted. Screenshots are viewport-only pixels; they are not structurally sanitized and may contain private information. A bundle accepts a screenshot only from the acquisition candidate whose text was selected.

Raw authenticated DOM, cookie files, browser state, and HAR files must never enter a capture bundle or repository.

## Report completeness literally

Read [references/platforms.md](references/platforms.md) when selecting a platform route. Use `kb adapters --json` when software needs the current capability matrix.

Interpret `complete`, `partial`, `auth-required`, `blocked`, and `unsupported` literally. A useful `partial` capture exits successfully, but its warnings and expected-versus-captured counts remain part of the result. Virtualized, collapsed, unloaded, paginated, or otherwise unstructured replies stay `partial`, often with `capturedItems: 0` even when visible prose was retained.

For page scope, item counts cover primary entries. For thread and comment scopes, they cover replies or comments and exclude the root, quotes, ancestors, and pagination markers. `--timeout-ms` applies independently to each request, process, or extraction operation rather than to the entire multi-lane capture.

Visible gate heuristics do not establish permission. Capture only public content or content the user is entitled and permitted to automate. Do not bypass login, paywall, CAPTCHA, rate-limit, DRM, audience, or platform-policy controls.

## Review the bundle

After writing a clip:

1. Compare the Markdown, quoted context, item counts, warnings, and asset list with the source.
2. Inspect large or surprising assets and every requested evidence artifact.
3. Run the knowledge base's normal refresh and check commands if the new note participates in its graph.

When changing capture behavior, run the public repository check and a live capture of public, non-sensitive content. Never use private accounts or credential-bearing fixtures in tests.
