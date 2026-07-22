/** URL classification and pure normalization for structured social captures. */

import { rewriteContent } from "./lib.js";

export type PlatformUrl =
  | { readonly platform: "x"; readonly href: string; readonly handle: string; readonly postId: string }
  | { readonly platform: "hacker-news"; readonly href: string; readonly itemId: string }
  | {
      readonly platform: "reddit";
      readonly href: string;
      readonly postId: string;
      readonly subreddit: string | null;
      readonly commentId: string | null;
    }
  | {
      readonly platform: "bluesky";
      readonly href: string;
      readonly actor: string;
      readonly postId: string;
    }
  | { readonly platform: "substack"; readonly href: string; readonly publication: string | null }
  | { readonly platform: "instagram"; readonly href: string; readonly contentId: string | null }
  | { readonly platform: "linkedin"; readonly href: string; readonly contentId: string | null }
  | { readonly platform: "facebook"; readonly href: string; readonly contentId: string | null }
  | { readonly platform: "tiktok"; readonly href: string; readonly contentId: string | null }
  | { readonly platform: "threads"; readonly href: string; readonly contentId: string | null }
  | { readonly platform: "whatsapp"; readonly href: string; readonly contentId: string | null }
  | { readonly platform: "youtube"; readonly href: string; readonly contentId: string | null }
  | { readonly platform: "generic"; readonly href: string; readonly host: string };

export type CapturedPlatform = "x" | "hacker-news" | "reddit" | "bluesky";
export type CapturedRole = "post" | "comment" | "quote";

export type CapturedAuthor = {
  readonly name: string;
  readonly handle: string | null;
  readonly profileUrl: string | null;
};

export type CapturedMedia = {
  readonly kind: "image" | "video" | "gif" | "link";
  readonly url: string;
  readonly previewUrl: string | null;
  readonly alt: string | null;
  readonly title: string | null;
  readonly dimensions: { readonly width: number; readonly height: number } | null;
};

export type CapturedMetrics = {
  readonly score: number | null;
  readonly replies: number | null;
  readonly likes: number | null;
  readonly reposts: number | null;
  readonly quotes: number | null;
};

export type CapturedContentEntry = {
  readonly kind: "content";
  readonly role: CapturedRole;
  readonly id: string;
  readonly author: CapturedAuthor | null;
  readonly createdAt: string | null;
  readonly sourceUrl: string | null;
  readonly text: string;
  readonly media: readonly CapturedMedia[];
  readonly metrics: CapturedMetrics;
  readonly quotes: readonly CapturedEntry[];
  readonly replies: readonly CapturedEntry[];
};

export type CapturedUnavailableEntry = {
  readonly kind: "unavailable";
  readonly role: CapturedRole;
  readonly id: string;
  readonly reason: "deleted" | "dead" | "removed" | "blocked" | "not-found";
  readonly sourceUrl: string | null;
  readonly replies: readonly CapturedEntry[];
};

export type CapturedMoreEntry = {
  readonly kind: "more";
  readonly id: string;
  readonly count: number | null;
  readonly childIds: readonly string[];
};

export type CapturedBoundaryEntry = {
  readonly kind: "boundary";
  readonly reason: "cycle" | "depth-limit" | "item-limit";
  readonly detail: string;
};

export type CapturedEntry =
  | CapturedContentEntry
  | CapturedUnavailableEntry
  | CapturedMoreEntry
  | CapturedBoundaryEntry;

export type NonEmptyEntries = readonly [CapturedEntry, ...CapturedEntry[]];

export type CapturedDocument = {
  readonly platform: CapturedPlatform;
  readonly sourceUrl: string;
  readonly title: string;
  readonly ancestors: readonly CapturedEntry[];
  readonly roots: NonEmptyEntries;
  readonly warnings: readonly string[];
};

export type CaptureError = {
  readonly code: "invalid-source" | "invalid-shape" | "missing-root";
  readonly message: string;
};

export type CaptureResult =
  | { readonly ok: true; readonly document: CapturedDocument }
  | { readonly ok: false; readonly error: CaptureError };

export type CaptureLimits = {
  readonly maxDepth: number;
  readonly maxItems: number;
  readonly maxTextLength: number;
  readonly maxMediaPerEntry: number;
};

export type CaptureOptions = {
  readonly limits?: Partial<CaptureLimits>;
};

export const DEFAULT_CAPTURE_LIMITS: CaptureLimits = {
  maxDepth: 24,
  maxItems: 1_000,
  maxTextLength: 100_000,
  maxMediaPerEntry: 32,
};

const HARD_CAPTURE_LIMITS: CaptureLimits = {
  maxDepth: 64,
  maxItems: 10_000,
  maxTextLength: 1_000_000,
  maxMediaPerEntry: 128,
};

type ParseContext = {
  readonly limits: CaptureLimits;
  usedItems: number;
  readonly warnings: string[];
};

const isUnknownArray = (value: unknown): value is unknown[] => Array.isArray(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !isUnknownArray(value);

const nonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const stringValue = (value: unknown): string | null => (typeof value === "string" ? value : null);

const booleanValue = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const safeInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

const signedSafeInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const foreignId = (value: unknown): string | null => {
  const text = nonEmptyString(value);
  if (text !== null) return text;
  const number = safeInteger(value);
  return number === null ? null : String(number);
};

const readRecord = (record: Record<string, unknown>, key: string): Record<string, unknown> | null => {
  const value = record[key];
  return isRecord(value) ? value : null;
};

const readArray = (record: Record<string, unknown>, key: string): readonly unknown[] | null => {
  const value = record[key];
  return isUnknownArray(value) ? value : null;
};

const clampLimit = (value: number | undefined, fallback: number, ceiling: number): number => {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value), ceiling));
};

const createContext = (options: CaptureOptions | undefined): ParseContext => ({
  limits: {
    maxDepth: clampLimit(
      options?.limits?.maxDepth,
      DEFAULT_CAPTURE_LIMITS.maxDepth,
      HARD_CAPTURE_LIMITS.maxDepth,
    ),
    maxItems: clampLimit(
      options?.limits?.maxItems,
      DEFAULT_CAPTURE_LIMITS.maxItems,
      HARD_CAPTURE_LIMITS.maxItems,
    ),
    maxTextLength: clampLimit(
      options?.limits?.maxTextLength,
      DEFAULT_CAPTURE_LIMITS.maxTextLength,
      HARD_CAPTURE_LIMITS.maxTextLength,
    ),
    maxMediaPerEntry: clampLimit(
      options?.limits?.maxMediaPerEntry,
      DEFAULT_CAPTURE_LIMITS.maxMediaPerEntry,
      HARD_CAPTURE_LIMITS.maxMediaPerEntry,
    ),
  },
  usedItems: 0,
  warnings: [],
});

const warn = (context: ParseContext, message: string): void => {
  if (context.warnings.length < 100 && !context.warnings.includes(message)) {
    context.warnings.push(message);
  }
};

const reserveItem = (context: ParseContext): boolean => {
  if (context.usedItems >= context.limits.maxItems) {
    warn(context, `Capture stopped at ${context.limits.maxItems} items.`);
    return false;
  }
  context.usedItems += 1;
  return true;
};

const boundary = (reason: CapturedBoundaryEntry["reason"], detail: string): CapturedBoundaryEntry => ({
  kind: "boundary",
  reason,
  detail,
});

const emptyMetrics = (): CapturedMetrics => ({
  score: null,
  replies: null,
  likes: null,
  reposts: null,
  quotes: null,
});

const asNonEmpty = (entries: readonly CapturedEntry[]): NonEmptyEntries | null => {
  const [first, ...rest] = entries;
  return first === undefined ? null : [first, ...rest];
};

