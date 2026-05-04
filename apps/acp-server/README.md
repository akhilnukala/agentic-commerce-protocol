# ACP REST Server (Mock, Schema-Validated)

This package implements ACP-compatible REST endpoints using the protocol definitions in this repository:

- OpenAPI: ../../spec/2026-04-17/openapi
- JSON Schema: ../../spec/2026-04-17/json-schema

## What Is Implemented

- Checkout API
- Cart API
- Feed API
- Delegate Authentication API
- Delegate Payment API
- Order webhook receiver
- Discovery endpoint at `/.well-known/acp.json`
- Non-ACP debug endpoint: `GET /_debug/webhooks`

## Key Behaviors

- Strict request validation using ACP JSON Schemas
- Required header enforcement based on OpenAPI `required: true` headers
- Authorization is intentionally excluded for local dev mode
- API-Version is required where the spec requires it, but any value is accepted and echoed
- Idempotency-Key is required where the spec requires it, but full replay/collision state is not implemented
- Webhook signature validates format only (`t=<unix_seconds>,v1=<64_hex>`)

## Quick Start

1. Install dependencies (validated with npm):

   `npm install`

2. Run tests:

   `npm test`

3. Start server:

   `npm run dev`

4. Build production output:

   `npm run build`

5. Run built server:

   `npm run start`

## curl Cheat Sheet

These examples are self-contained and can be pasted directly.

If you want a browser-friendly version with explicit copy buttons for every snippet, open [docs/curl-cheatsheet.html](./docs/curl-cheatsheet.html).

Useful seeded IDs for local testing:

- `feed_seed`
- `item_123`
- `item_456`
- `prod_classic_tee`
- `sku123-red-s`

### Fresh Server Happy Path

If you restart the server and start from empty in-memory state, the first generated IDs will typically be:

- `cart_000001`
- `cs_000001`
- `das_000001`
- `feed_000001`

If your server already has state, use the route-by-route examples below and replace the placeholder IDs with the ones returned by the create calls.

1. Health check

```bash
curl "http://localhost:8080/healthz"
```

2. Discovery

```bash
curl "http://localhost:8080/.well-known/acp.json"
```

3. Read the seeded product catalog

```bash
curl "http://localhost:8080/feeds/feed_seed/products"
```

4. Create a cart

```bash
curl -X POST "http://localhost:8080/carts" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440010" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "line_items": [
         { "id": "item_123", "quantity": 1 }
      ]
   }'
```

5. Update that cart

```bash
curl -X PUT "http://localhost:8080/carts/cart_000001" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440011" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "line_items": [
         { "id": "item_456", "quantity": 2 }
      ]
   }'
```

6. Create a checkout session

```bash
curl -X POST "http://localhost:8080/checkout_sessions" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "line_items": [
         { "id": "item_123" }
      ],
      "currency": "usd",
      "capabilities": {}
   }'
```

7. Create a delegated payment token

```bash
curl -X POST "http://localhost:8080/agentic_commerce/delegate_payment" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440020" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "payment_method": {
         "type": "card",
         "card_number_type": "fpan",
         "number": "4242424242424242",
         "exp_month": "11",
         "exp_year": "2026",
         "name": "Jane Doe",
         "cvc": "223",
         "checks_performed": ["avs"],
         "iin": "424242",
         "display_card_funding_type": "credit",
         "display_brand": "visa",
         "display_last4": "4242",
         "metadata": {
            "issuing_bank": "Test"
         }
      },
      "allowance": {
         "reason": "one_time",
         "max_amount": 5000,
         "currency": "usd",
         "checkout_session_id": "cs_123",
         "merchant_id": "acme",
         "expires_at": "2026-12-31T00:00:00Z"
      },
      "risk_signals": [
         {
            "type": "card_testing",
            "score": 5,
            "action": "authorized"
         }
      ],
      "metadata": {
         "source": "test"
      }
   }'
```

8. Create an authentication session

```bash
curl -X POST "http://localhost:8080/delegate_authentication" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "merchant_id": "merchant_abc123",
      "payment_method": {
         "type": "card",
         "number": "4917610000000000",
         "exp_month": "03",
         "exp_year": "2030",
         "name": "Jane Doe"
      },
      "amount": {
         "value": 1000,
         "currency": "EUR"
      }
   }'
```

9. Authenticate the authentication session

```bash
curl -X POST "http://localhost:8080/delegate_authentication/das_000001/authenticate" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "fingerprint_completion": "Y"
   }'
```

10. Complete the checkout session

```bash
curl -X POST "http://localhost:8080/checkout_sessions/cs_000001/complete" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440002" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "payment_data": {
         "handler_id": "handler_card",
         "instrument": {
            "type": "card",
            "credential": {
               "type": "spt",
               "token": "spt_123"
            }
         }
      }
   }'
```

11. Post an order webhook event

