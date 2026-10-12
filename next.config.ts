import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // The only images here are the four platform marks in /public/platforms,
    // already sized to 16px in the mode picker. Optimizing them costs a
    // round trip through the image pipeline for no bytes saved, and it is
    // what lets an SVG (gemini-color.svg) go through `next/image` untouched.
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // Directives that need no per-request nonce. A full script-src
          // policy would have to allow Next's inline hydration scripts, so
          // it is left out rather than shipped in a form that breaks the page.
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
