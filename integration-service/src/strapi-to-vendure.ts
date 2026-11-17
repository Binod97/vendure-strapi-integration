import { VENDURE_URL } from './config.js';

import { getStrapiProduct } from './strapi.js';

import { prisma } from './db.js';

import {
    getVendureAdminToken,
} from './vendure.js';

import {
    syncStrapiProductImagesToVendure,
    type StrapiMediaFile,
} from './image-sync.js';

// ============================================
// STRAPI PRODUCT INTERFACE
// ============================================

interface StrapiProduct {
    documentId: string;
    name: string;
    slug: string;
    description?: string | null;

    featuredImage?: StrapiMediaFile | null;

    gallery?: StrapiMediaFile[] | null;

    seo?: {
        metaTitle?: string | null;
        metaDescription?: string | null;
        canonicalUrl?: string | null;
    } | null;

    specs?: {
        key: string;
        value: string;
    }[] | null;

    lifecycleStatus?: 'active' | 'archived' | null;

    productCommerce?: {
        vendureProductId: string;
    } | null;
}

// ============================================
// VENDURE PRODUCT UPDATE RESPONSE
// ============================================

interface VendureUpdateResponse {
    data?: {
        updateProduct?: {
            id?: string;
            name?: string;
            slug?: string;

            errorCode?: string;
            message?: string;

            featuredAsset?: {
                id: string;
                name: string;
            } | null;

            assets?: {
                id: string;
                name: string;
            }[];
        };
    };

    errors?: {
        message: string;
    }[];
}

// ============================================
// VENDURE PRODUCT ARCHIVE RESPONSE
// ============================================

interface VendureArchiveResponse {
    data?: {
        updateProduct?: {
            id?: string;
            enabled?: boolean;
            errorCode?: string;
            message?: string;
        };
    };

    errors?: {
        message: string;
    }[];
}

// ============================================
// STRAPI -> VENDURE PRODUCT SYNC
// ============================================

export async function syncStrapiProductToVendure(
    documentId: string,
) {
    // ========================================
    // 1. FETCH PRODUCT FROM STRAPI
    // ========================================

    const rawProduct = await getStrapiProduct(documentId);

    if (!rawProduct) {
        throw new Error('Strapi product not found.');
    }

    const product =
        rawProduct as unknown as StrapiProduct;

    // ========================================
    // 2. FIND VENDURE PRODUCT MAPPING
    // ========================================

    const vendureProductId =
        product.productCommerce?.vendureProductId;

    if (!vendureProductId) {
        throw new Error(
            'Vendure Product ID mapping not found.',
        );
    }

    // ========================================
    // 3. AUTHENTICATE WITH VENDURE
    // ========================================

    const endpoint = new URL(
        '/admin-api',
        VENDURE_URL,
    );

    const token = await getVendureAdminToken(endpoint);

    // ========================================
    // 4. SYNC STRAPI IMAGES TO VENDURE
    // Reuse the same authentication token
    // ========================================

    const imageSyncResult =
        await syncStrapiProductImagesToVendure(
            token,
            product.featuredImage ?? null,
            product.gallery ?? [],
        );

    // ========================================
    // 5. PREPARE PRODUCT UPDATE INPUT
    // ========================================

    const productInput: Record<string, unknown> = {
        id: vendureProductId,

        // Product content
        translations: [
            {
                languageCode: 'en',
                name: product.name,
                slug: product.slug,
                description: product.description ?? '',
            },
        ],

        // SEO and specifications
        customFields: {
            strapiDocumentId: product.documentId,

            seoTitle:
                product.seo?.metaTitle ?? null,

            seoDescription:
                product.seo?.metaDescription ?? null,

            canonicalUrl:
                product.seo?.canonicalUrl ?? null,

            specificationsJson: JSON.stringify(
                product.specs ?? [],
            ),
        },

        // Featured Image
        featuredAssetId:
            imageSyncResult.featuredAssetId,

        // Product Gallery
        assetIds:
            imageSyncResult.assetIds,
    };

    // ========================================
    // 6. PRODUCT LIFECYCLE OWNERSHIP
    // Vendure owns enabled/disabled status.
    // Do not modify productInput.enabled.
    // ========================================

    // Strapi lifecycleStatus is intentionally
    // not used to change Vendure enabled state.
    // Vendure -> Strapi handles lifecycle sync.

    // ========================================
    // 7. UPDATE PRODUCT IN VENDURE
    // ========================================

    const updateResponse = await fetch(endpoint, {
        method: 'POST',

        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },

        body: JSON.stringify({
            query: `
                mutation UpdateProduct(
                    $input: UpdateProductInput!
                ) {
                    updateProduct(input: $input) {
                        id
                        name
                        slug

                        featuredAsset {
                            id
                            name
                        }

                        assets {
                            id
                            name
                        }
                    }
                }
            `,

            variables: {
                input: productInput,
            },
        }),
    });

    // ========================================
    // 8. CHECK UPDATE RESPONSE
    // ========================================

    if (!updateResponse.ok) {
        const errorBody = await updateResponse.text();

        throw new Error(
            `Vendure Product update failed (${updateResponse.status}): ${errorBody}`,
        );
    }

    const updateBody =
        await updateResponse.json() as VendureUpdateResponse;

    if (updateBody.errors?.length) {
        throw new Error(
            updateBody.errors[0].message,
        );
    }

    const result = updateBody.data?.updateProduct;

    if (!result || result.errorCode) {
        throw new Error(
            result?.message ??
            'Vendure Product update returned no result.',
        );
    }

    // ========================================
    // 9. RETURN SYNC RESULT
    // ========================================

    return {
        status: 'synced',
        source: 'strapi',

        vendureProductId,
        strapiDocumentId: product.documentId,

        productName: result.name,
        productSlug: result.slug,

        lifecycleStatus: product.lifecycleStatus ?? 'unchanged',

        featuredAssetId:
            imageSyncResult.featuredAssetId,

        galleryAssetIds:
            imageSyncResult.assetIds,

        imagesUploaded:
            imageSyncResult.uploadedCount,
    };
}

