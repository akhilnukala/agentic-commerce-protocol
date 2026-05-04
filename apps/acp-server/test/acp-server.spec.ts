import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createAcpApp } from "../src/app.js";
import { JSON_SCHEMA_ROOT } from "../src/config.js";
import { createProtocolValidator } from "../src/protocol/validation.js";

const validator = createProtocolValidator(JSON_SCHEMA_ROOT);

function requiredHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "API-Version": "2026-04-17",
    "Content-Type": "application/json",
    "Idempotency-Key": "550e8400-e29b-41d4-a716-446655440000",
    "Request-Id": "req_test_123",
    ...overrides
  };
}

describe("ACP REST server", () => {
  let app: ReturnType<typeof createAcpApp>["app"];

  beforeEach(() => {
    ({ app } = createAcpApp());
  });

  it("creates and completes checkout sessions with schema-valid responses", async () => {
    const createResponse = await request(app)
      .post("/checkout_sessions")
      .set(requiredHeaders())
      .send({
        line_items: [{ id: "item_123" }],
        currency: "usd",
        capabilities: {}
      });

    expect(createResponse.status).toBe(201);
    expect(validator.validate("checkoutSessionResponse", createResponse.body).valid).toBe(true);

    const checkoutId = createResponse.body.id;

    const completeResponse = await request(app)
      .post(`/checkout_sessions/${checkoutId}/complete`)
      .set(requiredHeaders({ "Idempotency-Key": "550e8400-e29b-41d4-a716-446655440001" }))
      .send({
        payment_data: {
          handler_id: "handler_card",
          instrument: {
            type: "card",
            credential: {
              type: "spt",
              token: "spt_123"
            }
          }
        }
      });

    expect(completeResponse.status).toBe(200);
    expect(validator.validate("checkoutSessionWithOrderResponse", completeResponse.body).valid).toBe(true);
    expect(completeResponse.body.status).toBe("completed");
    expect(completeResponse.body.order).toBeDefined();
  });

  it("rejects checkout create when required headers are missing", async () => {
    const response = await request(app)
      .post("/checkout_sessions")
      .set({
        "Content-Type": "application/json",
        "Idempotency-Key": "550e8400-e29b-41d4-a716-446655440002"
      })
      .send({
        line_items: [{ id: "item_123" }],
        currency: "usd",
        capabilities: {}
      });

    expect(response.status).toBe(400);
    expect(response.body.type).toBe("invalid_request");
  });

  it("supports full cart lifecycle and returns 404 after cancel", async () => {
    const createResponse = await request(app)
      .post("/carts")
      .set(
        requiredHeaders({
          "Idempotency-Key": "550e8400-e29b-41d4-a716-446655440010",
        }),
      )
      .send({ line_items: [{ id: "item_123", quantity: 1 }] });

    expect(createResponse.status).toBe(201);
    expect(validator.validate("cartResponse", createResponse.body).valid).toBe(true);
    expect(createResponse.body.line_items[0].quantity).toBe(1);

    const cartId = createResponse.body.id;

    const getResponse = await request(app)
      .get(`/carts/${cartId}`)
      .set({ "API-Version": "2026-04-17" });

    expect(getResponse.status).toBe(200);
    expect(validator.validate("cartResponse", getResponse.body).valid).toBe(true);

    const updateResponse = await request(app)
      .put(`/carts/${cartId}`)
      .set(
        requiredHeaders({
          "Idempotency-Key": "550e8400-e29b-41d4-a716-446655440011",
        }),
      )
      .send({
        line_items: [{ id: "item_456", quantity: 2 }],
      });

    expect(updateResponse.status).toBe(200);
    expect(validator.validate("cartResponse", updateResponse.body).valid).toBe(true);
    expect(updateResponse.body.line_items[0].quantity).toBe(2);

    const cancelResponse = await request(app)
      .post(`/carts/${cartId}/cancel`)
      .set({
        "API-Version": "2026-04-17",
        "Idempotency-Key": "550e8400-e29b-41d4-a716-446655440012"
      })
      .send({});

    expect(cancelResponse.status).toBe(200);

    const afterCancel = await request(app)
      .get(`/carts/${cartId}`)
      .set({ "API-Version": "2026-04-17" });

    expect(afterCancel.status).toBe(404);
  });

  it("handles feed create, upsert, and retrieval with schema-valid responses", async () => {
    const createResponse = await request(app)
      .post("/feeds")
      .set({ "Content-Type": "application/json" })
      .send({ target_country: "US" });

    expect(createResponse.status).toBe(201);
    expect(validator.validate("feedMetadataResponse", createResponse.body).valid).toBe(true);

    const feedId = createResponse.body.id;

    const upsertResponse = await request(app)
      .patch(`/feeds/${feedId}/products`)
      .set({ "Content-Type": "application/json" })
      .send({
        products: [
          {
            id: "prod_test_shirt",
            title: "Test Shirt",
            variants: [
              {
                id: "sku_test_shirt_small",
                title: "Test Shirt Small"
              }
            ]
          }
        ]
      });

    expect(upsertResponse.status).toBe(200);
    expect(validator.validate("feedUpsertResponse", upsertResponse.body).valid).toBe(true);

    const productsResponse = await request(app).get(`/feeds/${feedId}/products`);
    expect(productsResponse.status).toBe(200);
    expect(validator.validate("feedProductsResponse", productsResponse.body).valid).toBe(true);
  });

  it("rejects invalid feed payloads", async () => {
    const response = await request(app)
      .post("/feeds")
      .set({ "Content-Type": "application/json" })
      .send({ target_country: "usa" });

    expect(response.status).toBe(400);
    expect(response.body.type).toBe("invalid_request");
  });

  it("supports delegate authentication create -> authenticate -> get", async () => {
    const createResponse = await request(app)
      .post("/delegate_authentication")
      .set({
        "API-Version": "2026-04-17",
        "Content-Type": "application/json"
      })
      .send({
        merchant_id: "merchant_abc123",
        payment_method: {
          type: "card",
          number: "4917610000000000",
          exp_month: "03",
          exp_year: "2030",
          name: "Jane Doe"
        },
        amount: {
          value: 1000,
          currency: "EUR"
        }
      });

    expect(createResponse.status).toBe(201);
    expect(validator.validate("delegateAuthSessionResponse", createResponse.body).valid).toBe(true);

    const sessionId = createResponse.body.authentication_session_id;

    const authenticateResponse = await request(app)
      .post(`/delegate_authentication/${sessionId}/authenticate`)
      .set({
        "API-Version": "2026-04-17",
        "Content-Type": "application/json"
      })
      .send({ fingerprint_completion: "Y" });

    expect(authenticateResponse.status).toBe(200);
    expect(validator.validate("delegateAuthSessionResponse", authenticateResponse.body).valid).toBe(true);

    const getResponse = await request(app)
      .get(`/delegate_authentication/${sessionId}`)
      .set({ "API-Version": "2026-04-17" });

    expect(getResponse.status).toBe(200);
    expect(validator.validate("delegateAuthSessionWithResultResponse", getResponse.body).valid).toBe(true);
  });

  it("validates delegate payment requests and returns schema-valid tokens", async () => {
    const response = await request(app)
      .post("/agentic_commerce/delegate_payment")
      .set(requiredHeaders({ "Idempotency-Key": "550e8400-e29b-41d4-a716-446655440020" }))
      .send({
        payment_method: {
          type: "card",
          card_number_type: "fpan",
          number: "4242424242424242",
          exp_month: "11",
          exp_year: "2026",
          name: "Jane Doe",
          cvc: "223",
          checks_performed: ["avs"],
          iin: "424242",
          display_card_funding_type: "credit",
          display_brand: "visa",
          display_last4: "4242",
          metadata: {
            issuing_bank: "Test"
          }
        },
        allowance: {
          reason: "one_time",
          max_amount: 5000,
          currency: "usd",
          checkout_session_id: "cs_123",
          merchant_id: "acme",
          expires_at: "2026-12-31T00:00:00Z"
        },
        risk_signals: [
          {
            type: "card_testing",
            score: 5,
            action: "authorized"
          }
        ],
        metadata: {
          source: "test"
        }
      });

    expect(response.status).toBe(201);
    expect(validator.validate("delegatePaymentResponse", response.body).valid).toBe(true);
  });

  it("rejects malformed delegate payment payloads", async () => {
    const response = await request(app)
      .post("/agentic_commerce/delegate_payment")
      .set(requiredHeaders({ "Idempotency-Key": "550e8400-e29b-41d4-a716-446655440021" }))
      .send({
        payment_method: {
          type: "card",
          card_number_type: "fpan",
          number: "4242424242424242",
          exp_month: "11",
          exp_year: "2026",
          name: "Jane Doe",
          cvc: "223",
          checks_performed: ["avs"],
          iin: "424242",
          display_card_funding_type: "credit",
          display_brand: "visa",
          display_last4: "4242",
          metadata: {
            issuing_bank: "Test"
          }
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.type).toBe("invalid_request");
  });

  it("accepts webhook events with valid signature format and exposes debug retrieval", async () => {
    const signature =
      "t=1709123456,v1=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    const response = await request(app)
      .post("/agentic_checkout/webhooks/order_events")
      .set({
        "Content-Type": "application/json",
        "Merchant-Signature": signature,
        "Request-Id": "req_webhook_1"
      })
      .send({
        type: "order_update",
        data: {
          type: "order",
          id: "ord_123",
          checkout_session_id: "cs_123",
          permalink_url: "https://merchant.example.com/orders/ord_123",
          status: "processing"
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.received).toBe(true);

    const debugResponse = await request(app).get("/_debug/webhooks");
    expect(debugResponse.status).toBe(200);
    expect(debugResponse.body.count).toBe(1);
  });

  it("returns schema-valid discovery document", async () => {
    const response = await request(app).get("/.well-known/acp.json");

    expect(response.status).toBe(200);
    const validation = validator.validate("discoveryResponse", response.body);
    expect(validation.valid).toBe(true);
  });
});
