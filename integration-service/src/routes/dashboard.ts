import { Router } from 'express';
import { randomUUID } from 'node:crypto';

import { prisma } from '../db.js';

import {
    syncVendureProductToStrapi,
} from '../product-sync.js';

import {
    syncStrapiProductToVendure,
} from '../strapi-to-vendure.js';

const router = Router();

// ============================================
// LOCALHOST ACCESS ONLY
// ============================================

router.use((req, res, next) => {
    const address = req.socket.remoteAddress ?? '';

    const isLocalhost = [
        '127.0.0.1',
        '::1',
        '::ffff:127.0.0.1',
    ].includes(address);

    if (!isLocalhost) {
        return res.status(403).json({
            error: 'Dashboard is available from localhost only.',
        });
    }

    next();
});

// ============================================
// DASHBOARD HTML
// ============================================

const dashboardHtml = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <title>Vendure - Strapi Integration Dashboard</title>

    <style>
        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            font-family: Arial, sans-serif;
            background: #f4f6fa;
            color: #202938;
        }

        header {
            background: #192536;
            color: white;
            padding: 22px 30px;
        }

        header h1 {
            margin: 0 0 6px;
            font-size: 23px;
        }

        header p {
            margin: 0;
            color: #bdc9d9;
            font-size: 13px;
        }

        main {
            max-width: 1400px;
            margin: auto;
            padding: 25px;
        }

        .topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 15px;
            margin-bottom: 20px;
        }

        .topbar h2 {
            margin: 0;
            font-size: 19px;
        }

        button {
            border: 0;
            border-radius: 6px;
            padding: 9px 13px;
            cursor: pointer;
            background: #2563eb;
            color: white;
            font-weight: 600;
        }

        button:disabled {
            opacity: .5;
            cursor: wait;
        }

        .refresh {
            background: #374151;
        }

        .sync-strapi {
            background: #0e8875;
        }

        .sync-vendure {
            background: #2563eb;
        }

        .retry {
            background: #d97706;
        }

        .cards {
            display: grid;
            grid-template-columns: repeat(5, minmax(130px, 1fr));
            gap: 15px;
            margin-bottom: 25px;
        }

        .card {
            background: white;
            padding: 19px;
            border-radius: 9px;
            border: 1px solid #e5e7eb;
        }

        .card p {
            margin: 0 0 12px;
            font-size: 13px;
            color: #697586;
        }

        .card strong {
            font-size: 27px;
        }

        .panel {
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 9px;
            padding: 20px;
            margin-bottom: 22px;
            overflow: hidden;
        }

        .panel h3 {
            margin: 0 0 17px;
            font-size: 17px;
        }

        .table-wrap {
            overflow-x: auto;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            min-width: 650px;
        }

        th, td {
            text-align: left;
            padding: 12px 10px;
            border-bottom: 1px solid #edf0f4;
        }

        th {
            color: #657184;
            background: #f8fafc;
            font-weight: 600;
        }

        td {
            overflow-wrap: anywhere;
            
        }
 .error-cell {
            color: #991b1b;
            max-width: 280px;
            overflow-wrap: anywhere;
        }
            .actions {
            display: flex;
            gap: 7px;
            flex-wrap: wrap;
        }

        .status {
            display: inline-block;
            padding: 5px 8px;
            border-radius: 20px;
            background: #e5e7eb;
            color: #374151;
            font-size: 11px;
            font-weight: 700;
        }

        .processed {
            background: #dcfce7;
            color: #166534;
        }

        .failed, .retry_exhausted {
            background: #fee2e2;
            color: #991b1b;
        }

        .processing {
            background: #dbeafe;
            color: #1d4ed8;
        }

        .ignored {
            background: #f3f4f6;
            color: #4b5563;
        }

        .filters {
            margin-bottom: 14px;
            display: flex;
            gap: 10px;
        }

        select {
            padding: 8px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
        }

        .message {
            color: #64748b;
            font-size: 13px;
            margin-top: 12px;
        }

        footer {
            text-align: center;
            color: #8390a1;
            font-size: 12px;
            padding: 20px;
        }

        @media (max-width: 850px) {
            .cards {
                grid-template-columns: repeat(2, 1fr);
            }

            main {
                padding: 14px;
            }

            header {
                padding: 20px;
            }
        }
    </style>
