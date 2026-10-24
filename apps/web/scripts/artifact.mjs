// Turn the artifact-mode build into one page for publishing: React from cdnjs,
// everything else inline, no <html>/<head>/<body> wrapper (the host adds one).
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(new URL("../dist-artifact/index.html", import.meta.url), "utf8");
const pick = (re) => [...src.matchAll(re)].map((m) => m[0]);
const styles = pick(/<style[^>]*>[\s\S]*?<\/style>/g).join("\n");
const fonts = pick(/<link rel="(?:preconnect|stylesheet)"[^>]*>/g).join("\n");
const scripts = [...src.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim());
if (scripts.length !== 1) throw new Error(`expected one inline script, found ${scripts.length}`);
const code = scripts[0].replace(/<\/script/gi, "<\\/script");

const page = `<title>Thaloroot</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
${styles}
<div id="app"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>${code}</script>
`;
writeFileSync(new URL("../dist-artifact/thaloroot.html", import.meta.url), page);
console.log(`dist-artifact/thaloroot.html: ${(page.length / 1024).toFixed(0)} KB`);
