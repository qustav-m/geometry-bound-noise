import { defineConfig } from 'vite';

//GitHub Pages serves the project under /geometry-bound-noise/ --> the build needs that base path
//--> the dev server keeps using / so http://localhost:5173/ stays the same
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/geometry-bound-noise/' : '/',
}));
