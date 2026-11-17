
import { createHash } from 'node:crypto';

import { prisma } from './db.js';

import {
    getVendureProductById,
} from './vendure.js';

import {
    getStrapiProduct,
    getStrapiProductCommerceByVendureId,
    updateStrapiProductCommerce,
    updateStrapiProduct,
} from './strapi.js';

// ============================================
// HTML TO PLAIN TEXT HELPER
// ============================================

function htmlToPlainText(
    value: string | null | undefined,
): string | null {
    if (value == null) {
        return null;
    }

    return value
        // Remove HTML comments
        .replace(/<!--[\s\S]*?-->/g, ' ')

        // Remove script and style content
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')

        // Preserve line breaks from HTML
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(
            /<\/\s*(p|div|li|h[1-6]|blockquote|pre|tr)\s*>/gi,
            '\n',
        )

        // Remove remaining HTML tags
        .replace(/<[^>]*>/g, ' ')

        // Decode common HTML entities
        .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&apos;|&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')

        // Decode numeric HTML entities
        .replace(/&#(\d+);/g, (_match, code: string) => {
            const number = Number(code);

            return number > 0 &&
                number <= 0x10ffff &&
                !(number >= 0xd800 && number <= 0xdfff)
                ? String.fromCodePoint(number)
                : '';
        })
        .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => {
            const number = parseInt(code, 16);

            return number > 0 &&
                number <= 0x10ffff &&
                !(number >= 0xd800 && number <= 0xdfff)
                ? String.fromCodePoint(number)
                : '';
        })

        // Clean unnecessary spaces and line breaks
        .replace(/[ \t\r\f\v]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// ============================================
// STRAPI PRODUCT CONTENT INTERFACE
// ============================================

interface StrapiProductContent {
    name?: string | null;
    slug?: string | null;
    description?: string | null;
    lifecycleStatus?: 'active' | 'archived' | null;
}

// ============================================
// VENDURE -> STRAPI PRODUCT SYNC
// ============================================

export async function syncVendureProductToStrapi(
    vendureProductId: string,
) {
    // ========================================
    // 1. FIND PRODUCT MAPPING IN SQLITE
    // ========================================

    const mapping = await prisma.productMapping.findUnique({
        where: {
            vendureProductId,
        },
    });

    if (!mapping) {
        throw new Error(
            `Product mapping not found for Vendure ID ${vendureProductId}`,
        );
    }

    // ========================================
    // 2. FETCH PRODUCT FROM VENDURE
    // ========================================

    const vendureProduct = await getVendureProductById(
        vendureProductId,
    );

    if (!vendureProduct) {
        throw new Error('Vendure product not found.');
    }

    // ========================================
    // 3. FIND STRAPI COMMERCE RECORD
    // ========================================

    const commerce =
        await getStrapiProductCommerceByVendureId(
            vendureProductId,
        );

    if (!commerce) {
        throw new Error(
            'Strapi Product Commerce not found.',
        );
    }

    // ========================================
    // 4. VERIFY PRODUCT MAPPING
    // ========================================

    if (!commerce.product) {
        throw new Error(
            'Related Strapi product not found.',
        );
    }

    if (
        commerce.product.documentId !== mapping.strapiDocumentId
    ) {
        throw new Error(
            'Product mapping does not match Strapi Commerce relation.',
        );
    }

    // ========================================
    // 5. CALCULATE PRODUCT CONTENT HASH
    // ========================================

    const contentHash = createHash('sha256')
        .update(JSON.stringify(vendureProduct))
        .digest('hex');

    const syncTime = new Date();

    // ========================================
    // 6. FETCH EXISTING STRAPI PRODUCT
    // ========================================

    const rawStrapiProduct = await getStrapiProduct(
        mapping.strapiDocumentId,
    );

    if (!rawStrapiProduct) {
        throw new Error('Strapi product not found.');
    }

    const strapiProduct =
        rawStrapiProduct as unknown as StrapiProductContent;

    // ========================================
    // 7. CLEAN AND COMPARE PRODUCT CONTENT
    // ========================================

    // Convert Vendure HTML description into plain text
    const vendureDescription =
        htmlToPlainText(vendureProduct.description) ?? '';

    // Keep the original Strapi description for comparison.
    // This detects existing HTML tags in Strapi.
    const strapiDescription =
        strapiProduct.description ?? '';

    const contentChanged =
        strapiProduct.name !== vendureProduct.name ||
        strapiProduct.slug !== vendureProduct.slug ||
        strapiDescription !== vendureDescription;

    // ========================================
    // 8. DETERMINE PRODUCT LIFECYCLE
    // Vendure -> Strapi
    // ========================================

    const lifecycleStatus =
        typeof vendureProduct.enabled === 'boolean'
            ? vendureProduct.enabled
                ? 'active'
                : 'archived'
            : undefined;

    const lifecycleChanged =
        lifecycleStatus !== undefined &&
        strapiProduct.lifecycleStatus !== lifecycleStatus;

    // ========================================
    // 9. UPDATE STRAPI PRODUCT WHEN NEEDED
    // ========================================

    if (contentChanged || lifecycleChanged) {
        await updateStrapiProduct(
            mapping.strapiDocumentId,
            {
                name: vendureProduct.name,
                slug: vendureProduct.slug,
                description: vendureDescription,

                ...(lifecycleStatus
                    ? {
                        lifecycleStatus,
                    }
                    : {}),
            },
        );
    }

    // ========================================
    // 10. UPDATE STRAPI VARIANTS AND COMMERCE
    // ========================================

    await updateStrapiProductCommerce(
        commerce.documentId,
        vendureProduct.variants,
        {
            lastSyncedAt: syncTime.toISOString(),
            syncStatus: 'synced',
            commerceEnabled: vendureProduct.enabled ?? false,
        },
    );

    // ========================================
    // 11. SAVE SYNC INFORMATION IN SQLITE
    // ========================================

    await prisma.productMapping.update({
        where: {
            id: mapping.id,
        },
        data: {
            contentHash,
            lastSyncedAt: syncTime,
        },
    });

    // ========================================
    // 12. RETURN SYNC RESULT
    // ========================================

    return {
        status: 'synced',
        source: 'vendure',

        contentUpdated: contentChanged,
        lifecycleUpdated: lifecycleChanged,

        lifecycleStatus:
            lifecycleStatus ??
            strapiProduct.lifecycleStatus ??
            null,

        productName: vendureProduct.name,
        vendureProductId,
        strapiDocumentId: mapping.strapiDocumentId,

        variantsCount: vendureProduct.variants.length,

        lastSyncedAt: syncTime.toISOString(),
    };
}
