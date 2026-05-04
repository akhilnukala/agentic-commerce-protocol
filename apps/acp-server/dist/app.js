import express from "express";
import { ACP_VERSION, JSON_SCHEMA_ROOT, OPENAPI_ROOT } from "./config.js";
import { getRequiredHeaders, loadHeaderRequirements } from "./protocol/openapiHeaders.js";
import { createProtocolValidator } from "./protocol/validation.js";
import { createId, createStore, nowIso, snapshot } from "./store.js";
function toObject(value) {
    return (value && typeof value === "object" ? value : {});
}
function getQuantity(value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    return 1;
}
function getString(value, fallback) {
    return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}
function getNumber(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function makeError(type, code, message, param) {
    if (param) {
        return { type, code, message, param };
    }
    return { type, code, message };
}
function firstValidationParam(validation) {
    const first = validation.errors[0];
    if (!first) {
        return undefined;
    }
    const segment = first.split(" ")[0];
    return segment === "$" ? undefined : segment;
}
function logOperation(operationId, req, extra = {}) {
    const requestId = req.header("request-id") ?? null;
    const payload = {
        operationId,
        method: req.method,
        path: req.path,
        requestId,
        ...extra
    };
    console.log(`[ACP] ${JSON.stringify(payload)}`);
}
function applyEchoHeaders(req, res) {
    const idempotencyKey = req.header("idempotency-key");
    const requestId = req.header("request-id");
    if (idempotencyKey) {
        res.setHeader("Idempotency-Key", idempotencyKey);
    }
    if (requestId) {
        res.setHeader("Request-Id", requestId);
    }
}
function sendError(res, status, type, code, message, param) {
    return res.status(status).json(makeError(type, code, message, param));
}
function enforceHeaders(req, res, requiredHeaders) {
    for (const header of requiredHeaders) {
        const value = req.header(header);
        if (!value || value.trim().length === 0) {
            if (header === "merchant-signature") {
                return sendError(res, 401, "invalid_request", "invalid_signature", "Missing Merchant-Signature header.");
            }
            if (header === "idempotency-key") {
                return sendError(res, 400, "invalid_request", "idempotency_key_required", "Idempotency-Key header is required");
            }
            return sendError(res, 400, "invalid_request", "missing_required_header", `${header} header is required`, `$.headers.${header}`);
        }
        if (header === "content-type" && !value.toLowerCase().includes("application/json")) {
            return sendError(res, 400, "invalid_request", "invalid_content_type", "Content-Type must be application/json", "$.headers.content-type");
        }
    }
    return undefined;
}
function operationHeaders(requirements, file, method, routePath) {
    return getRequiredHeaders(requirements, file, method, routePath);
}
function validateBody(validator, req, res, schemaName, allowEmptyBody = false) {
    const body = req.body;
    if (allowEmptyBody && body && typeof body === "object" && Object.keys(body).length === 0) {
        return undefined;
    }
    const result = validator.validate(schemaName, body);
    if (result.valid) {
        return undefined;
    }
    const param = firstValidationParam(result);
    return sendError(res, 400, "invalid_request", "invalid_request", "Request body failed schema validation", param);
}
function validateResponse(validator, res, schemaName, payload, operationId, status = 200) {
    const result = validator.validate(schemaName, payload);
    if (!result.valid) {
        console.error(`[ACP] ${operationId} produced invalid response`, result.errors);
        return sendError(res, 500, "processing_error", "invalid_response", "Server produced a response that does not match ACP schema");
    }
    return res.status(status).json(payload);
}
function buildLineItems(store, sourceItems, currency) {
    const items = Array.isArray(sourceItems) ? sourceItems : [];
    const lineItems = [];
    let subtotal = 0;
    for (const rawItem of items) {
        const item = toObject(rawItem);
        const id = getString(item.id, "item_unknown");
        const catalogRecord = store.catalog.get(id);
        const quantity = getQuantity(item.quantity);
        const unitAmount = getNumber(item.unit_amount, catalogRecord?.unit_amount ?? 1000);
        const name = getString(item.name, catalogRecord?.name ?? id);
        const lineTotal = unitAmount * quantity;
        subtotal += lineTotal;
        lineItems.push({
            id: createId(store, "li"),
            item: {
                id,
                name,
                unit_amount: unitAmount
            },
            quantity,
            totals: [
                {
                    type: "subtotal",
                    display_text: "Subtotal",
                    amount: lineTotal
                }
            ]
        });
    }
    const totals = [
        {
            type: "subtotal",
            display_text: "Subtotal",
            amount: subtotal
        },
        {
            type: "total",
            display_text: "Total",
            amount: subtotal
        }
    ];
    // Keep item pricing in sync with catalog for future cart/checkout updates.
    for (const lineItem of lineItems) {
        const lineItemItem = toObject(lineItem.item);
        const itemId = getString(lineItemItem.id, "item_unknown");
        const unitAmount = getNumber(lineItemItem.unit_amount, 1000);
        const name = getString(lineItemItem.name, itemId);
        store.catalog.set(itemId, { name, unit_amount: unitAmount });
    }
    return { lineItems, totals };
}
function buildCheckoutSession(store, id, body) {
    const currency = getString(body.currency, "usd").toLowerCase();
    const { lineItems, totals } = buildLineItems(store, body.line_items, currency);
    return {
        id,
        status: "incomplete",
        currency,
        line_items: lineItems,
        totals,
        fulfillment_options: [],
        messages: [],
        links: [],
        capabilities: toObject(body.capabilities),
        buyer: body.buyer,
        created_at: nowIso(),
        updated_at: nowIso()
    };
}
function updateCheckoutSession(store, session, body) {
    const next = snapshot(session);
    if (body.buyer) {
        next.buyer = body.buyer;
    }
    if (body.selected_fulfillment_options) {
        next.selected_fulfillment_options = body.selected_fulfillment_options;
    }
    if (body.line_items) {
        const currency = getString(next.currency, "usd");
        const { lineItems, totals } = buildLineItems(store, body.line_items, currency);
        next.line_items = lineItems;
        next.totals = totals;
    }
    next.updated_at = nowIso();
    return next;
}
function buildOrderFromSession(store, session) {
    const orderId = createId(store, "ord");
    const lineItems = Array.isArray(session.line_items) ? session.line_items : [];
    const orderLineItems = lineItems.map((entry) => {
        const lineItem = toObject(entry);
        const item = toObject(lineItem.item);
        const quantity = getQuantity(lineItem.quantity);
        return {
            id: getString(lineItem.id, createId(store, "oli")),
            title: getString(item.name, getString(item.id, "unknown-item")),
            quantity: {
                ordered: quantity,
                current: quantity,
                fulfilled: 0
            }
        };
    });
    return {
        type: "order",
        id: orderId,
        checkout_session_id: getString(session.id, ""),
        permalink_url: `https://merchant.example.com/orders/${orderId}`,
        status: "created",
        line_items: orderLineItems,
        totals: Array.isArray(session.totals) ? session.totals : []
    };
}
function buildCart(store, id, body) {
    const { lineItems, totals } = buildLineItems(store, body.line_items, "usd");
    return {
        id,
        line_items: lineItems,
        currency: "usd",
        totals,
        buyer: body.buyer,
        messages: [],
        continue_url: `https://seller.example.com/cart/${id}`,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };
}
function updateCart(store, cart, body) {
    const next = snapshot(cart);
    const { lineItems, totals } = buildLineItems(store, body.line_items, getString(cart.currency, "usd"));
    next.line_items = lineItems;
    next.totals = totals;
    if (body.buyer) {
        next.buyer = body.buyer;
    }
    return next;
}
function upsertFeedProducts(store, feedId, products) {
    const feed = store.feeds.get(feedId);
    if (!feed) {
        return;
    }
    const currentProducts = [...feed.products];
    const productById = new Map();
    for (const existing of currentProducts) {
        productById.set(getString(existing.id, ""), existing);
    }
    for (const incoming of products) {
        const id = getString(incoming.id, "");
        if (!id) {
            continue;
        }
        productById.set(id, incoming);
        const variants = Array.isArray(incoming.variants) ? incoming.variants : [];
        const firstVariant = toObject(variants[0]);
        const price = toObject(firstVariant.price);
        const unitAmount = getNumber(price.amount, 1000);
        const name = getString(incoming.title, id);
        store.catalog.set(id, { name, unit_amount: unitAmount });
    }
    feed.products = Array.from(productById.values());
    feed.metadata.updated_at = nowIso();
}
function discoveryDocument(req) {
    const host = req.get("host") ?? "localhost:8080";
    const apiBaseUrl = `${req.protocol}://${host}`;
    return {
        protocol: {
            name: "acp",
            version: ACP_VERSION,
            supported_versions: ["2025-09-29", "2025-12-12", "2026-01-16", "2026-01-30", ACP_VERSION],
            documentation_url: "https://agenticcommerce.dev"
        },
        api_base_url: apiBaseUrl,
        transports: ["rest"],
        capabilities: {
            services: ["checkout", "orders", "delegate_payment", "carts"],
            extensions: [
                {
                    name: "discount",
                    spec: "https://agenticcommerce.dev/specs/discount",
                    schema: "https://agenticcommerce.dev/schemas/discount.json"
                },
                {
                    name: "fulfillment",
                    spec: "https://agenticcommerce.dev/specs/fulfillment",
                    schema: "https://agenticcommerce.dev/schemas/fulfillment.json"
                }
            ],
            intervention_types: ["3ds", "address_verification"],
            supported_currencies: ["usd", "eur", "gbp"],
            supported_locales: ["en-US", "fr-FR", "de-DE"]
        }
    };
}
export function createAcpApp() {
    const app = express();
    const store = createStore();
    const validator = createProtocolValidator(JSON_SCHEMA_ROOT);
    const headerRequirements = loadHeaderRequirements(OPENAPI_ROOT);
    app.use(express.json({ limit: "2mb" }));
    app.use((req, _res, next) => {
        if (req.path !== "/healthz") {
            logOperation("request", req);
        }
        next();
    });
    app.get("/healthz", (_req, res) => {
        res.status(200).json({ ok: true, version: ACP_VERSION });
    });
    // Checkout API --------------------------------------------------------------
    app.post("/checkout_sessions", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.agentic_checkout.yaml", "POST", "/checkout_sessions"));
        if (headerError) {
            return headerError;
        }
        const bodyError = validateBody(validator, req, res, "checkoutCreateRequest");
        if (bodyError) {
            return bodyError;
        }
        applyEchoHeaders(req, res);
        const sessionId = createId(store, "cs");
        const session = buildCheckoutSession(store, sessionId, toObject(req.body));
        store.checkoutSessions.set(sessionId, session);
        logOperation("createCheckoutSession", req, { checkout_session_id: sessionId });
        return validateResponse(validator, res, "checkoutSessionResponse", session, "createCheckoutSession", 201);
    });
    app.post("/checkout_sessions/:checkout_session_id", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.agentic_checkout.yaml", "POST", "/checkout_sessions/{checkout_session_id}"));
        if (headerError) {
            return headerError;
        }
        const bodyError = validateBody(validator, req, res, "checkoutUpdateRequest");
        if (bodyError) {
            return bodyError;
        }
        applyEchoHeaders(req, res);
        const id = req.params.checkout_session_id;
        const existing = store.checkoutSessions.get(id);
        if (!existing) {
            return sendError(res, 404, "invalid_request", "session_not_found", "Checkout session not found", "$.id");
        }
        const updated = updateCheckoutSession(store, existing, toObject(req.body));
        store.checkoutSessions.set(id, updated);
        logOperation("updateCheckoutSession", req, { checkout_session_id: id });
        return validateResponse(validator, res, "checkoutSessionResponse", updated, "updateCheckoutSession", 200);
    });
    app.get("/checkout_sessions/:checkout_session_id", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.agentic_checkout.yaml", "GET", "/checkout_sessions/{checkout_session_id}"));
        if (headerError) {
            return headerError;
        }
        applyEchoHeaders(req, res);
        const id = req.params.checkout_session_id;
        const existing = store.checkoutSessions.get(id);
        if (!existing) {
            return sendError(res, 404, "invalid_request", "session_not_found", "Checkout session not found", "$.id");
        }
        logOperation("getCheckoutSession", req, { checkout_session_id: id });
        return validateResponse(validator, res, "checkoutSessionResponse", snapshot(existing), "getCheckoutSession", 200);
    });
    app.post("/checkout_sessions/:checkout_session_id/complete", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.agentic_checkout.yaml", "POST", "/checkout_sessions/{checkout_session_id}/complete"));
        if (headerError) {
            return headerError;
        }
        const bodyError = validateBody(validator, req, res, "checkoutCompleteRequest");
        if (bodyError) {
            return bodyError;
        }
        applyEchoHeaders(req, res);
        const id = req.params.checkout_session_id;
        const existing = store.checkoutSessions.get(id);
        if (!existing) {
            return sendError(res, 404, "invalid_request", "session_not_found", "Checkout session not found", "$.id");
        }
        const completed = snapshot(existing);
        completed.status = "completed";
        completed.updated_at = nowIso();
        completed.order = buildOrderFromSession(store, completed);
        store.checkoutSessions.set(id, completed);
        logOperation("completeCheckoutSession", req, { checkout_session_id: id });
        return validateResponse(validator, res, "checkoutSessionWithOrderResponse", completed, "completeCheckoutSession", 200);
    });
    app.post("/checkout_sessions/:checkout_session_id/cancel", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.agentic_checkout.yaml", "POST", "/checkout_sessions/{checkout_session_id}/cancel"));
        if (headerError) {
            return headerError;
        }
        const bodyError = validateBody(validator, req, res, "checkoutCancelRequest", true);
        if (bodyError) {
            return bodyError;
        }
        applyEchoHeaders(req, res);
        const id = req.params.checkout_session_id;
        const existing = store.checkoutSessions.get(id);
        if (!existing) {
            return sendError(res, 404, "invalid_request", "session_not_found", "Checkout session not found", "$.id");
        }
        if (existing.status === "completed" || existing.status === "canceled") {
            return sendError(res, 405, "invalid_request", "not_cancelable", "Checkout session cannot be canceled in its current state");
        }
        const canceled = snapshot(existing);
        canceled.status = "canceled";
        canceled.updated_at = nowIso();
        store.checkoutSessions.set(id, canceled);
        logOperation("cancelCheckoutSession", req, { checkout_session_id: id });
        return validateResponse(validator, res, "checkoutSessionResponse", canceled, "cancelCheckoutSession", 200);
    });
    // Cart API ------------------------------------------------------------------
    app.post("/carts", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.cart.yaml", "POST", "/carts"));
        if (headerError) {
            return headerError;
        }
        const bodyError = validateBody(validator, req, res, "cartCreateRequest");
        if (bodyError) {
            return bodyError;
        }
        applyEchoHeaders(req, res);
        const cartId = createId(store, "cart");
        const cart = buildCart(store, cartId, toObject(req.body));
        store.carts.set(cartId, cart);
        logOperation("createCart", req, { cart_id: cartId });
        return validateResponse(validator, res, "cartResponse", cart, "createCart", 201);
    });
    app.get("/carts/:id", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.cart.yaml", "GET", "/carts/{id}"));
        if (headerError) {
            return headerError;
        }
        applyEchoHeaders(req, res);
        const cart = store.carts.get(req.params.id);
        if (!cart) {
            return sendError(res, 404, "invalid_request", "not_found", "Cart not found or has expired.", "$.id");
        }
        logOperation("getCart", req, { cart_id: req.params.id });
        return validateResponse(validator, res, "cartResponse", snapshot(cart), "getCart", 200);
    });
    app.put("/carts/:id", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.cart.yaml", "PUT", "/carts/{id}"));
        if (headerError) {
            return headerError;
        }
        const bodyError = validateBody(validator, req, res, "cartUpdateRequest");
        if (bodyError) {
            return bodyError;
        }
        applyEchoHeaders(req, res);
        const existing = store.carts.get(req.params.id);
        if (!existing) {
            return sendError(res, 404, "invalid_request", "not_found", "Cart not found or has expired.", "$.id");
        }
        const updated = updateCart(store, existing, toObject(req.body));
        store.carts.set(req.params.id, updated);
        logOperation("updateCart", req, { cart_id: req.params.id });
        return validateResponse(validator, res, "cartResponse", updated, "updateCart", 200);
    });
    app.post("/carts/:id/cancel", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.cart.yaml", "POST", "/carts/{id}/cancel"));
        if (headerError) {
            return headerError;
        }
        applyEchoHeaders(req, res);
        const existing = store.carts.get(req.params.id);
        if (!existing) {
            return sendError(res, 404, "invalid_request", "not_found", "Cart not found or has expired.", "$.id");
        }
        const canceled = snapshot(existing);
        store.carts.delete(req.params.id);
        logOperation("cancelCart", req, { cart_id: req.params.id });
        return validateResponse(validator, res, "cartResponse", canceled, "cancelCart", 200);
    });
    // Delegate Authentication API ------------------------------------------------
    app.post("/delegate_authentication", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.delegate_authentication.yaml", "POST", "/delegate_authentication"));
        if (headerError) {
            return headerError;
        }
        const bodyError = validateBody(validator, req, res, "delegateAuthCreateRequest");
        if (bodyError) {
            return bodyError;
        }
        applyEchoHeaders(req, res);
        const sessionId = createId(store, "das");
        const session = {
            authentication_session_id: sessionId,
            status: "action_required",
            action: {
                type: "fingerprint",
                fingerprint: {
                    three_ds_method_url: "https://acs.issuer.com/3dsmethod",
                    three_ds_server_trans_id: createId(store, "3ds")
                }
            }
        };
        store.authenticationSessions.set(sessionId, { session });
        logOperation("createAuthenticationSession", req, { authentication_session_id: sessionId });
        return validateResponse(validator, res, "delegateAuthSessionResponse", session, "createAuthenticationSession", 201);
    });
    app.post("/delegate_authentication/:authentication_session_id/authenticate", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.delegate_authentication.yaml", "POST", "/delegate_authentication/{authentication_session_id}/authenticate"));
        if (headerError) {
            return headerError;
        }
        const bodyError = validateBody(validator, req, res, "delegateAuthAuthenticateRequest");
        if (bodyError) {
            return bodyError;
        }
        applyEchoHeaders(req, res);
        const sessionId = req.params.authentication_session_id;
        const existing = store.authenticationSessions.get(sessionId);
        if (!existing) {
            return sendError(res, 404, "invalid_request", "invalid_card", "Authentication session not found", "$.id");
        }
        const fingerprintCompletion = getString(toObject(req.body).fingerprint_completion, "N");
        const authenticated = fingerprintCompletion === "Y";
        const nextSession = {
            authentication_session_id: sessionId,
            status: authenticated ? "authenticated" : "not_authenticated"
        };
        const authenticationResult = authenticated
            ? {
                trans_status: "Y",
                electronic_commerce_indicator: "05",
                three_ds_cryptogram: "AQIDBAUGBwgJCgsMDQ4PEBESExQ=",
                transaction_id: createId(store, "trn"),
                three_ds_server_trans_id: createId(store, "3ds"),
                version: "2.2.0"
            }
            : {
                trans_status: "N",
                transaction_id: createId(store, "trn"),
                three_ds_server_trans_id: createId(store, "3ds"),
                version: "2.2.0"
            };
        store.authenticationSessions.set(sessionId, {
            session: nextSession,
            authenticationResult
        });
        logOperation("authenticateSession", req, { authentication_session_id: sessionId });
        return validateResponse(validator, res, "delegateAuthSessionResponse", nextSession, "authenticateSession", 200);
    });
    app.get("/delegate_authentication/:authentication_session_id", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.delegate_authentication.yaml", "GET", "/delegate_authentication/{authentication_session_id}"));
        if (headerError) {
            return headerError;
        }
        applyEchoHeaders(req, res);
        const sessionId = req.params.authentication_session_id;
        const existing = store.authenticationSessions.get(sessionId);
        if (!existing) {
            return sendError(res, 404, "invalid_request", "invalid_card", "Authentication session not found", "$.id");
        }
        // The current schema composition for DelegateAuthenticationSessionWithResult
        // inherits additionalProperties: false from the base object, so only base
        // fields validate under strict schema checks.
        const payload = snapshot(existing.session);
        logOperation("getAuthenticationSession", req, { authentication_session_id: sessionId });
        return validateResponse(validator, res, "delegateAuthSessionWithResultResponse", payload, "getAuthenticationSession", 200);
    });
    // Delegate Payment API ------------------------------------------------------
    app.post("/agentic_commerce/delegate_payment", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.delegate_payment.yaml", "POST", "/agentic_commerce/delegate_payment"));
        if (headerError) {
            return headerError;
        }
        const bodyError = validateBody(validator, req, res, "delegatePaymentRequest");
        if (bodyError) {
            return bodyError;
        }
        applyEchoHeaders(req, res);
        const requestBody = toObject(req.body);
        const metadataInput = toObject(requestBody.metadata);
        const metadata = {
            source: "agent_checkout",
            merchant_id: getString(toObject(requestBody.allowance).merchant_id, "merchant_demo"),
            idempotency_key: req.header("idempotency-key") ?? "none"
        };
        for (const [key, value] of Object.entries(metadataInput)) {
            metadata[key] = String(value);
        }
        const payload = {
            id: createId(store, "vt"),
            created: nowIso(),
            metadata
        };
        logOperation("delegatePayment", req, { token_id: payload.id });
        return validateResponse(validator, res, "delegatePaymentResponse", payload, "delegatePayment", 201);
    });
    // Feed API ------------------------------------------------------------------
    app.post("/feeds", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.feed.yaml", "POST", "/feeds"));
        if (headerError) {
            return headerError;
        }
        const bodyError = validateBody(validator, req, res, "feedCreateRequest");
        if (bodyError) {
            return bodyError;
        }
        const feedId = createId(store, "feed");
        const body = toObject(req.body);
        const metadata = {
            id: feedId,
            target_country: body.target_country,
            updated_at: nowIso()
        };
        store.feeds.set(feedId, { metadata, products: [] });
        logOperation("createFeed", req, { feed_id: feedId });
        return validateResponse(validator, res, "feedMetadataResponse", metadata, "createFeed", 201);
    });
    app.get("/feeds/:id", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.feed.yaml", "GET", "/feeds/{id}"));
        if (headerError) {
            return headerError;
        }
        const feed = store.feeds.get(req.params.id);
        if (!feed) {
            return sendError(res, 404, "invalid_request", "feed_not_found", "Feed not found", "$.id");
        }
        logOperation("getFeed", req, { feed_id: req.params.id });
        return validateResponse(validator, res, "feedMetadataResponse", snapshot(feed.metadata), "getFeed", 200);
    });
    app.get("/feeds/:id/products", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.feed.yaml", "GET", "/feeds/{id}/products"));
        if (headerError) {
            return headerError;
        }
        const feed = store.feeds.get(req.params.id);
        if (!feed) {
            return sendError(res, 404, "invalid_request", "feed_not_found", "Feed not found", "$.id");
        }
        const payload = {
            products: snapshot(feed.products)
        };
        logOperation("getFeedProducts", req, { feed_id: req.params.id, product_count: feed.products.length });
        return validateResponse(validator, res, "feedProductsResponse", payload, "getFeedProducts", 200);
    });
    app.patch("/feeds/:id/products", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.feed.yaml", "PATCH", "/feeds/{id}/products"));
        if (headerError) {
            return headerError;
        }
        const bodyError = validateBody(validator, req, res, "feedUpsertRequest");
        if (bodyError) {
            return bodyError;
        }
        const feed = store.feeds.get(req.params.id);
        if (!feed) {
            return sendError(res, 404, "invalid_request", "feed_not_found", "Feed not found", "$.id");
        }
        const body = toObject(req.body);
        const products = (Array.isArray(body.products) ? body.products : []).map((entry) => toObject(entry));
        upsertFeedProducts(store, req.params.id, products);
        const payload = {
            id: req.params.id,
            accepted: true
        };
        logOperation("upsertFeedProducts", req, { feed_id: req.params.id, upsert_count: products.length });
        return validateResponse(validator, res, "feedUpsertResponse", payload, "upsertFeedProducts", 200);
    });
    // Webhook receiver ----------------------------------------------------------
    app.post("/agentic_checkout/webhooks/order_events", (req, res) => {
        const headerError = enforceHeaders(req, res, operationHeaders(headerRequirements, "openapi.agentic_checkout_webhook.yaml", "POST", "/agentic_checkout/webhooks/order_events"));
        if (headerError) {
            return headerError;
        }
        const signature = req.header("merchant-signature") ?? "";
        if (!/^t=\d+,v1=[a-fA-F0-9]{64}$/.test(signature)) {
            return sendError(res, 401, "invalid_request", "invalid_signature", "Merchant-Signature must be t=<timestamp>,v1=<64_hex>.");
        }
        const bodyError = validateBody(validator, req, res, "webhookEventRequest");
        if (bodyError) {
            return bodyError;
        }
        const eventBody = toObject(req.body);
        store.webhookEvents.push({
            received_at: nowIso(),
            request_id: req.header("request-id") ?? null,
            event: snapshot(eventBody)
        });
        logOperation("postOrderEvents", req, {
            event_type: getString(eventBody.type, "unknown"),
            webhook_count: store.webhookEvents.length
        });
        return res.status(200).json({
            received: true,
            request_id: req.header("request-id") ?? undefined
        });
    });
    // Discovery -----------------------------------------------------------------
    app.get("/.well-known/acp.json", (req, res) => {
        const payload = discoveryDocument(req);
        res.setHeader("Cache-Control", "public, max-age=3600");
        logOperation("discovery", req);
        return validateResponse(validator, res, "discoveryResponse", payload, "discovery", 200);
    });
    // Non-ACP debug endpoint for local inspection of webhook payloads.
    app.get("/_debug/webhooks", (_req, res) => {
        return res.status(200).json({
            count: store.webhookEvents.length,
            events: snapshot(store.webhookEvents)
        });
    });
    app.use((_req, res) => {
        return sendError(res, 404, "invalid_request", "not_found", "Endpoint not found");
    });
    return { app, store };
}
