// Assemble dist-artifact/ en un seul fichier HTML autonome (page en ligne, pour téléphone)
import { readFileSync, writeFileSync, readdirSync } from 'fs';
const dir = 'dist-artifact/assets/';
const files = readdirSync(dir);
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(dir + f, 'utf8')).join('\n');
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(dir + f, 'utf8')).join('\n').replace(/<\/script/gi, '<\\/script');
const html = readFileSync('index.html', 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[^>]*src=[^>]*><\/script>/, '');
const out = `<title>Beatbox Studio</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
${body.trim()}
<script type="module">${js}</script>
`;
writeFileSync('dist-artifact/beatbox-boucle.html', out);
console.log('dist-artifact/beatbox-boucle.html', (out.length / 1024).toFixed(0) + ' Ko');
