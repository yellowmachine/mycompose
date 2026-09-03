# mycompose

Single-host control panel for Docker Compose stacks. You paste a **public Git URL**, press **Deploy**, and the panel clones that commit and runs `docker compose` on the same machine. Status, logs, CPU/memory, and a service shell stay in the UI so you do not need SSH for day-2 work.

There is **no login**. Anyone who can reach the panel has full control (Docker socket + `docker exec`). Do not expose it to the internet.

Product spec: [SPEC-0.md](./SPEC-0.md). Implementation: [PLAN.md](./PLAN.md).  
AI diagnosis (not implemented yet): [SPEC-AI.md](./SPEC-AI.md), [PLAN-AI.md](./PLAN-AI.md).

## Requirements

On the host:

- [Bun](https://bun.sh)
- Git
- Docker Engine with the Compose **v2** plugin (`docker compose version`)
- Your user able to talk to `/var/run/docker.sock` (usually the `docker` group)

Postgres 16 is started with the repo `compose.yaml`. You do not need a local Postgres install.

## Run the panel

```sh
cp .env.example .env
bun install
bun run db:start          # Postgres on localhost:5433
bun run db:migrate
bun run dev               # http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173). `bun run dev` also starts a small WebSocket helper on `127.0.0.1:5174` (used by the in-browser terminal).

| Variable                    | Default                                                   | Purpose                                 |
| --------------------------- | --------------------------------------------------------- | --------------------------------------- |
| `DATABASE_URL`              | `postgres://mycompose:mycompose@localhost:5433/mycompose` | Panel database                          |
| `MYCOMPOSE_DATA_DIR`        | `./data`                                                  | Clone + env-file directory              |
| `DOCKER_SOCK`               | `/var/run/docker.sock`                                    | Engine socket                           |
| `MYCOMPOSE_ALLOW_LOCAL_GIT` | `0`                                                       | `1` allows a local path / `file://` URL |
| `ORIGIN`                    | `http://localhost:5173`                                   | Public origin for the panel             |

## Try a first deploy

### Option A — fixture repo on disk (no GitHub)

This is the fastest way to see a stack come up. The sample compose is nginx on host port **18080**.

```sh
# in another shell, or add it to .env
export MYCOMPOSE_ALLOW_LOCAL_GIT=1
bun run dev
```

In the UI:

1. **New app**
2. Name anything; slug e.g. `sample`
3. Git URL: the absolute path of `fixtures/sample-compose` in this repo (for example `/home/you/dev/mycompose/fixtures/sample-compose`)
4. Leave branch `main` and path `docker-compose.yml`
5. **Create**, then **Deploy**

Wait until status is `running` (a few seconds). Then:

- Header shows a short live SHA and published port `:18080`
- Open [http://127.0.0.1:18080](http://127.0.0.1:18080) for the nginx welcome page
- **Runtime** shows CPU and memory for `web`
- **Container logs** stream nginx stdout
- **Terminal** → Open terminal → run `pwd` / `ls`
- **Stop** / **Start** do not clone Git again
- **Destroy** asks you to type the slug; named volumes are **not** deleted

### Option B — public HTTPS Git

Leave `MYCOMPOSE_ALLOW_LOCAL_GIT=0`. Create an app with a public `https://…git` URL that contains a compose file (set **Compose file path** if it is not `docker-compose.yml`). SSH Git URLs and embedded credentials are rejected.

Compose project name on the host is always `mycompose-<slug>`. Check with:

```sh
docker compose -p mycompose-sample ps
```

## What the panel will not do

- Auth, domains, TLS, or a reverse proxy — published `ports:` are the public surface
- Private Git, deploy keys, or webhooks
- `docker compose down -v` — named volumes survive deploy, stop, start, and destroy
- Bind mounts that point at the clone directory — that directory is wiped on every deploy; use named volumes

## Tests

```sh
bun run test:unit
bun run test:e2e          # needs Docker + Playwright browsers (`bunx playwright install`)
bun run check
bun run lint
```

E2E uses `MYCOMPOSE_ALLOW_LOCAL_GIT=1` and copies `fixtures/` into throwaway git repos. It does not hit the public internet.
