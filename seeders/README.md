# Database seeders

Seeders are explicit, idempotent data initialization jobs. Filenames use `YYYYMMDDHHmmss-description.js` and export an asynchronous `up` function.

The production environment rejects `npm run db:seed` unless `ALLOW_DATABASE_SEED=true` is explicitly set. Frontend mock data must never be treated as production data automatically.
