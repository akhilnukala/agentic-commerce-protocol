import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
export const OPENAPI_FILES = [
    "openapi.agentic_checkout.yaml",
    "openapi.cart.yaml",
    "openapi.delegate_authentication.yaml",
    "openapi.delegate_payment.yaml",
    "openapi.feed.yaml",
    "openapi.agentic_checkout_webhook.yaml"
];
function resolveParameter(parameter, components) {
    if (!parameter.$ref) {
        return parameter;
    }
    const prefix = "#/components/parameters/";
    if (!parameter.$ref.startsWith(prefix)) {
        return undefined;
    }
    const key = parameter.$ref.slice(prefix.length);
    return components?.parameters?.[key];
}
function operationKey(file, method, routePath) {
    return `${file}::${method.toUpperCase()} ${routePath}`;
}
export function loadHeaderRequirements(openapiRoot) {
    const requirements = new Map();
    const methods = ["get", "post", "put", "patch", "delete"];
    for (const file of OPENAPI_FILES) {
        const absolutePath = path.join(openapiRoot, file);
        const document = YAML.parse(fs.readFileSync(absolutePath, "utf8"));
        for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
            const pathParams = pathItem.parameters ?? [];
            for (const method of methods) {
                const operation = pathItem[method];
                if (!operation) {
                    continue;
                }
                const operationParams = operation.parameters ?? [];
                const allParams = [...pathParams, ...operationParams]
                    .map((param) => resolveParameter(param, document.components))
                    .filter((param) => Boolean(param));
                const requiredHeaders = Array.from(new Set(allParams
                    .filter((param) => param.in === "header" &&
                    param.required === true &&
                    param.name?.toLowerCase() !== "authorization")
                    .map((param) => String(param.name).toLowerCase())));
                requirements.set(operationKey(file, method, routePath), requiredHeaders);
            }
        }
    }
    return requirements;
}
export function getRequiredHeaders(requirements, file, method, routePath) {
    return requirements.get(operationKey(file, method, routePath)) ?? [];
}
