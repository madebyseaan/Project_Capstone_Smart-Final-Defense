import fs from "node:fs";
import path from "node:path";

const failures = [];
const dist = path.resolve("dist");

function fail(message) {
  failures.push(message);
}

function readPngSize(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function resolveDistAsset(src) {
  return path.join(dist, src.replace(/^\/+/, ""));
}

if (!fs.existsSync(dist)) {
  fail("dist/ does not exist. Run the production build first.");
} else {
  const manifestPath = path.join(dist, "manifest.webmanifest");
  if (!fs.existsSync(manifestPath)) {
    fail("dist/manifest.webmanifest is missing.");
  } else {
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (error) {
      fail(`dist/manifest.webmanifest is not valid JSON: ${error.message}`);
    }

    if (manifest) {
      if (manifest.name !== "SMART") fail("Manifest name must be SMART.");
      if (manifest.short_name !== "SMART") fail("Manifest short_name must be SMART.");
      if (manifest.start_url !== "/teacher") fail("Manifest start_url must be /teacher.");
      if (manifest.scope !== "/") fail("Manifest scope must be /.");
      if (manifest.display !== "standalone") fail("Manifest display must be standalone.");
      if (!Array.isArray(manifest.icons) || manifest.icons.length < 3) {
        fail("Manifest must declare at least 3 icons.");
      } else {
        for (const icon of manifest.icons) {
          const file = resolveDistAsset(icon.src);
          if (!fs.existsSync(file)) {
            fail(`Manifest icon is missing from dist: ${icon.src}`);
            continue;
          }
          const size = readPngSize(file);
          if (!size) {
            fail(`Manifest icon is not a PNG: ${icon.src}`);
            continue;
          }
          const declared = String(icon.sizes ?? "").split(/\s+/)[0];
          const expected = declared.includes("x") ? declared.split("x").map(Number) : [];
          if (expected.length !== 2 || size.width !== expected[0] || size.height !== expected[1]) {
            fail(
              `Manifest icon size mismatch: ${icon.src} declared ${icon.sizes}, actual ${size.width}x${size.height}`,
            );
          }
        }
        const maskable = manifest.icons.some((icon) =>
          String(icon.purpose ?? "").includes("maskable"),
        );
        if (!maskable) fail("Manifest must include a maskable icon.");
      }
    }
  }

  const swPath = path.join(dist, "sw.js");
  if (!fs.existsSync(swPath)) {
    fail("dist/sw.js is missing.");
  } else {
    const sw = fs.readFileSync(swPath, "utf8");

    const precacheUrls = [...sw.matchAll(/url:"([^"]+)"/g)].map((match) => match[1]);
    if (precacheUrls.length === 0) {
      fail("Service worker precache manifest is empty.");
    }
    if (!precacheUrls.some((url) => url.endsWith("index.html"))) {
      fail("Service worker must precache index.html.");
    }
    const apiEntries = precacheUrls.filter(
      (url) => /^\/?api\//.test(url) || /^\/?uploads\//.test(url),
    );
    if (apiEntries.length > 0) {
      fail(`Service worker must not precache API/uploads: ${apiEntries.join(", ")}`);
    }
    if (!sw.includes("SKIP_WAITING")) {
      fail("Service worker is missing the SKIP_WAITING update handler.");
    }
  }

  const indexPath = path.join(dist, "index.html");
  if (!fs.existsSync(indexPath)) {
    fail("dist/index.html is missing.");
  } else {
    const index = fs.readFileSync(indexPath, "utf8");
    if (!index.includes('rel="manifest"')) {
      fail("dist/index.html is missing the web manifest link.");
    }
    if (!index.includes('rel="apple-touch-icon"')) {
      fail("dist/index.html is missing the Apple touch icon.");
    }
  }
}

if (failures.length > 0) {
  console.error("[check-pwa-build] FAILED");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log("[check-pwa-build] OK");
