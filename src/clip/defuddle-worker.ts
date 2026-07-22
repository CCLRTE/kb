import { Defuddle } from "defuddle/node";

type WorkerResponse =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string };

type WorkerGlobal = {
  onmessage: ((event: MessageEvent<unknown>) => void | Promise<void>) | null;
  postMessage: (value: WorkerResponse) => void;
};

const workerGlobal = globalThis as unknown as WorkerGlobal;

workerGlobal.onmessage = async (event: MessageEvent<unknown>): Promise<void> => {
  const request = event.data;
  if (
    typeof request !== "object"
    || request === null
    || Array.isArray(request)
    || !("html" in request)
    || typeof request.html !== "string"
    || !("url" in request)
    || typeof request.url !== "string"
    || !("includeReplies" in request)
    || (request.includeReplies !== true && request.includeReplies !== false && request.includeReplies !== "extractors")
  ) {
    workerGlobal.postMessage({ ok: false, message: "Defuddle worker received an invalid request." });
    return;
  }
  try {
    const value = await Defuddle(request.html, request.url, {
      markdown: false,
      separateMarkdown: true,
      includeReplies: request.includeReplies,
      useAsync: false,
      removeImages: false,
    });
    workerGlobal.postMessage({ ok: true, value });
  } catch {
    workerGlobal.postMessage({ ok: false, message: "Defuddle could not parse this acquisition." });
  }
};
