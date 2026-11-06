# Geometry-bound noise

Procedural noise that is bound to the surface of 3D objects, yet spread evenly across the screen. Like a texture, it moves with the objects, and its patterns get smaller with distance. But as they get smaller they fade out while coarser patterns fade in, so the noise on screen stays evenly spread at about the same grain size.

**Live demo:** https://qustav-m.github.io/geometry-bound-noise/

## What it does

- **Noise on the surface:** value noise is generated directly in the fragment shader from the mesh's UV coordinates. Every object gets its own seed.
- **Anisotropic filtering:** for every pixel, the shader computes how the pixel's footprint is stretched on the surface (an ellipse from the screen-space derivatives of the UVs). The noise level is chosen from the short axis, and up to 16 samples are taken along the long axis. Two neighbouring levels are blended so there are no jumps.
- **Contrast-preserving blending:** a mix of two uniform values clusters around the middle, so filtered noise would fade to grey. A **probability integral transform (PIT)** — the CDF of the mix — makes it uniform again (exact for independent inputs).
- **Post-processing in two passes:**
  - **Spiral blur:** samples a square around each pixel in an inward spiral and mixes them one by one with the same contrast-preserving mix — the center has the most influence.
  - **Final blur:** an exact median over a circle, found by binary search over the 256 brightness levels instead of sorting.

## Controls

- **Mouse:** left drag rotates, scroll zooms, right drag pans.
- **Resolution slider:** render resolution relative to the window (logarithmic). Starts at 960 px wide; pixels are scaled up sharply, so you can see exactly what the shader computes per pixel.
- **Spiral blur r:** radius of the spiral blur (0 = off).
- **Final blur r:** radius of the median (0 = off).
- **Model upload:** load your own `.glb` (or a `.gltf` with embedded data). It replaces the current model, is scaled to the same height and gets the noise on every mesh. The model needs UV coordinates — without them the noise can't work, and a warning is shown.
- **FPS** are shown in the panel.

## Run locally

Requires [Node.js](https://nodejs.org/) 20 or newer.

```sh
npm install
npm run dev
```

Then open http://localhost:5173/.

`npm run build` creates a production build in `dist/`. Every push to `main` is built and published to GitHub Pages automatically.
