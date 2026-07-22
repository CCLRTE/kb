import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  CONTENT_REWRITE_TRUNCATION_WARNING,
  resolveRemote,
  rewriteContentWithStatus,
  scanImageSources,
} from "./lib.js";
import { FetchFailure, safeFetch, type SafeFetchResult } from "./network.js";

export type AssetRecord = {
  readonly source: string;
  readonly url: string;
  readonly path: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly sha256: string;
};

export type LocalizeAssetsOptions = {
  readonly assetsDirectory: string;
  readonly baseUrl: URL;
  readonly userAgent: string;
  readonly timeoutMs: number;
  readonly maxAssetBytes: number;
  readonly maxTotalAssetBytes: number;
  readonly allowPrivateNetwork: boolean;
  readonly concurrency?: number;
  /** Hard operational cap; intentionally separate from the network-byte budget. */
  readonly maxSources?: number;
  readonly fetchResource?: (url: URL, options: Parameters<typeof safeFetch>[1]) => Promise<SafeFetchResult>;
  readonly cookieHeaderProvider?: (url: URL) => Promise<string | null>;
};

export type LocalizeAssetsResult = {
  readonly content: string;
  readonly assets: readonly AssetRecord[];
  readonly warnings: readonly string[];
  readonly truncated: boolean;
};

type SniffedImage = { readonly mimeType: string; readonly extension: string };

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder().decode(bytes.slice(start, start + length));
}

/** Trust file signatures, not URL extensions or challenge-page Content-Type headers. */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mimeType: "image/jpeg", extension: "jpg" };
  const prefix = ascii(bytes, 0, 6);
  if (prefix === "GIF87a" || prefix === "GIF89a") return { mimeType: "image/gif", extension: "gif" };
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "avif" || brand === "avis") return { mimeType: "image/avif", extension: "avif" };
  }
  return null;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inertAssetUrl(url: URL): string {
  const inert = new URL(url);
  inert.username = "";
  inert.password = "";
  inert.search = "";
  inert.hash = "";
  return inert.href;
}

function safeAssetFailure(error: unknown): string {
  if (!(error instanceof FetchFailure)) return "image request failed";
  switch (error.code) {
    case "private-network": return "image request was blocked by the private-network boundary";
    case "timeout": return "image request timed out";
    case "too-large": return "image response exceeded its byte limit";
    case "redirect": return "image redirect chain was rejected";
    case "dns": return "image hostname could not be resolved";
    case "http": return "image server returned an unsuccessful response";
    case "invalid-url": return "image URL was rejected";
    case "network": return "image request failed";
  }
}

type DownloadResult =
  | { readonly ok: true; readonly source: string; readonly url: URL; readonly bytes: Uint8Array; readonly image: SniffedImage; readonly networkBytes: number }
  | { readonly ok: false; readonly source: string; readonly warning: string; readonly networkBytes: number };

async function downloadImage(source: string, options: LocalizeAssetsOptions, maxBytes: number): Promise<DownloadResult> {
  const remote = resolveRemote(source, options.baseUrl);
  if (remote === null) return { ok: false, source, warning: "Skipped a non-web image target.", networkBytes: 0 };
  let authenticationWarning: string | null = null;
  let cookieHeader: string | undefined;
  if (options.cookieHeaderProvider !== undefined) {
    try {
      cookieHeader = (await options.cookieHeaderProvider(remote)) ?? undefined;
    } catch {
      authenticationWarning = "The explicitly selected cookie source could not provide origin-scoped image cookies.";
    }
  }
  try {
    const response = await (options.fetchResource ?? safeFetch)(remote, {
      timeoutMs: options.timeoutMs,
      maxBytes,
      allowPrivateNetwork: options.allowPrivateNetwork,
      userAgent: options.userAgent,
      referer: options.baseUrl.href,
      accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1",
      ...(cookieHeader === undefined ? {} : { cookieHeader }),
      retries: 0,
    });
    const image = sniffImage(response.bytes);
    if (image === null) {
      const declared = response.contentType?.split(";")[0]?.trim() ?? "unknown content type";
      return {
        ok: false,
        source,
        warning: `${authenticationWarning === null ? "" : `${authenticationWarning} `}Kept remote ${inertAssetUrl(remote)}: response was not a supported raster image (${declared})`,
        networkBytes: response.bytes.byteLength,
      };
    }
    return { ok: true, source, url: response.finalUrl, bytes: response.bytes, image, networkBytes: response.bytes.byteLength };
  } catch (error) {
    return {
      ok: false,
      source,
      warning: `${authenticationWarning === null ? "" : `${authenticationWarning} `}Kept remote ${inertAssetUrl(remote)}: ${safeAssetFailure(error)}`,
      networkBytes: maxBytes,
    };
  }
}

