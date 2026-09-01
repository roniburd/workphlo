# workphlo

A local, Electron-based, Obsidian/VSCode-like workbench for driving Claude Code.
Instead of a scrolling transcript, each session produces a **live document** made
of typed **sections** ("cells"), each owned by a specialist agent ("hat") with its
own engine + model.

See the design spec and implementation plans under `docs/superpowers/`.

## Project Setup

```bash
npm install      # install dependencies
npm run dev      # run the app in development
npm test         # run the Vitest suite
npm run typecheck
npm run build    # typecheck + build
```
