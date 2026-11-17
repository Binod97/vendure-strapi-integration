# Architecture Decisions

## 1. Project

Vendure 3.x and Strapi 5 Bidirectional Integration.

## 2. Applications

- Vendure 3.8.1: E-commerce backend.
- Strapi 5: Product content management.
- Integration Service: Node.js, TypeScript, Express.
- Database: SQLite with Prisma.
- Admin Dashboard: React, Vite, Tailwind CSS.

## 3. Architecture

Four separate applications:

1. Vendure
2. Strapi
3. Integration Service
4. Admin Dashboard

## 4. Integration Principles

- Bidirectional product synchronization.
- Persistent queues and retry failed jobs.
- Idempotent synchronization.
- Conflict detection and resolution.
- Manual synchronization and reconciliation.
- Secure communication between applications.
- Centralized product and variant ID mapping.

## 5. Initial Scope

- One language, channel, and currency.
- Product images.
- Product categories mapped to Vendure Collections.
- Product specifications and SEO metadata.
- Local development without Docker or Redis.

## 6. Field Ownership Decisions

### Strapi Owns

- Product name, description and slug.
- Product images, SEO and specifications.
- Product category.
- Product variant display labels.

### Vendure Owns

- Product variant existence and commerce configuration.
- Product SKU and variant SKU.
- Product price and stock.
- Variant pricing.

### Integration Service Owns

- Cross-system product ID mapping.
- Cross-system variant ID mapping.
- Category ID mapping.
- Synchronization jobs, logs and conflict records.

### Variant SKU Decision

- Strapi Variant component retains `sku` and `label`.
- Strapi Variant `sku` is not the source of truth.
- Vendure remains authoritative for SKU.
- Strapi Variant `initialPrice` field is removed because Vendure owns pricing.

### Product Commerce

- Strapi stores a copy of Vendure commerce data.
- Product Commerce maintains synchronization status and commerce snapshots.

## 7. Phase 2 Schema Decisions

### Product Schema

- Product `name` is required.
- Product slug uses Strapi UID based on `name`.
- Product has a bidirectional one-to-one relation with Product Commerce.
- Existing draft and publish functionality is retained.

### Category Schema

- Category `name` is required.
- Category slug uses Strapi UID based on `name`.
- Category has a one-to-many relation with Products.

### Product Commerce Schema

- Separate `productDocumentId` field is removed.
- Product Commerce has a bidirectional one-to-one relation with Product.
- `vendureProductId` is required and unique.
- `commerceEnabled` defaults to `false`.
- `syncStatus` defaults to `pending`.
- `variantsSnapshot` stores Vendure commerce information.
- `lastSyncedAt` stores the last synchronization timestamp.

### Product Components

- SEO component retains its SEO fields.
- Specification component retains its key and value fields.
- Variant component retains `sku` and `label`.
- Variant `initialPrice` is removed.

## 8. Mapping Decision

- Product Commerce references its related Strapi Product through a one-to-one relation.
- Integration Service database is the authoritative source for cross-system ID mappings.
- Strapi Product system-generated `documentId` identifies Strapi products.
- Vendure Product IDs are stored in the Integration Service mapping database.

## 9. Synchronization Responsibilities

### Strapi to Vendure

- Product name.
- Product description.
- Product slug.
- Product images.
- Product category.
- SEO metadata.
- Product specifications.
- Variant labels.

### Vendure to Strapi

- Product and variant SKU.
- Variant commerce data.
- Price.
- Stock information.
- Commerce status and snapshot data.

Product Commerce stores a copy of relevant Vendure commerce information.

## 10. Development Principles

- Inspect existing files before making changes.
- Preserve existing project data and configuration.
- Avoid unnecessary schema and database changes.
- Test each major change before proceeding.
- Keep integration logic inside the Integration Service.
- Use secure webhook authentication and event verification.
- Prevent duplicate events and synchronization loops.
- Maintain synchronization logs and error handling.
