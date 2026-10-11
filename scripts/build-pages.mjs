import { copyFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const projectRoot = new URL("../", import.meta.url);
await build({ configFile: fileURLToPath(new URL("vite.pages.config.ts", projectRoot)) });
const output = new URL("pages-dist/", projectRoot);
await copyFile(new URL("index.html", output), new URL("404.html", output));
await writeFile(new URL(".nojekyll", output), "");
console.log("GitHub Pages site built in pages-dist/.");
