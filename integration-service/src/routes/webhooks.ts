
import { Router } from 'express';
import { createHash } from 'node:crypto';

import { prisma } from '../db.js';

import {
    verifyVendureWebhook,
    verifyStrapiWebhook,
} from '../middleware.js';

import {
    syncVendureProductToStrapi,
} from '../product-sync.js';

import {
    syncStrapiCategoryToVendure,
} from '../category-sync.js';

import {
    syncStrapiProductToVendure,
    archiveDeletedStrapiProduct,
} from '../strapi-to-vendure.js';

import {
    getVendureProductIdByVariantId,
} from '../vendure.js';

const router = Router();

// ============================================
// WEBHOOK EVENT ID GENERATOR
// Generates a stable ID for duplicate protection
// ============================================

function createWebhookEventId(
    source: string,
    payload: Record<string, unknown>,
    rawBody?: string,
): string {
    const providerEventId = payload.eventId;

    // Use provider event ID when available
    if (
        providerEventId !== undefined &&
        providerEventId !== null &&
        String(providerEventId).trim() !== ''
    ) {
        return `${source}:${String(providerEventId)}`;
    }

    // Otherwise generate a stable ID from the request body
    const body = rawBody ?? JSON.stringify(payload) ?? '';

    const hash = createHash('sha256')
        .update(`${source}:${body}`)
        .digest('hex');

    return `${source}:${hash}`;
}

// ============================================
// SAVE WEBHOOK LOG
// Prevents duplicate webhook events
// ============================================

async function saveWebhookLog(data: {
    eventId: string;
    source: string;
    eventType: string;
    entityType: string;
    entityId: string;
    payload: string;
}) {
    const existing = await prisma.syncLog.findUnique({
        where: {
            eventId: data.eventId,
        },
    });

    if (existing) {
        return {
            log: existing,
            duplicate: true,
        };
    }

    try {
        const log = await prisma.syncLog.create({
            data,
        });

        return {
            log,
            duplicate: false,
        };
    } catch (error) {
        // Handle simultaneous duplicate requests
        if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'P2002'
        ) {
            const duplicateLog = await prisma.syncLog.findUnique({
                where: {
                    eventId: data.eventId,
                },
            });

            if (duplicateLog) {
                return {
                    log: duplicateLog,
                    duplicate: true,
                };
            }
        }

        throw error;
    }
}

// ============================================
// MARK WEBHOOK AS IGNORED
// ============================================

async function markWebhookIgnored(
    logId: string,
    message: string,
) {
    await prisma.syncLog.update({
        where: {
            id: logId,
        },
        data: {
            status: 'ignored',
            errorMessage: message,
            processedAt: new Date(),
            nextRetryAt: null,
        },
    });
}

// ============================================
// MARK WEBHOOK AS FAILED
// Schedules retry after 1 minute
// ============================================

async function markWebhookFailed(
    logId: string,
    message: string,
) {
    const failedAt = new Date();

    const nextRetryAt = new Date(
        failedAt.getTime() + 60 * 1000,
    );

    await prisma.syncLog.update({
        where: {
            id: logId,
        },
        data: {
            status: 'failed',
            errorMessage: message,
            processedAt: failedAt,
            lastAttemptAt: failedAt,
            nextRetryAt,
        },
    });

    return nextRetryAt;
}

// ============================================
// VENDURE WEBHOOK
// Receives Vendure events and syncs mapped products
// ============================================

