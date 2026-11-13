# Vendure-Strapi Integration

A bidirectional integration project connecting Vendure 3.x and Strapi 5.

## Project Architecture

The project consists of four applications:

1. Vendure - E-commerce backend
2. Strapi - Headless CMS
3. Integration Service - Synchronization engine
4. Admin Dashboard - Integration monitoring interface

## Technology Stack

| Application | Technologies |
|---|---|
| E-commerce | Vendure 3.8.1 |
| CMS | Strapi 5 |
| Integration | Node.js, TypeScript, Express |
| Database | SQLite |
| ORM | Prisma |
| Dashboard | React, Vite, Tailwind CSS |

## Project Structure

- `vendure/` - Vendure application
- `strapi/` - Strapi CMS
- `integration-service/` - Synchronization service
- `dashboard/` - Admin dashboard
- `docs/` - Architecture documentation

## Development Status

- [x] Vendure installation
- [x] Vendure dashboard login
- [x] Sample products verification
- [ ] Strapi installation
- [ ] Integration service
- [ ] Admin dashboard
- [ ] Bidirectional synchronization

## Documentation

See `docs/decisions.md` for architecture decisions.

## Development

Each application will be developed and run independently.
