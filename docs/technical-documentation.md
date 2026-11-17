# Technical Documentation
## Vendure–Strapi Bidirectional Integration

## 1. Introduction

This document explains the technical implementation of the bidirectional integration between Vendure 3.8.1 and Strapi 5.62.0.

The integration uses a centralized Integration Service built with Node.js, TypeScript, and Express. It receives webhook events from both systems, synchronizes the relevant data, maintains cross-system mappings, and records synchronization activity in a SQLite database using Prisma.

The main objectives are:

- Keep product content synchronized between Strapi and Vendure.
- Keep commerce-related information synchronized from Vendure to Strapi.
- Maintain reliable references between records in both systems.
- Handle duplicate webhook events and synchronization failures.
- Provide monitoring and manual operations through an Integration Dashboard.

## 2. System Architecture

The system contains three main applications.

| Component | Responsibility |
|---|---|
| Vendure | E-commerce product, variant, SKU, price, stock, and availability management |
| Strapi | Product content, descriptions, images, categories, SEO, and specifications |
| Integration Service | Webhook processing, synchronization, mapping, logging, and retry management |

### Architecture Flow

```text
                 STRAPI CMS
                     |
                     | Strapi Webhooks
                     |
                     v
          INTEGRATION SERVICE
          -------------------
          Webhook Routes
          Authentication
          Product Synchronization
          Category Synchronization
          Image Synchronization
          Retry Worker
          Dashboard Routes
                     |
                     |
              SQLite Database
                (Prisma)
                     |
          -----------------------
          |          |          |
       Product   Category     Media
       Mapping   Mapping     Mapping
                     |
                  Sync Logs

                     ^
                     |
                     | Vendure Webhooks
                     |
                  VENDURE
```

The Integration Service is the central communication layer. Both applications communicate through its webhook endpoints and API clients.

The Integration Service is responsible for synchronization logic so that the two applications do not need to contain duplicated integration logic.

## 3. Data Ownership Strategy

The integration uses a field-ownership strategy.

Each system owns specific data fields. This reduces the possibility of both systems continuously overwriting each other's information.

### 3.1 Strapi as the Source of Truth

Strapi manages content-related information.

| Field | Synchronization Direction |
|---|---|
| Product name | Strapi → Vendure |
| Product description | Strapi → Vendure |
| Product slug | Strapi → Vendure |
| Product images | Strapi → Vendure |
| Product gallery | Strapi → Vendure |
| Product category | Strapi → Vendure Collection |
| Product specifications | Strapi → Vendure |
| SEO metadata | Strapi → Vendure |
| Variant display labels | Strapi → Vendure |

### 3.2 Vendure as the Source of Truth

Vendure manages commerce-related information.

| Field | Synchronization Direction |
|---|---|
| Product and variant identifiers | Vendure → Strapi |
| Product and variant SKUs | Vendure → Strapi |
| Variant prices | Vendure → Strapi |
| Stock information | Vendure → Strapi |
| Commerce availability | Vendure → Strapi |
| Commerce status and snapshots | Vendure → Strapi |

Vendure controls whether a product is commercially available. Strapi stores the relevant commerce status and a snapshot of commerce information through its Product Commerce content type.

### 3.3 Integration Service Ownership

The Integration Service manages:

- Cross-system product ID mappings.
- Category ID mappings.
- Media ID mappings.
- Webhook event processing.
- Synchronization logs.
- Retry scheduling and processing.

This separation helps keep content responsibilities and commerce responsibilities independent.

## 4. Data Mapping Strategy

The Integration Service uses Prisma and SQLite to maintain relationships between records in both systems.

The current database contains four main models.

### 4.1 ProductMapping

Connects a Strapi Product with a Vendure Product.

Important fields:

