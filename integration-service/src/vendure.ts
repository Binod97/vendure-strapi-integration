import { VENDURE_URL } from './config.js';

// ============================================
// VENDURE PRODUCT INTERFACES
// ============================================

export interface VendureVariantPrice {
    currencyCode: string;
    price: number;
}

export interface VendureStockLevel {
    stockLocationId: string;
    stockOnHand: number;
    stockAllocated: number;
}

export interface VendureProductVariant {
    id: string;
    name: string;
    sku: string;
    priceWithTax: number;
    currencyCode: string;
    enabled?: boolean;
    prices?: VendureVariantPrice[];
    stockLevels?: VendureStockLevel[];
}

export interface VendureProduct {
    id: string;
    name: string;
    slug: string;
    description: string;
    enabled?: boolean;
    variants: VendureProductVariant[];
}

interface VendureGraphQLResponse {
    data?: {
        products?: {
            items: VendureProduct[];
            totalItems: number;
        };
        product?: VendureProduct | null;
    };
    errors?: {
        message: string;
    }[];
}

interface VendureLoginResponse {
    data?: {
        login?: {
            identifier?: string;
            message?: string;
        };
    };
    errors?: {
        message: string;
    }[];
}

// ============================================
// GET VENDURE PRODUCTS
// Shop API
// ============================================

export async function getVendureProducts(take = 5) {
    const url = new URL('/shop-api', VENDURE_URL);

    const query = `
        query {
            products(options: { take: ${take} }) {
                items {
                    id
                    name
                    slug
                    description
                    variants {
                        id
                        name
                        sku
                        priceWithTax
                        currencyCode
                    }
                }
                totalItems
            }
        }
    `;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
    });

    if (!response.ok) {
        throw new Error(
            `Vendure Shop API error: ${response.status}`,
        );
    }

    const result =
        await response.json() as VendureGraphQLResponse;

    if (result.errors?.length) {
        throw new Error(result.errors[0].message);
    }

    if (!result.data?.products) {
        throw new Error('Vendure products were not returned.');
    }

    return result.data.products;
}

// ============================================
// GET VENDURE ADMIN TOKEN
// ============================================

export async function getVendureAdminToken(
    endpoint: URL,
): Promise<string> {
    const username = process.env.SUPERADMIN_USERNAME;
    const password = process.env.SUPERADMIN_PASSWORD;

    if (!username || !password) {
        throw new Error(
            'Vendure Admin credentials are missing.',
        );
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            query: `
                mutation Login(
                    $username: String!,
                    $password: String!
                ) {
                    login(
                        username: $username,
                        password: $password
                    ) {
                        ... on CurrentUser {
                            identifier
                        }

                        ... on ErrorResult {
                            message
                        }
                    }
                }
            `,
            variables: {
                username,
                password,
            },
        }),
    });

    if (!response.ok) {
        throw new Error(
            `Vendure Admin login failed: ${response.status}`,
        );
    }

    const result =
        await response.json() as VendureLoginResponse;

    if (result.errors?.length) {
        throw new Error(result.errors[0].message);
    }

    if (result.data?.login?.message) {
        throw new Error(result.data.login.message);
    }

    const token = response.headers.get(
        'vendure-auth-token',
    );

    if (!token) {
        throw new Error(
            'Vendure Admin token was not returned.',
        );
    }

    return token;
}

// ============================================
// GET VENDURE PRODUCT BY ID
// Admin API
// Includes disabled products, prices and stock
// ============================================

export async function getVendureProductById(
    productId: string,
): Promise<VendureProduct | null> {
    const url = new URL('/admin-api', VENDURE_URL);

    // 1. Authenticate
    const token = await getVendureAdminToken(url);

    // 2. Fetch complete Product information
    const query = `
        query GetVendureProduct($id: ID!) {
            product(id: $id) {
                id
                name
                slug
                description
                enabled

                variants {
                    id
                    name
                    sku
                    enabled
                    priceWithTax
                    currencyCode

                    prices {
                        currencyCode
                        price
                    }

                    stockLevels {
                        stockLocationId
                        stockOnHand
                        stockAllocated
                    }
                }
            }
        }
    `;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            query,
            variables: {
                id: productId,
            },
        }),
    });

    if (!response.ok) {
        throw new Error(
            `Vendure Admin API error: ${response.status}`,
        );
    }

    const result =
        await response.json() as VendureGraphQLResponse;

    if (result.errors?.length) {
        throw new Error(result.errors[0].message);
    }

    return result.data?.product ?? null;
}
// ============================================
// GET PRODUCT ID FROM VARIANT ID
// Used by Variant Price Webhooks
// ============================================

export async function getVendureProductIdByVariantId(
    variantId: string,
): Promise<string | null> {
    const endpoint = new URL('/admin-api', VENDURE_URL);

    // 1. Authenticate
    const token = await getVendureAdminToken(endpoint);

    // 2. Find parent Product
    const query = `
        query GetVariantParent($id: ID!) {
            productVariant(id: $id) {
                id
                product {
                    id
                }
            }
        }
    `;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            query,
            variables: {
                id: variantId,
            },
        }),
    });

    if (!response.ok) {
        throw new Error(
            `Vendure Variant API error: ${response.status}`,
        );
    }

    const result = await response.json() as {
        data?: {
            productVariant?: {
                id: string;
                product?: {
                    id: string;
                };
            } | null;
        };
        errors?: {
            message: string;
        }[];
    };

    if (result.errors?.length) {
        throw new Error(result.errors[0].message);
    }

    return result.data?.productVariant?.product?.id ?? null;
}