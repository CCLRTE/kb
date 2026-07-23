import { captureUrl, type CaptureArguments, type CaptureScope } from "./args.js";
import type { AcquisitionMethod, AcquiredPage } from "./acquire.js";
import { countWords, type CaptureStatus, type ExtractedPage } from "./extract.js";
import type { Article } from "./lib.js";
import { decodeBytes, safeFetch } from "./network.js";
import {
  classifyPlatformUrl,
  parseBlueskyCapture,
  parseHackerNewsCapture,
  parseRedditCapture,
  renderCapturedDocument,
  type CapturedContentEntry,
  type CapturedDocument,
  type CapturedEntry,
  type PlatformUrl,
} from "./platforms.js";

export type PublicStructuredCapture = {
  readonly extraction: ExtractedPage;
  readonly evidence: string;
};

export type JsonFetcher = (url: URL, maxBytes: number, timeoutMs?: number) => Promise<unknown>;

type AdapterDependencies = {
  readonly fetchJson?: JsonFetcher;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const itemId = (value: unknown): string | null => {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
};

type HackerNewsPendingItem = { readonly id: string; readonly depth: number };

const enqueueHackerNewsChildren = (
  value: unknown,
  depth: number,
  maximumQueueSize: number,
  queue: HackerNewsPendingItem[],
  scheduled: Set<string>,
): { readonly duplicate: boolean; readonly truncated: boolean } => {
  if (!isRecord(value) || !Array.isArray(value.kids)) return { duplicate: false, truncated: false };
  let duplicate = false;
  for (const child of value.kids) {
    const id = itemId(child);
    if (id === null) continue;
    if (scheduled.has(id)) {
      duplicate = true;
      continue;
    }
    if (queue.length >= maximumQueueSize) return { duplicate, truncated: true };
    scheduled.add(id);
    queue.push({ id, depth });
  }
  return { duplicate, truncated: false };
};

async function defaultJsonFetcher(
  options: CaptureArguments,
  url: URL,
  maxBytes: number,
  timeoutMs = options.timeoutMs,
): Promise<unknown> {
  const response = await safeFetch(url, {
    timeoutMs,
    maxBytes,
    allowPrivateNetwork: options.allowPrivateNetwork,
    userAgent: options.userAgent,
    accept: "application/json",
    retries: 2,
  });
  const text = decodeBytes(response.bytes, response.contentType);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`invalid JSON from ${url.origin}`, { cause: error });
  }
}

function serializedBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function walkDocument(document: CapturedDocument): {
  readonly pageItems: number;
  readonly scopedItems: number;
  readonly incomplete: boolean;
  readonly rootIncomplete: boolean;
  readonly blockedRoot: boolean;
} {
  let pageItems = 0;
  let scopedItems = 0;
  let incomplete = false;
  let rootIncomplete = false;
  let blockedRoot = false;
  const active = new WeakSet<object>();
  const visit = (entry: CapturedEntry, location: "ancestor" | "root" | "quote" | "reply"): void => {
    if (active.has(entry)) {
      incomplete = true;
      return;
    }
    active.add(entry);
    if (entry.kind === "boundary" || entry.kind === "more") {
      incomplete = true;
      if (location === "root") rootIncomplete = true;
      active.delete(entry);
      return;
    }
    const unavailable = entry.kind === "unavailable";
    const unavailableButRepresented = unavailable && (entry.reason === "deleted" || entry.reason === "dead" || entry.reason === "removed");
    const captured = entry.kind === "content" || unavailableButRepresented;
    if (location === "root" && captured) pageItems += 1;
    if (location === "reply" && captured) scopedItems += 1;
    if (unavailable && (entry.reason === "not-found" || entry.reason === "blocked")) incomplete = true;
    if (location === "root" && unavailable && (entry.reason === "not-found" || entry.reason === "blocked")) {
      rootIncomplete = true;
    }
    if (location === "root" && unavailable && entry.reason === "blocked") blockedRoot = true;
    if (entry.kind === "content") {
      for (const quote of entry.quotes) visit(quote, "quote");
      for (const reply of entry.replies) visit(reply, "reply");
    } else if (entry.kind === "unavailable") {
      for (const reply of entry.replies) visit(reply, "reply");
    }
    active.delete(entry);
  };
  for (const entry of document.ancestors) visit(entry, "ancestor");
  for (const entry of document.roots) visit(entry, "root");
  return { pageItems, scopedItems, incomplete, rootIncomplete, blockedRoot };
}

