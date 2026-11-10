import fs from "node:fs";
import path from "node:path";

const failures = [];
const srcDir = path.resolve("src");

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  const file = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(file)) {
    fail(`Missing expected file: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

const teacherLayout = read("src/layouts/TeacherLayout.tsx");
const adminLayout = read("src/layouts/AdminLayout.tsx");
const registrarLayout = read("src/layouts/RegistrarLayout.tsx");
const main = read("src/main.tsx");
const viteConfig = read("vite.config.ts");

if (!teacherLayout.includes("InstallAppButton")) {
  fail("TeacherLayout must mount InstallAppButton.");
}
if (!teacherLayout.includes("OfflineBanner")) {
  fail("TeacherLayout must mount OfflineBanner.");
}
if (!teacherLayout.includes("registerTeacherPwa")) {
  fail("TeacherLayout must register the teacher service worker.");
}

for (const [name, source] of [
  ["AdminLayout", adminLayout],
  ["RegistrarLayout", registrarLayout],
  ["main.tsx", main],
]) {
  for (const forbidden of [
    "InstallAppButton",
    "OfflineBanner",
    "registerTeacherPwa",
    "virtual:pwa-register",
    "serviceWorker.register",
  ]) {
    if (source.includes(forbidden)) {
      fail(`${name} must not reference ${forbidden}.`);
    }
  }
}

if (main.includes("serviceWorker")) {
  fail("main.tsx must not register a service worker.");
}

if (!viteConfig.includes("injectRegister: false")) {
  fail("vite.config.ts must set injectRegister: false.");
}
if (!viteConfig.includes("devOptions")) {
  fail("vite.config.ts must configure devOptions.");
}
if (!viteConfig.includes("scope: '/teacher'")) {
  fail("vite.config.ts must scope the teacher service worker to /teacher.");
}

const sourceFiles = walk(srcDir);
for (const file of sourceFiles) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const relative = path.relative(process.cwd(), file).replaceAll("\\", "/");
  const source = fs.readFileSync(file, "utf8");

  if (source.includes("virtual:pwa-register") && relative !== "src/pwa/registerTeacherPwa.ts") {
    fail(`${relative} must not import virtual:pwa-register; use registerTeacherPwa.`);
  }
  if (source.includes("navigator.serviceWorker.register")) {
    fail(`${relative} must not register a service worker manually.`);
  }
}

if (failures.length > 0) {
  console.error("[check-pwa-scope] FAILED");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("[check-pwa-scope] OK");
