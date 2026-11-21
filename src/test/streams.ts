/** Test helpers for building byte streams and SSE responses. */

export function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

/** An OpenAI-style SSE response carrying each object as one `data:` event, then [DONE]. */
export function sseResponse(
  objects: unknown[],
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const body = objects.map((o) => `data: ${JSON.stringify(o)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(streamOf([body]), {
    status: init.status ?? 200,
    headers: { 'content-type': 'text/event-stream', ...init.headers },
  })
}

/** A stream that emits nothing and never closes until `signal` aborts. */
export function hangingStream(signal?: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      signal?.addEventListener('abort', () => controller.error(signal.reason))
    },
  })
}

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const x of it) out.push(x)
  return out
}