</head>

<body>

<header>
    <h1>Vendure - Strapi Integration</h1>
    <p>Integration Service Management Dashboard</p>
</header>

<main>

    <div class="topbar">
        <h2>Integration Overview</h2>
        <button class="refresh" id="refreshButton">Refresh Data</button>
    </div>

    <section class="cards">
        <div class="card">
            <p>Product Mappings</p>
            <strong id="productCount">-</strong>
        </div>

        <div class="card">
            <p>Category Mappings</p>
            <strong id="categoryCount">-</strong>
        </div>

        <div class="card">
            <p>Media Mappings</p>
            <strong id="mediaCount">-</strong>
        </div>

        <div class="card">
            <p>Processed Events</p>
            <strong id="processedCount">-</strong>
        </div>

        <div class="card">
            <p>Failed Events</p>
            <strong id="failedCount">-</strong>
        </div>
    </section>

    <section class="panel">
        <h3>Product Mappings</h3>

        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>Strapi Document ID</th>
                        <th>Vendure Product ID</th>
                        <th>Last Synced</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="productsTable">
                    <tr><td colspan="4">Loading...</td></tr>
                </tbody>
            </table>
        </div>

        <p class="message">
            Choose a direction to manually synchronize a mapped Product.
        </p>
    </section>

    <section class="panel">
        <h3>Category Mappings</h3>

        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>Strapi Category ID</th>
                        <th>Vendure Collection ID</th>
                        <th>Created At</th>
                    </tr>
                </thead>
                <tbody id="categoriesTable">
                    <tr><td colspan="3">Loading...</td></tr>
                </tbody>
            </table>
        </div>
    </section>

    <section class="panel">
        <h3>Media Mappings</h3>

        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>Strapi File ID</th>
                        <th>Vendure Asset ID</th>
                        <th>File Name</th>
                        <th>MIME Type</th>
                    </tr>
                </thead>
                <tbody id="mediaTable">
                    <tr><td colspan="4">Loading...</td></tr>
                </tbody>
            </table>
        </div>
    </section>

    <section class="panel">
        <h3>Synchronization Logs</h3>

        <div class="filters">
            <select id="statusFilter">
                <option value="">All statuses</option>
                <option value="processed">Processed</option>
                <option value="failed">Failed</option>
                <option value="processing">Processing</option>
                <option value="ignored">Ignored</option>
                <option value="retry_exhausted">Retry Exhausted</option>
            </select>

            <button id="filterButton">Apply Filter</button>
        </div>

        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>Source</th>
                        <th>Event</th>
                        <th>Entity</th>
                        <th>Status</th>
                        <th>Attempts</th>
                        <th>Received</th>
                        <th>Error / Failure Reason</th>
                        <th>Action</th>
                    </tr>
                </thead>

                <tbody id="logsTable">
                    <tr><td colspan="8">Loading...</td></tr>
                </tbody>
            </table>
        </div>
    </section>

    <p class="message" id="pageMessage"></p>

</main>

<footer>
    Vendure - Strapi Integration Service
</footer>

<script>
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[ch]));

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || data.message || 'Request failed');
    }

    return data;
}

function setMessage(message) {
    document.getElementById('pageMessage').textContent = message;
}

async function loadOverview() {
    const data = await api('/dashboard/api/overview');

    document.getElementById('productCount').textContent =
        data.products;

    document.getElementById('categoryCount').textContent =
        data.categories;

    document.getElementById('mediaCount').textContent =
        data.media;

    document.getElementById('processedCount').textContent =
        data.processed;

    document.getElementById('failedCount').textContent =
        data.failed;
}

