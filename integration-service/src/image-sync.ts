
import {
    STRAPI_URL,
    STRAPI_API_TOKEN,
    VENDURE_URL,
} from './config.js';

import { prisma } from './db.js';

// ============================================
// STRAPI MEDIA INTERFACE
// ============================================

export interface StrapiMediaFile {
    id?: number | string;
    documentId?: string;
    name?: string;
    url?: string;
    mime?: string;
    mimeType?: string;
    alternativeText?: string | null;
}

// ============================================
// VENDURE ASSET RESPONSE
// ============================================

interface VendureAssetResult {
    id?: string;
    name?: string;
    mimeType?: string;
    message?: string;
    errorCode?: string;
}

interface CreateAssetsResponse {
    data?: {
        createAssets?: VendureAssetResult[];
    };
    errors?: {
        message: string;
    }[];
}

// ============================================
// GET STRAPI FILE DOCUMENT ID
// ============================================

function getStrapiFileDocumentId(
    media: StrapiMediaFile,
): string {
    const documentId =
        media.documentId ?? media.id;

    if (documentId === undefined || documentId === null) {
        throw new Error(
            'Strapi media documentId is missing.',
        );
    }

    return String(documentId);
}

// ============================================
// DOWNLOAD IMAGE FROM STRAPI
// ============================================

async function downloadStrapiImage(
    media: StrapiMediaFile,
): Promise<Blob> {
    if (!media.url) {
        throw new Error(
            'Strapi media URL is missing.',
        );
    }

    const imageUrl = new URL(
        media.url,
        STRAPI_URL,
    );

    const strapiOrigin = new URL(STRAPI_URL).origin;

    // Send API token only to the Strapi origin.
    const headers: Record<string, string> = {};

    if (imageUrl.origin === strapiOrigin) {
        headers.Authorization =
            `Bearer ${STRAPI_API_TOKEN}`;
    }

    const response = await fetch(imageUrl, {
        method: 'GET',
        headers,
    });

    if (!response.ok) {
        throw new Error(
            `Image download failed (${response.status}): ${media.name ?? media.url}`,
        );
    }

    const blob = await response.blob();

    const mimeType =
        media.mime ??
        media.mimeType ??
        blob.type;

    if (!mimeType.startsWith('image/')) {
        throw new Error(
            `Unsupported media type: ${mimeType}`,
        );
    }

    // Prevent unexpectedly large uploads.
    if (blob.size > 20 * 1024 * 1024) {
        throw new Error(
            `Image is larger than 20 MB: ${media.name ?? 'unknown image'}`,
        );
    }

    return new Blob([blob], {
        type: mimeType,
    });
}

// ============================================
// UPLOAD STRAPI IMAGE TO VENDURE
// Uses GraphQL multipart request
// ============================================

async function uploadImageToVendureOnce(
    media: StrapiMediaFile,
    endpoint: URL,
    token: string,
): Promise<string> {
    const strapiFileDocumentId =
        getStrapiFileDocumentId(media);

    // 1. Check existing Media Mapping
    const existingMapping =
        await prisma.mediaMapping.findUnique({
            where: {
                strapiFileDocumentId,
            },
        });

    if (existingMapping) {
        return existingMapping.vendureAssetId;
    }

    // 2. Download image from Strapi
    const imageBlob = await downloadStrapiImage(media);

    const fileName =
        media.name ??
        `strapi-image-${strapiFileDocumentId}`;

    const mimeType =
        media.mime ??
        media.mimeType ??
        imageBlob.type;

    // 3. Prepare GraphQL upload
    const query = `
        mutation CreateAssets(
            $input: [CreateAssetInput!]!
        ) {
            createAssets(input: $input) {
                ... on Asset {
                    id
                    name
                    mimeType
                }

                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `;

    const formData = new FormData();

    const operations = {
        query,
        variables: {
            input: [
                {
                    file: null,
                },
            ],
        },
    };

    formData.set(
        'operations',
        JSON.stringify(operations),
    );

    formData.set(
        'map',
        JSON.stringify({
            '0': [
                'variables.input.0.file',
            ],
        }),
    );

    formData.set(
        '0',
        imageBlob,
        fileName,
    );

    // 4. Upload image to Vendure Admin API
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const errorBody = await response.text();

        throw new Error(
            `Vendure Asset upload failed (${response.status}): ${errorBody}`,
        );
    }

    const result =
        await response.json() as CreateAssetsResponse;

    if (result.errors?.length) {
        throw new Error(
            result.errors[0].message,
        );
    }

    const asset =
        result.data?.createAssets?.[0];

    if (!asset?.id) {
        throw new Error(
            asset?.message ??
            'Vendure Asset was not created.',
        );
    }

    // 5. Save Media Mapping
    await prisma.mediaMapping.create({
        data: {
            strapiFileDocumentId,
            vendureAssetId: asset.id,
            fileName,
            mimeType,
        },
    });

    return asset.id;
}

// ============================================
// PREVENT CONCURRENT DUPLICATE IMAGE UPLOADS
// ============================================

const inFlightMediaUploads =
    new Map<string, Promise<string>>();

async function uploadImageToVendure(
    media: StrapiMediaFile,
    endpoint: URL,
    token: string,
): Promise<string> {
    const key = getStrapiFileDocumentId(media);

    // Reuse an upload already in progress.
    const existingUpload =
        inFlightMediaUploads.get(key);

    if (existingUpload) {
        return existingUpload;
    }

    // Start only one upload for this media document.
    const uploadPromise = uploadImageToVendureOnce(
        media,
        endpoint,
        token,
    ).finally(() => {
        inFlightMediaUploads.delete(key);
    });

    inFlightMediaUploads.set(
        key,
        uploadPromise,
    );

    return uploadPromise;
}

// ============================================
// SYNC PRODUCT IMAGES
// Strapi -> Vendure
// Reuses the existing Vendure Admin token
// ============================================

export async function syncStrapiProductImagesToVendure(
    token: string,
    featuredImage?: StrapiMediaFile | null,
    gallery?: StrapiMediaFile[] | null,
) {
    const allMedia = [
        ...(featuredImage ? [featuredImage] : []),
        ...(gallery ?? []),
    ];

    // Remove duplicate Strapi media files.
    const uniqueMedia = Array.from(
        new Map(
            allMedia.map(media => [
                getStrapiFileDocumentId(media),
                media,
            ]),
        ).values(),
    );

    if (uniqueMedia.length === 0) {
        return {
            featuredAssetId: null,
            assetIds: [],
            uploadedCount: 0,
        };
    }

    // Reuse the token received from Product sync.
    const endpoint = new URL(
        '/admin-api',
        VENDURE_URL,
    );

    // 1. Upload or reuse existing Assets
    const assetIds: string[] = [];

    for (const media of uniqueMedia) {
        const assetId = await uploadImageToVendure(
            media,
            endpoint,
            token,
        );

        assetIds.push(assetId);
    }

    // 2. Identify Featured Asset
    const featuredAssetId = featuredImage
        ? assetIds[
            uniqueMedia.findIndex(
                media =>
                    getStrapiFileDocumentId(media) ===
                    getStrapiFileDocumentId(featuredImage),
            )
        ]
        : null;

    return {
        featuredAssetId,
        assetIds,
        uploadedCount: assetIds.length,
    };
}
