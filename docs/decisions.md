# Architecture Decisions

## Project
Vendure 3.x and Strapi 5 Bidirectional Integration.

## Applications
- Vendure 3.8.1: E-commerce backend.
- Strapi 5: Product content management.
- Integration Service: Node.js, TypeScript, Express.
- Database: SQLite with Prisma.
- Dashboard: React, Vite, Tailwind CSS.

## Architecture
Four separate applications:
1. Vendure
2. Strapi
3. Integration Service
4. Admin Dashboard

## Integration Principles
- Bidirectional product synchronization.
- Persistent queues and retry failed jobs.
- Idempotent synchronization.
- Conflict detection and resolution.
- Manual synchronization and reconciliation.

## Initial Scope
- One language, channel, and currency.
- Product images.
- Product categories mapped to Vendure Collections.
- Product specifications and SEO metadata.
- Local development without Docker or Redis.
