import { createHmac, randomUUID } from 'node:crypto';
import { Logger } from '@vendure/core';

export interface WebhookPayload {
    eventType: string;
    entityType: string;
    entityId: string | number;
    occurredAt: string;
    data?: Record<string, unknown>;
}

// Existing Product payload interface
export interface ProductWebhookPayload {
    eventType: 'created' | 'updated' | 'deleted';
    productId: string | number;
    productName: string;
    occurredAt: string;
}

// ============================================
// WEBHOOK DELIVERY RETRY SETTINGS
// ============================================

// Total attempts: 1 initial + 3 retries
const MAX_ATTEMPTS = 4;

// Delay before retry attempts
const RETRY_DELAYS_MS = [
    1000,
    2000,
    4000,
];

const REQUEST_TIMEOUT_MS = 5000;

// ============================================
// DELAY HELPER
// ============================================

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// WEBHOOK SENDER
// Sends webhook with automatic delivery retries
// ============================================

export async function sendWebhook(
    payload: WebhookPayload,
): Promise<void> {
    const webhookUrl = process.env.INTEGRATION_WEBHOOK_URL;
    const secret = process.env.WEBHOOK_SECRET;

    if (!webhookUrl) {
        Logger.warn(
            'Integration webhook URL is not configured.',
            'WebhookSender',
        );
        return;
    }

    if (!secret) {
        Logger.warn(
            'Webhook secret is not configured.',
            'WebhookSender',
        );
        return;
    }

    // Generate the event ID only once.
    // All retry attempts must use the same event ID.
    const webhookPayload = {
        schemaVersion: 1,
        eventId: randomUUID(),
        source: 'vendure',
        eventType: payload.eventType,
        entityType: payload.entityType,
        entityId: String(payload.entityId),
        occurredAt: payload.occurredAt,
        ...(payload.data ? { data: payload.data } : {}),
    };

    const rawBody = JSON.stringify(webhookPayload);

    // ========================================
    // DELIVERY ATTEMPTS
    // ========================================

    for (
        let attempt = 1;
        attempt <= MAX_ATTEMPTS;
        attempt++
    ) {
        const timestamp = Math.floor(
            Date.now() / 1000,
        ).toString();

        // Generate a fresh signature for each attempt.
        // The event ID and payload remain unchanged.
        const signature = createHmac('sha256', secret)
            .update(`${timestamp}.${rawBody}`)
            .digest('hex');

        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',

                signal: AbortSignal.timeout(
                    REQUEST_TIMEOUT_MS,
                ),

                headers: {
                    'Content-Type': 'application/json',
                    'X-Webhook-Timestamp': timestamp,
                    'X-Webhook-Signature': `sha256=${signature}`,
                },

                body: rawBody,
            });

            if (response.ok) {
                Logger.info(
                    `Webhook delivered successfully: ${payload.eventType} (${payload.entityType} ID: ${payload.entityId})`,
                    'WebhookSender',
                );

                return;
            }

            const errorBody = await response.text();

            // Retry temporary HTTP errors only
            const retryable =
                response.status === 408 ||
                response.status === 425 ||
                response.status === 429 ||
                response.status >= 500;

            if (!retryable) {
                Logger.error(
                    `Webhook rejected with HTTP ${response.status}. ${errorBody}`,
                    'WebhookSender',
                );

                return;
            }

            if (attempt === MAX_ATTEMPTS) {
                Logger.error(
                    `Webhook delivery failed after ${MAX_ATTEMPTS} attempts. HTTP ${response.status}.`,
                    'WebhookSender',
                );

                return;
            }

            const retryDelay =
                RETRY_DELAYS_MS[attempt - 1];

            Logger.warn(
                `Webhook delivery attempt ${attempt}/${MAX_ATTEMPTS} failed with HTTP ${response.status}. Retrying in ${retryDelay}ms.`,
                'WebhookSender',
            );

            await delay(retryDelay);

        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Unknown network error';

            if (attempt === MAX_ATTEMPTS) {
                Logger.error(
                    `Webhook delivery failed after ${MAX_ATTEMPTS} attempts: ${message}`,
                    'WebhookSender',
                );

                return;
            }

            const retryDelay =
                RETRY_DELAYS_MS[attempt - 1];

            Logger.warn(
                `Webhook delivery attempt ${attempt}/${MAX_ATTEMPTS} failed: ${message}. Retrying in ${retryDelay}ms.`,
                'WebhookSender',
            );

            await delay(retryDelay);
        }
    }
}

// ============================================
// BACKWARD-COMPATIBLE PRODUCT SENDER
// ============================================

export async function sendProductWebhook(
    payload: ProductWebhookPayload,
): Promise<void> {
    return sendWebhook({
        eventType: `product.${payload.eventType}`,
        entityType: 'product',
        entityId: payload.productId,
        occurredAt: payload.occurredAt,
    });
}