import {
    STRAPI_URL,
    STRAPI_API_TOKEN,
} from './config.js';

import type {
    VendureProductVariant,
} from './vendure.js';

// ============================================
// GET STRAPI PRODUCT
// ============================================

export async function getStrapiProduct(
    documentId: string,
) {
    const url = new URL('/api/products', STRAPI_URL);

    url.searchParams.set(
        'filters[documentId][$eq]',
        documentId,
    );

    url.searchParams.set('populate', '*');

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${STRAPI_API_TOKEN}`,
            Accept: 'application/json',
        },
    });

    if (!response.ok) {
        const errorBody = await response.text();

        throw new Error(
            `Strapi API error (${response.status}): ${errorBody}`,
        );
    }

    const result = await response.json() as {
        data: Record<string, unknown>[];
    };

    return result.data[0] ?? null;
}

// ============================================
// UPDATE STRAPI PRODUCT COMMERCE
// Saves Variant Snapshot and Sync Metadata
// ============================================

export async function updateStrapiProductCommerce(
    commerceDocumentId: string,
    variantsSnapshot: VendureProductVariant[],
    syncMetadata?: {
        lastSyncedAt?: string;
        syncStatus?: 'pending' | 'synced' | 'failed' | 'conflict' | 'archived';
        commerceEnabled?: boolean;
    },
) {
    const url = new URL(
        `/api/product-commerces/${commerceDocumentId}`,
        STRAPI_URL,
    );

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${STRAPI_API_TOKEN}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({
            data: {
                variantsSnapshot,
                ...(syncMetadata ?? {}),
            },
        }),
    });

    if (!response.ok) {
        const errorBody = await response.text();

        throw new Error(
            `Strapi update error (${response.status}): ${errorBody}`,
        );
    }

    const result = await response.json() as {
        data: Record<string, unknown>;
    };

    return result.data;
}

// ============================================
// GET STRAPI PRODUCT COMMERCE BY VENDURE ID
// ============================================

export async function getStrapiProductCommerceByVendureId(
    vendureProductId: string,
) {
    const url = new URL(
        '/api/product-commerces',
        STRAPI_URL,
    );

    url.searchParams.set(
        'filters[vendureProductId][$eq]',
        vendureProductId,
    );

    url.searchParams.set('populate', 'product');

    url.searchParams.set('status', 'draft');

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${STRAPI_API_TOKEN}`,
            Accept: 'application/json',
        },
    });

    if (!response.ok) {
        const errorBody = await response.text();

        throw new Error(
            `Strapi Commerce API error (${response.status}): ${errorBody}`,
        );
    }

    const result = await response.json() as {
        data: {
            id: number;
            documentId: string;
            vendureProductId: string;
            product: {
                documentId: string;
                name: string;
            } | null;
        }[];
    };

    return result.data[0] ?? null;
}

// ============================================
// UPDATE STRAPI PRODUCT
// Supports Product Content and Lifecycle
// ============================================

export async function updateStrapiProduct(
    documentId: string,
    productData: {
        name: string;
        slug: string;
        description: string;
        lifecycleStatus?: 'active' | 'archived';
    },
) {
    const url = new URL(
        `/api/products/${documentId}`,
        STRAPI_URL,
    );

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${STRAPI_API_TOKEN}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({
            data: {
                name: productData.name,
                slug: productData.slug,
                description: productData.description,

                // Update lifecycle only when supplied
                ...(productData.lifecycleStatus
                    ? {
                        lifecycleStatus:
                            productData.lifecycleStatus,
                    }
                    : {}),
            },
        }),
    });

    if (!response.ok) {
        const errorBody = await response.text();

        throw new Error(
            `Strapi product update error (${response.status}): ${errorBody}`,
        );
    }

    const result = await response.json() as {
        data: Record<string, unknown>;
    };

    return result.data;
}