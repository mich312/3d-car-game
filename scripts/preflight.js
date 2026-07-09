// Runs before `npm run dev` / `npm run build`. If the dev tooling is missing
// (typically because dependencies were installed with --production/--omit=dev
// or NODE_ENV=production, or npm install was never run), fail with a clear
// message instead of a cryptic "vite: not found".
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const missing = ['vite', 'concurrently', '@vitejs/plugin-react'].filter(
  (dep) => !fs.existsSync(path.join(root, 'node_modules', dep))
);

if (missing.length > 0) {
  console.error(
    `\nMissing dev tooling: ${missing.join(', ')}\n\n` +
      'Fix it by installing ALL dependencies (including devDependencies):\n\n' +
      '    npm install\n\n' +
      'Notes:\n' +
      '  - Do not use --production or --omit=dev for development.\n' +
      '  - If NODE_ENV=production is set in your environment, npm skips\n' +
      '    devDependencies; unset it or run: npm install --include=dev\n'
  );
  process.exit(1);
}
