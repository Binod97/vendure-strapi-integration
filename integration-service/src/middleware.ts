
import {
    createHmac,
    timingSafeEqual,
} from 'node:crypto';

import type {
    Request,
    Response,
    NextFunction,
} from 'express';

import {
    VENDURE_WEBHOOK_SECRET,
    STRAPI_WEBHOOK_SECRET,
} from './config.js';

declare module 'http' {
    interface IncomingMessage {
        rawBody?: string;
    }
}

export function verifyVendureWebhook(
    req: Request,
    res: Response,
    next: NextFunction,
) {
    const timestamp = req.header('X-Webhook-Timestamp');
    const signature = req.header('X-Webhook-Signature');

    if (!timestamp || !signature || !req.rawBody) {
        return res.status(401).json({
            error: 'Missing webhook signature.',
        });
    }

    const timestampNumber = Number(timestamp);

    if (
        !Number.isSafeInteger(timestampNumber) ||
        Math.abs(Date.now() / 1000 - timestampNumber) > 300
    ) {
        return res.status(401).json({
            error: 'Invalid or expired webhook timestamp.',
        });
    }

    const expectedSignature = createHmac(
        'sha256',
        VENDURE_WEBHOOK_SECRET,
    )
        .update(`${timestamp}.${req.rawBody}`)
        .digest('hex');

    const receivedSignature = signature.replace(/^sha256=/, '');

    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const receivedBuffer = Buffer.from(receivedSignature, 'hex');

    if (
        receivedBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
        return res.status(401).json({
            error: 'Invalid webhook signature.',
        });
    }

    next();
}

export function verifyStrapiWebhook(
    req: Request,
    res: Response,
    next: NextFunction,
) {
    const secret = req.header('x-strapi-webhook-secret');

    const secretParts = secret?.split(', ') ?? [];

    if (
        !secret ||
        secret.length !== STRAPI_WEBHOOK_SECRET.length ||
        !timingSafeEqual(
            Buffer.from(secret),
            Buffer.from(STRAPI_WEBHOOK_SECRET),
        )
    ) {
        console.warn('[strapi-webhook] auth failed', {
            headerPresent: Boolean(secret),
            receivedLength: secret?.length ?? 0,
            expectedLength: STRAPI_WEBHOOK_SECRET.length,
            lengthsMatch: secret?.length === STRAPI_WEBHOOK_SECRET.length,

            splitParts: secretParts.length,

            everyPartMatches:
                secretParts.length > 0 &&
                secretParts.every((part) => {
                    const partBuffer = Buffer.from(part);
                    const expectedBuffer = Buffer.from(STRAPI_WEBHOOK_SECRET);

                    return (
                        partBuffer.length === expectedBuffer.length &&
                        timingSafeEqual(partBuffer, expectedBuffer)
                    );
                }),

            partLengths: secretParts.map((part) => part.length),

            partMatches: secretParts.map((part) => {
                const partBuffer = Buffer.from(part);
                const expectedBuffer = Buffer.from(STRAPI_WEBHOOK_SECRET);

                return (
                    partBuffer.length === expectedBuffer.length &&
                    timingSafeEqual(partBuffer, expectedBuffer)
                );
            }),

            headerNames: Object.keys(req.headers),
            userAgent: req.header('user-agent'),
        });

        return res.status(401).json({
            error: 'Invalid Strapi webhook secret.',
        });
    }

    next();
}