router.post(
    '/vendure',
    verifyVendureWebhook,
    async (req, res) => {
        let logId: string | undefined;

        try {
            const payload = req.body ?? {};

            const eventType = String(
                payload.eventType ?? 'unknown',
            );

            const entityType = String(
                payload.entityType ?? 'unknown',
            );

            const entityId = String(
                payload.entityId ?? 'unknown',
            );

            // 1. Save incoming webhook
            const saved = await saveWebhookLog({
                eventId: createWebhookEventId(
                    'vendure',
                    payload,
                    req.rawBody,
                ),
                source: 'vendure',
                eventType,
                entityType,
                entityId,
                payload:
                    req.rawBody ??
                    JSON.stringify(payload) ??
                    '{}',
            });

            const log = saved.log;
            logId = log.id;

            // 2. Ignore duplicate events
            if (saved.duplicate) {
                return res.status(200).json({
                    status: 'duplicate',
                    source: 'vendure',
                    eventId: log.eventId,
                });
            }

            // 3. Supported events
            const supportedEvent =
                (
                    entityType === 'product' &&
                    [
                        'product.created',
                        'product.updated',
                    ].includes(eventType)
                ) ||
                (
                    entityType === 'product-variant' &&
                    [
                        'product-variant.created',
                        'product-variant.updated',
                        'product-variant.deleted',
                        'product-variant.stock-updated',
                    ].includes(eventType)
                ) ||
                (
                    entityType === 'product-variant-price' &&
                    [
                        'product-variant-price.created',
                        'product-variant-price.updated',
                        'product-variant-price.deleted',
                    ].includes(eventType)
                );

            // 4. Ignore unsupported events
            if (!supportedEvent) {
                await markWebhookIgnored(
                    log.id,
                    'Event is not handled by the current sync flow.',
                );

                return res.status(200).json({
                    status: 'ignored',
                    source: 'vendure',
                    eventType,
                    entityType,
                });
            }

            // 5. Mark as processing and increment attempts
            const attemptAt = new Date();

            await prisma.syncLog.update({
                where: {
                    id: log.id,
                },
                data: {
                    status: 'processing',
                    attemptCount: {
                        increment: 1,
                    },
                    lastAttemptAt: attemptAt,
                    nextRetryAt: null,
                },
            });

            // 6. Identify related Product ID
            let productId: string | null = null;

            // Product event
            if (entityType === 'product') {
                productId = entityId;
            }

            // Product Variant event
            if (
                entityType === 'product-variant' &&
                payload.data?.productId != null
            ) {
                productId = String(
                    payload.data.productId,
                );
            }

            // Product Variant Price event
            // Price ID is not Product ID.
            // Find parent Product using Variant ID.
            if (
                entityType === 'product-variant-price'
            ) {
                const variantId = payload.data?.variantId;

                if (
                    variantId === undefined ||
                    variantId === null
                ) {
                    throw new Error(
                        'Variant ID missing from Product Variant Price webhook.',
                    );
                }

                productId =
                    await getVendureProductIdByVariantId(
                        String(variantId),
                    );
            }

            if (!productId) {
                await markWebhookIgnored(
                    log.id,
                    'Related Vendure Product could not be identified.',
                );

                return res.status(200).json({
                    status: 'ignored',
                    source: 'vendure',
                    reason: 'Related Product not found.',
                });
            }

            // 7. Check Product Mapping
            const mapping = await prisma.productMapping.findUnique({
                where: {
                    vendureProductId: productId,
                },
            });

            if (!mapping) {
                await markWebhookIgnored(
                    log.id,
                    'Product mapping not found.',
                );

                return res.status(200).json({
                    status: 'ignored',
                    reason: 'Product mapping not found.',
                    productId,
                });
            }

            // 8. Sync Vendure -> Strapi
            const syncResult =
                await syncVendureProductToStrapi(productId);

            // 9. Mark successful
            await prisma.syncLog.update({
                where: {
                    id: log.id,
                },
                data: {
                    status: 'processed',
                    processedAt: new Date(),
                    errorMessage: null,
                    nextRetryAt: null,
                },
            });

            return res.status(200).json({
                status: 'synced',
                source: 'vendure',
                eventType,
                result: syncResult,
            });

        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Unknown Vendure synchronization error';

            let nextRetryAt: Date | null = null;

            if (logId) {
                try {
                    nextRetryAt = await markWebhookFailed(
                        logId,
                        message,
                    );
                } catch (logError) {
                    console.error(
                        'Could not update Vendure SyncLog:',
                        logError,
                    );
                }
            }

            console.error(
                'Vendure Product Sync failed:',
                message,
            );

            return res.status(500).json({
                status: 'failed',
                source: 'vendure',
                message,
                nextRetryAt: nextRetryAt?.toISOString() ?? null,
            });
        }
    },
);

