// Writes .vercel/output (Vercel Build Output API v3), so Vercel deploys plain JavaScript and never
// type-checks with TypeScript 7, whose JS API its builder cannot use (ADR 0003). Run: npm run build:vercel
import { build } from "esbuild"
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULT_PUBLIC_DIR, pageFiles } from "../src/static.ts"
import { buildOutputConfig, FUNCTION_PATH, staticFileFor } from "../src/vercel-output.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const out = join(root, ".vercel", "output")
rmSync(out, { recursive: true, force: true })

// Only the listed page files, never the whole folder: the CDN must not serve anything `serveStatic` would not.
for (const f of pageFiles()) {
  const from = join(DEFAULT_PUBLIC_DIR, f.file)
  if (!existsSync(from)) {
    console.warn(`skip (not on disk): public/${f.file}`)
    continue
  }
  const to = join(out, "static", staticFileFor(f.path))
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
}

const fn = join(out, "functions", `${FUNCTION_PATH.slice(1)}.func`)
await build({
  entryPoints: [join(root, "src", "vercel.ts")],
  outfile: join(fn, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "warning"
})
writeFileSync(
  join(fn, ".vc-config.json"),
  JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false }, null, 2)
)
writeFileSync(join(out, "config.json"), JSON.stringify(buildOutputConfig(), null, 2))
console.log(`wrote ${out}`)
