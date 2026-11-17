const http = require('node:http');
const path = require('node:path');
const { createHmac, timingSafeEqual } = require('node:crypto');

require('./vendure/node_modules/dotenv').config({
    path: path.join(__dirname, 'vendure', '.env'),
});
require('./vendure/node_modules/dotenv').config({
    path: path.join(__dirname, 'strapi-cms', '.env'),
});
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const STRAPI_WEBHOOK_SECRET = process.env.STRAPI_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
    console.error('WEBHOOK_SECRET is not configured.');
    process.exit(1);
}

console.log('Webhook secret loaded: Yes');
if (!STRAPI_WEBHOOK_SECRET) {
    console.error('STRAPI_WEBHOOK_SECRET is not configured.');
    process.exit(1);
}

console.log('Strapi webhook secret loaded: Yes');
const PORT = 4000;

const server = http.createServer((req, res) => {
    const allowedPaths = [
        '/strapi-webhook',
        '/vendure-webhook',
    ];

    if (req.method !== 'POST' || !allowedPaths.includes(req.url)) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }

    let body = '';

    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', () => {

        // Verify HMAC signature for Vendure webhooks
        if (req.url === '/vendure-webhook') {
            const timestampHeader = req.headers['x-webhook-timestamp'];
            const signatureHeader = req.headers['x-webhook-signature'];

            if (
                typeof timestampHeader !== 'string' ||
                typeof signatureHeader !== 'string'
            ) {
                res.writeHead(401);
                res.end('Missing authentication headers');
                return;
            }

            const timestamp = Number(timestampHeader);

            if (!Number.isSafeInteger(timestamp)) {
                res.writeHead(401);
                res.end('Invalid timestamp');
                return;
            }

            const currentTime = Math.floor(Date.now() / 1000);

            if (Math.abs(currentTime - timestamp) > 300) {
                res.writeHead(401);
                res.end('Webhook timestamp expired or invalid');
                return;
            }

            const signatureMatch = signatureHeader.match(
                /^sha256=([a-f0-9]{64})$/i
            );

            if (!signatureMatch) {
                res.writeHead(401);
                res.end('Invalid signature format');
                return;
            }

            const expectedSignature = createHmac(
                'sha256',
                WEBHOOK_SECRET,
            )
                .update(`${timestampHeader}.${body}`)
                .digest('hex');

            const expectedBuffer = Buffer.from(
                expectedSignature,
                'hex',
            );

            const receivedBuffer = Buffer.from(
                signatureMatch[1],
                'hex',
            );

            if (
                expectedBuffer.length !== receivedBuffer.length ||
                !timingSafeEqual(expectedBuffer, receivedBuffer)
            ) {
                res.writeHead(401);
                res.end('Invalid webhook signature');
                return;
            }

            console.log('HMAC Verification: Valid');
        }

        // Verify secret for Strapi webhooks
        if (req.url === '/strapi-webhook') {
            const receivedSecret =
                req.headers['x-strapi-webhook-secret'];

            if (typeof receivedSecret !== 'string') {
                res.writeHead(401);
                res.end('Missing Strapi webhook secret');
                return;
            }

            const expectedBuffer = Buffer.from(
                STRAPI_WEBHOOK_SECRET,
                'utf8',
            );

            const receivedBuffer = Buffer.from(
                receivedSecret,
                'utf8',
            );

            if (
                expectedBuffer.length !== receivedBuffer.length ||
                !timingSafeEqual(expectedBuffer, receivedBuffer)
            ) {
                res.writeHead(401);
                res.end('Invalid Strapi webhook secret');
                return;
            }

            console.log('Strapi Secret Verification: Valid');
        }

        let payload;

        try {
            payload = JSON.parse(body || '{}');
        } catch {
            res.writeHead(400);
            res.end('Invalid JSON');
            return;
        }

       console.log('\n--- WEBHOOK RECEIVED ---');
console.log('Path:', req.url);
console.log(
    'Strapi Secret Header:',
    req.headers['x-strapi-webhook-secret'] ? 'Present' : 'Missing'
);
console.log(
    'Timestamp Header:',
    req.headers['x-webhook-timestamp'] ?? 'Missing'
);

console.log(
    'Signature Header:',
    req.headers['x-webhook-signature'] ? 'Present' : 'Missing'
);

console.log('Payload:', JSON.stringify(payload, null, 2));

        res.writeHead(200, {
            'Content-Type': 'application/json',
        });

        res.end(JSON.stringify({ received: true }));
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Webhook Receiver running at http://127.0.0.1:${PORT}`);
});