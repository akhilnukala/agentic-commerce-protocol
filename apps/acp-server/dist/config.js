import fs from "node:fs";
import path from "node:path";
export const ACP_VERSION = "2026-04-17";
function findRepoRoot(startDirectory) {
    let current = path.resolve(startDirectory);
    while (true) {
        const specProbe = path.join(current, "spec", ACP_VERSION);
        if (fs.existsSync(specProbe)) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            throw new Error(`Unable to find repository root containing spec/${ACP_VERSION}. Start the server from this repo or set ACP_REPO_ROOT.`);
        }
        current = parent;
    }
}
export const REPO_ROOT = process.env.ACP_REPO_ROOT
    ? path.resolve(process.env.ACP_REPO_ROOT)
    : findRepoRoot(process.cwd());
export const SPEC_ROOT = path.join(REPO_ROOT, "spec", ACP_VERSION);
export const OPENAPI_ROOT = path.join(SPEC_ROOT, "openapi");
export const JSON_SCHEMA_ROOT = path.join(SPEC_ROOT, "json-schema");
export const PORT = Number(process.env.PORT ?? "8080");
