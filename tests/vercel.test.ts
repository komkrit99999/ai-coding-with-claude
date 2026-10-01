import { readFileSync } from "node:fs"
import { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { handle, NOTICE } from "../src/app.ts"
import { clientKeyFromRequest } from "../src/rate-limit.ts"
import { createReportStore, RATE_LIMIT_MAX, reportsOpen, reportsOpenUntilFromEnv } from "../src/reports.ts"
import { createAppServer, type Handler, type ServerOptions } from "../src/server.ts"
import { fileHeaders, pageFiles } from "../src/static.ts"
import { buildOutputConfig, staticFileFor } from "../src/vercel-output.ts"

const now = new Date("2026-10-08T03:00:00Z")
const report = { landmark: "ปากซอยลาดพร้าว 71", depth: "knee", seenAt: "2026-10-08T09:50:00+07:00" }

describe("client key on Vercel (RPT-REQ-009, ADR 0003)", () => {
  it("on Vercel comes from x-vercel-forwarded-for, normalized like a socket address", () => {
    expect(clientKeyFromRequest("10.0.0.1", { "x-vercel-forwarded-for": "203.0.113.7" }, true)).toBe("203.0.113.7")
    expect(clientKeyFromRequest("10.0.0.1", { "x-vercel-forwarded-for": "2001:db8:1:2:aaaa::1" }, true)).toBe("2001:db8:1:2::/64")
  })

  it("on Vercel never reads X-Forwarded-For or Forwarded, and a missing header is the unknown bucket", () => {
    expect(clientKeyFromRequest("10.0.0.1", { "x-forwarded-for": "198.51.100.1", forwarded: "for=198.51.100.2" }, true)).toBe("unknown")
  })

  it("off Vercel ignores x-vercel-forwarded-for: anyone can send it there", () => {
    expect(clientKeyFromRequest("::ffff:192.0.2.5", { "x-vercel-forwarded-for": "203.0.113.7" }, false)).toBe("192.0.2.5")
  })
})

describe("reporting window (RPT-REQ-018)", () => {
  it("off Vercel with nothing set there is no window: always open", () => {
    expect(reportsOpenUntilFromEnv({})).toBeUndefined()
    expect(reportsOpen(undefined, now)).toBe(true)
  })

  it("on Vercel a missing or unreadable REPORTS_OPEN_UNTIL means closed", () => {
    for (const value of [undefined, "", "tomorrow", "2026-10-08T12:00:00"]) {
      const until = reportsOpenUntilFromEnv({ VERCEL: "1", REPORTS_OPEN_UNTIL: value })
      expect(reportsOpen(until, now)).toBe(false)
    }
  })

  it("is open until the instant, closed from it on", () => {
    const until = reportsOpenUntilFromEnv({ VERCEL: "1", REPORTS_OPEN_UNTIL: "2026-10-08T12:00:00+07:00" })
    expect(reportsOpen(until, new Date("2026-10-08T04:59:59.999Z"))).toBe(true)
    expect(reportsOpen(until, new Date("2026-10-08T05:00:00Z"))).toBe(false)
  })

  it("POST while closed is 403 reports_closed with the notice, and costs no quota", () => {
    const reports = createReportStore()
    const closed = { now, clientKey: "203.0.113.7", reports, reportsOpenUntil: new Date(0) }
    for (let i = 0; i <= RATE_LIMIT_MAX; i++) {
      expect(handle("POST", "/districts/lat-phrao/reports", report, closed)).toEqual({
        status: 403,
        body: { notice: NOTICE, error: "reports_closed" }
      })
    }
    const open = handle("POST", "/districts/lat-phrao/reports", report, { ...closed, reportsOpenUntil: new Date("2026-10-08T05:00:00Z") })
    expect(open.status).toBe(201)
  })

  it("GET /districts says whether reporting is open, so the page can hide the form", () => {
    const body = (until?: Date) => handle("GET", "/districts", undefined, { now, ...(until ? { reportsOpenUntil: until } : {}) }).body
    expect(body()).toMatchObject({ reportsOpen: true })
    expect(body(new Date(0))).toMatchObject({ reportsOpen: false })
  })
})

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))))
})

