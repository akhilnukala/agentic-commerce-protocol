import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

type OpenApiParameter = {
  $ref?: string;
  name?: string;
  in?: string;
  required?: boolean;
};

type OpenApiComponents = {
  parameters?: Record<string, OpenApiParameter>;
};

type OpenApiOperation = {
  parameters?: OpenApiParameter[];
};

type OpenApiPathItem = {
  parameters?: OpenApiParameter[];
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
};

type OpenApiDocument = {
  components?: OpenApiComponents;
  paths?: Record<string, OpenApiPathItem>;
};

export const OPENAPI_FILES = [
  "openapi.agentic_checkout.yaml",
  "openapi.cart.yaml",
  "openapi.delegate_authentication.yaml",
  "openapi.delegate_payment.yaml",
  "openapi.feed.yaml",
  "openapi.agentic_checkout_webhook.yaml"
] as const;

export type OpenApiFile = (typeof OPENAPI_FILES)[number];

export type HeaderRequirements = Map<string, string[]>;

function resolveParameter(
  parameter: OpenApiParameter,
  components: OpenApiComponents | undefined
): OpenApiParameter | undefined {
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

function operationKey(file: OpenApiFile, method: string, routePath: string): string {
  return `${file}::${method.toUpperCase()} ${routePath}`;
}

export function loadHeaderRequirements(openapiRoot: string): HeaderRequirements {
  const requirements = new Map<string, string[]>();
  const methods: HttpMethod[] = ["get", "post", "put", "patch", "delete"];

  for (const file of OPENAPI_FILES) {
    const absolutePath = path.join(openapiRoot, file);
    const document = YAML.parse(fs.readFileSync(absolutePath, "utf8")) as OpenApiDocument;

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
          .filter((param): param is OpenApiParameter => Boolean(param));

        const requiredHeaders = Array.from(
          new Set(
            allParams
              .filter(
                (param) =>
                  param.in === "header" &&
                  param.required === true &&
                  param.name?.toLowerCase() !== "authorization"
              )
              .map((param) => String(param.name).toLowerCase())
          )
        );

        requirements.set(operationKey(file, method, routePath), requiredHeaders);
      }
    }
  }

  return requirements;
}

export function getRequiredHeaders(
  requirements: HeaderRequirements,
  file: OpenApiFile,
  method: string,
  routePath: string
): string[] {
  return requirements.get(operationKey(file, method, routePath)) ?? [];
}
