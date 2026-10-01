import { fileHeaders, pageFiles } from "./static.ts"

/** The one Vercel Function; every path that is not a page file goes to it. */
export const FUNCTION_PATH = "/api"

/** Where a listed URL lives under `.vercel/output/static`: decoded, with `/` as `index.html`. */
export function staticFileFor(urlPath: string): string {
  const decoded = decodeURIComponent(urlPath)
  return decoded === "/" ? "index.html" : decoded.slice(1)
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * `.vercel/output/config.json` (Build Output API v3). One route per listed page file sets the same headers
 * `serveStatic` sends; then the CDN serves files; everything else, including a listed file that is missing,
 * goes to the function, which answers with `NOTICE` like `npm start` does (ADR 0003).
 */
export function buildOutputConfig(): { version: 3; routes: Record<string, unknown>[] } {
  const fileRoutes = pageFiles().map((f) => ({
    // Vercel may match the encoded or the decoded path, so a %20 in a glyph URL accepts both.
    src: `^${escapeRegex(f.path).replace(/%20/g, "(?:%20| )")}$`,
    headers: fileHeaders(f.path, f.type),
    continue: true
  }))
  return {
    version: 3,
    routes: [...fileRoutes, { handle: "filesystem" }, { src: "^/.*$", dest: FUNCTION_PATH }]
  }
}
