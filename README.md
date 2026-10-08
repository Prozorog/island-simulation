# Island Simulation

Interactive coastal island and water simulation, published from Shore Water Site version 16.

Live site: https://shore-water-coastal-surf.serik-sktl.chatgpt.site/

## Run the published snapshot

No build is needed to inspect the published HTML files. From the repository root, run:

```sh
python3 -m http.server 8080 --directory dist
```

Then open http://localhost:8080/ in a modern browser. The main page retains the published version-selection navigation. The current layered-water / optics candidate is at http://localhost:8080/layered-water/ . WebGPU requires a supported browser, GPU, and a secure context (localhost is supported); the older WebGL comparison is included at `/shore-water-v9.html`.

## Source layout

- `dist/`: exact runnable static snapshot of Site version 16, including version comparisons and standalone downloads.
- `source/optics-2.2/`: modular source for the current optics candidate.
- `source/alfred-2.1a/`: earlier character candidate source.
- `experimental-layered-source/`: earlier layered-water source.
- `webgpu/`: earlier WebGPU baseline source.

Each source directory has its own package.json and build script. For example:

```sh
cd source/optics-2.2
npm ci
npm run build
python3 -m http.server 8081 --directory dist
```

Use Node.js 20 or newer. The source build writes its own `dist/index.html`; it does not replace the root published snapshot. Dependencies are pinned in the lockfile. Browser feature support and performance vary by GPU. This is an experimental simulation, not a production physics engine.

## Snapshot provenance

This repository starts with a clean source snapshot of Site version 16 (2026-10-07), commit `177117d0c89c3bbab6aefc5778f1767d02e740af`. It does not import earlier private Git history, deployment configuration, credentials, private reference images, or internal QA records. Later unpublished experimental work is not included.

## Third-party notices

Existing dependency and bundled-source copyright/license notices are preserved. Dependencies including Three.js, esbuild, pngjs, and webgpu retain their respective licenses. Links and attributions already present in the simulation are preserved. No new blanket license is assigned to project code or embedded assets by this publication.
