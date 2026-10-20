import { readFileSync, writeFileSync } from "node:fs";
const html = readFileSync("index.html", "utf8");
const body = readFileSync("_body.html", "utf8");
const next = html.replace(/<main>[\s\S]*<\/main>/, "<main>\n" + body + "\n</main>");
if (next === html) {
  console.log("NO REPLACE");
  process.exit(1);
}
writeFileSync("index.html", next);
console.log("sections", (next.match(/<section/g) || []).length, "bytes", next.length);
