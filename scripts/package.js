import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { zipSync } from "fflate";

const files = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "styles.css",
  "dist/content.js",
  "dist/popup.js",
  "assets/audio/rooster.oga",
  "assets/audio/donkey.wav",
  "assets/audio/README.md",
  "README.md",
  "docs/media/power-mode.gif",
  "docs/media/ocean.png",
  "docs/media/settings.png",
];
const archive = {};
const directory = "release/unpacked";
await rm(directory, { recursive: true, force: true });
for (const file of files) {
  const content = await readFile(file);
  archive[file] = new Uint8Array(content);
  const destination = join(directory, file);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}
await writeFile("release/developer-power-mode-combo.zip", zipSync(archive));
console.log(
  "Ready: release/unpacked and release/developer-power-mode-combo.zip",
);