async function loadProducts() {
    const data = await api('/dashboard/api/products');

    const table = document.getElementById('productsTable');

    if (!data.length) {
        table.innerHTML = '<tr><td colspan="4">No Product mappings found.</td></tr>';
        return;
    }

    table.innerHTML = data.map(item => {
        return '<tr>' +
            '<td>' + esc(item.strapiDocumentId) + '</td>' +
            '<td>' + esc(item.vendureProductId) + '</td>' +
            '<td>' + esc(item.lastSyncedAt || 'Never') + '</td>' +
            '<td><div class="actions">' +
            '<button class="sync-strapi" data-direction="vendure-to-strapi" data-id="' + esc(item.vendureProductId) + '">Vendure → Strapi</button>' +
            '<button class="sync-vendure" data-direction="strapi-to-vendure" data-id="' + esc(item.vendureProductId) + '">Strapi → Vendure</button>' +
            '</div></td>' +
            '</tr>';
    }).join('');

    table.querySelectorAll('button[data-id]').forEach(button => {
        button.addEventListener('click', async () => {
            await manualSync(
                button.dataset.id,
                button.dataset.direction,
                button
            );
        });
    });
}

async function loadCategories() {
    const data = await api('/dashboard/api/categories');

    const table = document.getElementById('categoriesTable');

    if (!data.length) {
        table.innerHTML = '<tr><td colspan="3">No Category mappings found.</td></tr>';
        return;
    }

    table.innerHTML = data.map(item => {
        return '<tr>' +
            '<td>' + esc(item.strapiDocumentId) + '</td>' +
            '<td>' + esc(item.vendureCollectionId) + '</td>' +
            '<td>' + esc(item.createdAt) + '</td>' +
            '</tr>';
    }).join('');
}

async function loadMedia() {
    const data = await api('/dashboard/api/media');

    const table = document.getElementById('mediaTable');

    if (!data.length) {
        table.innerHTML = '<tr><td colspan="4">No Media mappings found.</td></tr>';
        return;
    }

    table.innerHTML = data.map(item => {
        return '<tr>' +
            '<td>' + esc(item.strapiFileDocumentId) + '</td>' +
            '<td>' + esc(item.vendureAssetId) + '</td>' +
            '<td>' + esc(item.fileName) + '</td>' +
            '<td>' + esc(item.mimeType) + '</td>' +
            '</tr>';
    }).join('');
}

async function loadLogs() {
    const status = document.getElementById('statusFilter').value;

    const url = new URL(
        '/dashboard/api/logs',
        window.location.origin
    );

    if (status) {
        url.searchParams.set('status', status);
    }

    const data = await api(url.pathname + url.search);

    const table = document.getElementById('logsTable');

    if (!data.length) {
        table.innerHTML = '<tr><td colspan="8">No logs found.</td></tr>';
        return;
    }

    table.innerHTML = data.map(item => {
        const canRetry =
            item.status === 'failed' ||
            item.status === 'retry_exhausted';

        const retryButton = canRetry
            ? '<button class="retry" data-retry="' + esc(item.id) + '">Retry</button>'
            : '';

        return '<tr>' +
            '<td>' + esc(item.source) + '</td>' +
            '<td>' + esc(item.eventType) + '</td>' +
            '<td>' + esc(item.entityType) + ': ' + esc(item.entityId) + '</td>' +
            '<td><span class="status ' + esc(item.status) + '">' + esc(item.status) + '</span></td>' +
            '<td>' + esc(item.attemptCount) + '</td>' +
            '<td>' + esc(item.receivedAt) + '</td>' +
            '<td class="error-cell">' + esc(item.errorMessage || '-') + '</td>' +
            '<td>' + retryButton + '</td>' +
            '</tr>';
    }).join('');

    table.querySelectorAll('button[data-retry]').forEach(button => {
        button.addEventListener('click', async () => {
            await manualRetry(button.dataset.retry, button);
        });
    });
}

async function manualSync(productId, direction, button) {
    if (!confirm('Start manual Product synchronization?')) {
        return;
    }

    button.disabled = true;
    button.textContent = 'Syncing...';

    try {
        const result = await api(
            '/dashboard/api/products/' + encodeURIComponent(productId) + '/sync',
            {
                method: 'POST',
                body: JSON.stringify({ direction })
            }
        );

        setMessage('Sync completed successfully.');
        alert('Product synchronization successful.');

        await loadDashboard();

    } catch (error) {
        alert('Sync failed: ' + error.message);
        setMessage('Sync failed: ' + error.message);
        await loadDashboard();

    } finally {
        button.disabled = false;
    }
}

