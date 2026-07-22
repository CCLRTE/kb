# Platform routing

Use the strongest stable and permitted lane. Every lane is bounded by item, depth, time, HTML, per-asset, and aggregate-asset limits.

| Surface | Preferred route | Conversation behavior | Honest limit |
| --- | --- | --- | --- |
| Generic articles and papers | HTTP + Defuddle; rendered browser fallback | Page content only unless the site exposes comments in the article DOM | JavaScript-only or unusual layouts can remain partial |
| X | Defuddle X extractor plus rendered `read`; explicit signed-in profile for loaded replies | Preserves the main post, quoted post, visible metrics, media, and loaded replies | Declared but unloaded replies make the result `partial`; no private GraphQL client runs automatically |
| Substack | HTTP + Defuddle; signed-in render for user-entitled subscriber text | Article plus a separately rendered, unstructured visible conversation context | Comments remain `partial` with conservative counts; email/app-only or virtualized comments may be absent |
| Hacker News | Official Firebase item API | Recursively preserves ordered comments, deleted/dead nodes, cycles, and limits | Bounds are explicit in the manifest |
| Bluesky | Public AT Protocol handle resolution and `getPostThread` | Preserves parents, replies, blocks/not-found nodes, quotes, images, video, and links | Moderation/unavailable records are represented as exposed by the service |
| Reddit | Best-effort public `.json` listing, then rendered page + Defuddle | Preserves bounded nesting, deletion markers, and `more`/pagination boundaries | The unofficial JSON surface may rate-limit or disappear; failures fall back and incomplete branches remain `partial` |
| Instagram / Facebook | Generic authorized rendered page or saved HTML; yt-dlp for accessible media | Loaded caption plus separately rendered conversation context | No dedicated item adapter; login, audience, region, markup, virtualization, and lazy-load gates remain explicit |
| LinkedIn | Generic authorized rendered page or saved HTML | Loaded post/article and comments only | No dedicated adapter or automated private API derivation; UI and policy restrictions can limit capture |
| TikTok | Generic rendered page or saved HTML; yt-dlp for accessible media | Loaded caption plus separately rendered conversation context | No dedicated thread adapter; region/login gates, virtualization, access controls, and DRM are not bypassed |
| Paywalled sites | Public preview, then a session already entitled to view the page | Whatever that authorized page renders | Never bypass a paywall, CAPTCHA, login, DRM, or access control |

Use `kb adapters --json` when software needs the current matrix. Treat platform markup and endpoints as unstable: a successful fallback does not upgrade a partial tree to complete unless declared counts, cursors, and boundaries agree.

For foreign structured data, parse from `unknown`. Keep missing, deleted, blocked, cyclic, depth-limited, item-limited, and pagination-boundary nodes visible instead of dropping them.
