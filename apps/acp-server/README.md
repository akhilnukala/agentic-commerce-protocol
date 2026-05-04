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

## Environment

Copy `.env.example` if needed:

- `PORT` (default: `8080`)
- `ACP_REPO_ROOT` optional. If unset, the app auto-discovers the repo root by finding `spec/2026-04-17`.

## Notes

- Data storage is in-memory only.
- The server includes seeded feed/catalog data for immediate testing.
- Logs are emitted for each operation with operation IDs and key context.