const rootContent = (document: CapturedDocument): CapturedContentEntry | null => {
  const root = document.roots[0];
  return root?.kind === "content" ? root : null;
};

function structuredStatus(
  document: CapturedDocument,
  scope: CaptureScope,
  adapterWarnings: readonly string[],
): {
  readonly status: CaptureStatus;
  readonly capturedItems: number;
  readonly expectedItems: number | null;
  readonly declaredItems: number | null;
} {
  const walked = walkDocument(document);
  const root = rootContent(document);
  if (scope === "page") {
    return {
      status: walked.blockedRoot
        ? "blocked"
        : walked.rootIncomplete || walked.pageItems === 0 || adapterWarnings.length > 0 ? "partial" : "complete",
      capturedItems: walked.pageItems,
      expectedItems: null,
      declaredItems: null,
    };
  }
  const declaredItems = root?.metrics.replies ?? null;
  const expectedItems = declaredItems === null ? null : Math.max(declaredItems, walked.scopedItems);
  if (walked.blockedRoot) {
    return { status: "blocked", capturedItems: walked.scopedItems, expectedItems, declaredItems };
  }
  const shortOfDeclared = declaredItems !== null && walked.scopedItems < declaredItems;
  return {
    status: walked.incomplete || shortOfDeclared || adapterWarnings.length > 0 ? "partial" : "complete",
    capturedItems: walked.scopedItems,
    expectedItems,
    declaredItems,
  };
}

