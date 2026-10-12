// Component tests opt into jsdom with a `@vitest-environment jsdom` pragma;
// everything else (route, lib) runs on plain node.
if (typeof window !== "undefined") {
  // jsdom has no matchMedia, which framer-motion's useReducedMotion reads.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