| Field | Description |
|---|---|
| `id` | Internal mapping record ID |
| `strapiDocumentId` | Strapi Product document ID |
| `vendureProductId` | Vendure Product ID |
| `contentHash` | Optional content hash |
| `lastSyncedAt` | Last synchronization timestamp |
| `createdAt` | Mapping creation time |
| `updatedAt` | Last mapping update time |

Both `strapiDocumentId` and `vendureProductId` have unique constraints.

### 4.2 CategoryMapping

Connects a Strapi Category with a Vendure Collection.

| Field | Description |
|---|---|
| `id` | Internal mapping record ID |
| `strapiDocumentId` | Strapi Category document ID |
| `vendureCollectionId` | Vendure Collection ID |
| `createdAt` | Mapping creation time |
| `updatedAt` | Last mapping update time |

Both external identifiers are unique.

### 4.3 MediaMapping

Connects Strapi media files with Vendure assets.

| Field | Description |
|---|---|
| `id` | Internal mapping record ID |
| `strapiFileDocumentId` | Strapi media document ID |
| `vendureAssetId` | Vendure Asset ID |
| `fileName` | Original filename |
| `mimeType` | Media MIME type |
| `createdAt` | Mapping creation time |
| `updatedAt` | Last mapping update time |

Unique constraints prevent one external identifier from being mapped to multiple records in the same mapping table.

### 4.4 SyncLog

Stores webhook and synchronization information.

Important fields:

| Field | Description |
|---|---|
| `id` | Internal log ID |
| `eventId` | Unique event identifier |
| `source` | Event source: Vendure or Strapi |
| `eventType` | Type of webhook event |
| `entityType` | Type of affected entity |
| `entityId` | Related entity identifier |
| `status` | Processing status |
| `errorMessage` | Error details when processing fails |
| `receivedAt` | Event receiving timestamp |
| `processedAt` | Processing completion timestamp |
| `attemptCount` | Number of attempts |
| `lastAttemptAt` | Last processing attempt |
| `nextRetryAt` | Scheduled retry time |
| `payload` | Stored webhook payload |

A unique constraint on `eventId` supports duplicate event protection.

### 4.5 Variant Mapping

The current Prisma schema does not contain a separate VariantMapping model.

Variant information is obtained from Vendure and associated with its parent Product during synchronization. Product Commerce stores a snapshot of relevant variant information in Strapi.

## 5. Synchronization Approach

The integration uses webhook-driven synchronization.

Instead of continuously polling both applications for changes, the Integration Service receives events when relevant content or commerce changes occur.

### 5.1 Strapi to Vendure

The Strapi-to-Vendure workflow is:

1. A Product or Category is created or updated in Strapi.
2. Strapi sends a webhook to the Integration Service.
3. The `/webhooks/strapi` endpoint receives the request.
4. The shared webhook secret is verified.
5. The event is assigned an event ID and saved in SyncLog.
6. Duplicate events are detected and ignored.
7. The Integration Service identifies the affected Strapi document.
8. The relevant synchronization function retrieves the Strapi content.
9. Product content, category information, media, SEO, and specifications are synchronized to Vendure according to the supported flow.
10. The synchronization result is recorded in the database.

Main implementation files:

- `src/strapi-to-vendure.ts`
- `src/category-sync.ts`
- `src/image-sync.ts`
- `src/strapi.ts`
- `src/vendure.ts`
- `src/routes/webhooks.ts`

### 5.2 Vendure to Strapi

The Vendure-to-Strapi workflow is:

1. A relevant Product, Variant, Stock, or Variant Price event occurs in Vendure.
2. Vendure sends a webhook to the Integration Service.
3. The `/webhooks/vendure` endpoint receives the request.
4. The HMAC signature and timestamp are verified.
5. The event is saved in SyncLog.
6. Duplicate events are identified.
7. The Integration Service resolves the affected Vendure Product ID.
8. The ProductMapping record is retrieved.
9. The corresponding Strapi Product and Product Commerce information are updated.
10. The synchronization result is recorded in SyncLog.

