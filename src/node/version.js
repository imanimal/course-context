// Single source of the package version (read from package.json).
import { readFileSync } from "node:fs";
export const VERSION = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;
