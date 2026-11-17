import dotenv from 'dotenv';

dotenv.config({
    path: [
        '.env',
        '../vendure/.env',
        '../strapi-cms/.env',
    ],
});

const vendureSecret = process.env.WEBHOOK_SECRET;
const strapiSecret = process.env.STRAPI_WEBHOOK_SECRET;
const strapiUrl = process.env.STRAPI_URL;
const strapiApiToken = process.env.STRAPI_API_TOKEN;
const vendureUrl = process.env.VENDURE_URL;
if (!vendureSecret) {
    throw new Error('Vendure WEBHOOK_SECRET is missing.');
}

if (!strapiSecret) {
    throw new Error('Strapi STRAPI_WEBHOOK_SECRET is missing.');
}
if (!strapiUrl) {
    throw new Error('Strapi STRAPI_URL is missing.');
}

if (!strapiApiToken) {
    throw new Error('Strapi STRAPI_API_TOKEN is missing.');
}
if (!vendureUrl) {
    throw new Error('Vendure VENDURE_URL is missing.');
}
export const VENDURE_WEBHOOK_SECRET = vendureSecret;
export const STRAPI_WEBHOOK_SECRET = strapiSecret;
export const STRAPI_URL = strapiUrl.replace(/\/+$/, '');
export const STRAPI_API_TOKEN = strapiApiToken;
export const VENDURE_URL = vendureUrl.replace(/\/+$/, '');