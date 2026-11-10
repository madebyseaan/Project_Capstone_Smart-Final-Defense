import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

// Source: replace public/pwa/school-logo.png with the current school logo, then
// run `node scripts/generate-pwa-icons.mjs` and rebuild.
const logo = fs.readFileSync("public/pwa/school-logo.png").toString("base64");
const logoUri = `data:image/png;base64,${logo}`;

const targets = [
  { file: "icon-192.png", size: 192, ratio: 0.86 },
  { file: "icon-512.png", size: 512, ratio: 0.86 },
  { file: "icon-maskable-512.png", size: 512, ratio: 0.62 },
  { file: "apple-touch-icon-180.png", size: 180, ratio: 0.8 },
];

const outDir = path.join("public", "pwa");
const browser = await chromium.launch();

try {
  for (const target of targets) {
    const page = await browser.newPage({
      viewport: { width: target.size, height: target.size },
      deviceScaleFactor: 1,
    });
    const width = Math.round(target.size * target.ratio);
    await page.setContent(
      `<style>
        html,body{margin:0;width:${target.size}px;height:${target.size}px;overflow:hidden;background:#ffffff}
        body{display:flex;align-items:center;justify-content:center}
        img{display:block;width:${width}px;height:${width}px;object-fit:contain}
      </style><img src="${logoUri}" alt="" />`,
      { waitUntil: "load" },
    );
    await page.screenshot({
      path: path.join(outDir, target.file),
      omitBackground: false,
    });
    await page.close();
    console.log(`wrote ${target.file}`);
  }
} finally {
  await browser.close();
}
