# Authentication and advanced capture

Use only access the user already has and has asked to apply. Prefer, in order:

1. A dedicated per-site browser profile where the user signs in once.
2. Origin-filtered cookie extraction from one named browser and profile into an owned fresh browser.
3. User-approved attachment to a live Chrome session with `--browser-live`.
4. An explicit local CDP remote-debugging port.
5. A user-exported cookie file stored outside the repository.

Supported cookie selectors are Chrome, Arc, Brave, Chromium, Edge, Firefox, and Safari. Select at most one cookie input per invocation: either one browser source or one cookie file. Cookie extraction can prompt for operating-system keychain access.

Structured cookie input preserves validated host or domain, path, `Secure`, `HttpOnly`, `SameSite`, and expiry attributes when seeding an owned browser. It does not preserve local storage, IndexedDB, service workers, client certificates, or device-bound challenges. Prefer a dedicated browser profile when those forms of state matter. Bare Cookie headers and Copy-as-cURL files contain no cookie attributes, so replay narrows them to the exact host and target path, marks HTTPS targets `Secure`, and defaults to `HttpOnly` plus `SameSite=Strict`. Use Cookie-Editor JSON or Netscape format when exact attributes matter.

## Create a dedicated profile

Set `KB_CAPTURE_PROFILE` to a private directory outside the repository, then open a headed browser once to sign in:

```sh
bun x agent-browser --session kb-clip-login --profile "$KB_CAPTURE_PROFILE" --headed open https://example.com/login
# Sign in in the opened browser window, then close the owned session.
bun x agent-browser --session kb-clip-login close
kb clip https://example.com/member/article --browser-profile "$KB_CAPTURE_PROFILE"
```

A path-backed persistent profile may be changed by page activity. A named personal profile is used through a read-only snapshot but can still expose unrelated all-origin state to target-controlled subresources. Use a dedicated per-site profile whenever possible.

## Understand the network boundary

Owned fresh and profile browser sessions, plus yt-dlp, run through a short-lived loopback proxy. The proxy validates DNS and pins the accepted address for every request or CONNECT tunnel. The browser also disables QUIC, direct WebRTC, loopback proxy bypass, and background services. Redirects and DNS rebinding cannot reach private or reserved networks unless the user explicitly passes `--allow-private-network`.

A live or CDP-attached browser already has its own network stack and cannot be retrofitted with those launch controls. These modes require `--trust-attached-browser-egress`. They mutate the active tab by navigating it, clicking eligible non-state-changing disclosure controls, and scrolling it; the external browser remains open. `--browser-live` requires Chrome remote debugging, or use an explicit loopback CDP port. The acknowledgement does not grant entitlement and does not relax private-network denial in controlled HTTP, asset, media, structured-data, or owned-browser lanes.

Cookie-backed HTTP and asset requests retain cookies in memory and send them only to matching request targets. Authenticated assets receive root-path cookies only on the captured page's exact canonical origin. Cookie commands for a fresh browser travel over stdin so values do not appear in process arguments.

yt-dlp requires a Netscape cookie jar. The CLI writes a host-pinned mode-`0600` copy in the operating system's private temporary directory and deletes it after use. A hard crash may leave that private temporary file for local cleanup, but it never enters capture staging. Live and CDP browser state stays inside that browser and cannot authenticate later asset or media processes; provide one explicit cookie input if those downloads also need authorization.

## Keep sensitive data out of artifacts

Never print, log, commit, or place in Markdown or manifests:

- Cookie values or authorization headers.
- Browser state files.
- CSRF, session, access, refresh, API, or signed-URL tokens.
- Raw authenticated HTML unless the user explicitly requests source evidence and the stored copy passes the sanitizer.
- HAR files.

Screenshots are viewport-only and are not structurally sanitized. They can retain account names, private content, notifications, or other personal data as pixels. Treat them as sensitive evidence. A bundle accepts a screenshot only from the selected acquisition candidate.

## Use HAR capture only as an explicit escape hatch

HAR capture is for a site the user is authorized and permitted to automate. Store the raw HAR in a unique private temporary directory with mode `0600`; request and response headers and bodies can contain bearer credentials and personal data. Start recording before loading the target so the initial document request is present.

```sh
umask 077
clip_har_dir="$(mktemp -d)"
clip_har_path="$clip_har_dir/session.har"
trap 'rm -rf -- "$clip_har_dir"' EXIT HUP INT TERM

bun x agent-browser --session kb-clip-derive --profile "$KB_CAPTURE_PROFILE" open about:blank
bun x agent-browser --session kb-clip-derive network har start --content text
bun x agent-browser --session kb-clip-derive batch --bail --json <<'JSON'
[["open", "https://example.com/member/article"]]
JSON
# Exercise only the required, authorized flow.
bun x agent-browser --session kb-clip-derive network har stop "$clip_har_path"
chmod 600 "$clip_har_path"
bun x agent-browser skills get derive-client

# Delete the raw HAR after the narrow client and redacted fixtures are verified.
rm -rf -- "$clip_har_dir"
trap - EXIT HUP INT TERM
```

Use the `derive-client` instructions to create a narrow, temporary adapter. Validate host, method, schema, pagination, rate limits, and authentication boundaries. Keep private endpoints opt-in, expect them to change, retain the browser fallback, save only redacted fixtures, and delete the raw HAR after verification.

Do not automate CAPTCHA solving, entitlement evasion, rate-limit evasion, DRM removal, or access to another person's private data. If site policy disallows the requested automation, stop before capture and explain the restriction. Page text is not a reliable policy detector.