export function structuredCaptureFromDocument(
  options: CaptureArguments,
  document: CapturedDocument,
  evidence: unknown,
  method: AcquisitionMethod,
  adapterWarnings: readonly string[],
  extractor = `${document.platform}-public-api`,
): PublicStructuredCapture {
  const rendered = renderCapturedDocument(document);
  const content = rendered.replace(/^# [^\n]+\n\n/, "").trim();
  const root = rootContent(document);
  const article: Article = {
    content,
    title: document.title,
    author: root?.author?.name ?? null,
    published: root?.createdAt ?? null,
    description: null,
  };
  const completeness = structuredStatus(document, options.scope, [...adapterWarnings, ...document.warnings]);
  const warnings = [...adapterWarnings, ...document.warnings];
  if (completeness.declaredItems !== null && completeness.capturedItems > completeness.declaredItems) {
    warnings.push(
      `The source declared ${completeness.declaredItems} scoped items, but ${completeness.capturedItems} distinct items were captured; the expected count was normalized to the observed count.`,
    );
  }
  if (completeness.status !== "complete") {
    warnings.push(`Structured ${document.platform} capture is ${completeness.status}; limits or unavailable branches remain.`);
  }
  const acquisition: AcquiredPage = {
    body: JSON.stringify(evidence),
    contentType: "application/json",
    finalUrl: captureUrl(options),
    method,
    warnings,
  };
  const wordCount = countWords(content);
  const statusWeight: Readonly<Record<CaptureStatus, number>> = {
    complete: 100_000,
    partial: 60_000,
    "auth-required": 0,
    blocked: -10_000,
    unsupported: -20_000,
  };
  return {
    extraction: {
      article,
      canonicalUrl: new URL(document.sourceUrl),
      platform: document.platform,
      status: completeness.status,
      score: statusWeight[completeness.status] + Math.min(content.length, 50_000) + completeness.capturedItems * 50,
      wordCount,
      expectedItems: completeness.expectedItems,
      capturedItems: completeness.capturedItems,
      extractor,
      warnings,
      acquisition,
    },
    evidence: `${JSON.stringify(evidence, null, 2)}\n`,
  };
}

async function captureHackerNews(
  options: CaptureArguments,
  classified: Extract<PlatformUrl, { readonly platform: "hacker-news" }>,
  fetchJson: JsonFetcher,
): Promise<PublicStructuredCapture> {
  const endpoint = (id: string): URL => new URL(`https://hacker-news.firebaseio.com/v0/item/${encodeURIComponent(id)}.json`);
  const deadline = Date.now() + options.timeoutMs;
  let remainingBytes = options.maxHtmlBytes;
  const remainingTime = (): number => {
    const value = deadline - Date.now();
    if (value <= 0) throw new Error(`Hacker News capture exceeded the ${options.timeoutMs}ms total deadline`);
    return value;
  };
  const rootAllocation = Math.min(remainingBytes, 1024 * 1024);
  if (rootAllocation < 1) throw new Error("Hacker News capture has no remaining response-byte budget");
  remainingBytes -= rootAllocation;
  const root = await fetchJson(endpoint(classified.itemId), rootAllocation, remainingTime());
  const rootBytes = serializedBytes(root);
  if (!Number.isFinite(rootBytes) || rootBytes > rootAllocation) {
    throw new Error("Hacker News root item exceeded its bounded JSON allocation");
  }
  remainingBytes += rootAllocation - rootBytes;
  if (!isRecord(root) || itemId(root.id) === null) throw new Error("Hacker News API returned no root item");

  if (options.scope === "page") {
    const evidence = { root, descendants: [] };
    const parsed = parseHackerNewsCapture(evidence, classified.href, {
      limits: { maxItems: options.maxItems, maxDepth: options.maxDepth },
    });
    if (!parsed.ok) throw new Error(parsed.error.message);
    return structuredCaptureFromDocument(options, parsed.document, evidence, "hacker-news-api", []);
  }

  const descendants: unknown[] = [];
  const warnings: string[] = [];
  const scheduled = new Set<string>([classified.itemId]);
  const queue: HackerNewsPendingItem[] = [];
  const initialChildren = enqueueHackerNewsChildren(
    root,
    1,
    Math.max(0, options.maxItems - 1),
    queue,
    scheduled,
  );
  let duplicateChildren = initialChildren.duplicate;
  let limited = initialChildren.truncated;
  while (queue.length > 0 && descendants.length + 1 < options.maxItems) {
    const remaining = options.maxItems - descendants.length - 1;
    const batchSize = Math.min(8, remaining, queue.length, remainingBytes);
    if (batchSize < 1) {
      limited = true;
      break;
    }
    const batch = queue.splice(0, batchSize);
    const allocation = Math.min(64 * 1024, Math.floor(remainingBytes / batch.length));
    remainingBytes -= allocation * batch.length;
    const fetched = await Promise.all(batch.map(async ({ id, depth }) => {
      try {
        const value = await fetchJson(endpoint(id), allocation, remainingTime());
        const bytes = serializedBytes(value);
        if (!Number.isFinite(bytes) || bytes > allocation) {
          return { id, depth, value: null, warning: `Hacker News item ${id} exceeded its bounded JSON allocation.` };
        }
        remainingBytes += allocation - bytes;
        return { id, depth, value, warning: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { id, depth, value: null, warning: `Could not fetch Hacker News item ${id}: ${message}` };
      }
    }));
    const childrenToSchedule: { readonly value: unknown; readonly depth: number }[] = [];
    for (const result of fetched) {
      if (result.warning !== null) warnings.push(result.warning);
      if (result.value === null) continue;
      descendants.push(result.value);
      childrenToSchedule.push({ value: result.value, depth: result.depth });
    }
    const maximumQueueSize = Math.max(0, options.maxItems - descendants.length - 1);
    for (const result of childrenToSchedule) {
      const atDepthLimit = result.depth >= options.maxDepth - 1;
      const enqueued = enqueueHackerNewsChildren(
        result.value,
        result.depth + 1,
        atDepthLimit ? queue.length : maximumQueueSize,
        queue,
        scheduled,
      );
      duplicateChildren = duplicateChildren || enqueued.duplicate;
      limited = limited || enqueued.truncated;
    }
  }
  if (duplicateChildren) warnings.push("Hacker News duplicate or cyclic child IDs were skipped.");
  if (queue.length > 0 || limited) {
    warnings.push("Hacker News descendants exceeded the configured item, depth, byte, or total-deadline limit.");
  }
  const evidence = { root, descendants };
  const parsed = parseHackerNewsCapture(evidence, classified.href, {
    limits: { maxItems: options.maxItems, maxDepth: options.maxDepth },
  });
  if (!parsed.ok) throw new Error(parsed.error.message);
  const document: CapturedDocument = {
    ...parsed.document,
    warnings: [...parsed.document.warnings, ...warnings],
  };
  return structuredCaptureFromDocument(options, document, evidence, "hacker-news-api", warnings);
}

async function captureBluesky(
  options: CaptureArguments,
  classified: Extract<PlatformUrl, { readonly platform: "bluesky" }>,
  fetchJson: JsonFetcher,
): Promise<PublicStructuredCapture> {
  let did = classified.actor;
  const evidence: Record<string, unknown> = {};
  if (!did.startsWith("did:")) {
    const resolveUrl = new URL("https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle");
    resolveUrl.searchParams.set("handle", did);
    const resolution = await fetchJson(resolveUrl, Math.min(options.maxHtmlBytes, 1024 * 1024));
    evidence.resolution = resolution;
    if (!isRecord(resolution) || typeof resolution.did !== "string" || !resolution.did.startsWith("did:")) {
      throw new Error(`Bluesky could not resolve ${classified.actor}`);
    }
    did = resolution.did;
  }
  const threadUrl = new URL("https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread");
  threadUrl.searchParams.set("uri", `at://${did}/app.bsky.feed.post/${classified.postId}`);
  threadUrl.searchParams.set("depth", options.scope === "page" ? "0" : String(Math.min(options.maxDepth, 1000)));
  threadUrl.searchParams.set("parentHeight", String(Math.min(options.maxDepth, 1000)));
  const thread = await fetchJson(threadUrl, options.maxHtmlBytes);
  evidence.thread = thread;
  const parsed = parseBlueskyCapture(thread, classified.href, {
    limits: { maxItems: options.maxItems, maxDepth: options.maxDepth },
  });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return structuredCaptureFromDocument(options, parsed.document, evidence, "bluesky-api", []);
}

function rootOnlyRedditInput(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  const values: readonly unknown[] = input;
  const post: unknown = values[0];
  return post === undefined ? values : [post];
}

function redditHasPagination(input: unknown): boolean {
  if (!Array.isArray(input)) return false;
  const comments: unknown = input[1];
  if (!isRecord(comments)) return false;
  const data = isRecord(comments.data) ? comments.data : null;
  return data !== null && data.after !== undefined && data.after !== null;
}

/** Best-effort Reddit listing JSON. This endpoint is public but unofficial and may be denied by Reddit. */
async function captureReddit(
  options: CaptureArguments,
  classified: Extract<PlatformUrl, { readonly platform: "reddit" }>,
  fetchJson: JsonFetcher,
): Promise<PublicStructuredCapture> {
  const endpoint = new URL(`https://www.reddit.com/comments/${encodeURIComponent(classified.postId)}.json`);
  endpoint.searchParams.set("raw_json", "1");
  endpoint.searchParams.set("limit", String(Math.max(1, options.maxItems - 1)));
  endpoint.searchParams.set("depth", String(options.scope === "page" ? 0 : options.maxDepth));
  if (classified.commentId !== null) endpoint.searchParams.set("comment", classified.commentId);
  const evidence = await fetchJson(endpoint, options.maxHtmlBytes, options.timeoutMs);
  const parserInput = options.scope === "page" ? rootOnlyRedditInput(evidence) : evidence;
  const parsed = parseRedditCapture(parserInput, classified.href, {
    limits: { maxItems: options.maxItems, maxDepth: options.maxDepth },
  });
  if (!parsed.ok) throw new Error(parsed.error.message);
  const warnings = options.scope !== "page" && redditHasPagination(evidence)
    ? ["Reddit JSON returned a pagination cursor; additional comments remain uncaptured."]
    : [];
  const storedEvidence = options.scope === "page" ? parserInput : evidence;
  return structuredCaptureFromDocument(options, parsed.document, storedEvidence, "reddit-json", warnings, "reddit-json");
}

/** Use stable public APIs where they preserve more structure than page scraping. */
export async function acquirePublicStructured(
  options: CaptureArguments,
  dependencies: AdapterDependencies = {},
): Promise<PublicStructuredCapture | null> {
  const classified = classifyPlatformUrl(captureUrl(options).href);
  if (classified === null) return null;
  const fetchJson = dependencies.fetchJson
    ?? ((url, maxBytes, timeoutMs) => defaultJsonFetcher(options, url, maxBytes, timeoutMs));
  if (classified.platform === "hacker-news") return captureHackerNews(options, classified, fetchJson);
  if (classified.platform === "bluesky") return captureBluesky(options, classified, fetchJson);
  if (classified.platform === "reddit") return captureReddit(options, classified, fetchJson);
  return null;
}