const httpUrl = (value: unknown, base?: string): string | null => {
  const text = nonEmptyString(value);
  if (text === null) return null;
  try {
    const url = base === undefined ? new URL(text) : new URL(text, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

const normalizedSource = (sourceUrl: string): string | null => httpUrl(sourceUrl);

const boundedText = (value: string, context: ParseContext, label: string): string => {
  if (value.length <= context.limits.maxTextLength) return value;
  warn(context, `${label} was truncated to ${context.limits.maxTextLength} characters.`);
  return `${value.slice(0, context.limits.maxTextLength)}\n\n[Text truncated.]`;
};

const boundedTitle = (value: string, context: ParseContext, label: string): string => {
  const limit = Math.min(context.limits.maxTextLength, 512);
  if (value.length <= limit) return value;
  warn(context, `${label} was truncated to ${limit} characters.`);
  return `${value.slice(0, Math.max(1, limit - 1))}…`;
};

const isoTimestamp = (value: unknown): string | null => {
  const text = nonEmptyString(value);
  if (text === null) return null;
  const milliseconds = Date.parse(text);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
};

const epochTimestamp = (value: unknown): string | null => {
  const seconds = finiteNumber(value);
  if (seconds === null || seconds > 253_402_300_799) return null;
  return new Date(seconds * 1_000).toISOString();
};

const cleanPathSegments = (url: URL): string[] => {
  const segments: string[] = [];
  for (const rawSegment of url.pathname.split("/")) {
    if (rawSegment === "") continue;
    try {
      segments.push(decodeURIComponent(rawSegment));
    } catch {
      segments.push(rawSegment);
    }
  }
  return segments;
};

const domainMatches = (hostname: string, domain: string): boolean =>
  hostname === domain || hostname.endsWith(`.${domain}`);

const canonicalWithoutFragment = (url: URL): string => {
  const canonical = new URL(url.href);
  canonical.hash = "";
  return canonical.href;
};

/** Classify a public content URL without accepting lookalike domains or non-web schemes. */
export function classifyPlatformUrl(value: string | URL): PlatformUrl | null {
  let url: URL;
  try {
    url = new URL(typeof value === "string" ? value : value.href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const hostname = url.hostname.toLowerCase();
  const segments = cleanPathSegments(url);

  if (domainMatches(hostname, "x.com") || domainMatches(hostname, "twitter.com")) {
    const handle = segments[0];
    const status = segments[1];
    const postId = segments[2];
    if (
      handle !== undefined &&
      status === "status" &&
      postId !== undefined &&
      /^[a-zA-Z0-9_]{1,32}$/.test(handle) &&
      /^\d+$/.test(postId)
    ) {
      return {
        platform: "x",
        href: `https://x.com/${handle}/status/${postId}`,
        handle,
        postId,
      };
    }
  }

  if (hostname === "news.ycombinator.com" && url.pathname === "/item") {
    const itemId = url.searchParams.get("id");
    if (itemId !== null && /^\d+$/.test(itemId)) {
      return {
        platform: "hacker-news",
        href: `https://news.ycombinator.com/item?id=${itemId}`,
        itemId,
      };
    }
  }

  if (domainMatches(hostname, "reddit.com")) {
    const commentsIndex = segments.indexOf("comments");
    const postId = commentsIndex >= 0 ? segments[commentsIndex + 1] : undefined;
    if (postId !== undefined && /^[a-zA-Z0-9]+$/.test(postId)) {
      const subreddit = commentsIndex >= 2 && segments[0] === "r" ? (segments[1] ?? null) : null;
      const possibleComment = segments[commentsIndex + 3];
      const commentId =
        possibleComment !== undefined && /^[a-zA-Z0-9]+$/.test(possibleComment)
          ? possibleComment
          : null;
      return {
        platform: "reddit",
        href: canonicalWithoutFragment(url),
        postId,
        subreddit,
        commentId,
      };
    }
  }
  if (hostname === "redd.it") {
    const postId = segments[0];
    if (postId !== undefined && /^[a-zA-Z0-9]+$/.test(postId)) {
      return {
        platform: "reddit",
        href: canonicalWithoutFragment(url),
        postId,
        subreddit: null,
        commentId: null,
      };
    }
  }

  if (hostname === "bsky.app" && segments[0] === "profile" && segments[2] === "post") {
    const actor = segments[1];
    const postId = segments[3];
    if (actor !== undefined && actor !== "" && postId !== undefined && postId !== "") {
      return {
        platform: "bluesky",
        href: `https://bsky.app/profile/${encodeURIComponent(actor)}/post/${encodeURIComponent(postId)}`,
        actor,
        postId,
      };
    }
  }

  if (hostname === "substack.com" || domainMatches(hostname, "substack.com")) {
    const publication = hostname === "substack.com" ? null : hostname.slice(0, -".substack.com".length);
    return { platform: "substack", href: canonicalWithoutFragment(url), publication };
  }

  if (domainMatches(hostname, "instagram.com")) {
    const contentId = ["p", "reel", "tv"].includes(segments[0] ?? "") ? (segments[1] ?? null) : null;
    return { platform: "instagram", href: canonicalWithoutFragment(url), contentId };
  }

  if (domainMatches(hostname, "linkedin.com")) {
    const contentId = segments.find((segment) => /(?:activity|ugcPost|share)[:-]?\d+/.test(segment)) ??
      segments[1] ??
      null;
    return { platform: "linkedin", href: canonicalWithoutFragment(url), contentId };
  }

  if (
    domainMatches(hostname, "facebook.com") ||
    hostname === "fb.com" ||
    hostname === "fb.watch"
  ) {
    const contentId = url.searchParams.get("story_fbid") ?? url.searchParams.get("v") ?? segments.at(-1) ?? null;
    return { platform: "facebook", href: canonicalWithoutFragment(url), contentId };
  }

  if (domainMatches(hostname, "tiktok.com")) {
    const videoIndex = segments.indexOf("video");
    const contentId = videoIndex >= 0 ? (segments[videoIndex + 1] ?? null) : (segments[0] ?? null);
    return { platform: "tiktok", href: canonicalWithoutFragment(url), contentId };
  }

  if (domainMatches(hostname, "threads.com") || domainMatches(hostname, "threads.net")) {
    const postIndex = segments.indexOf("post");
    const contentId = postIndex >= 0 ? (segments[postIndex + 1] ?? null) : null;
    return { platform: "threads", href: canonicalWithoutFragment(url), contentId };
  }

  if (hostname === "web.whatsapp.com") {
    return { platform: "whatsapp", href: canonicalWithoutFragment(url), contentId: null };
  }

  if (domainMatches(hostname, "youtube.com") || hostname === "youtu.be") {
    const contentId = hostname === "youtu.be"
      ? (segments[0] ?? null)
      : url.searchParams.get("v") ?? (segments[0] === "shorts" || segments[0] === "live" ? (segments[1] ?? null) : null);
    return { platform: "youtube", href: canonicalWithoutFragment(url), contentId };
  }

  return { platform: "generic", href: canonicalWithoutFragment(url), host: hostname };
}

const invalidSource = (): CaptureResult => ({
  ok: false,
  error: { code: "invalid-source", message: "The capture source must be an HTTP(S) URL." },
});

const invalidShape = (message: string): CaptureResult => ({
  ok: false,
  error: { code: "invalid-shape", message },
});

type BirdItem = {
  readonly id: string;
  readonly parentId: string | null;
  readonly articleTitle: string | null;
  readonly entry: CapturedContentEntry;
};

const birdMedia = (value: unknown, context: ParseContext): CapturedMedia[] => {
  if (!isUnknownArray(value)) return [];
  const media: CapturedMedia[] = [];
  const limit = Math.min(value.length, context.limits.maxMediaPerEntry);
  for (let index = 0; index < limit; index += 1) {
    const item = value[index];
    if (!isRecord(item)) continue;
    const rawType = nonEmptyString(item.type);
    const imageUrl = httpUrl(item.url);
    const videoUrl = httpUrl(item.videoUrl);
    const url = rawType === "video" || rawType === "animated_gif" ? (videoUrl ?? imageUrl) : imageUrl;
    if (url === null) continue;
    const width = safeInteger(item.width);
    const height = safeInteger(item.height);
    media.push({
      kind: rawType === "video" ? "video" : rawType === "animated_gif" ? "gif" : "image",
      url,
      previewUrl: httpUrl(item.previewUrl) ?? (videoUrl === null ? null : imageUrl),
      alt: nonEmptyString(item.altText) ?? nonEmptyString(item.alt),
      title: null,
      dimensions: width === null || height === null ? null : { width, height },
    });
  }
  if (value.length > limit) warn(context, `Media was truncated to ${limit} items on one entry.`);
  return media;
};

const birdAuthor = (value: unknown): CapturedAuthor | null => {
  if (!isRecord(value)) return null;
  const handle = nonEmptyString(value.username);
  if (handle === null) return null;
  return {
    name: nonEmptyString(value.name) ?? handle,
    handle,
    profileUrl: `https://x.com/${encodeURIComponent(handle)}`,
  };
};

function parseBirdItem(
  value: unknown,
  context: ParseContext,
  depth: number,
  active: WeakSet<object>,
): BirdItem | null {
  if (!isRecord(value)) return null;
  const id = foreignId(value.id);
  const text = stringValue(value.text);
  const author = birdAuthor(value.author);
  if (id === null || text === null || author === null) return null;
  if (active.has(value)) return null;
  if (!reserveItem(context)) return null;
  active.add(value);

  const quotes: CapturedEntry[] = [];
  const quotedValue = value.quotedTweet;
  if (quotedValue !== undefined && quotedValue !== null) {
    if (depth >= context.limits.maxDepth) {
      quotes.push(boundary("depth-limit", `Quoted post nesting exceeded ${context.limits.maxDepth}.`));
      warn(context, `Quoted post nesting stopped at depth ${context.limits.maxDepth}.`);
    } else if (isRecord(quotedValue) && active.has(quotedValue)) {
      quotes.push(boundary("cycle", `Quoted post ${id} references an ancestor.`));
      warn(context, "A cycle in quoted posts was stopped.");
    } else {
      const quoted = parseBirdItem(quotedValue, context, depth + 1, active);
      if (quoted === null) warn(context, `Malformed quoted post on ${id} was skipped.`);
      else quotes.push({ ...quoted.entry, role: "quote" });
    }
  }

  const article = readRecord(value, "article");
  const articleTitle = article === null ? null : nonEmptyString(article.title);
  const entry: CapturedContentEntry = {
    kind: "content",
    role: "post",
    id,
    author,
    createdAt: isoTimestamp(value.createdAt),
    sourceUrl: `https://x.com/${encodeURIComponent(author.handle ?? "")}/status/${encodeURIComponent(id)}`,
    text: boundedText(text, context, `Post ${id}`),
    media: birdMedia(value.media, context),
    metrics: {
      score: null,
      replies: safeInteger(value.replyCount),
      likes: safeInteger(value.likeCount),
      reposts: safeInteger(value.retweetCount),
      quotes: safeInteger(value.quoteCount),
    },
    quotes,
    replies: [],
  };
  active.delete(value);
  return {
    id,
    parentId: foreignId(value.inReplyToStatusId),
    articleTitle,
    entry,
  };
}

const birdValues = (input: unknown): readonly unknown[] | null => {
  if (isUnknownArray(input)) return input;
  if (!isRecord(input)) return null;
  const tweets = readArray(input, "tweets");
  if (tweets !== null) return tweets;
  if (input.tweet !== undefined) return [input.tweet];
  return [input];
};

const firstLine = (text: string, maxLength: number): string => {
  const line = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line.length <= maxLength ? line : `${line.slice(0, Math.max(1, maxLength - 1))}…`;
};

/** Parse `bird read/thread --json` output into the shared capture tree. */
export function parseBirdCapture(
  input: unknown,
  sourceUrl: string,
  options?: CaptureOptions,
): CaptureResult {
  const source = normalizedSource(sourceUrl);
  if (source === null) return invalidSource();
  const values = birdValues(input);
  if (values === null) return invalidShape("Bird output must be a tweet, tweet array, or tweets wrapper.");

  const context = createContext(options);
  const items = new Map<string, BirdItem>();
  const order: string[] = [];
  const scanLimit = Math.min(values.length, context.limits.maxItems);
  for (let index = 0; index < scanLimit; index += 1) {
    const item = parseBirdItem(values[index], context, 0, new WeakSet<object>());
    if (item === null) {
      warn(context, `Malformed Bird item at index ${index} was skipped.`);
      continue;
    }
    if (items.has(item.id)) {
      warn(context, `Duplicate Bird post ${item.id} was skipped.`);
      continue;
    }
    items.set(item.id, item);
    order.push(item.id);
  }
  if (values.length > scanLimit) warn(context, `Bird output was truncated to ${scanLimit} top-level items.`);
  if (order.length === 0) return invalidShape("Bird output contained no valid tweets.");

  const children = new Map<string, string[]>();
  for (const id of order) {
    const item = items.get(id);
    if (item?.parentId === null || item?.parentId === undefined || !items.has(item.parentId)) continue;
    const existing = children.get(item.parentId);
    if (existing === undefined) children.set(item.parentId, [id]);
    else existing.push(id);
  }

  const rendered = new Set<string>();
  const buildTree = (id: string, path: ReadonlySet<string>, depth: number): CapturedEntry => {
    const item = items.get(id);
    if (item === undefined) return boundary("cycle", `Post ${id} could not be resolved.`);
    if (depth >= context.limits.maxDepth) {
      return boundary("depth-limit", `Thread nesting exceeded ${context.limits.maxDepth}.`);
    }
    if (path.has(id)) {
      warn(context, "A cycle in Bird reply relationships was stopped.");
      return boundary("cycle", `Post ${id} repeats in its reply ancestry.`);
    }
    rendered.add(id);
    const nextPath = new Set(path);
    nextPath.add(id);
    const replies = (children.get(id) ?? []).map((childId) => buildTree(childId, nextPath, depth + 1));
    return { ...item.entry, replies };
  };

  const classified = classifyPlatformUrl(source);
  const targetId = classified?.platform === "x" ? classified.postId : null;
  let targetRoot = targetId;
  const walked = new Set<string>();
  for (let depth = 0; targetRoot !== null && depth < context.limits.maxDepth; depth += 1) {
    if (walked.has(targetRoot)) break;
    walked.add(targetRoot);
    const parentId = items.get(targetRoot)?.parentId ?? null;
    if (parentId === null || !items.has(parentId)) break;
    targetRoot = parentId;
  }

  const rootIds: string[] = [];
  if (targetRoot !== null && items.has(targetRoot)) rootIds.push(targetRoot);
  for (const id of order) {
    const parentId = items.get(id)?.parentId ?? null;
    if ((parentId === null || !items.has(parentId)) && !rootIds.includes(id)) rootIds.push(id);
  }
  const roots: CapturedEntry[] = rootIds.map((id) => buildTree(id, new Set<string>(), 0));
  for (const id of order) {
    if (!rendered.has(id)) roots.push(buildTree(id, new Set<string>(), 0));
  }
  const nonEmptyRoots = asNonEmpty(roots);
  if (nonEmptyRoots === null) {
    return { ok: false, error: { code: "missing-root", message: "Bird output had no renderable root." } };
  }

  const titleItem = (targetId === null ? undefined : items.get(targetId)) ?? items.get(order[0] ?? "");
  const authorLabel = titleItem?.entry.author?.handle ?? titleItem?.entry.author?.name ?? "Unknown author";
  const rawTitle =
    titleItem?.articleTitle ?? (firstLine(titleItem?.entry.text ?? "", 96) || `@${authorLabel} on X`);
  const title = boundedTitle(rawTitle, context, "Bird title");
  return {
    ok: true,
    document: {
      platform: "x",
      sourceUrl: source,
      title,
      ancestors: [],
      roots: nonEmptyRoots,
      warnings: context.warnings,
    },
  };
}

const decodeHtmlEntities = (value: string): string =>
  value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, decimal, hexadecimal, named) => {
    if (typeof decimal === "string") {
      const point = Number.parseInt(decimal, 10);
      return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    if (typeof hexadecimal === "string") {
      const point = Number.parseInt(hexadecimal, 16);
      return Number.isSafeInteger(point) && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    if (typeof named !== "string") return whole;
    const entities: Readonly<Record<string, string>> = {
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      nbsp: " ",
      quot: '"',
    };
    return entities[named.toLowerCase()] ?? whole;
  });

type HtmlTag = {
  readonly closing: boolean;
  readonly name: string;
  readonly raw: string;
};

const parseHtmlTag = (raw: string): HtmlTag | null => {
  let cursor = 0;
  let closing = false;
  if (raw.charCodeAt(cursor) === 47) {
    closing = true;
    cursor += 1;
  }
  const start = cursor;
  while (cursor < raw.length) {
    const code = raw.charCodeAt(cursor);
    const alphaNumeric =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122);
    if (!alphaNumeric) break;
    cursor += 1;
  }
  if (cursor === start) return null;
  return { closing, name: raw.slice(start, cursor).toLowerCase(), raw };
};

const stripHtmlTagsLinear = (html: string): string => {
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const opening = html.indexOf("<", cursor);
    if (opening < 0) {
      chunks.push(html.slice(cursor));
      break;
    }
    if (opening > cursor) chunks.push(html.slice(cursor, opening));
    const closing = html.indexOf(">", opening + 1);
    if (closing < 0) {
      chunks.push(html.slice(opening));
      break;
    }
    cursor = closing + 1;
  }
  return chunks.join("");
};

const quotedHref = (tag: HtmlTag): string | null => {
  let cursor = tag.name.length;
  while (cursor < tag.raw.length) {
    while (cursor < tag.raw.length && /\s/.test(tag.raw[cursor] ?? "")) cursor += 1;
    if (tag.raw[cursor] === "/") {
      cursor += 1;
      continue;
    }
    const nameStart = cursor;
    while (cursor < tag.raw.length) {
      const character = tag.raw[cursor] ?? "";
      if (/\s/.test(character) || character === "=" || character === "/") break;
      cursor += 1;
    }
    if (cursor === nameStart) {
      cursor += 1;
      continue;
    }
    const name = tag.raw.slice(nameStart, cursor).toLowerCase();
    while (cursor < tag.raw.length && /\s/.test(tag.raw[cursor] ?? "")) cursor += 1;
    if (tag.raw[cursor] !== "=") continue;
    cursor += 1;
    while (cursor < tag.raw.length && /\s/.test(tag.raw[cursor] ?? "")) cursor += 1;
    const quote = tag.raw[cursor];
    if (quote !== '"' && quote !== "'") continue;
    cursor += 1;
    const valueStart = cursor;
    while (cursor < tag.raw.length && tag.raw[cursor] !== quote) cursor += 1;
    if (cursor >= tag.raw.length) return null;
    if (name === "href") return tag.raw.slice(valueStart, cursor);
    cursor += 1;
  }
  return null;
};

const isWhitespace = (value: string): boolean => /\s/.test(value);

const isPlainBreakTag = (tag: HtmlTag): boolean => {
  if (tag.closing || tag.name !== "br") return false;
  let cursor = tag.name.length;
  while (cursor < tag.raw.length && isWhitespace(tag.raw[cursor] ?? "")) cursor += 1;
  if (tag.raw[cursor] === "/") cursor += 1;
  while (cursor < tag.raw.length && isWhitespace(tag.raw[cursor] ?? "")) cursor += 1;
  return cursor === tag.raw.length;
};

const isExactFormattingTag = (tag: HtmlTag, name: string): boolean =>
  tag.name === name && tag.raw.length === name.length + (tag.closing ? 1 : 0);

const htmlToMarkdown = (html: string): string => {
  const chunks: string[] = [];
  const lower = html.toLowerCase();
  let nextAnchorClosing = lower.indexOf("</a>");
  let cursor = 0;
  while (cursor < html.length) {
    const opening = html.indexOf("<", cursor);
    if (opening < 0) {
      chunks.push(html.slice(cursor));
      break;
    }
    if (opening > cursor) chunks.push(html.slice(cursor, opening));
    const closing = html.indexOf(">", opening + 1);
    if (closing < 0) {
      chunks.push(html.slice(opening));
      break;
    }
    const tag = parseHtmlTag(html.slice(opening + 1, closing));
    if (tag === null) {
      cursor = closing + 1;
      continue;
    }

    if (!tag.closing && tag.name === "a") {
      const target = quotedHref(tag);
      while (nextAnchorClosing >= 0 && nextAnchorClosing < closing + 1) {
        nextAnchorClosing = lower.indexOf("</a>", nextAnchorClosing + 4);
      }
      if (target !== null && nextAnchorClosing >= 0) {
        const label = html.slice(closing + 1, nextAnchorClosing);
        const cleanLabel = decodeHtmlEntities(stripHtmlTagsLinear(label)).trim();
        const url = httpUrl(decodeHtmlEntities(target), "https://news.ycombinator.com/");
        chunks.push(url === null ? cleanLabel : `[${cleanLabel || url}](<${url}>)`);
        cursor = nextAnchorClosing + 4;
        nextAnchorClosing = lower.indexOf("</a>", cursor);
        continue;
      }
    }

    const nextOpening = closing + 1;
    if (
      isExactFormattingTag(tag, "pre") &&
      !tag.closing &&
      lower.startsWith("<code>", nextOpening)
    ) {
      chunks.push("\n\n```\n");
      cursor = nextOpening + 6;
      continue;
    }
    if (
      isExactFormattingTag(tag, "code") &&
      tag.closing &&
      lower.startsWith("</pre>", nextOpening)
    ) {
      chunks.push("\n```\n\n");
      cursor = nextOpening + 6;
      continue;
    }
    if (!tag.closing && tag.name === "p") chunks.push("\n\n");
    else if (isPlainBreakTag(tag)) chunks.push("\n");
    else if (isExactFormattingTag(tag, "i") || isExactFormattingTag(tag, "em")) chunks.push("*");
    else if (isExactFormattingTag(tag, "b") || isExactFormattingTag(tag, "strong")) chunks.push("**");
    cursor = closing + 1;
  }
  return decodeHtmlEntities(chunks.join(""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

type HackerNewsEnvelope = { readonly root: unknown; readonly descendants: readonly unknown[] };

const hackerNewsEnvelope = (input: unknown): HackerNewsEnvelope | null => {
  if (isUnknownArray(input)) {
    const [root, ...descendants] = input;
    return root === undefined ? null : { root, descendants };
  }
  if (!isRecord(input)) return null;
  const root = input.root ?? input.rootItem;
  const descendants = readArray(input, "descendants") ?? readArray(input, "items") ?? [];
  return root === undefined ? null : { root, descendants };
};

const hackerNewsKids = (record: Record<string, unknown>, context: ParseContext): string[] => {
  const kids = readArray(record, "kids");
  if (kids === null) return [];
  const result: string[] = [];
  const limit = Math.min(kids.length, context.limits.maxItems);
  for (let index = 0; index < limit; index += 1) {
    const id = foreignId(kids[index]);
    if (id !== null) result.push(id);
  }
  if (kids.length > limit) warn(context, `Hacker News child IDs were truncated to ${limit}.`);
  return result;
};

/** Parse a Hacker News Firebase root item plus its fetched descendants. */
export function parseHackerNewsCapture(
  input: unknown,
  sourceUrl: string,
  options?: CaptureOptions,
): CaptureResult {
  const source = normalizedSource(sourceUrl);
  if (source === null) return invalidSource();
  const envelope = hackerNewsEnvelope(input);
  if (envelope === null || !isRecord(envelope.root)) {
    return invalidShape("Hacker News input must provide a root item and descendant items.");
  }
  const rootId = foreignId(envelope.root.id);
  if (rootId === null) return invalidShape("The Hacker News root item has no valid id.");

  const context = createContext(options);
  const byId = new Map<string, Record<string, unknown>>();
  byId.set(rootId, envelope.root);
  const scanLimit = Math.min(envelope.descendants.length, context.limits.maxItems - 1);
  for (let index = 0; index < scanLimit; index += 1) {
    const value = envelope.descendants[index];
    if (!isRecord(value)) {
      warn(context, `Malformed Hacker News descendant at index ${index} was skipped.`);
      continue;
    }
    const id = foreignId(value.id);
    if (id === null) {
      warn(context, `Hacker News descendant at index ${index} has no id.`);
      continue;
    }
    if (byId.has(id)) warn(context, `Duplicate Hacker News item ${id} was skipped.`);
    else byId.set(id, value);
  }
  if (envelope.descendants.length > scanLimit) {
    warn(context, `Hacker News descendants were truncated to ${scanLimit}.`);
  }

  const buildItem = (
    id: string,
    role: CapturedRole,
    path: ReadonlySet<string>,
    depth: number,
  ): CapturedEntry => {
    if (depth >= context.limits.maxDepth) {
      return boundary("depth-limit", `Hacker News nesting exceeded ${context.limits.maxDepth}.`);
    }
    if (path.has(id)) {
      warn(context, "A cycle in Hacker News child IDs was stopped.");
      return boundary("cycle", `Hacker News item ${id} repeats in its ancestry.`);
    }
    if (!reserveItem(context)) return boundary("item-limit", "The Hacker News item limit was reached.");
    const record = byId.get(id);
    if (record === undefined) {
      return {
        kind: "unavailable",
        role,
        id,
        reason: "not-found",
        sourceUrl: `https://news.ycombinator.com/item?id=${encodeURIComponent(id)}`,
        replies: [],
      };
    }
    const nextPath = new Set(path);
    nextPath.add(id);
    const replies: CapturedEntry[] = [];
    for (const childId of hackerNewsKids(record, context)) {
      if (context.usedItems >= context.limits.maxItems) {
        replies.push(boundary("item-limit", "Additional Hacker News descendants were omitted."));
        break;
      }
      replies.push(buildItem(childId, "comment", nextPath, depth + 1));
    }
    const sourceForItem = `https://news.ycombinator.com/item?id=${encodeURIComponent(id)}`;
    if (booleanValue(record.deleted) === true || booleanValue(record.dead) === true) {
      return {
        kind: "unavailable",
        role,
        id,
        reason: booleanValue(record.deleted) === true ? "deleted" : "dead",
        sourceUrl: sourceForItem,
        replies,
      };
    }
    const authorHandle = nonEmptyString(record.by);
    const author: CapturedAuthor | null =
      authorHandle === null
        ? null
        : {
            name: authorHandle,
            handle: authorHandle,
            profileUrl: `https://news.ycombinator.com/user?id=${encodeURIComponent(authorHandle)}`,
          };
    const rawText = stringValue(record.text) ?? "";
    const body = htmlToMarkdown(boundedText(rawText, context, `Hacker News item ${id}`));
    const external = httpUrl(record.url, "https://news.ycombinator.com/");
    const text = external === null ? body : `${body}${body === "" ? "" : "\n\n"}[Linked article](<${external}>)`;
    return {
      kind: "content",
      role,
      id,
      author,
      createdAt: epochTimestamp(record.time),
      sourceUrl: sourceForItem,
      text,
      media: [],
      metrics: {
        ...emptyMetrics(),
        score: safeInteger(record.score),
        replies: safeInteger(record.descendants) ?? (replies.length === 0 ? null : replies.length),
      },
      quotes: [],
      replies,
    };
  };

  const root = buildItem(rootId, "post", new Set<string>(), 0);
  const title = boundedTitle(
    nonEmptyString(envelope.root.title) ?? `Hacker News item ${rootId}`,
    context,
    "Hacker News title",
  );
  return {
    ok: true,
    document: {
      platform: "hacker-news",
      sourceUrl: source,
      title,
      ancestors: [],
      roots: [root],
      warnings: context.warnings,
    },
  };
}

const redditListingChildren = (value: unknown): readonly unknown[] | null => {
  if (!isRecord(value)) return null;
  if (value.kind === "Listing") {
    const data = readRecord(value, "data");
    return data === null ? null : readArray(data, "children");
  }
  const data = readRecord(value, "data");
  return data === null ? null : readArray(data, "children");
};

type RedditEnvelope = { readonly post: unknown; readonly comments: unknown };

const redditEnvelope = (input: unknown): RedditEnvelope | null => {
  if (isUnknownArray(input)) {
    const post = input[0];
    if (post === undefined) return null;
    return { post, comments: input[1] ?? null };
  }
  if (!isRecord(input) || input.post === undefined) return null;
  return { post: input.post, comments: input.comments ?? null };
};

const redditPostData = (value: unknown, maxItems: number): Record<string, unknown> | null => {
  if (isRecord(value) && value.kind === "t3") return readRecord(value, "data");
  const children = redditListingChildren(value);
  if (children === null) return null;
  const limit = Math.min(children.length, maxItems);
  for (let index = 0; index < limit; index += 1) {
    const child = children[index];
    if (isRecord(child) && child.kind === "t3") return readRecord(child, "data");
  }
  return null;
};

const redditAuthor = (value: unknown): CapturedAuthor | null => {
  const handle = nonEmptyString(value);
  if (handle === null || handle === "[deleted]") return null;
  return {
    name: handle,
    handle,
    profileUrl: `https://www.reddit.com/user/${encodeURIComponent(handle)}`,
  };
};

const redditPermalink = (value: unknown): string | null =>
  httpUrl(value, "https://www.reddit.com/");

/** Parse Reddit's post-and-comments listing JSON, including nested `more` placeholders. */
export function parseRedditCapture(
  input: unknown,
  sourceUrl: string,
  options?: CaptureOptions,
): CaptureResult {
  const source = normalizedSource(sourceUrl);
  if (source === null) return invalidSource();
  const envelope = redditEnvelope(input);
  if (envelope === null) return invalidShape("Reddit input must contain a post listing.");
  const context = createContext(options);
  const post = redditPostData(envelope.post, context.limits.maxItems);
  if (post === null) return invalidShape("Reddit input contained no valid post object.");
  const postId = foreignId(post.id) ?? foreignId(post.name);
  const rawTitle = nonEmptyString(post.title);
  if (postId === null || rawTitle === null) return invalidShape("The Reddit post has no valid id or title.");
  const title = boundedTitle(rawTitle, context, "Reddit title");
  if (!reserveItem(context)) return invalidShape("The capture item limit cannot hold the Reddit post.");

  const active = new WeakSet<object>();
  const parseThing = (value: unknown, depth: number): CapturedEntry | null => {
    if (!isRecord(value)) return null;
    if (depth >= context.limits.maxDepth) {
      return boundary("depth-limit", `Reddit nesting exceeded ${context.limits.maxDepth}.`);
    }
    if (active.has(value)) {
      warn(context, "A cycle in Reddit replies was stopped.");
      return boundary("cycle", "A Reddit reply object repeats in its ancestry.");
    }
    const kind = nonEmptyString(value.kind);
    const data = readRecord(value, "data");
    if (kind === null || data === null) return null;
    if (!reserveItem(context)) return boundary("item-limit", "Additional Reddit comments were omitted.");
    active.add(value);

    if (kind === "more") {
      const childValues = readArray(data, "children") ?? [];
      const childIds: string[] = [];
      const limit = Math.min(childValues.length, context.limits.maxItems);
      for (let index = 0; index < limit; index += 1) {
        const id = foreignId(childValues[index]);
        if (id !== null) childIds.push(id);
      }
      active.delete(value);
      return {
        kind: "more",
        id: foreignId(data.id) ?? "more",
        count: safeInteger(data.count),
        childIds,
      };
    }
    if (kind !== "t1") {
      active.delete(value);
      warn(context, `Unsupported Reddit thing kind ${kind} was skipped.`);
      return null;
    }

    const id = foreignId(data.id) ?? foreignId(data.name) ?? "unknown-comment";
    const replyValues = redditListingChildren(data.replies) ?? [];
    const replies: CapturedEntry[] = [];
    const limit = Math.min(replyValues.length, context.limits.maxItems);
    for (let index = 0; index < limit; index += 1) {
      if (context.usedItems >= context.limits.maxItems) {
        warn(context, `Capture stopped at ${context.limits.maxItems} items.`);
        replies.push(boundary("item-limit", "Additional Reddit replies were omitted."));
        break;
      }
      const reply = parseThing(replyValues[index], depth + 1);
      if (reply !== null) replies.push(reply);
    }
    const itemSource = redditPermalink(data.permalink);
    const body = stringValue(data.body) ?? "";
    active.delete(value);
    if (body.trim() === "[deleted]" || body.trim() === "[removed]") {
      return {
        kind: "unavailable",
        role: "comment",
        id,
        reason: body.trim() === "[deleted]" ? "deleted" : "removed",
        sourceUrl: itemSource,
        replies,
      };
    }
    return {
      kind: "content",
      role: "comment",
      id,
      author: redditAuthor(data.author),
      createdAt: epochTimestamp(data.created_utc),
      sourceUrl: itemSource,
      text: boundedText(body, context, `Reddit comment ${id}`),
      media: [],
      metrics: { ...emptyMetrics(), score: signedSafeInteger(data.score), replies: replies.length || null },
      quotes: [],
      replies,
    };
  };

  const commentValues = redditListingChildren(envelope.comments) ?? [];
  const replies: CapturedEntry[] = [];
  const commentLimit = Math.min(commentValues.length, context.limits.maxItems);
  for (let index = 0; index < commentLimit; index += 1) {
    if (context.usedItems >= context.limits.maxItems) {
      warn(context, `Capture stopped at ${context.limits.maxItems} items.`);
      replies.push(boundary("item-limit", "Additional Reddit comments were omitted."));
      break;
    }
    const reply = parseThing(commentValues[index], 1);
    if (reply !== null) replies.push(reply);
  }
  if (commentValues.length > commentLimit) warn(context, `Reddit comments were truncated to ${commentLimit}.`);

  const permalink = redditPermalink(post.permalink);
  const selfText = stringValue(post.selftext) ?? "";
  const linkedUrl = httpUrl(post.url);
  const linkText = linkedUrl === null || linkedUrl === permalink ? "" : `[Linked page](<${linkedUrl}>)`;
  const body = `${boundedText(selfText, context, `Reddit post ${postId}`)}${
    selfText.trim() === "" || linkText === "" ? "" : "\n\n"
  }${linkText}`;
  const root: CapturedContentEntry = {
    kind: "content",
    role: "post",
    id: postId,
    author: redditAuthor(post.author),
    createdAt: epochTimestamp(post.created_utc),
    sourceUrl: permalink ?? source,
    text: body,
    media: [],
    metrics: {
      ...emptyMetrics(),
      score: signedSafeInteger(post.score),
      replies: safeInteger(post.num_comments) ?? replies.length,
    },
    quotes: [],
    replies,
  };
  return {
    ok: true,
    document: {
      platform: "reddit",
      sourceUrl: source,
      title,
      ancestors: [],
      roots: [root],
      warnings: context.warnings,
    },
  };
}

const bskyAuthor = (value: unknown): CapturedAuthor | null => {
  if (!isRecord(value)) return null;
  const handle = nonEmptyString(value.handle);
  const did = nonEmptyString(value.did);
  if (handle === null && did === null) return null;
  const actor = handle ?? did ?? "unknown";
  return {
    name: nonEmptyString(value.displayName) ?? actor,
    handle,
    profileUrl: `https://bsky.app/profile/${encodeURIComponent(actor)}`,
  };
};

const bskyRkey = (uri: string): string | null => {
  const segments = uri.split("/").filter((segment) => segment !== "");
  return segments.at(-1) ?? null;
};

const bskyPostUrl = (uri: string | null, author: CapturedAuthor | null): string | null => {
  if (uri === null || author === null) return null;
  const rkey = bskyRkey(uri);
  const actor = author.handle;
  return rkey === null || actor === null
    ? null
    : `https://bsky.app/profile/${encodeURIComponent(actor)}/post/${encodeURIComponent(rkey)}`;
};

const bskyMedia = (values: readonly unknown[], context: ParseContext): CapturedMedia[] => {
  const media: CapturedMedia[] = [];
  const seen = new Set<string>();
  const active = new WeakSet<object>();
  const add = (item: CapturedMedia): void => {
    const key = `${item.kind}:${item.url}`;
    if (seen.has(key) || media.length >= context.limits.maxMediaPerEntry) return;
    seen.add(key);
    media.push(item);
  };
  const visit = (value: unknown, depth: number): void => {
    if (!isRecord(value) || depth > Math.min(8, context.limits.maxDepth) || active.has(value)) return;
    active.add(value);
    const images = readArray(value, "images");
    if (images !== null) {
      const limit = Math.min(images.length, context.limits.maxMediaPerEntry);
      for (let index = 0; index < limit; index += 1) {
        const image = images[index];
        if (!isRecord(image)) continue;
        const url = httpUrl(image.fullsize) ?? httpUrl(image.thumb);
        if (url === null) continue;
        const ratio = readRecord(image, "aspectRatio");
        const width = ratio === null ? null : safeInteger(ratio.width);
        const height = ratio === null ? null : safeInteger(ratio.height);
        add({
          kind: "image",
          url,
          previewUrl: httpUrl(image.thumb),
          alt: nonEmptyString(image.alt),
          title: null,
          dimensions: width === null || height === null ? null : { width, height },
        });
      }
    }
    const playlist = httpUrl(value.playlist);
    if (playlist !== null) {
      add({
        kind: "video",
        url: playlist,
        previewUrl: httpUrl(value.thumbnail),
        alt: nonEmptyString(value.alt),
        title: null,
        dimensions: null,
      });
    }
    const external = readRecord(value, "external");
    if (external !== null) {
      const url = httpUrl(external.uri);
      if (url !== null) {
        add({
          kind: "link",
          url,
          previewUrl: httpUrl(external.thumb),
          alt: nonEmptyString(external.description),
          title: nonEmptyString(external.title),
          dimensions: null,
        });
      }
    }
    if (value.media !== undefined) visit(value.media, depth + 1);
    const embeds = readArray(value, "embeds");
    if (embeds !== null) {
      const limit = Math.min(embeds.length, context.limits.maxMediaPerEntry);
      for (let index = 0; index < limit; index += 1) visit(embeds[index], depth + 1);
    }
    active.delete(value);
  };
  for (const value of values) visit(value, 0);
  if (media.length >= context.limits.maxMediaPerEntry) {
    warn(context, `Bluesky media was truncated to ${context.limits.maxMediaPerEntry} items on one entry.`);
  }
  return media;
};

const bskyQuoteRecord = (embed: unknown): unknown => {
  if (!isRecord(embed)) return null;
  const type = nonEmptyString(embed.$type) ?? "";
  if (type.includes("recordWithMedia")) {
    const outerRecord = readRecord(embed, "record");
    return outerRecord?.record ?? null;
  }
  if (type.includes("record#view") || type.includes("recordWithMedia#view")) return embed.record ?? null;
  return null;
};

function parseBskyQuote(
  value: unknown,
  context: ParseContext,
  depth: number,
  active: WeakSet<object>,
): CapturedEntry | null {
  if (!isRecord(value)) return null;
  if (depth >= context.limits.maxDepth) {
    return boundary("depth-limit", `Bluesky quote nesting exceeded ${context.limits.maxDepth}.`);
  }
  if (active.has(value)) {
    warn(context, "A cycle in Bluesky quoted records was stopped.");
    return boundary("cycle", "A Bluesky quoted record repeats in its ancestry.");
  }
  const uri = nonEmptyString(value.uri) ?? "unknown-quote";
  if (booleanValue(value.notFound) === true || booleanValue(value.blocked) === true) {
    if (!reserveItem(context)) return boundary("item-limit", "Additional Bluesky quotes were omitted.");
    return {
      kind: "unavailable",
      role: "quote",
      id: uri,
      reason: booleanValue(value.blocked) === true ? "blocked" : "not-found",
      sourceUrl: null,
      replies: [],
    };
  }
  const author = bskyAuthor(value.author);
  const record = readRecord(value, "value") ?? readRecord(value, "record");
  if (record === null || !reserveItem(context)) return null;
  active.add(value);
  const nestedEmbed = value.embeds ?? record.embed;
  const nestedQuoteValue = bskyQuoteRecord(nestedEmbed);
  const quotes: CapturedEntry[] = [];
  if (nestedQuoteValue !== null) {
    const nested = parseBskyQuote(nestedQuoteValue, context, depth + 1, active);
    if (nested !== null) quotes.push(nested);
  }
  active.delete(value);
  return {
    kind: "content",
    role: "quote",
    id: uri,
    author,
    createdAt: isoTimestamp(record.createdAt),
    sourceUrl: bskyPostUrl(uri, author),
    text: boundedText(stringValue(record.text) ?? "", context, `Bluesky quote ${uri}`),
    media: bskyMedia([value, record], context),
    metrics: emptyMetrics(),
    quotes,
    replies: [],
  };
}

function parseBskyThreadNode(
  value: unknown,
  role: CapturedRole,
  includeReplies: boolean,
  context: ParseContext,
  depth: number,
  active: WeakSet<object>,
): CapturedEntry | null {
  if (!isRecord(value)) return null;
  if (depth >= context.limits.maxDepth) {
    return boundary("depth-limit", `Bluesky nesting exceeded ${context.limits.maxDepth}.`);
  }
  if (active.has(value)) {
    warn(context, "A cycle in Bluesky thread objects was stopped.");
    return boundary("cycle", "A Bluesky thread object repeats in its ancestry.");
  }
  const post = readRecord(value, "post");
  const fallbackUri = nonEmptyString(value.uri) ?? "unknown-post";
  const type = nonEmptyString(value.$type) ?? "";
  if (
    booleanValue(value.notFound) === true ||
    booleanValue(value.blocked) === true ||
    type.includes("notFoundPost") ||
    type.includes("blockedPost")
  ) {
    if (!reserveItem(context)) return boundary("item-limit", "Additional Bluesky entries were omitted.");
    return {
      kind: "unavailable",
      role,
      id: fallbackUri,
      reason: booleanValue(value.blocked) === true || type.includes("blockedPost") ? "blocked" : "not-found",
      sourceUrl: null,
      replies: [],
    };
  }
  if (post === null || !reserveItem(context)) return null;
  const uri = nonEmptyString(post.uri) ?? fallbackUri;
  const author = bskyAuthor(post.author);
  const record = readRecord(post, "record");
  if (record === null) return null;
  active.add(value);

  const embedValues: unknown[] = [];
  if (post.embed !== undefined) embedValues.push(post.embed);
  if (record.embed !== undefined) embedValues.push(record.embed);
  const quotes: CapturedEntry[] = [];
  for (const embed of embedValues) {
    const quoteValue = bskyQuoteRecord(embed);
    if (quoteValue === null) continue;
    const quote = parseBskyQuote(quoteValue, context, depth + 1, active);
    if (quote !== null) quotes.push(quote);
  }

  const replies: CapturedEntry[] = [];
  const replyValues = includeReplies ? readArray(value, "replies") ?? [] : [];
  const limit = Math.min(replyValues.length, context.limits.maxItems);
  for (let index = 0; index < limit; index += 1) {
    if (context.usedItems >= context.limits.maxItems) {
      warn(context, `Capture stopped at ${context.limits.maxItems} items.`);
      replies.push(boundary("item-limit", "Additional Bluesky replies were omitted."));
      break;
    }
    const reply = parseBskyThreadNode(replyValues[index], "comment", true, context, depth + 1, active);
    if (reply !== null) replies.push(reply);
  }
  active.delete(value);
  return {
    kind: "content",
    role,
    id: uri,
    author,
    createdAt: isoTimestamp(record.createdAt) ?? isoTimestamp(post.indexedAt),
    sourceUrl: bskyPostUrl(uri, author),
    text: boundedText(stringValue(record.text) ?? "", context, `Bluesky post ${uri}`),
    media: bskyMedia(embedValues, context),
    metrics: {
      score: null,
      replies: safeInteger(post.replyCount),
      likes: safeInteger(post.likeCount),
      reposts: safeInteger(post.repostCount),
      quotes: safeInteger(post.quoteCount),
    },
    quotes,
    replies,
  };
}

/** Parse `app.bsky.feed.getPostThread` JSON, retaining parents, replies, and embeds. */
export function parseBlueskyCapture(
  input: unknown,
  sourceUrl: string,
  options?: CaptureOptions,
): CaptureResult {
  const source = normalizedSource(sourceUrl);
  if (source === null) return invalidSource();
  if (!isRecord(input)) return invalidShape("Bluesky output must be an object containing a thread.");
  const thread = input.thread ?? input;
  if (!isRecord(thread)) return invalidShape("Bluesky output contained no thread root.");
  const context = createContext(options);
  const root = parseBskyThreadNode(thread, "post", true, context, 0, new WeakSet<object>());
  if (root === null) return invalidShape("Bluesky output contained no valid post at the thread root.");

  const ancestorsNearestFirst: CapturedEntry[] = [];
  const seenParents = new WeakSet<object>();
  let parent: unknown = thread.parent;
  for (let depth = 1; parent !== undefined && parent !== null; depth += 1) {
    if (depth >= context.limits.maxDepth) {
      ancestorsNearestFirst.push(boundary("depth-limit", "Additional Bluesky parent context was omitted."));
      break;
    }
    if (!isRecord(parent)) break;
    if (seenParents.has(parent)) {
      ancestorsNearestFirst.push(boundary("cycle", "A Bluesky parent object repeats in its ancestry."));
      warn(context, "A cycle in Bluesky parent context was stopped.");
      break;
    }
    seenParents.add(parent);
    const parsed = parseBskyThreadNode(parent, "post", false, context, depth, new WeakSet<object>());
    if (parsed !== null) ancestorsNearestFirst.push(parsed);
    parent = parent.parent;
  }
  ancestorsNearestFirst.reverse();
  const titleAuthor = root.kind === "content" ? root.author : null;
  const titleText = root.kind === "content" ? firstLine(root.text, 96) : "";
  const title = titleText || `${titleAuthor?.name ?? "Unknown author"} on Bluesky`;
  return {
    ok: true,
    document: {
      platform: "bluesky",
      sourceUrl: source,
      title,
      ancestors: ancestorsNearestFirst,
      roots: [root],
      warnings: context.warnings,
    },
  };
}

/** Dispatch one of the four structured platform parsers. */
export function parseStructuredCapture(
  platform: CapturedPlatform,
  input: unknown,
  sourceUrl: string,
  options?: CaptureOptions,
): CaptureResult {
  switch (platform) {
    case "x":
      return parseBirdCapture(input, sourceUrl, options);
    case "hacker-news":
      return parseHackerNewsCapture(input, sourceUrl, options);
    case "reddit":
      return parseRedditCapture(input, sourceUrl, options);
    case "bluesky":
      return parseBlueskyCapture(input, sourceUrl, options);
  }
}

const platformLabel = (platform: CapturedPlatform): string => {
  switch (platform) {
    case "x":
      return "X";
    case "hacker-news":
      return "Hacker News";
    case "reddit":
      return "Reddit";
    case "bluesky":
      return "Bluesky";
  }
};

const escapeInline = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/([*_[\]`])/g, "\\$1").replace(/\s+/g, " ").trim();

const cleanHeading = (value: string): string => value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

const authorLabel = (author: CapturedAuthor | null): string => {
  if (author === null) return "Unknown author";
  const name = escapeInline(author.name);
  if (author.handle === null || author.handle === author.name) return name;
  return `${name} (@${escapeInline(author.handle)})`;
};

const metadata = (entry: CapturedContentEntry): string => {
  const pieces = [`**${authorLabel(entry.author)}**`];
  if (entry.createdAt !== null) pieces.push(entry.createdAt);
  if (entry.sourceUrl !== null) pieces.push(`[source](<${entry.sourceUrl}>)`);
  return pieces.join(" · ");
};

const metricLabel = (value: number, singular: string, plural = `${singular}s`): string =>
  `${value} ${value === 1 ? singular : plural}`;

const metricsLine = (metrics: CapturedMetrics): string | null => {
  const pieces: string[] = [];
  if (metrics.score !== null) pieces.push(metricLabel(metrics.score, "point"));
  if (metrics.replies !== null) pieces.push(metricLabel(metrics.replies, "reply", "replies"));
  if (metrics.likes !== null) pieces.push(metricLabel(metrics.likes, "like"));
  if (metrics.reposts !== null) pieces.push(metricLabel(metrics.reposts, "repost"));
  if (metrics.quotes !== null) pieces.push(metricLabel(metrics.quotes, "quote"));
  return pieces.length === 0 ? null : pieces.join(" · ");
};

const indentLines = (lines: readonly string[], prefix: string): string[] =>
  lines.map((line) => (line === "" ? prefix.trimEnd() : `${prefix}${line}`));

const mediaLines = (media: readonly CapturedMedia[]): string[] => {
  const lines: string[] = [];
  for (const item of media) {
    const fallback = item.kind === "gif" ? "GIF" : `${item.kind[0]?.toUpperCase() ?? ""}${item.kind.slice(1)}`;
    const label = escapeInline(item.title ?? item.alt ?? fallback);
    if (item.kind === "image" || item.kind === "gif") {
      lines.push(`![${label}](<${item.url}>)`);
    } else {
      if (item.previewUrl !== null) lines.push(`![${label} preview](<${item.previewUrl}>)`);
      lines.push(`- [${label}](<${item.url}>)`);
    }
  }
  return lines;
};

type RenderState = { count: number; readonly active: WeakSet<object> };

const unavailableLabel = (entry: CapturedUnavailableEntry): string => {
  const noun = entry.role === "comment" ? "comment" : entry.role === "quote" ? "quoted post" : "post";
  return `${entry.reason} ${noun} ${escapeInline(entry.id)}`;
};

const renderQuote = (entry: CapturedEntry, depth: number, state: RenderState): string[] => {
  const lines = renderRootEntry(entry, depth + 1, state);
  return indentLines(lines, "> ");
};

const renderReplies = (entries: readonly CapturedEntry[], depth: number, state: RenderState): string[] => {
  const lines: string[] = [];
  for (const entry of entries) lines.push(...renderNestedEntry(entry, depth, state));
  return lines;
};

function renderNestedEntry(entry: CapturedEntry, depth: number, state: RenderState): string[] {
  const prefix = "  ".repeat(depth);
  if (depth >= 64 || state.count >= 20_000) return [`${prefix}- *[render limit reached]*`];
  if (state.active.has(entry)) return [`${prefix}- *[cycle omitted]*`];
  state.count += 1;
  state.active.add(entry);
  let lines: string[];
  switch (entry.kind) {
    case "boundary":
      lines = [`${prefix}- *[${escapeInline(entry.detail)}]*`];
      break;
    case "more": {
      const count = entry.count === null ? "More comments" : `${entry.count} more comments`;
      const ids = entry.childIds.length === 0 ? "" : ` (${entry.childIds.map(escapeInline).join(", ")})`;
      lines = [`${prefix}- *${count}${ids}*`];
      break;
    }
    case "unavailable": {
      const source = entry.sourceUrl === null ? "" : ` · [source](<${entry.sourceUrl}>)`;
      lines = [`${prefix}- *[${unavailableLabel(entry)}]*${source}`];
      lines.push(...renderReplies(entry.replies, depth + 1, state));
      break;
    }
    case "content": {
      lines = [`${prefix}- ${metadata(entry)}`];
      if (entry.text.trim() !== "") {
        lines.push(`${prefix}  `, ...indentLines(entry.text.trim().split("\n"), `${prefix}  `));
      }
      const metricText = metricsLine(entry.metrics);
      if (metricText !== null) lines.push(`${prefix}  `, `${prefix}  _${metricText}_`);
      if (entry.media.length > 0) {
        lines.push(`${prefix}  `, ...indentLines(mediaLines(entry.media), `${prefix}  `));
      }
      for (const quote of entry.quotes) {
        lines.push(`${prefix}  `, ...indentLines(renderQuote(quote, depth, state), `${prefix}  `));
      }
      lines.push(...renderReplies(entry.replies, depth + 1, state));
      break;
    }
  }
  state.active.delete(entry);
  return lines;
}

function renderRootEntry(entry: CapturedEntry, depth: number, state: RenderState): string[] {
  if (depth >= 64 || state.count >= 20_000) return ["*[render limit reached]*"];
  if (state.active.has(entry)) return ["*[cycle omitted]*"];
  state.count += 1;
  state.active.add(entry);
  let lines: string[];
  switch (entry.kind) {
    case "boundary":
      lines = [`*[${escapeInline(entry.detail)}]*`];
      break;
    case "more": {
      const count = entry.count === null ? "More comments" : `${entry.count} more comments`;
      lines = [`*${count}*`];
      break;
    }
    case "unavailable": {
      const source = entry.sourceUrl === null ? "" : ` · [source](<${entry.sourceUrl}>)`;
      lines = [`*[${unavailableLabel(entry)}]*${source}`];
      if (entry.replies.length > 0) lines.push("", "#### Replies", "", ...renderReplies(entry.replies, 0, state));
      break;
    }
    case "content": {
      lines = [metadata(entry)];
      if (entry.text.trim() !== "") lines.push("", entry.text.trim());
      const metricText = metricsLine(entry.metrics);
      if (metricText !== null) lines.push("", `_${metricText}_`);
      if (entry.media.length > 0) lines.push("", ...mediaLines(entry.media));
      if (entry.quotes.length > 0) {
        lines.push("", "#### Quoted posts", "");
        for (const quote of entry.quotes) lines.push(...renderQuote(quote, depth, state), "");
        if (lines.at(-1) === "") lines.pop();
      }
      if (entry.replies.length > 0) lines.push("", "#### Replies", "", ...renderReplies(entry.replies, 0, state));
      break;
    }
  }
  state.active.delete(entry);
  return lines;
}

/** Render a normalized document as stable, readable Markdown. */
export function renderCapturedDocument(document: CapturedDocument): string {
  const lines = [
    `# ${cleanHeading(document.title) || "Captured post"}`,
    "",
    `Source: [${document.sourceUrl}](<${document.sourceUrl}>)`,
    `Platform: ${platformLabel(document.platform)}`,
  ];
  const state: RenderState = { count: 0, active: new WeakSet<object>() };
  if (document.ancestors.length > 0) {
    lines.push("", "## Parent context", "");
    for (let index = 0; index < document.ancestors.length; index += 1) {
      lines.push(`### Parent ${index + 1}`, "", ...renderRootEntry(document.ancestors[index] ?? boundary("cycle", "Missing parent."), 0, state), "");
    }
    if (lines.at(-1) === "") lines.pop();
  }
  lines.push("", document.roots.length === 1 ? "## Post" : "## Posts", "");
  for (let index = 0; index < document.roots.length; index += 1) {
    if (document.roots.length > 1) lines.push(`### Post ${index + 1}`, "");
    const root = document.roots[index];
    if (root !== undefined) lines.push(...renderRootEntry(root, 0, state));
    if (index < document.roots.length - 1) lines.push("");
  }
  if (document.warnings.length > 0) {
    lines.push("", "## Capture notes", "");
    for (const warning of document.warnings) lines.push(`- ${warning}`);
  }
  const markdown = `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
  return rewriteContent(markdown, new URL(document.sourceUrl), new Map(), { remoteImages: "embed" });
}