```bash
curl -X POST "http://localhost:8080/agentic_checkout/webhooks/order_events" \
   -H "Content-Type: application/json" \
   -H "Merchant-Signature: t=1709123456,v1=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" \
   -H "Request-Id: req_webhook_1" \
   -d '{
      "type": "order_update",
      "data": {
         "type": "order",
         "id": "ord_123",
         "checkout_session_id": "cs_123",
         "permalink_url": "https://merchant.example.com/orders/ord_123",
         "status": "processing"
      }
   }'
```

12. Inspect captured webhook events

```bash
curl "http://localhost:8080/_debug/webhooks"
```

### Individual Route Examples

#### Health And Discovery

Health check:

```bash
curl "http://localhost:8080/healthz"
```

Discovery:

```bash
curl "http://localhost:8080/.well-known/acp.json"
```

#### Checkout API

Create a checkout session:

```bash
curl -X POST "http://localhost:8080/checkout_sessions" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "line_items": [
         { "id": "item_123" }
      ],
      "currency": "usd",
      "capabilities": {}
   }'
```

Get a checkout session:

```bash
curl "http://localhost:8080/checkout_sessions/cs_000001" \
   -H "API-Version: 2026-04-17" \
   -H "Request-Id: req_demo_123"
```

Update a checkout session:

```bash
curl -X POST "http://localhost:8080/checkout_sessions/cs_000001" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440001" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "selected_fulfillment_options": [
         {
            "type": "shipping",
            "option_id": "fulfillment_option_456",
            "item_ids": ["item_123"]
         }
      ]
   }'
```

Complete a checkout session:

```bash
curl -X POST "http://localhost:8080/checkout_sessions/cs_000001/complete" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440002" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "payment_data": {
         "handler_id": "handler_card",
         "instrument": {
            "type": "card",
            "credential": {
               "type": "spt",
               "token": "spt_123"
            }
         }
      }
   }'
```

Cancel a checkout session:

```bash
curl -X POST "http://localhost:8080/checkout_sessions/cs_000001/cancel" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440003" \
   -H "Request-Id: req_demo_123" \
   -d '{}'
```

#### Cart API

Create a cart:

```bash
curl -X POST "http://localhost:8080/carts" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440010" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "line_items": [
         { "id": "item_123", "quantity": 1 }
      ]
   }'
```

Get a cart:

```bash
curl "http://localhost:8080/carts/cart_000001" \
   -H "API-Version: 2026-04-17" \
   -H "Request-Id: req_demo_123"
```

Update a cart:

```bash
curl -X PUT "http://localhost:8080/carts/cart_000001" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440011" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "line_items": [
         { "id": "item_456", "quantity": 2 }
      ]
   }'
```

Cancel a cart:

```bash
curl -X POST "http://localhost:8080/carts/cart_000001/cancel" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440012" \
   -H "Request-Id: req_demo_123" \
   -d '{}'
```

#### Delegate Authentication API

Create an authentication session:

```bash
curl -X POST "http://localhost:8080/delegate_authentication" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "merchant_id": "merchant_abc123",
      "payment_method": {
         "type": "card",
         "number": "4917610000000000",
         "exp_month": "03",
         "exp_year": "2030",
         "name": "Jane Doe"
      },
      "amount": {
         "value": 1000,
         "currency": "EUR"
      }
   }'
```

Authenticate a session:

```bash
curl -X POST "http://localhost:8080/delegate_authentication/das_000001/authenticate" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "fingerprint_completion": "Y"
   }'
```

Get an authentication session:

```bash
curl "http://localhost:8080/delegate_authentication/das_000001" \
   -H "API-Version: 2026-04-17" \
   -H "Request-Id: req_demo_123"
```

#### Delegate Payment API

Create a delegated payment token:

```bash
curl -X POST "http://localhost:8080/agentic_commerce/delegate_payment" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440020" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "payment_method": {
         "type": "card",
         "card_number_type": "fpan",
         "number": "4242424242424242",
         "exp_month": "11",
         "exp_year": "2026",
         "name": "Jane Doe",
         "cvc": "223",
         "checks_performed": ["avs"],
         "iin": "424242",
         "display_card_funding_type": "credit",
         "display_brand": "visa",
         "display_last4": "4242",
         "metadata": {
            "issuing_bank": "Test"
         }
      },
      "allowance": {
         "reason": "one_time",
         "max_amount": 5000,
         "currency": "usd",
         "checkout_session_id": "cs_123",
         "merchant_id": "acme",
         "expires_at": "2026-12-31T00:00:00Z"
      },
      "risk_signals": [
         {
            "type": "card_testing",
            "score": 5,
            "action": "authorized"
         }
      ],
      "metadata": {
         "source": "test"
      }
   }'
```

#### Feed API

Create a feed:

```bash
curl -X POST "http://localhost:8080/feeds" \
   -H "Content-Type: application/json" \
   -d '{
      "target_country": "US"
   }'
```

Get feed metadata:

