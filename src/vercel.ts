import { createRequestListener } from "./server.ts"

/**
 * Vercel Function entry (ADR 0003). The same pipeline as `npm start`, minus the page files: Vercel's CDN
 * serves those from the build output, with byte ranges for the tiles. This file only ever runs on Vercel,
 * so it says so itself instead of trusting a variable. Bundled by scripts/build-vercel.ts.
 */
export default createRequestListener(undefined, { files: false, env: { ...process.env, VERCEL: "1" } })