// ============================================
// STRAPI WEBHOOK
// Receives Strapi events and syncs to Vendure
// ============================================

router.post(
    '/strapi',
    verifyStrapiWebhook,
    async (req, res) => {
        let logId: string | undefined;

        try {
            const payload = req.body ?? {};
            const entry = payload.entry ?? {};

            // 1. Extract event details
            const eventType = String(
                payload.event ?? payload.eventType ?? 'unknown',
            );

            const entityType = String(
                payload.model ?? payload.entityType ?? 'unknown',
            );

            const documentId = String(
                entry.documentId ??
                payload.documentId ??
                '',
            );

            const entityId = documentId || String(
                entry.id ??
                payload.entityId ??
                'unknown',
            );

            // 2. Save webhook event
            const saved = await saveWebhookLog({
                eventId: createWebhookEventId(
                    'strapi',
                    payload,
                    req.rawBody,
                ),
                source: 'strapi',
                eventType,
                entityType,
                entityId,
                payload:
                    req.rawBody ??
                    JSON.stringify(payload) ??
                    '{}',
            });

            const log = saved.log;
            logId = log.id;

            // 3. Ignore duplicate events
            if (saved.duplicate) {
                return res.status(200).json({
                    status: 'duplicate',
                    source: 'strapi',
                    eventId: log.eventId,
                });
            }

            // 4. Identify Product and Category events
            const isProduct =
                entityType === 'product' ||
                entityType === 'api::product.product';

            const isCategory =
                entityType === 'category' ||
                entityType === 'api::category.category';

            const supportedEntity =
                isProduct || isCategory;

            // Product Delete is handled separately.
            // Category Delete is not supported yet.
            const isProductDelete =
                isProduct && eventType === 'entry.delete';

            // 5. Check supported Strapi events
            const supportedEvent =
                [
                    'entry.create',
                    'entry.update',
                    'entry.publish',
                ].includes(eventType) ||
                isProductDelete;

            if (
                !supportedEntity ||
                !supportedEvent ||
                !documentId
            ) {
                await markWebhookIgnored(
                    log.id,
                    'Unsupported Strapi event or missing documentId.',
                );

                return res.status(200).json({
                    status: 'ignored',
                    source: 'strapi',
                    eventType,
                    entityType,
                });
            }

            // 6. Mark as processing and increment attempts
            const attemptAt = new Date();

            await prisma.syncLog.update({
                where: {
                    id: log.id,
                },
                data: {
                    status: 'processing',
                    attemptCount: {
                        increment: 1,
                    },
                    lastAttemptAt: attemptAt,
                    nextRetryAt: null,
                },
            });

            // 7. Sync Strapi -> Vendure
            let syncResult;

            if (isProductDelete) {
                // Deleted Strapi Product:
                // Archive the mapped Vendure Product.
                syncResult =
                    await archiveDeletedStrapiProduct(documentId);
            } else if (isCategory) {
                syncResult =
                    await syncStrapiCategoryToVendure(documentId);
            } else {
                syncResult =
                    await syncStrapiProductToVendure(documentId);
            }

            // 8. Mark successful
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

            return res.status(200).json({
                status: isProductDelete ? 'archived' : 'synced',
                source: 'strapi',
                eventType,
                result: syncResult,
            });

        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : 'Unknown Strapi synchronization error';

            let nextRetryAt: Date | null = null;

            if (logId) {
                try {
                    nextRetryAt = await markWebhookFailed(
                        logId,
                        message,
                    );
                } catch (logError) {
                    console.error(
                        'Could not update Strapi SyncLog:',
                        logError,
                    );
                }
            }

            console.error(
                'Strapi Product Sync failed:',
                message,
            );

            return res.status(500).json({
                status: 'failed',
                source: 'strapi',
                message,
                nextRetryAt: nextRetryAt?.toISOString() ?? null,
            });
        }
    },
);

export default router;
