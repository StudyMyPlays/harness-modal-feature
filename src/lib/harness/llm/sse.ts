/**
 * Server-sent events → the `data:` payload of each event.
 *
 * Only `data` fields matter to the OpenAI-style streams this reads; `event`,
 * `id` and comment lines are skipped. `[DONE]` ends the stream even if the
 * server keeps the connection open.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []

  // Returns true when the stream is finished ([DONE]).
  function* flushEvent(): Generator<string, boolean> {
    if (data.length === 0) return false
    const payload = data.join('\n')
    data = []
    if (payload === '[DONE]') return true
    yield payload
    return false
  }

  function* takeLine(line: string): Generator<string, boolean> {
    if (line === '') return yield* flushEvent()
    if (line.startsWith(':')) return false
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    if (field !== 'data') return false
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    data.push(value)
    return false
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (yield* takeLine(line)) return
      }
      if (done) {
        if (buffer) {
          const line = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
          buffer = ''
          if (yield* takeLine(line)) return
        }
        yield* flushEvent()
        return
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}