For variant events, the parent Product ID is used to identify the corresponding Strapi Product. For variant-price events, the Integration Service resolves the parent Product using the Variant ID.

Main implementation files:

- `src/product-sync.ts`
- `src/vendure.ts`
- `src/strapi.ts`
- `src/routes/webhooks.ts`

### 5.3 Product Lifecycle Synchronization

Commerce availability is controlled by Vendure.

When a mapped Vendure Product is disabled, its corresponding Strapi commerce information is updated to reflect an archived or unavailable state.

When it is enabled again, the Strapi lifecycle and commerce status are updated accordingly.

For Strapi Product deletion, the integration handles the `entry.delete` event by archiving the corresponding Vendure Product when its document ID is available.

## 6. Webhook Communication and Security

The Integration Service exposes two webhook endpoints.

| Source | HTTP Method | Endpoint |
|---|---|---|
| Vendure | POST | `/webhooks/vendure` |
| Strapi | POST | `/webhooks/strapi` |

### 6.1 Vendure Webhook Contract

Vendure sends a custom JSON payload.

Important fields include:

| Field | Description |
|---|---|
| `schemaVersion` | Webhook payload version |
| `eventId` | Unique event ID |
| `source` | Event source, set to `vendure` |
| `eventType` | Event type |
| `entityType` | Affected entity type |
| `entityId` | Affected entity ID |
| `occurredAt` | Event creation timestamp |
| `data` | Additional event information, such as Product or Variant IDs |

Supported event categories include:

- Product creation and updates.
- Product Variant creation, updates, deletion, and stock updates.
- Product Variant Price creation, updates, and deletion.

### 6.2 Vendure Webhook Authentication

Vendure webhook requests use HMAC SHA-256 signature verification.

The request contains:

- `X-Webhook-Timestamp`
- `X-Webhook-Signature`

The Integration Service uses the configured `WEBHOOK_SECRET` to verify the signature.

Timestamp validation helps reject old or replayed requests outside the configured acceptance window.

### 6.3 Strapi Webhook Authentication

Strapi sends webhook requests with the shared secret in:

`X-Strapi-Webhook-Secret`

The Integration Service compares the received secret with its configured `STRAPI_WEBHOOK_SECRET`.

Both systems must use matching webhook configuration.

### 6.4 Raw Request Body

The Express JSON middleware retains the raw request body in addition to parsing JSON.

This allows the Vendure signature verification logic to validate the original request content rather than a reconstructed JSON object.

## 7. Duplicate Event Prevention and Idempotency

Webhook providers may deliver the same event more than once.

The Integration Service uses event identifiers and database uniqueness to reduce duplicate processing.

The event ID strategy is:

1. Use the provider's `eventId` when it is available.
2. Otherwise, generate a SHA-256 hash using the event source and raw request body.
3. Check whether the event ID already exists in SyncLog.
4. Ignore an already recorded event.
5. Enforce the unique database constraint to handle simultaneous duplicate insertions.

If two identical events arrive at nearly the same time, the unique constraint prevents both from creating separate records. A Prisma unique-constraint conflict is handled by retrieving the existing event.

This approach makes webhook event processing idempotent at the event-recording level.

It does not represent a general distributed transaction across Vendure, Strapi, and SQLite.

## 8. Error Handling and Retry Mechanism

Synchronization can fail because of API errors, invalid data, missing mappings, network problems, or authentication failures.

The Integration Service records processing errors in SyncLog.

### 8.1 Event Processing States

The implementation uses statuses including:

| Status | Meaning |
|---|---|
| `received` | Webhook event has been recorded |
| `processing` | Synchronization is in progress |
| `processed` | Synchronization completed successfully |
| `failed` | Synchronization failed and may be retried |
| `ignored` | Event is unsupported, unmapped, or cannot be handled by the current flow |
| `retry_exhausted` | Automatic retry limit has been reached |

### 8.2 Failed Event Handling

When a synchronization operation fails:

