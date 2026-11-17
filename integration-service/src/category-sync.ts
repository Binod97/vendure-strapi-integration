import {
    STRAPI_URL,
    STRAPI_API_TOKEN,
    VENDURE_URL,
} from './config.js';

import { prisma } from './db.js';

import {
    getVendureAdminToken,
} from './vendure.js';

// ============================================
// STRAPI CATEGORY INTERFACE
// ============================================

interface StrapiCategory {
    documentId: string;
    name: string;
    slug: string;
    description?: string | null;
    products?: {
        documentId: string;
    }[] | null;
}

// ============================================
// VENDURE COLLECTION INTERFACE
// ============================================

interface VendureCollection {
    id: string;
    name: string;
    slug: string;
}

interface GraphQLResponse<T> {
    data?: T;
    errors?: {
        message: string;
    }[];
}

// ============================================
// VENDURE ADMIN GRAPHQL HELPER
// ============================================

async function vendureAdminRequest<T>(
    endpoint: URL,
    token: string,
    query: string,
    variables?: Record<string, unknown>,
): Promise<T> {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            query,
            variables,
        }),
    });

    if (!response.ok) {
        throw new Error(
            `Vendure Admin API error: ${response.status}`,
        );
    }

    const result =
        await response.json() as GraphQLResponse<T>;

    if (result.errors?.length) {
        throw new Error(result.errors[0].message);
    }

    if (!result.data) {
        throw new Error(
            'Vendure did not return GraphQL data.',
        );
    }

    return result.data;
}

// ============================================
// FETCH STRAPI CATEGORY
// ============================================

async function getStrapiCategory(
    documentId: string,
): Promise<StrapiCategory | null> {
    const url = new URL('/api/categories', STRAPI_URL);

    url.searchParams.set(
        'filters[documentId][$eq]',
        documentId,
    );

    url.searchParams.set('populate', 'products');

    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${STRAPI_API_TOKEN}`,
            Accept: 'application/json',
        },
    });

    if (!response.ok) {
        const errorBody = await response.text();

        throw new Error(
            `Strapi Category API error (${response.status}): ${errorBody}`,
        );
    }

    const result = await response.json() as {
        data: StrapiCategory[];
    };

    return result.data[0] ?? null;
}

// ============================================
// BUILD PRODUCT ID COLLECTION FILTER
// Vendure uses product-id-filter for manually
// selected products in a Collection.
// ============================================

function buildProductIdFilter(productIds: string[]) {
    return {
        code: 'product-id-filter',
        arguments: [
            {
                name: 'productIds',
                value: JSON.stringify(productIds),
            },
            {
                name: 'combineWithAnd',
                value: 'true',
            },
        ],
    };
}

// ============================================
// SYNC STRAPI CATEGORY -> VENDURE COLLECTION
// ============================================

export async function syncStrapiCategoryToVendure(
    documentId: string,
) {
    // 1. Fetch Category from Strapi
    const category = await getStrapiCategory(documentId);

    if (!category) {
        throw new Error('Strapi Category not found.');
    }

    if (!category.name || !category.slug) {
        throw new Error(
            'Strapi Category name or slug is missing.',
        );
    }

    // 2. Get Product document IDs from Category
    const strapiProductIds =
        (category.products ?? [])
            .map(product => product.documentId)
            .filter(Boolean);

    // 3. Find matching Vendure Product IDs
    const productMappings =
        strapiProductIds.length > 0
            ? await prisma.productMapping.findMany({
                where: {
                    strapiDocumentId: {
                        in: strapiProductIds,
                    },
                },
                select: {
                    vendureProductId: true,
                },
            })
            : [];

    const vendureProductIds = [
        ...new Set(
            productMappings.map(
                mapping => mapping.vendureProductId,
            ),
        ),
    ];

    // 4. Authenticate with Vendure Admin API
    const endpoint = new URL('/admin-api', VENDURE_URL);

    const token = await getVendureAdminToken(endpoint);

    // 5. Find existing Category Mapping
    const categoryMapping =
        await prisma.categoryMapping.findUnique({
            where: {
                strapiDocumentId: documentId,
            },
        });

    // 6. Check whether mapped Collection still exists
    let collection: VendureCollection | null = null;

    if (categoryMapping) {
        const result = await vendureAdminRequest<{
            collection: VendureCollection | null;
        }>(
            endpoint,
            token,
            `
                query GetCollectionById($id: ID!) {
                    collection(id: $id) {
                        id
                        name
                        slug
                    }
                }
            `,
            {
                id: categoryMapping.vendureCollectionId,
            },
        );

        collection = result.collection;
    }

    // 7. If no mapping exists, search using Category slug
    if (!collection) {
        const result = await vendureAdminRequest<{
            collection: VendureCollection | null;
        }>(
            endpoint,
            token,
            `
                query GetCollectionBySlug($slug: String!) {
                    collection(slug: $slug) {
                        id
                        name
                        slug
                    }
                }
            `,
            {
                slug: category.slug,
            },
        );

        collection = result.collection;
    }

    // 8. Collection translations
    const translations = [
        {
            languageCode: 'en',
            name: category.name,
            slug: category.slug,
            description: category.description ?? '',
        },
    ];

    // 9. Collection product filter
    const filters = [
        buildProductIdFilter(vendureProductIds),
    ];

    let vendureCollectionId: string;

    // 10. Update existing Collection
    if (collection) {
        const result = await vendureAdminRequest<{
            updateCollection: VendureCollection;
        }>(
            endpoint,
            token,
            `
                mutation UpdateCollection(
                    $input: UpdateCollectionInput!
                ) {
                    updateCollection(input: $input) {
                        id
                        name
                        slug
                    }
                }
            `,
            {
                input: {
                    id: collection.id,
                    translations,
                    filters,
                    inheritFilters: false,
                },
            },
        );

        vendureCollectionId =
            result.updateCollection.id;
    }

    // 11. Create new Collection
    else {
        const result = await vendureAdminRequest<{
            createCollection: VendureCollection;
        }>(
            endpoint,
            token,
            `
                mutation CreateCollection(
                    $input: CreateCollectionInput!
                ) {
                    createCollection(input: $input) {
                        id
                        name
                        slug
                    }
                }
            `,
            {
                input: {
                    translations,
                    filters,
                    inheritFilters: false,
                    isPrivate: false,
                },
            },
        );

        vendureCollectionId =
            result.createCollection.id;
    }

    // 12. Save Category Mapping in SQLite
    await prisma.categoryMapping.upsert({
        where: {
            strapiDocumentId: documentId,
        },
        create: {
            strapiDocumentId: documentId,
            vendureCollectionId,
        },
        update: {
            vendureCollectionId,
        },
    });

    // 13. Return Sync Result
    return {
        status: 'synced',
        source: 'strapi',
        categoryName: category.name,
        strapiDocumentId: documentId,
        vendureCollectionId,
        mappedProductCount: vendureProductIds.length,
        unmappedProductCount:
            strapiProductIds.length - vendureProductIds.length,
    };
}