async function start(options: ServerOptions): Promise<string> {
  const reports = createReportStore()
  const handler: Handler = (method, path, body, ctx) => handle(method, path, body, { ...ctx, reports })
  const server = createAppServer(handler, options)
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const post = (base: string, headers: Record<string, string>) =>
  fetch(`${base}/districts/lat-phrao/reports`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ ...report, seenAt: new Date().toISOString() })
  })

describe("the Vercel function pipeline", () => {
  const vercelEnv = { VERCEL: "1", REPORTS_OPEN_UNTIL: "2099-01-01T00:00:00Z" }

  it("gives each client its own quota by x-vercel-forwarded-for", async () => {
    const base = await start({ files: false, env: vercelEnv })
    for (let i = 0; i < RATE_LIMIT_MAX; i++) expect((await post(base, { "x-vercel-forwarded-for": "203.0.113.1" })).status).not.toBe(429)
    expect((await post(base, { "x-vercel-forwarded-for": "203.0.113.1" })).status).toBe(429)
    // Same landmark, so it merges (200): accepted, not limited.
    expect((await post(base, { "x-vercel-forwarded-for": "203.0.113.2" })).status).toBe(200)
  })

  it("is closed on Vercel when REPORTS_OPEN_UNTIL is not set", async () => {
    const base = await start({ files: false, env: { VERCEL: "1" } })
    const res = await post(base, { "x-vercel-forwarded-for": "203.0.113.1" })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ notice: NOTICE, error: "reports_closed" })
  })

  it("leaves page files to the CDN, and API answers say noindex", async () => {
    const base = await start({ files: false, env: vercelEnv })
    const page = await fetch(`${base}/`)
    expect(page.status).toBe(404)
    expect(page.headers.get("x-robots-tag")).toBe("noindex, nofollow")
    expect(await page.json()).toMatchObject({ notice: NOTICE })
  })
})

describe("Vercel build output config", () => {
  const config = buildOutputConfig()

  it("sets the same headers on every listed page file as npm start does", () => {
    for (const f of pageFiles()) {
      const route = config.routes.find((r) => typeof r.src === "string" && new RegExp(r.src).test(f.path))
      expect(route, f.path).toBeDefined()
      expect(route?.headers).toEqual(fileHeaders(f.path, f.type))
    }
  })

  it("sends the page with the strict CSP and noindex", () => {
    const headers = fileHeaders("/", "text/html; charset=utf-8")
    expect(headers["content-security-policy"]).toContain("default-src 'self'")
    expect(headers["x-robots-tag"]).toBe("noindex, nofollow")
  })

  it("serves files from the CDN first, then sends everything else to the function", () => {
    expect(config.routes.slice(-2)).toEqual([{ handle: "filesystem" }, { src: "^/.*$", dest: "/api" }])
  })

  it("places files at their decoded path, with / as index.html", () => {
    expect(staticFileFor("/")).toBe("index.html")
    expect(staticFileFor("/vendor/glyphs/Noto%20Sans%20Regular/0-255.pbf")).toBe("vendor/glyphs/Noto Sans Regular/0-255.pbf")
  })

  it("robots.txt disallows everything", () => {
    expect(readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8")).toBe("User-agent: *\nDisallow: /\n")
  })
})

describe("map page when reporting is closed", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8")
  const js = readFileSync(new URL("../public/app.js", import.meta.url), "utf8")

  it("has a closed note in both tabs, and the page reads reportsOpen", () => {
    expect(html.match(/class="hint closed-note"/g)).toHaveLength(2)
    expect(js).toContain('classList.toggle("reports-closed", list.body.reportsOpen === false)')
  })
})
