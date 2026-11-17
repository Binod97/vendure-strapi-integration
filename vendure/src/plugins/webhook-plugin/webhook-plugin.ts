import { OnModuleInit } from '@nestjs/common';

import {
    EventBus,
    Logger,
    ProductEvent,
    ProductVariantEvent,
    ProductVariantPriceEvent,
    ProductVariantService,
    StockMovementEvent,
    PluginCommonModule,
    VendurePlugin,
} from '@vendure/core';

import {
    sendProductWebhook,
    sendWebhook,
} from './webhook-sender';

@VendurePlugin({
    imports: [PluginCommonModule],
    compatibility: '^3.8.1',
})
export class WebhookPlugin implements OnModuleInit {
    constructor(
        private eventBus: EventBus,
        private productVariantService: ProductVariantService,
    ) {}

    onModuleInit() {
        // ========================================
        // PRODUCT EVENTS
        // ========================================

        this.eventBus.ofType(ProductEvent).subscribe(event => {
            const productName =
                event.product.translations?.[0]?.name ?? 'Unknown product';

            Logger.info(
                `Product ${event.type}: ${productName} (ID: ${event.product.id})`,
                'WebhookPlugin',
            );

            void sendProductWebhook({
                eventType: event.type,
                productId: event.product.id,
                productName,
                occurredAt: new Date().toISOString(),
            });
        });

        // ========================================
        // PRODUCT VARIANT EVENTS
        // ========================================

        this.eventBus.ofType(ProductVariantEvent).subscribe(event => {
            for (const variant of event.entity) {
                const variantName =
                    variant.translations?.[0]?.name ?? 'Unknown variant';

                Logger.info(
                    `Product Variant ${event.type}: ${variantName} (ID: ${variant.id})`,
                    'WebhookPlugin',
                );

                void sendWebhook({
                    eventType: `product-variant.${event.type}`,
                    entityType: 'product-variant',
                    entityId: variant.id,
                    occurredAt: new Date().toISOString(),
                    data: {
                        sku: variant.sku,
                        name: variantName,
                        productId: variant.productId,
                    },
                });
            }
        });

        // ========================================
        // PRODUCT VARIANT PRICE EVENTS
        // ========================================

        this.eventBus.ofType(ProductVariantPriceEvent).subscribe(event => {
            for (const variantPrice of event.entity) {
                Logger.info(
                    `Product Variant Price ${event.type}: ${variantPrice.price} ${variantPrice.currencyCode} (ID: ${variantPrice.id})`,
                    'WebhookPlugin',
                );

                void sendWebhook({
                    eventType: `product-variant-price.${event.type}`,
                    entityType: 'product-variant-price',
                    entityId: variantPrice.id,
                    occurredAt: new Date().toISOString(),
                    data: {
                        price: variantPrice.price,
                        currencyCode: variantPrice.currencyCode,
                        channelId: variantPrice.channelId,
                        variantId: variantPrice.variant?.id ?? null,
                    },
                });
            }
        });

        // ========================================
        // STOCK MOVEMENT EVENTS
        // ========================================

        this.eventBus.ofType(StockMovementEvent).subscribe(event => {
            // Group movements by Variant ID.
            // One webhook per Variant avoids unnecessary repeated syncs.
            const movementsByVariant = new Map<
                string,
                typeof event.stockMovements
            >();

            for (const movement of event.stockMovements) {
                const variantId = movement.productVariant?.id;

                if (!variantId) {
                    Logger.warn(
                        'Stock movement has no Product Variant ID.',
                        'WebhookPlugin',
                    );
                    continue;
                }

                const key = String(variantId);

                const existing =
                    movementsByVariant.get(key) ?? [];

                existing.push(movement);

                movementsByVariant.set(key, existing);
            }

            for (const [variantId, movements] of movementsByVariant) {
                void this.sendStockMovementWebhook(
                    event,
                    variantId,
                    movements,
                ).catch(error => {
                    Logger.error(
                        `Stock webhook failed for Variant ${variantId}: ${
                            error instanceof Error
                                ? error.message
                                : String(error)
                        }`,
                        'WebhookPlugin',
                    );
                });
            }
        });
    }

    // ========================================
    // SEND STOCK MOVEMENT WEBHOOK
    // ========================================

    private async sendStockMovementWebhook(
        event: StockMovementEvent,
        variantId: string,
        movements: typeof event.stockMovements,
    ) {
        // Find Variant and its parent Product
        const variant = await this.productVariantService.findOne(
            event.ctx,
            variantId,
            ['product'],
        );

        if (!variant) {
            throw new Error(
                `Product Variant ${variantId} not found.`,
            );
        }

        const productId =
            variant.productId ?? variant.product?.id;

        if (!productId) {
            throw new Error(
                `Parent Product not found for Variant ${variantId}.`,
            );
        }

        const stockMovementDetails = movements.map(movement => ({
            type: movement.type,
            quantity: movement.quantity,
            stockLocationId: movement.stockLocationId,
        }));

        // Send stock update to Integration Service
        await sendWebhook({
            eventType: 'product-variant.stock-updated',
            entityType: 'product-variant',
            entityId: variantId,
            occurredAt: new Date().toISOString(),
            data: {
                productId: String(productId),
                variantId,
                stockMovementType: event.type,
                movements: stockMovementDetails,
            },
        });

        Logger.info(
            `Stock webhook sent for Variant ${variantId}, Product ${productId}`,
            'WebhookPlugin',
        );
    }
}