```bash
curl "http://localhost:8080/feeds/feed_seed"
```

Get feed products:

```bash
curl "http://localhost:8080/feeds/feed_seed/products"
```

Upsert feed products:

```bash
curl -X PATCH "http://localhost:8080/feeds/feed_seed/products" \
   -H "Content-Type: application/json" \
   -d '{
      "products": [
         {
            "id": "prod_test_shirt",
            "title": "Test Shirt",
            "variants": [
               {
                  "id": "sku_test_shirt_small",
                  "title": "Test Shirt Small"
               }
            ]
         }
      ]
   }'
```

#### Order Webhook Receiver

Post an order event webhook:

```bash
curl -X POST "http://localhost:8080/agentic_checkout/webhooks/order_events" \
   -H "Content-Type: application/json" \
   -H "Merchant-Signature: t=1709123456,v1=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" \
   -H "Request-Id: req_webhook_1" \
   -d '{
      "type": "order_update",
      "data": {
         "type": "order",
         "id": "ord_123",
         "checkout_session_id": "cs_123",
         "permalink_url": "https://merchant.example.com/orders/ord_123",
         "status": "processing"
      }
   }'
```

Inspect captured webhook events:

```bash
curl "http://localhost:8080/_debug/webhooks"
```

### Copy-Paste End-to-End Demo

Paste this into a terminal after starting a fresh server with `npm run dev`.

```bash
curl "http://localhost:8080/healthz"

curl "http://localhost:8080/.well-known/acp.json"

curl "http://localhost:8080/feeds/feed_seed/products"

curl -X POST "http://localhost:8080/carts" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440010" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "line_items": [
         { "id": "item_123", "quantity": 1 }
      ]
   }'

curl -X PUT "http://localhost:8080/carts/cart_000001" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440011" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "line_items": [
         { "id": "item_456", "quantity": 2 }
      ]
   }'

curl -X POST "http://localhost:8080/checkout_sessions" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "line_items": [
         { "id": "item_123" }
      ],
      "currency": "usd",
      "capabilities": {}
   }'

curl -X POST "http://localhost:8080/agentic_commerce/delegate_payment" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440020" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "payment_method": {
         "type": "card",
         "card_number_type": "fpan",
         "number": "4242424242424242",
         "exp_month": "11",
         "exp_year": "2026",
         "name": "Jane Doe",
         "cvc": "223",
         "checks_performed": ["avs"],
         "iin": "424242",
         "display_card_funding_type": "credit",
         "display_brand": "visa",
         "display_last4": "4242",
         "metadata": {
            "issuing_bank": "Test"
         }
      },
      "allowance": {
         "reason": "one_time",
         "max_amount": 5000,
         "currency": "usd",
         "checkout_session_id": "cs_123",
         "merchant_id": "acme",
         "expires_at": "2026-12-31T00:00:00Z"
      },
      "risk_signals": [
         {
            "type": "card_testing",
            "score": 5,
            "action": "authorized"
         }
      ],
      "metadata": {
         "source": "test"
      }
   }'

curl -X POST "http://localhost:8080/delegate_authentication" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "merchant_id": "merchant_abc123",
      "payment_method": {
         "type": "card",
         "number": "4917610000000000",
         "exp_month": "03",
         "exp_year": "2030",
         "name": "Jane Doe"
      },
      "amount": {
         "value": 1000,
         "currency": "EUR"
      }
   }'

curl -X POST "http://localhost:8080/delegate_authentication/das_000001/authenticate" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "fingerprint_completion": "Y"
   }'

curl -X POST "http://localhost:8080/checkout_sessions/cs_000001/complete" \
   -H "API-Version: 2026-04-17" \
   -H "Content-Type: application/json" \
   -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440002" \
   -H "Request-Id: req_demo_123" \
   -d '{
      "payment_data": {
         "handler_id": "handler_card",
         "instrument": {
            "type": "card",
            "credential": {
               "type": "spt",
               "token": "spt_123"
            }
         }
      }
   }'

curl -X POST "http://localhost:8080/agentic_checkout/webhooks/order_events" \
   -H "Content-Type: application/json" \
   -H "Merchant-Signature: t=1709123456,v1=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" \
   -H "Request-Id: req_webhook_1" \
   -d '{
      "type": "order_update",
      "data": {
         "type": "order",
         "id": "ord_123",
         "checkout_session_id": "cs_123",
         "permalink_url": "https://merchant.example.com/orders/ord_123",
         "status": "processing"
      }
   }'

curl "http://localhost:8080/_debug/webhooks"
```

## Environment

Copy `.env.example` if needed:

- `PORT` (default: `8080`)
- `ACP_REPO_ROOT` optional. If unset, the app auto-discovers the repo root by finding `spec/2026-04-17`.

## Notes

- Data storage is in-memory only.
- The server includes seeded feed/catalog data for immediate testing.
- Logs are emitted for each operation with operation IDs and key context.