/** Download raster images with deterministic content-addressed names and bounded concurrency. */
export async function localizeAssets(content: string, options: LocalizeAssetsOptions): Promise<LocalizeAssetsResult> {
  const maxSources = Math.max(1, Math.min(options.maxSources ?? 1_000, 10_000));
  // One sentinel source preserves an exact warning for small overflows without
  // ever materializing or sorting the attacker's complete candidate set.
  const discovery = scanImageSources(content, maxSources + 1);
  const discoveredSources = [...discovery.sources].sort((left, right) => left.localeCompare(right));
  const sources = discoveredSources.slice(0, maxSources);
  const warnings: string[] = discoveredSources.length > sources.length
    ? [`Image localization stopped at ${sources.length} sources; ${discovery.truncated ? "at least " : ""}${discoveredSources.length - sources.length} additional remote image(s) remain inert links.`]
    : [];
  if (discovery.truncated) {
    warnings.push("Image discovery reached a safety limit; additional or over-limit image candidates remain inert.");
  }
  const rewrittenResult = (localBySource: ReadonlyMap<string, string>): Pick<LocalizeAssetsResult, "content" | "truncated"> => {
    const rewritten = rewriteContentWithStatus(content, options.baseUrl, localBySource, {
      maxImageSources: maxSources + 1,
    });
    if (rewritten.truncated) warnings.push(CONTENT_REWRITE_TRUNCATION_WARNING);
    return rewritten;
  };
  if (discovery.requiresInertFallback) {
    const rewritten = rewrittenResult(new Map());
    return {
      ...rewritten,
      assets: [],
      warnings,
    };
  }
  if (discoveredSources.length === 0) {
    const rewritten = rewrittenResult(new Map());
    return {
      ...rewritten,
      assets: [],
      warnings,
    };
  }
  mkdirSync(options.assetsDirectory, { recursive: true });

  const results = new Map<string, DownloadResult>();
  const workerCount = Math.max(1, Math.min(options.concurrency ?? 4, sources.length, 16));
  let remainingNetworkBytes = options.maxTotalAssetBytes;
  const deadline = Date.now() + options.timeoutMs;
  for (let cursor = 0; cursor < sources.length && remainingNetworkBytes > 0;) {
    const remainingTime = deadline - Date.now();
    if (remainingTime <= 0) break;
    const batchSize = Math.min(workerCount, sources.length - cursor, remainingNetworkBytes);
    const allocation = Math.min(options.maxAssetBytes, Math.floor(remainingNetworkBytes / batchSize));
    const batch = sources.slice(cursor, cursor + batchSize);
    cursor += batch.length;
    remainingNetworkBytes -= allocation * batch.length;
    const downloaded = await Promise.all(batch.map((source) => downloadImage(
      source,
      { ...options, timeoutMs: Math.max(1, Math.min(options.timeoutMs, remainingTime)) },
      allocation,
    )));
    for (const result of downloaded) {
      results.set(result.source, result);
      remainingNetworkBytes += Math.max(0, allocation - result.networkBytes);
    }
  }

  const localBySource = new Map<string, string>();
  const assetsByHash = new Map<string, AssetRecord>();
  let totalBytes = 0;
  let unattempted = 0;
  for (const source of sources) {
    const result = results.get(source);
    if (result === undefined) {
      unattempted += 1;
      continue;
    }
    if (!result.ok) {
      warnings.push(result.warning);
      continue;
    }
    const digest = sha256(result.bytes);
    const existing = assetsByHash.get(digest);
    if (existing !== undefined) {
      localBySource.set(source, existing.path);
      continue;
    }
    if (totalBytes + result.bytes.byteLength > options.maxTotalAssetBytes) {
      warnings.push(`Kept remote ${inertAssetUrl(result.url)}: total asset limit ${options.maxTotalAssetBytes} bytes would be exceeded`);
      continue;
    }
    const filename = `${digest}.${result.image.extension}`;
    const relativePath = `assets/${filename}`;
    writeFileSync(join(options.assetsDirectory, filename), result.bytes, { mode: 0o644 });
    totalBytes += result.bytes.byteLength;
    const record: AssetRecord = {
      source: (() => {
        const resolved = resolveRemote(source, options.baseUrl);
        return resolved === null ? source : inertAssetUrl(resolved);
      })(),
      url: inertAssetUrl(result.url),
      path: relativePath,
      mimeType: result.image.mimeType,
      bytes: result.bytes.byteLength,
      sha256: digest,
    };
    assetsByHash.set(digest, record);
    localBySource.set(source, relativePath);
  }
  if (unattempted > 0) {
    const reason = Date.now() >= deadline ? "total asset deadline" : "aggregate asset network-byte budget";
    warnings.push(`${unattempted} remote image source(s) were not requested because the ${reason} was exhausted.`);
  }

  const rewritten = rewrittenResult(localBySource);
  return {
    ...rewritten,
    assets: [...assetsByHash.values()].sort((left, right) => left.path.localeCompare(right.path)),
    warnings,
  };
}
