\# Webhook Contract



\## 1. Purpose



This document defines the webhook payload structure and communication rules for the Vendure-Strapi integration.



\## 2. Webhook Sources



Two applications send webhook events:



\- Vendure

\- Strapi



The Integration Service will receive and normalize events from both applications.



\## 3. Vendure Webhook Payload



Vendure uses a custom JSON payload.



\### Required Fields



\- schemaVersion: Payload format version.

\- eventId: Unique event identifier.

\- source: Event source, always vendure.

\- eventType: Type of event.

\- entityType: Type of affected entity.

\- entityId: ID of the affected entity.

\- occurredAt: Event creation timestamp in UTC.



\### Optional Fields



\- productId: Parent Product ID for Variant-related events.



\### Example: Product Created



```json

{

&#x20; "schemaVersion": 1,

&#x20; "eventId": "unique-event-id",

&#x20; "source": "vendure",

&#x20; "eventType": "product.created",

&#x20; "entityType": "product",

&#x20; "entityId": "55",

&#x20; "occurredAt": "2026-11-14T05:29:58.885Z"

}

