# Tinyurl Monorepo

A URL-shortener backend split into two independent HTTP services that share a common
library. **There is no frontend in this repository** — it is API-only. You interact with
it via HTTP requests (curl, Postman, or a separate client app of your own).

## How the project works

This is an npm-workspaces monorepo with three packages:

| Package | Description |
|---|---|
| `Tinyurl-api` | The public-facing API. Handles user registration/login (local + Google OAuth), URL shortening, listing a user's URLs, and redirecting short links to their original URL. |
| `kgs` | The **Key Generation Service**. Its only job is producing unique, unused short-URL keys ahead of time and handing them out on request. |
| `shared` | A library published internally as the `shared` workspace package. Provides the logger, the Redis client, a `BaseError` class, and a messaging abstraction (`MessagePublisher`/`MessageConsumer`, implemented with BullMQ on top of Redis) used by both services. |

Each service is a standalone Express app with its own `server.ts`, its own MongoDB
database, and its own `.env` file — they are deployed and scaled independently.

### Why two services? (the KGS pattern)

Generating a short, unique key for every URL on the request path would mean checking
for collisions synchronously on every write. Instead:

1. `kgs` continuously pre-generates a pool of unique keys and pushes them into a Redis
   list (`shared`'s Redis/queue helpers), replenishing the pool via a BullMQ worker
   whenever it runs low (see `kgs/src/queue/workers.ts`).
2. When `Tinyurl-api` needs to shorten a URL, it first pops a key straight out of
   Redis — no network call needed, this is the fast path.
3. If Redis is empty, `Tinyurl-api` falls back to calling `kgs` directly over HTTP
   (`GET /api/v1/keys/next`, see `Tinyurl-api/src/gateway/kgs/index.ts`) so the request
   can still be served while the pool refills in the background.

This means `Tinyurl-api` needs to reach `kgs` over HTTP (`KGS_BASE_URL`) and both
services need to reach the same Redis instance (`REDIS_URL`) and their own MongoDB
databases.

## Interacting with the APIs

`Tinyurl-api` listens on `PORT` (default `8080` locally, see `.env`) and exposes:

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/register` | none | Create a user. Body: `{ "fullName": string, "email": string, "password": string (min 5 chars) }` |
| `POST` | `/api/v1/auth/login` | none | Body: `{ "email": string, "password": string }`. Returns an access + refresh token. |
| `POST` | `/api/v1/auth/refresh-token` | none | Body: `{ "refreshToken": string }`. Issues a new token pair. |
| `POST` | `/api/v1/auth/logout` | Bearer token | Invalidates the current user's session. |
| `GET` | `/api/v1/auth/google` | none | Starts the Google OAuth flow (redirects to Google). |
| `GET` | `/api/v1/auth/google/redirect` | none | Google OAuth callback; redirects back to `WEB_APP_URL` with tokens as query params. |
| `POST` | `/api/v1/urls` | optional Bearer token | Body: `{ "longUrl": string }`. Shortens a URL. If a token is supplied, the URL is associated with that user. |
| `GET` | `/api/v1/urls` | Bearer token | Lists the URLs created by the authenticated user. |
| `GET` | `/api/v1/users/:userId` | Bearer token | Fetch a user by id (only the token's own user id is allowed). |
| `GET` | `/:key` | none | Redirects a short key (e.g. `/aB3xQ1`) to its original long URL. |

Authenticated requests use a standard header: `Authorization: Bearer <accessToken>`.

Example — shorten a URL anonymously:

```bash
curl -X POST http://localhost:8080/api/v1/urls \
  -H "Content-Type: application/json" \
  -d '{"longUrl": "https://example.com/some/very/long/path"}'
```

`kgs` listens on its own `PORT` (default `8081`) and is meant to be called by
`Tinyurl-api`, not by end users directly, but it exposes:

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check, returns `{ "status": true }`. |
| `GET` | `/api/v1/keys/next` | Returns an unused short key: `{ "data": { "key": "..." } }`. |

All responses share the shape `{ status: boolean, message?: string, data?: ... }`;
errors return `{ status: false, message: string }` with a non-2xx status code.

## Requirements

Whichever way you run this, you need:

- **Node.js 20+** (developed against Node 24) and **npm** (workspaces support)
- **MongoDB** — one database per service (`tinyurl` and `tinyurl-keys` by default)
- **Redis** — shared between both services (fast-path key pool + BullMQ queues)
- A **Google OAuth 2.0** client id/secret if you want the Google login flow to work
  (optional — local email/password auth works without it)

## Running without Docker

1. Install MongoDB and Redis locally (or point at remote instances) and have them
   running.
2. Install dependencies for the whole workspace from the repo root:

   ```bash
   npm install
   ```

3. Configure environment variables. Each service reads its own `.env` file:
   - `Tinyurl-api/.env` — see the keys already listed there (`PORT`,
     `DB_CONNECTION_STRING`, `JWT_KEY`, `REFRESH_TOKEN_KEY`, `GOOGLE_OAUTH_*`,
     `REDIS_URL`, `SERVICE_NAME`, `SHORT_URL_BASE_URL`, `WEB_APP_URL`, and
     `KGS_BASE_URL` to point at your `kgs` instance, e.g. `http://localhost:8081`).
   - `kgs/.env` — `PORT`, `DB_CONNECTION_STRING`, `REDIS_URL`, `SERVICE_NAME`.

4. Build the shared package and run each service in its own terminal (from the repo
   root):

   ```bash
   npm run dev:kgs   # builds `shared`, then runs kgs with hot reload (tsx watch)
   npm run dev:api   # builds `shared`, then runs Tinyurl-api with hot reload
   ```

   Start `kgs` first (or at least before sending real traffic) so it has a chance to
   stock its key pool before `Tinyurl-api` needs one.

   For a production-style run instead of hot reload:

   ```bash
   npm run build         # builds shared + both services
   npm run start:kgs
   npm run start:api
   ```

Other useful root-level scripts: `npm test`, `npm run lint`, `npm run typecheck`,
`npm run format`.

## Running with Docker

A `docker-compose.yml` at the repo root wires up MongoDB, Redis, `kgs`, and
`Tinyurl-api` together, each service built from its own `Dockerfile`.

1. Copy the Docker env templates and fill in real secrets (JWT keys, Google OAuth
   credentials, etc.). These are separate from the local `.env` files because inside
   Docker the services must address Mongo/Redis/each other by service name instead of
   `localhost`:

   ```bash
   cp Tinyurl-api/.env.docker.example Tinyurl-api/.env.docker
   cp kgs/.env.docker.example kgs/.env.docker
   ```

2. Build and start everything:

   ```bash
   docker compose up --build
   ```

   This starts:
   - `mongo` on `localhost:27017` (persisted in a named volume)
   - `redis` on `localhost:6379`
   - `kgs` on `localhost:8081`
   - `tinyurl-api` on `localhost:8080`

3. Verify it's up:

   ```bash
   curl http://localhost:8081/health
   curl -X POST http://localhost:8080/api/v1/urls -H "Content-Type: application/json" \
     -d '{"longUrl": "https://example.com"}'
   ```

4. Tear down with `docker compose down` (add `-v` to also drop the MongoDB volume).

To rebuild after changing source or dependencies, run `docker compose up --build`
again — each `Dockerfile` builds the `shared` workspace package before the service
that depends on it.