1. The error message is recorded in SyncLog.
2. The event status becomes `failed`.
3. The failed processing timestamp is stored.
4. A next retry time is scheduled.
5. The retry worker checks for eligible events.

The webhook handler returns an error response when processing fails.

### 8.3 Automatic Retry Worker

The retry worker is implemented in:

`src/retry-worker.ts`

Its current configuration includes:

| Setting | Value |
|---|---|
| Maximum retry attempts | 5 |
| Polling interval | 15 seconds |
| Retry delays | 1, 2, 5, and 15 minutes |
| Retry lease | 10 minutes |
| Events processed per polling batch | Up to 10 |

The worker checks for failed events whose retry time is due.

It claims eligible records by updating their status and attempt information before executing synchronization.

This helps reduce the chance of the same retry record being picked up by overlapping worker executions.

The retry operation depends on the event source and entity type to select the appropriate synchronization function.

### 8.4 Manual Retry

The dashboard provides a retry action for events with `failed` or `retry_exhausted` status.

A manual retry:

- Resets the retry attempt count.
- Clears the previous processing completion timestamp.
- Changes the event back to an eligible failed state.
- Schedules it for immediate retry processing.

The retry worker then processes the event.

### 8.5 Ignored Events

Not every incoming webhook represents a supported synchronization operation.

Examples include:

- Unsupported event types.
- Vendure events where the parent Product cannot be identified.
- Vendure Products without an existing ProductMapping.
- Strapi events without a usable document ID.
- Unsupported category deletion events.

These events are recorded as `ignored` instead of being treated as successful synchronization.

## 9. Dashboard and Monitoring

The Integration Management Dashboard is provided by the Integration Service.

Dashboard URL:

`http://localhost:4000/dashboard`

It is designed for local development and is restricted to localhost requests.

### 9.1 Dashboard Overview

The dashboard displays:

- Product mapping count.
- Category mapping count.
- Media mapping count.
- Processed event count.
- Failed and retry-exhausted event count.

It also provides tables for product, category, and media mappings.

### 9.2 Dashboard API

The dashboard exposes the following endpoints.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/dashboard/api/overview` | Summary counts |
| GET | `/dashboard/api/products` | Product mappings |
| GET | `/dashboard/api/categories` | Category mappings |
| GET | `/dashboard/api/media` | Media mappings |
| GET | `/dashboard/api/logs` | Synchronization event history |
| POST | `/dashboard/api/products/:vendureProductId/sync` | Manual product synchronization |
| POST | `/dashboard/api/retry/:id` | Queue a manual retry |

The logs endpoint supports status filtering and a configurable result limit.

The manual product synchronization endpoint supports:

- `vendure-to-strapi`
- `strapi-to-vendure`

The dashboard is intended for monitoring and operational control during local development and demonstration.

## 10. Important Design Decisions and Trade-offs

### 10.1 Separate Integration Service

**Decision:** Synchronization logic is centralized in a separate Express application.

**Reason:** This keeps Vendure and Strapi independent and avoids placing integration-specific logic inside both applications.

**Trade-off:** The Integration Service becomes an additional application that must be configured and run.

### 10.2 SQLite Instead of Redis or an External Queue

**Decision:** SQLite with Prisma is used to persist mappings and retry information.

**Reason:** It keeps local setup simple and avoids requiring Docker, Redis, or a separate queue service.

**Trade-off:** SQLite is suitable for the local assignment scope but is not a substitute for a dedicated distributed queue in a high-concurrency production architecture.

### 10.3 Webhook-Driven Synchronization

**Decision:** Events are sent when relevant changes occur.

**Reason:** This avoids continuous polling and allows changes to be synchronized through event handlers.

**Trade-off:** Synchronization is eventually consistent. Temporary network or API failures can delay updates until retry processing succeeds.

### 10.4 Field Ownership

**Decision:** Strapi owns content fields, while Vendure owns commerce fields.

**Reason:** Clear ownership reduces conflicting updates.

**Trade-off:** The integration does not implement a universal last-write-wins conflict resolver. Data changes should follow the defined ownership rules.

### 10.5 Localhost-Only Dashboard

**Decision:** Dashboard routes reject requests that do not originate from localhost.

**Reason:** The dashboard is intended for local assignment demonstration and operational visibility.

**Trade-off:** Remote dashboard administration requires additional authentication and deployment security before production use.

### 10.6 Single-Currency and Single-Channel Scope

**Decision:** The initial implementation focuses on one language, channel, and currency.

**Reason:** This keeps the synchronization model manageable for the assignment.

**Trade-off:** Multi-language, multi-channel, and multi-currency synchronization require additional mapping and conversion rules.

## 11. Testing and Verification

The following workflows have been demonstrated during local development.

### 11.1 Strapi to Vendure Product Update

- Updated the description of the Integration Test Product in Strapi.
- Published the updated Product.
- Verified that the corresponding Vendure Product received the updated description.

### 11.2 Vendure to Strapi Availability Update

- Disabled the mapped Product in Vendure.
- Verified the corresponding Strapi commerce status changed to archived/unavailable.
- Verified `commerceEnabled` became `false`.
- Enabled the Product again in Vendure.
- Verified the Strapi lifecycle status returned to active and `commerceEnabled` became `true`.

### 11.3 Dashboard Verification

Verified that the dashboard displays:

- Product mappings.
- Category mappings.
- Media mappings.
- Processed event counts.
- Failed event counts.
- Synchronization logs.

### 11.4 Service Health

The Integration Service health endpoint is:

`http://localhost:4000/health`

