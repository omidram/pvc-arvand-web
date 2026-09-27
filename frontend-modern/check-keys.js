const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const srcDir = path.join(__dirname, "src");
const translationsFile = path.join(srcDir, "lib", "i18n", "translations.ts");

const source = fs.readFileSync(translationsFile, "utf8");
const result = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
});

const moduleObj = { exports: {} };
const fn = new Function("module", "exports", "require", result.outputText);
fn(moduleObj, moduleObj.exports, require);
const { translations } = moduleObj.exports;

function getByPath(obj, p) {
  return p.split(".").reduce((acc, key) => (acc && typeof acc === "object" && key in acc ? acc[key] : undefined), obj);
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const files = walk(srcDir);
const keyRegex = /\bt\(\s*`([^`$]+)`|\bt\(\s*"([^"]+)"|\bt\(\s*'([^']+)'/g;
const dynamicKeyRegex = /\bt\(\s*`([^`]*\$\{[^}]+\}[^`]*)`/g;

let missingEn = new Set();
let missingFa = new Set();
let dynamicFound = new Set();

for (const file of files) {
  if (file === translationsFile) continue;
  const content = fs.readFileSync(file, "utf8");
  let m;
  while ((m = keyRegex.exec(content))) {
    const key = m[1] || m[2] || m[3];
    if (!key || key.includes("${")) continue;
    const enVal = getByPath(translations.en, key);
    const faVal = getByPath(translations.fa, key);
    if (typeof enVal !== "string") missingEn.add(`${key}  (${path.relative(srcDir, file)})`);
    if (typeof faVal !== "string") missingFa.add(`${key}  (${path.relative(srcDir, file)})`);
  }
  while ((m = dynamicKeyRegex.exec(content))) {
    dynamicFound.add(`${m[1]}  (${path.relative(srcDir, file)})`);
  }
}

console.log("=== Missing EN keys ===");
console.log(missingEn.size ? [...missingEn].join("\n") : "(none)");
console.log("\n=== Missing FA keys ===");
console.log(missingFa.size ? [...missingFa].join("\n") : "(none)");
console.log("\n=== Dynamic keys (manual check) ===");
console.log(dynamicFound.size ? [...dynamicFound].join("\n") : "(none)");
