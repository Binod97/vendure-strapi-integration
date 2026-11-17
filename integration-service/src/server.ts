import 'dotenv/config';
import dashboardRoutes from './routes/dashboard.js';
import express from 'express';
import { prisma } from './db.js';
import webhookRoutes from './routes/webhooks.js';
import { startRetryWorker } from './retry-worker.js';

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(express.json({
    verify: (req, _res, buf) => {
        req.rawBody = buf.toString('utf8');
    },
}));
app.use('/dashboard', dashboardRoutes);
app.use('/webhooks', webhookRoutes);

app.get('/health', async (_req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;

        res.status(200).json({
            status: 'ok',
            service: 'integration-service',
            database: 'connected',
        });
    } catch (error) {
        console.error('Database health check failed:', error);

        res.status(503).json({
            status: 'error',
            service: 'integration-service',
            database: 'disconnected',
        });
    }
});

app.listen(PORT, () => {
    console.log(`Integration Service running at http://localhost:${PORT}`);

    startRetryWorker();
});