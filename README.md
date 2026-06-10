# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
npm run build:gh-pages
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm run build:gh-pages`: create a GitHub Pages static SPA in `dist/github-pages`
- `npm run preview:gh-pages`: preview the GitHub Pages static SPA locally
- `npm run db:generate`: generate Drizzle migrations after schema changes

## GitHub Pages Static Build

This project keeps the Vinext/Cloudflare build and adds a separate GitHub
Pages target for browser-only play.

```bash
npm run build:gh-pages
```

The static output is written to `dist/github-pages`. It includes:

- `index.html` for the main static app
- `404.html` copied from `index.html` for GitHub Pages SPA fallback
- `.nojekyll` so Pages serves Vite assets as-is

The static SPA uses hash routing. The custom map builder is available at
`#/custom`. GitHub Pages does not provide `/api/maps`, so the static build uses
browser `localStorage` for map saves.

If the repository is hosted under a non-root path and assets need an explicit
base path, build with one of these:

```bash
GITHUB_PAGES_BASE=/repository-name/ npm run build:gh-pages
```

```powershell
$env:GITHUB_PAGES_BASE='/repository-name/'; npm run build:gh-pages
```

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
