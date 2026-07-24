# Contributing

Issues and focused pull requests are welcome in the [hraness/kb repository](https://github.com/hraness/kb).

Open an issue before starting a broad command-surface, manifest-schema, adapter, or security-boundary change so compatibility and threat-model expectations can be agreed first.

Run the public repository gate before opening a pull request:

```sh
bun install --frozen-lockfile
bun run check
```

Keep changes platform-neutral unless the feature is explicitly capability-detected. Add a named regression test for every parser, path, network, credential, status, or rollback bug. Add property tests for laws over arbitrary input, including parsing, normalization, ordering, cardinality, and round trips.

Capture changes must preserve bounded time, bytes, item counts, depth, process output, filesystem paths, and cleanup. A fallback may retain useful content, but it must not upgrade an uncertain conversation to `complete`. Security-sensitive changes should include failure cases for private-network access, DNS rebinding, redirects, cookie scope, credential redaction, symlinks, and subprocess termination as applicable.

Use synthetic fixtures. Do not commit real cookies, browser profiles, HARs, authenticated HTML, private screenshots, signed URLs, or captured source material that the project cannot redistribute.

Keep runtime dependency versions deliberate. When changing Defuddle, agent-browser, Sweet Cookie, yt-dlp integration, or ffmpeg behavior, update diagnostics and test the installed command surface. Live verification must use public, non-sensitive content and must not depend on a personal account.

Metadata parsing and queries must preserve YAML value types and nested structure. Pair named examples with property tests for repeated-filter conjunction, normalized tags, stable ordering, missing values, and arbitrary metadata trees.

QMD is a derived search capability, not the storage layer. Keep it dynamically loaded so graph, metadata, and capture commands do not initialize its native runtime. Unit tests must inject a fake store and cover update, embed, search, result confinement, and close-on-failure behavior without downloading a model or using the network. When changing the pinned QMD version or model, also run a real local index-and-query smoke test and document any new system requirement.

Update public documentation when commands, defaults, status meanings, manifest fields, supported platforms, or security boundaries change.