// ============================================
// ARCHIVE VENDURE PRODUCT AFTER STRAPI DELETE
// Does NOT permanently delete Vendure Product
// ============================================

export async function archiveDeletedStrapiProduct(
    documentId: string,
) {
    // ========================================
    // 1. FIND EXISTING PRODUCT MAPPING
    // ========================================

    const mapping = await prisma.productMapping.findUnique({
        where: {
            strapiDocumentId: documentId,
        },

        select: {
            vendureProductId: true,
        },
    });

    if (!mapping) {
        return {
            status: 'skipped',
            reason: 'Vendure Product mapping not found.',
            strapiDocumentId: documentId,
        };
    }

    // ========================================
    // 2. AUTHENTICATE WITH VENDURE
    // ========================================

    const endpoint = new URL(
        '/admin-api',
        VENDURE_URL,
    );

    const token = await getVendureAdminToken(endpoint);

    // ========================================
    // 3. DISABLE VENDURE PRODUCT
    // Instead of permanently deleting it
    // ========================================

    const response = await fetch(endpoint, {
        method: 'POST',

        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },

        body: JSON.stringify({
            query: `
                mutation ArchiveDeletedProduct(
                    $input: UpdateProductInput!
                ) {
                    updateProduct(input: $input) {
                        id
                        enabled
                    }
                }
            `,

            variables: {
                input: {
                    id: mapping.vendureProductId,
                    enabled: false,
                },
            },
        }),
    });

    // ========================================
    // 4. CHECK HTTP RESPONSE
    // ========================================

    if (!response.ok) {
        const errorBody = await response.text();

        throw new Error(
            `Vendure archive failed (${response.status}): ${errorBody}`,
        );
    }

    // ========================================
    // 5. CHECK GRAPHQL RESPONSE
    // ========================================

    const result =
        await response.json() as VendureArchiveResponse;

    if (result.errors?.length) {
        throw new Error(
            result.errors[0].message,
        );
    }

    const archivedProduct =
        result.data?.updateProduct;

    if (!archivedProduct || archivedProduct.errorCode) {
        throw new Error(
            archivedProduct?.message ??
            'Vendure Product archive failed.',
        );
    }

    if (archivedProduct.enabled !== false) {
        throw new Error(
            'Vendure Product was not disabled successfully.',
        );
    }

    // ========================================
    // 6. RETURN ARCHIVE RESULT
    // ProductMapping is intentionally preserved
    // ========================================

    return {
        status: 'archived',
        source: 'strapi',

        strapiDocumentId: documentId,
        vendureProductId: archivedProduct.id,

        enabled: archivedProduct.enabled,
    };
}