async function manualRetry(logId, button) {
    if (!confirm('Queue this event for manual retry?')) {
        return;
    }

    button.disabled = true;
    button.textContent = 'Queued...';

    try {
        await api(
            '/dashboard/api/retry/' + encodeURIComponent(logId),
            {
                method: 'POST',
                body: JSON.stringify({})
            }
        );

        setMessage('Retry queued. Worker will process it shortly.');

        await loadDashboard();

    } catch (error) {
        alert('Retry failed: ' + error.message);
        button.disabled = false;
        button.textContent = 'Retry';
    }
}

async function loadDashboard() {
    setMessage('Loading dashboard...');

    try {
        await Promise.all([
            loadOverview(),
            loadProducts(),
            loadCategories(),
            loadMedia(),
            loadLogs()
        ]);

        setMessage('Dashboard data refreshed.');

    } catch (error) {
        setMessage('Dashboard error: ' + error.message);
    }
}

document.getElementById('refreshButton')
    .addEventListener('click', loadDashboard);

document.getElementById('filterButton')
    .addEventListener('click', loadLogs);

loadDashboard();
</script>

</body>
</html>`;

// ============================================
// DASHBOARD PAGE
// ============================================

router.get('/', (_req, res) => {
    res.type('html').send(dashboardHtml);
});

// ============================================
// OVERVIEW API
// ============================================

router.get('/api/overview', async (_req, res) => {
    try {
        const [
            products,
            categories,
            media,
            processed,
            failed,
        ] = await Promise.all([
            prisma.productMapping.count(),

            prisma.categoryMapping.count(),

            prisma.mediaMapping.count(),

            prisma.syncLog.count({
                where: {
                    status: 'processed',
                },
            }),

            prisma.syncLog.count({
                where: {
                    status: {
                        in: ['failed', 'retry_exhausted'],
                    },
                },
            }),
        ]);

        return res.json({
            products,
            categories,
            media,
            processed,
            failed,
        });

    } catch (error) {
        console.error('Dashboard overview error:', error);

        return res.status(500).json({
            error: 'Could not load dashboard overview.',
        });
    }
});

// ============================================
// PRODUCT MAPPINGS API
// ============================================

router.get('/api/products', async (_req, res) => {
    try {
        const mappings = await prisma.productMapping.findMany({
            orderBy: {
                updatedAt: 'desc',
            },
        });

        return res.json(mappings);

    } catch (error) {
        console.error('Dashboard products error:', error);

        return res.status(500).json({
            error: 'Could not load Product mappings.',
        });
    }
});

// ============================================
// CATEGORY MAPPINGS API
// ============================================

router.get('/api/categories', async (_req, res) => {
    try {
        const mappings = await prisma.categoryMapping.findMany({
            orderBy: {
                createdAt: 'desc',
            },
        });

        return res.json(mappings);

    } catch (error) {
        console.error('Dashboard categories error:', error);

        return res.status(500).json({
            error: 'Could not load Category mappings.',
        });
    }
});

// ============================================
// MEDIA MAPPINGS API
// ============================================

router.get('/api/media', async (_req, res) => {
    try {
        const mappings = await prisma.mediaMapping.findMany({
            orderBy: {
                createdAt: 'desc',
            },
        });

        return res.json(mappings);

    } catch (error) {
        console.error('Dashboard media error:', error);

        return res.status(500).json({
            error: 'Could not load Media mappings.',
        });
    }
});

// ============================================
// SYNC LOGS API
// ============================================

router.get('/api/logs', async (req, res) => {
    try {
        const status =
            typeof req.query.status === 'string'
                ? req.query.status
                : undefined;

        const limitValue = Number(req.query.limit ?? 50);

        const limit = Number.isFinite(limitValue)
            ? Math.min(Math.max(limitValue, 1), 100)
            : 50;

        const logs = await prisma.syncLog.findMany({
            where: status ? { status } : undefined,

            orderBy: {
                receivedAt: 'desc',
            },

            take: limit,

            select: {
                id: true,
                eventId: true,
                source: true,
                eventType: true,
                entityType: true,
                entityId: true,
                status: true,
                errorMessage: true,
                receivedAt: true,
                processedAt: true,
                attemptCount: true,
                lastAttemptAt: true,
                nextRetryAt: true,
            },
        });

        return res.json(logs);

    } catch (error) {
        console.error('Dashboard logs error:', error);

        return res.status(500).json({
            error: 'Could not load Sync Logs.',
        });
    }
});

// ============================================
// MANUAL PRODUCT SYNC API
// ============================================

router.post(
    '/api/products/:vendureProductId/sync',
    async (req, res) => {
        const vendureProductId = req.params.vendureProductId;

        const direction = req.body?.direction;

        if (
            direction !== 'vendure-to-strapi' &&
            direction !== 'strapi-to-vendure'
        ) {
            return res.status(400).json({
                error: 'Invalid synchronization direction.',
            });
        }

        try {
            const mapping = await prisma.productMapping.findUnique({
                where: {
                    vendureProductId,
                },
            });

            if (!mapping) {
                return res.status(404).json({
                    error: 'Product mapping not found.',
                });
            }

            const source =
                direction === 'vendure-to-strapi'
                    ? 'vendure'
                    : 'strapi';

            const entityId =
                direction === 'vendure-to-strapi'
                    ? mapping.vendureProductId
                    : mapping.strapiDocumentId;

            const startedAt = new Date();

            const log = await prisma.syncLog.create({
                data: {
                    eventId: `dashboard:${randomUUID()}`,
                    source,
                    eventType: 'manual.product.sync',
                    entityType: 'product',
                    entityId,
                    status: 'processing',
                    payload: JSON.stringify({
                        direction,
                        initiatedBy: 'dashboard',
                    }),
                    attemptCount: 1,
                    lastAttemptAt: startedAt,
                },
            });

            try {
                let result;

                if (direction === 'vendure-to-strapi') {
                    result = await syncVendureProductToStrapi(
                        mapping.vendureProductId,
                    );
                } else {
                    result = await syncStrapiProductToVendure(
                        mapping.strapiDocumentId,
                    );
                }

                await prisma.syncLog.update({
                    where: {
                        id: log.id,
                    },
                    data: {
                        status: 'processed',
                        processedAt: new Date(),
                        errorMessage: null,
                        nextRetryAt: null,
                    },
                });

                return res.json({
                    status: 'synced',
                    logId: log.id,
                    result,
                });

            } catch (syncError) {
                const message =
                    syncError instanceof Error
                        ? syncError.message
                        : 'Unknown manual sync error';

                const failedAt = new Date();

                await prisma.syncLog.update({
                    where: {
                        id: log.id,
                    },
                    data: {
                        status: 'failed',
                        errorMessage: message,
                        processedAt: failedAt,
                        nextRetryAt: new Date(
                            failedAt.getTime() + 60 * 1000,
                        ),
                    },
                });

                return res.status(500).json({
                    status: 'failed',
                    logId: log.id,
                    error: message,
                });
            }

        } catch (error) {
            console.error('Manual Product Sync error:', error);

            return res.status(500).json({
                error: 'Manual Product Sync could not be started.',
            });
        }
    },
);

// ============================================
// MANUAL RETRY API
// ============================================

router.post('/api/retry/:id', async (req, res) => {
    try {
        const log = await prisma.syncLog.findUnique({
            where: {
                id: req.params.id,
            },
        });

        if (!log) {
            return res.status(404).json({
                error: 'Sync Log not found.',
            });
        }

        if (
            log.status !== 'failed' &&
            log.status !== 'retry_exhausted'
        ) {
            return res.status(400).json({
                error: `Cannot retry an event with status: ${log.status}`,
            });
        }

        // A manual retry starts a fresh retry budget.
        const updated = await prisma.syncLog.update({
            where: {
                id: log.id,
            },
            data: {
                status: 'failed',
                attemptCount: 0,
                processedAt: null,
                errorMessage: 'Manual retry queued from Dashboard.',
                nextRetryAt: new Date(Date.now() - 1000),
            },
        });

        return res.json({
            status: 'queued',
            eventId: updated.eventId,
            message: 'Retry Worker will process this event shortly.',
        });

    } catch (error) {
        console.error('Manual Retry error:', error);

        return res.status(500).json({
            error: 'Could not queue event for retry.',
        });
    }
});

export default router;