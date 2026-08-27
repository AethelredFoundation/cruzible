# PostgreSQL Initialization Directory

This directory is intentionally checked in so the production Compose scaffold
can mount `/docker-entrypoint-initdb.d` without relying on an untracked local
path.

Database schema changes are managed through the checked-in Prisma migrations in
`backend/api/prisma/migrations`. Operators should run `npm run db:migrate:deploy`
from `backend/api` after PostgreSQL is reachable rather than adding ad hoc SQL
to this init directory.
