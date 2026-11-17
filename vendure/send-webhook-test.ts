import 'dotenv/config';
import { sendProductWebhook } from './src/plugins/webhook-plugin/webhook-sender.js';

async function main() {
    console.log('Sending controlled webhook for Product 55...');

    await sendProductWebhook({
        eventType: 'updated',
        productId: '55',
        productName: 'Integration Test Product',
        occurredAt: new Date().toISOString(),
    });

    console.log('Webhook sender execution completed. Check service logs.');
}

main().catch(error => {
    console.error('Webhook test failed:', error);
    process.exitCode = 1;
});
