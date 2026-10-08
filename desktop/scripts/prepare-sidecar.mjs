import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareRuntimeArtifact } from "../../../craft/scripts/release/runtime-artifact.ts";

// Only this presentation project owns the desktop staging output.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
await prepareRuntimeArtifact(resolve(root, "../craft"), process.execPath, root);
