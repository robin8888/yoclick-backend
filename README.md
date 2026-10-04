# yoclick-back

API multi-centro de Yoclick: NestJS 11 (Fastify) + Prisma + PostgreSQL con RLS.

- Reglas del repositorio: [`CLAUDE.md`](CLAUDE.md)
- Especificación: [`docs/spec/`](docs/spec) · Plan de tickets: [`docs/spec/05-plan-de-trabajo.md`](docs/spec/05-plan-de-trabajo.md)
- Puesta en marcha local: [`docs/local-setup.md`](docs/local-setup.md)

## Comandos

```bash
npm install
npm run start:dev      # API en :3000 (necesita .env, ver docs/local-setup.md)
npm run lint && npm run typecheck && npm test && npm run test:e2e
npm run audit:prod     # dependencias de producción: debe quedar sin vulnerabilidades altas
```
