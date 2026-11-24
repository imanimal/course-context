// Runs the fake school in its own process (the e2e tests call the CLI with spawnSync, which blocks this event loop).
import { mockSchool } from "./mock.js";
const s = await mockSchool();
process.stdout.write(JSON.stringify({ base: s.base, TOKEN: s.TOKEN }) + "\n");
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
