import { readFileSync, writeFileSync } from 'node:fs';
const lines = readFileSync('web/mode-pages.js', 'utf8').split(/\r?\n/);
const slice = (a, b) => lines.slice(a - 1, b).join('\n');
writeFileSync('.scratch/e2e/seg-workshop.js', slice(16, 155));
writeFileSync('.scratch/e2e/seg-pilot.js', slice(157, 590));
writeFileSync('.scratch/e2e/seg-session.js', slice(592, 706));
writeFileSync('.scratch/e2e/seg-control.js', slice(708, 837));
console.log('ok');
