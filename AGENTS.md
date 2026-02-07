# Repository Guidelines

## Project Structure & Module Organization
- `main.ts` is the Obsidian plugin source; `main.js` is the built bundle referenced by `manifest.json`.
- `esbuild.config.mjs` contains the build pipeline (bundle entry is `main.ts`, output is `main.js`).
- `skills/` holds AI skill artifacts, including `skills/granola-extractor/scripts/granola-extractor.py` and skill docs at `skills/**/SKILL.md`.
- `package.json` and `tsconfig.json` define Node/TypeScript tooling and compiler settings.

## Build, Test, and Development Commands
- `npm install` installs Node dependencies for the Obsidian plugin build.
- `npm run dev` runs the esbuild watcher for local development (writes `main.js`).
- `npm run build` produces a production bundle (no inline sourcemaps).

## Coding Style & Naming Conventions
- TypeScript targets ES6 with ESNext modules; strict flags include `noImplicitAny` and `strictNullChecks` (see `tsconfig.json`).
- Keep TypeScript code in `main.ts` and avoid editing `main.js` directly (it is generated).
- Indentation in existing files uses tabs; follow the existing style in each file.
- No formatter or linter is configured yet; keep changes small and consistent with nearby code.

## Testing Guidelines
- There is no automated test framework configured in this repository.
- If you add tests, document the framework and how to run them in `README.md` and add scripts in `package.json`.

## Commit & Pull Request Guidelines
- No Git history is available in this repository, so there is no established commit message convention yet.
- When opening a PR, include a short summary, validation steps (e.g., `npm run build`), and note any Obsidian UI or settings changes. Add screenshots only if UI output is affected.

## Security & Configuration Notes
- Avoid committing personal meeting data or extracted transcripts. Skills read from local Granola caches; keep generated notes in user-specific locations outside the repo.
- The cache path in `main.ts` and `skills/granola-extractor/scripts/granola-extractor.py` uses the macOS default; on Windows, update these paths to match your Granola install location.