It checks database connectivity using a database query.

A successful health response reports:

```json
{
  "status": "ok",
  "service": "integration-service",
  "database": "connected"
}
```

### 11.5 TypeScript Validation

The Integration Service TypeScript validation command is:

```powershell
npm run typecheck
```

This command has been run successfully during development.

**Testing limitation:** The Integration Service package does not currently contain a configured automated test suite. Its `npm test` script is still the default placeholder. The verification described above is based on manual development and integration checks.

## 12. Known Limitations and Future Improvements

The current implementation is designed for the assignment's local development scope.

Known limitations include:

- Strapi Category deletion is not currently supported by the webhook flow.
- Vendure product events without an existing mapping are ignored.
- The current integration scope is limited to one language, channel, and currency.
- The dashboard is restricted to localhost and does not provide production-grade user authentication.
- SQLite-based retry polling is intended for a local deployment rather than a distributed multi-instance worker architecture.
- Automated integration and unit test coverage should be expanded.
- A dedicated conflict-resolution strategy and more comprehensive loop-prevention mechanism would strengthen production readiness.
- Full end-to-end verification should be expanded to cover all product, category, media, variant, price, stock, and failure scenarios.

Potential future improvements include:

- Automated integration tests for both synchronization directions.
- Better conflict detection and reconciliation tooling.
- More detailed retry and failure analytics.
- Production-grade dashboard authentication.
- Support for multiple channels, languages, and currencies.
- A dedicated message queue for larger deployments.

## 13. Related Documentation

- [`README.md`](../README.md) — Project introduction, installation, setup, architecture overview, and demo information.
- [`decisions.md`](./decisions.md) — Architecture and data ownership decisions.
- [`webhook-contract.md`](./webhook-contract.md) — Webhook payload structure and communication rules.

## 14. Conclusion

The project demonstrates a webhook-driven bidirectional integration between Vendure and Strapi using a centralized Integration Service.

It separates content ownership from commerce ownership, maintains cross-system mappings, authenticates incoming webhooks, records synchronization events, prevents duplicate event records, and provides retry handling and a monitoring dashboard.

The architecture provides a foundation for maintaining consistency between an e-commerce backend and a headless CMS while keeping both applications independently manageable.