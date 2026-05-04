import fs from "node:fs";
import path from "node:path";
import Ajv2020Import from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
const Ajv2020Ctor = Ajv2020Import;
const addFormats = addFormatsImport;
const CHECKOUT_SCHEMA_ID = "https://example.com/schemas/agentic-checkout/bundle.schema.json";
const CART_SCHEMA_ID = "https://example.com/schemas/cart/bundle.schema.json";
const DELEGATE_AUTH_SCHEMA_ID = "https://example.com/schemas/delegate-authentication/bundle.schema.json";
const DELEGATE_PAYMENT_SCHEMA_ID = "https://example.com/schemas/delegate-payment/bundle.schema.json";
const FEED_SCHEMA_ID = "https://example.com/schemas/feed/bundle.schema.json";
const WEBHOOK_EVENT_SCHEMA_ID = "local://acp/webhook-event.schema.json";
const FEED_UPSERT_RESPONSE_SCHEMA_ID = "local://acp/feed-upsert-response.schema.json";
const CART_REQUEST_ITEM_SCHEMA_ID = "local://acp/cart-request-item.schema.json";
const CART_CREATE_REQUEST_SCHEMA_ID = "local://acp/cart-create-request.schema.json";
const CART_UPDATE_REQUEST_SCHEMA_ID = "local://acp/cart-update-request.schema.json";
function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function rewriteCartRefs(value) {
    if (typeof value === "string") {
        return value.startsWith("schema.agentic_checkout.json#")
            ? `${CHECKOUT_SCHEMA_ID}${value.slice("schema.agentic_checkout.json".length)}`
            : value;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => rewriteCartRefs(entry));
    }
    if (value && typeof value === "object") {
        const clone = {};
        for (const [key, nested] of Object.entries(value)) {
            clone[key] = rewriteCartRefs(nested);
        }
        return clone;
    }
    return value;
}
function webhookEventSchema() {
    return {
        $id: WEBHOOK_EVENT_SCHEMA_ID,
        type: "object",
        additionalProperties: false,
        required: ["type", "data"],
        properties: {
            type: { type: "string" },
            data: {
                allOf: [
                    { $ref: `${CHECKOUT_SCHEMA_ID}#/$defs/Order` },
                    {
                        type: "object",
                        required: ["type", "checkout_session_id", "permalink_url", "status"],
                        properties: {
                            type: { const: "order" }
                        }
                    }
                ]
            }
        }
    };
}
function cartRequestItemSchema() {
    return {
        $id: CART_REQUEST_ITEM_SCHEMA_ID,
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
            id: { type: "string" },
            quantity: {
                type: "integer",
                minimum: 1,
            },
        },
    };
}
function cartCreateRequestSchema() {
    return {
        $id: CART_CREATE_REQUEST_SCHEMA_ID,
        type: "object",
        additionalProperties: false,
        required: ["line_items"],
        properties: {
            line_items: {
                type: "array",
                items: {
                    $ref: CART_REQUEST_ITEM_SCHEMA_ID,
                },
                minItems: 1,
            },
            buyer: {
                $ref: `${CHECKOUT_SCHEMA_ID}#/$defs/Buyer`,
            },
            locale: {
                type: "string",
            },
        },
    };
}
function cartUpdateRequestSchema() {
    return {
        $id: CART_UPDATE_REQUEST_SCHEMA_ID,
        type: "object",
        additionalProperties: false,
        required: ["line_items"],
        properties: {
            line_items: {
                type: "array",
                items: {
                    $ref: CART_REQUEST_ITEM_SCHEMA_ID,
                },
                minItems: 1,
            },
            buyer: {
                $ref: `${CHECKOUT_SCHEMA_ID}#/$defs/Buyer`,
            },
        },
    };
}
function feedUpsertResponseSchema() {
    return {
        $id: FEED_UPSERT_RESPONSE_SCHEMA_ID,
        type: "object",
        additionalProperties: false,
        required: ["id", "accepted"],
        properties: {
            id: { type: "string" },
            accepted: { type: "boolean" }
        }
    };
}
function formatErrors(errors) {
    if (!errors || errors.length === 0) {
        return [];
    }
    return errors.map((error) => {
        const path = error.instancePath || "$";
        return `${path} ${error.message ?? "is invalid"}`;
    });
}
function compileOrThrow(ajv, schemaRef) {
    const validator = ajv.getSchema(schemaRef);
    if (!validator) {
        throw new Error(`Failed to compile schema reference: ${schemaRef}`);
    }
    return validator;
}
export class ProtocolValidator {
    validators;
    constructor(validators) {
        this.validators = validators;
    }
    validate(name, data) {
        const validator = this.validators[name];
        const valid = validator(data);
        return {
            valid: Boolean(valid),
            errors: formatErrors(validator.errors)
        };
    }
}
export function createProtocolValidator(jsonSchemaRoot) {
    const ajv = new Ajv2020Ctor({ allErrors: true, strict: false });
    addFormats(ajv);
    const checkoutSchema = readJson(path.join(jsonSchemaRoot, "schema.agentic_checkout.json"));
    const cartSchemaRaw = readJson(path.join(jsonSchemaRoot, "schema.cart.json"));
    const cartSchema = rewriteCartRefs(cartSchemaRaw);
    const delegateAuthSchema = readJson(path.join(jsonSchemaRoot, "schema.delegate_authentication.json"));
    const delegatePaymentSchema = readJson(path.join(jsonSchemaRoot, "schema.delegate_payment.json"));
    const feedSchema = readJson(path.join(jsonSchemaRoot, "schema.feed.json"));
    ajv.addSchema(checkoutSchema);
    ajv.addSchema(checkoutSchema, "schema.agentic_checkout.json");
    ajv.addSchema(checkoutSchema, "https://example.com/schemas/cart/schema.agentic_checkout.json");
    ajv.addSchema(cartSchema);
    ajv.addSchema(delegateAuthSchema);
    ajv.addSchema(delegatePaymentSchema);
    ajv.addSchema(feedSchema);
    // The cart examples and server behavior support quantity on request items,
    // but the upstream cart schema currently reuses checkout Item, which does not.
    ajv.addSchema(cartRequestItemSchema());
    ajv.addSchema(cartCreateRequestSchema());
    ajv.addSchema(cartUpdateRequestSchema());
    ajv.addSchema(webhookEventSchema());
    ajv.addSchema(feedUpsertResponseSchema());
    const validators = {
        checkoutCreateRequest: compileOrThrow(ajv, `${CHECKOUT_SCHEMA_ID}#/$defs/CheckoutSessionCreateRequest`),
        checkoutUpdateRequest: compileOrThrow(ajv, `${CHECKOUT_SCHEMA_ID}#/$defs/CheckoutSessionUpdateRequest`),
        checkoutCompleteRequest: compileOrThrow(ajv, `${CHECKOUT_SCHEMA_ID}#/$defs/CheckoutSessionCompleteRequest`),
        checkoutCancelRequest: compileOrThrow(ajv, `${CHECKOUT_SCHEMA_ID}#/$defs/CancelSessionRequest`),
        checkoutSessionResponse: compileOrThrow(ajv, `${CHECKOUT_SCHEMA_ID}#/$defs/CheckoutSession`),
        checkoutSessionWithOrderResponse: compileOrThrow(ajv, `${CHECKOUT_SCHEMA_ID}#/$defs/CheckoutSessionWithOrder`),
        checkoutError: compileOrThrow(ajv, `${CHECKOUT_SCHEMA_ID}#/$defs/Error`),
        cartCreateRequest: compileOrThrow(ajv, CART_CREATE_REQUEST_SCHEMA_ID),
        cartUpdateRequest: compileOrThrow(ajv, CART_UPDATE_REQUEST_SCHEMA_ID),
        cartResponse: compileOrThrow(ajv, `${CART_SCHEMA_ID}#/$defs/Cart`),
        delegateAuthCreateRequest: compileOrThrow(ajv, `${DELEGATE_AUTH_SCHEMA_ID}#/$defs/DelegateAuthenticationCreateRequest`),
        delegateAuthAuthenticateRequest: compileOrThrow(ajv, `${DELEGATE_AUTH_SCHEMA_ID}#/$defs/DelegateAuthenticationAuthenticateRequest`),
        delegateAuthSessionResponse: compileOrThrow(ajv, `${DELEGATE_AUTH_SCHEMA_ID}#/$defs/DelegateAuthenticationSession`),
        delegateAuthSessionWithResultResponse: compileOrThrow(ajv, `${DELEGATE_AUTH_SCHEMA_ID}#/$defs/DelegateAuthenticationSessionWithResult`),
        delegateAuthError: compileOrThrow(ajv, `${DELEGATE_AUTH_SCHEMA_ID}#/$defs/Error`),
        delegatePaymentRequest: compileOrThrow(ajv, `${DELEGATE_PAYMENT_SCHEMA_ID}#/$defs/DelegatePaymentRequest`),
        delegatePaymentResponse: compileOrThrow(ajv, `${DELEGATE_PAYMENT_SCHEMA_ID}#/$defs/DelegatePaymentResponse`),
        delegatePaymentError: compileOrThrow(ajv, `${DELEGATE_PAYMENT_SCHEMA_ID}#/$defs/Error`),
        feedCreateRequest: compileOrThrow(ajv, `${FEED_SCHEMA_ID}#/$defs/CreateFeedRequest`),
        feedUpsertRequest: compileOrThrow(ajv, `${FEED_SCHEMA_ID}#/$defs/UpsertProductsRequest`),
        feedMetadataResponse: compileOrThrow(ajv, `${FEED_SCHEMA_ID}#/$defs/FeedMetadata`),
        feedProductsResponse: compileOrThrow(ajv, `${FEED_SCHEMA_ID}#/$defs/ProductsResponse`),
        feedUpsertResponse: compileOrThrow(ajv, FEED_UPSERT_RESPONSE_SCHEMA_ID),
        feedError: compileOrThrow(ajv, `${FEED_SCHEMA_ID}#/$defs/Error`),
        discoveryResponse: compileOrThrow(ajv, `${CHECKOUT_SCHEMA_ID}#/$defs/DiscoveryResponse`),
        webhookEventRequest: compileOrThrow(ajv, WEBHOOK_EVENT_SCHEMA_ID),
    };
    return new ProtocolValidator(validators);
}
