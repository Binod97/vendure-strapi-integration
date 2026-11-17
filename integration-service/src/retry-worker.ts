
import { prisma } from './db.js';

import {
    syncVendureProductToStrapi,
} from './product-sync.js';

import {
    syncStrapiCategoryToVendure,
} from './category-sync.js';

import {
    syncStrapiProductToVendure,
    archiveDeletedStrapiProduct,
} from './strapi-to-vendure.js';

import {
    getVendureProductIdByVariantId,
} from './vendure.js';

// Maximum attempts, including the first webhook attempt
const MAX_ATTEMPTS = 5;

// Worker checks every 15 seconds
const POLL_INTERVAL_MS = 15 * 1000;

// Retry delays
const RETRY_DELAYS_MS = [
    60 * 1000,
    2 * 60 * 1000,
    5 * 60 * 1000,
    15 * 60 * 1000,
];

// Retry lease
const RETRY_LEASE_MS = 10 * 60 * 1000;

let isRunning = false;

let workerTimer: ReturnType<typeof setInterval> | undefined;

// ============================================
// WEBHOOK PAYLOAD INTERFACE
// ============================================

interface VendureRetryPayload {
    data?: {
        productId?: string | number | null;
        variantId?: string | number | null;
    };
}

// ============================================
// IDENTIFY PRODUCT FOR VENDURE RETRY
// ============================================

async function getRetryProductId(log: {
    entityType: string;
    entityId: string;
    payload: string | null;
}): Promise<string> {
    const payload = JSON.parse(
        log.payload ?? '{}',
    ) as VendureRetryPayload;

    // Product event
    if (log.entityType === 'product') {
        return log.entityId;
    }

    // Product Variant event
    if (log.entityType === 'product-variant') {
        const productId = payload.data?.productId;

        if (productId !== undefined && productId !== null) {
            return String(productId);
        }

        // Fallback: find parent Product using Variant ID
        const parentProductId =
            await getVendureProductIdByVariantId(log.entityId);

        if (parentProductId) {
            return parentProductId;
        }
    }

    // Product Variant Price event
    if (log.entityType === 'product-variant-price') {
        const variantId = payload.data?.variantId;

        if (variantId === undefined || variantId === null) {
            throw new Error(
                'Variant ID missing from Price Webhook payload. Cannot retry this event.',
            );
        }

        const productId =
            await getVendureProductIdByVariantId(
                String(variantId),
            );

        if (productId) {
            return productId;
        }
    }

    throw new Error(
        `Could not identify Product for ${log.entityType} event.`,
    );
}

// ============================================
// EXECUTE RETRY
// ============================================

async function executeRetry(log: {
    id: string;
    eventId: string;
    source: string;
    eventType: string;
    entityType: string;
    entityId: string;
    payload: string | null;
    attemptCount: number;
}) {
    const startedAt = new Date();

    const attemptNumber = log.attemptCount + 1;

    // Claim the event to prevent concurrent processing
    const claim = await prisma.syncLog.updateMany({
        where: {
            id: log.id,
            status: 'failed',
            attemptCount: {
                lt: MAX_ATTEMPTS,
            },
            nextRetryAt: {
                lte: startedAt,
            },
        },
        data: {
            attemptCount: {
                increment: 1,
            },
            lastAttemptAt: startedAt,
            nextRetryAt: new Date(
                startedAt.getTime() + RETRY_LEASE_MS,
            ),
        },
    });

    if (claim.count === 0) {
        return;
    }

    try {
        // ========================================
        // VENDURE -> STRAPI
        // ========================================

        if (log.source === 'vendure') {
            const productId = await getRetryProductId(log);

            await syncVendureProductToStrapi(productId);
        }

        // ========================================
        // STRAPI -> VENDURE
        // ========================================

        else if (log.source === 'strapi') {
            if (
                !log.entityId ||
                log.entityId === 'unknown'
            ) {
                throw new Error(
                    'Strapi documentId is missing.',
                );
            }

            // Category events
            if (
                log.entityType === 'category' ||
                log.entityType === 'api::category.category'
            ) {
                if (log.eventType === 'entry.delete') {
                    throw new Error(
                        'Category delete is not supported.',
                    );
                }

                await syncStrapiCategoryToVendure(
                    log.entityId,
                );
            }

            // Product events
            else if (
                log.entityType === 'product' ||
                log.entityType === 'api::product.product'
            ) {
                // Deleted Strapi Product:
                // Retry the archive operation using saved mapping.
                if (log.eventType === 'entry.delete') {
                    await archiveDeletedStrapiProduct(
                        log.entityId,
                    );
                }

                // Normal Product synchronization
                else {
                    await syncStrapiProductToVendure(
                        log.entityId,
                    );
                }
            }

            else {
                throw new Error(
                    `Unsupported Strapi entity type: ${log.entityType}`,
                );
            }
        }

        else {
            throw new Error(
                `Unsupported webhook source: ${log.source}`,
            );
        }

        // ========================================
        // MARK RETRY SUCCESSFUL
        // ========================================

        await prisma.syncLog.update({
            where: {
                id: log.id,
            },
            data: {
                status: 'processed',
                errorMessage: null,
                processedAt: new Date(),
                nextRetryAt: null,
            },
        });

        console.log(
            `Webhook retry successful: ${log.eventId}`,
        );

    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : 'Unknown retry error';

        const failedAt = new Date();

        const exhausted = attemptNumber >= MAX_ATTEMPTS;

        const retryDelay =
            RETRY_DELAYS_MS[
                Math.min(
                    attemptNumber - 1,
                    RETRY_DELAYS_MS.length - 1,
                )
            ];

        await prisma.syncLog.update({
            where: {
                id: log.id,
            },
            data: {
                status: exhausted
                    ? 'retry_exhausted'
                    : 'failed',

                errorMessage: message,

                processedAt: failedAt,

                nextRetryAt: exhausted
                    ? null
                    : new Date(
                        failedAt.getTime() + retryDelay,
                    ),
            },
        });

        console.error(
            `Webhook retry failed (${attemptNumber}/${MAX_ATTEMPTS}):`,
            message,
        );

        if (exhausted) {
            console.error(
                `Webhook retry limit reached: ${log.id}`,
            );
        }
    }
}

// ============================================
// PROCESS DUE RETRIES
// ============================================

async function processDueRetries() {
    if (isRunning) {
        return;
    }

    isRunning = true;

    try {
        const now = new Date();

        const failedLogs = await prisma.syncLog.findMany({
            where: {
                status: 'failed',
                attemptCount: {
                    lt: MAX_ATTEMPTS,
                },
                nextRetryAt: {
                    lte: now,
                },
            },

            orderBy: {
                nextRetryAt: 'asc',
            },

            take: 10,
        });

        for (const log of failedLogs) {
            try {
                await executeRetry(log);
            } catch (error) {
                console.error(
                    `Could not process retry log ${log.id}:`,
                    error,
                );
            }
        }

    } catch (error) {
        console.error(
            'Retry Worker processing failed:',
            error,
        );

    } finally {
        isRunning = false;
    }
}

// ============================================
// START RETRY WORKER
// ============================================

export function startRetryWorker() {
    if (workerTimer) {
        return;
    }

    console.log(
        'Webhook Retry Worker started. Checking every 15 seconds.',
    );

    void processDueRetries();

    workerTimer = setInterval(() => {
        void processDueRetries();
    }, POLL_INTERVAL_MS);
}
