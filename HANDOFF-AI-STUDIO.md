# Handoff: build-out in Google AI Studio + Vercel site

Goal: continue the project in Google AI Studio (build-out) and publish a website on Vercel that explains and hosts Lingonberry Router.

## What exists (source of truth)

- Repo: `https://github.com/brusnyak/lingonberry-router` (private). Work from `main`.
- Core: Rust CLI + HTTP API in `core/`. Tests: `cd core && cargo test`.
- Install: `cargo install --path core`, then `lingonberry-core init` and `lingonberry-core doctor`.
- Behaviour contract: `README.md`. Current state: `HANDOFF.md`.

## What to build (proposed, owner to confirm)

1. **Website (Vercel).** Landing page for the router: value in one line, install commands, how-it-works diagram, CLI table, a link to the repo. Static site first; no backend.
2. **Build-out in AI Studio.** Pick the next features from HANDOFF "Open". Keep the Rust core as the engine; AI Studio work should go through the same repo and CI.
3. **Docs.** Keep README as the single reference; the website copies from it, it does not fork it.

## Constraints (carry these over)

- No secrets in the repo, the site, or AI Studio prompts. Provider keys stay in `~/.env` or `~/.config/lingonberry/env`; the router reads them itself.
- Loopback only for the router. The website is static and must not call a local port.
- No spending: Vercel and AI Studio on a free tier unless the owner approves a paid plan.
- Outward copy (site text, posts) needs owner approval before publishing.

## Decisions needed from the owner

1. Site domain and brand name (keep "Lingonberry Router" or change).
2. Vercel project owner account (the `brusnyak` GitHub login or another).
3. Is the site public or private (preview only) at first.
4. Which AI Studio features come first from HANDOFF "Open".

## Done criteria for the handoff

- `cargo test` passes on a fresh clone of `main`.
- CI is green on `main`.
- The site builds with `vercel build` and renders on a phone-width screen.
