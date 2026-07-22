# Capture web content

`kb clip` saves public or user-entitled web content as an auditable Markdown bundle. It combines bounded structured adapters, HTTP extraction, optional browser rendering, localized assets, and explicit completeness metadata.

## Check local capabilities

Run the diagnostics before using browser state or optional media capture:

```sh
kb doctor
kb adapters
```

`kb doctor --json` reports the installed runtime, extraction dependencies, browser support, profile display names, yt-dlp, and ffmpeg without reading cookie stores or the operating-system keychain. `kb adapters --json` returns the current platform capability matrix.

## Capture or inspect a page

```sh
kb clip https://example.com/article
kb inspect https://example.com/article
kb inspect https://example.com/article --json
```

The default route tries stable public structured data when available, bounded HTTP extraction, and a rendered browser when the platform or result requires one. Inspection returns the selected Markdown and capture report without writing artifacts.

By default, a capture writes `kb/articles/<slug>/`:

```text
<slug>/
  <slug>.md
  capture.json
  assets/
  evidence/       # only when requested
```

The Markdown records source and capture metadata. `capture.json` records the acquisition attempts, selected extractor, scope, status, item counts, warnings, asset hashes, and requested artifact outcomes. Writes stage beside the target and install with an atomic rename. `--force` replaces only a compatible clip-owned bundle and restores the previous bundle if installation fails.

Set `KB_CLIP_OUTPUT` to change the default output root, or pass `--output <directory>` for one command. Set `KB_CLIP_USER_AGENT` or pass `--user-agent <value>` to override the default request user agent.

## Select acquisition and scope

```sh
kb clip https://example.com/article --mode http
kb clip https://example.com/application --mode browser
kb clip https://example.com/post --scope page
kb clip https://example.com/post --scope thread
kb clip https://example.com/discussion --scope comments
```

`auto` is the normal acquisition mode. `http` disables browser fallback. `browser` requires rendered state. Saved HTML can be imported without browser automation:

```sh
kb clip https://example.com/article --html "$KB_SAVED_HTML"
kb clip https://example.com/article --html - < page.html
```

Default resource bounds are 30 seconds per request, process, or extraction operation; 500 scoped items; depth 16; 25 MB of HTML; 100 MB per asset; and 500 MB across assets. Browser expansion also has fixed DOM, click, and scroll ceilings. Reaching a bound is recorded and can downgrade a result to `partial`.

## Capture images, media, and evidence

```sh
kb clip https://example.com/article --media none
kb clip https://example.com/article --media images
kb clip https://example.com/video --media all
kb clip https://example.com/article --evidence source
kb clip https://example.com/article --evidence screenshot
kb clip https://example.com/article --evidence all
```

Image downloads are signature-checked, content-addressed, byte-bounded, and rewritten to relative bundle paths. Failed images remain inert links. `--media all` invokes yt-dlp for accessible, non-DRM audio and video; ffmpeg may be required for merging or remuxing.

Source evidence is sanitized into inert HTML with credential-shaped values redacted and a deny-all content security policy. Screenshots are viewport-only pixels and are not structurally sanitized. They may contain private content or notifications, so review them before retaining or sharing a bundle.

## Use authenticated capture

Set path variables to private absolute paths outside the repository:

```sh
kb clip https://example.com/member/article --browser-profile "$KB_CAPTURE_PROFILE"
kb clip https://example.com/member/article --cookie-source chrome --cookie-profile "Default"
kb clip https://example.com/member/article --cookies-file "$KB_COOKIES_FILE"
```

Choose at most one browser session and one cookie input. A browser session may use a separate cookie input for later asset or media downloads because attached browser state is not exported.

Owned browser sessions run through a DNS-validating, address-pinning loopback proxy. Explicit cookies are filtered to matching request targets and kept in memory, except for a short-lived mode-`0600` yt-dlp jar. The CLI does not probe cookie stores unless the user selects one.

Live and CDP attachment use an existing browser network stack and mutate the active tab. They require a separate acknowledgement:

```sh
kb clip https://example.com/member/article --browser-live --trust-attached-browser-egress
kb clip https://example.com/member/article --cdp 9222 --trust-attached-browser-egress
```

The acknowledgement does not allow controlled capture lanes to reach private networks. `--allow-private-network` is a separate broad opt-in. It should remain off for ordinary web capture.

Never store cookie files, authorization values, browser profiles, raw authenticated DOM, or HARs in a bundle or repository. Capture only content the user is entitled and permitted to automate. The CLI does not bypass login, paywall, CAPTCHA, rate-limit, DRM, audience, or platform-policy controls.

## Interpret status and counts

Capture status is one of:

- `complete`: the selected bounded representation was acquired without a known missing boundary.
- `partial`: useful content was retained, but a count, cursor, configured bound, hidden branch, or generic rendered representation prevents a completeness claim.
- `auth-required`: the selected routes reached an authentication gate.
- `blocked`: the source returned a block or verification shell.
- `unsupported`: no route produced a usable representation.

For page scope, counts cover primary entries. For thread and comment scopes, counts cover replies or comments and exclude roots, quotes, ancestors, and pagination markers. Generic rendered conversations often report `capturedItems: 0` because visible prose does not prove a trustworthy per-item tree.

A `complete` or `partial` capture exits with status 0. Authentication, blocked, and unsupported outcomes use status 3. Argument errors use status 2, environment diagnostic failures use status 4, and operational errors use status 1. Automation should inspect the structured status and warnings rather than relying only on the process exit code.

## Platform routes

- Hacker News uses the official Firebase item API for bounded recursive discussions.
- Bluesky uses public AT Protocol resolution and thread APIs.
- Reddit first tries its unofficial public listing JSON and falls back when that surface is denied or changes.
- X uses article extraction plus rendered capture; unloaded or virtualized replies remain partial.
- Substack uses article extraction and an authorized browser for subscriber text when selected.
- Instagram, Facebook, LinkedIn, TikTok, and arbitrary applications use generic rendered or saved-HTML capture. They do not gain a trustworthy item tree without a dedicated adapter.

Platform markup and endpoints change. Run `kb adapters` for the installed version's current claims.
