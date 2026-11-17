import { syncVendureProductToStrapi } from './src/product-sync.ts';

async function main() {
    const result = await syncVendureProductToStrapi('1');

    console.log('Product Sync Result:');
    console.dir(result, { depth: null });
}

main().catch((error) => {
    console.error('Product Sync Failed:', error);
    process.exitCode = 1;
});