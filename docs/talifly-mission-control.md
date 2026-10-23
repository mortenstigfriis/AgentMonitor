# Talifly Mission Control profile

This fork adds a separate read-only production entrypoint. It reuses the
AgentMonitor React client, Express authentication and static asset delivery but
does not import or mount AgentManager, pipelines, PTY terminal, directory
browsing, uploads, task mutation, relay control or Socket.IO command handlers.
It is based on upstream commit
`38e2085f112b6725ebfe9f486577c51f9d624f9a`.

## Build

Install from the reviewed lockfiles without lifecycle scripts:

```bash
npm ci --ignore-scripts
cd server && npm ci --ignore-scripts && cd ..
cd client && npm ci --ignore-scripts && cd ..
npm run build:mission-control
npm run licenses:audit
npm run licenses:notices
```

The server dependency install must not run the upstream automatic
`opencli@latest` sync. The Mission Control entrypoint does not use OpenCLI.

## Required runtime configuration

```text
PORT=3456
DASHBOARD_PASSWORD=<at-least-16-random-characters>
COOKIE_SECURE=true
TALIFLY_ADAPTER_URL=http://127.0.0.1:3460
TALIFLY_ADAPTER_TOKEN_FILE=/home/talifly/projects/Talifly/.local/ai-team/mission-control.token
```

Start locally with:

```bash
cd server
npm run start:mission-control
```

The server binds only to `127.0.0.1`. Put it behind the existing authenticated
HTTPS reverse proxy. The adapter token is read server-side from a mode-0600
file and is never sent to the browser.

Terminate HTTPS at the existing reverse proxy. Apply its standard login rate
limit and do not expose ports 3456 or 3460 publicly. Keep both services bound
to loopback.

## Licensing and dependency policy

The upstream AgentMonitor code remains covered by its MIT license; the root
`LICENSE` file must accompany copies or substantial portions. Lockfiles are
authoritative and installs use `--ignore-scripts`. The license audit checks all
installed dependency manifests against the reviewed permissive/open-source
allowlist and fails closed on unknown or newly introduced license expressions.
`THIRD_PARTY_NOTICES.md` is generated from the server and client runtime
lockfiles and packages the corresponding installed license texts.

VitePress was removed from this operational fork because the Markdown files do
not require a documentation-site runtime and its current dependency tree has
unresolved development-only advisories. The Markdown documentation remains in
`docs/`.

The reviewed audit baseline has no high or critical runtime findings. Express'
transitive `qs` package has one moderate advisory; this entrypoint explicitly
uses the built-in `simple` query parser and accepts only numeric `after` and
`limit` values. The relay has the same transitive advisory but is not part of
the Talifly deployment profile.

## Validation baseline

- Server: 21 test files, 173 tests passed.
- Client: 4 test files, 7 tests passed (upstream jsdom/xterm canvas warnings).
- Normal AgentMonitor client/server build passed.
- Dedicated Mission Control client/server build passed.
- Relay TypeScript build passed, although relay is not deployed.
- Hardened `node --jitless` login, snapshot and event flow passed against the
  real read-only Talifly adapter; unknown API routes returned 404.
- The systemd unit parses successfully with `systemd-analyze verify`.

## Exposed application API

- `POST /api/auth/login`
- `GET /api/auth/check`
- `POST /api/auth/logout`
- `GET /api/mission-control/health`
- `GET /api/mission-control/snapshot`
- `GET /api/mission-control/events?after=<cursor>&limit=<1-200>`

All other Mission Control methods return `405`. The full AgentMonitor server
entrypoint remains available for upstream comparison and tests, but it is not
approved for Talifly deployment.

## Isolated Hetzner installation

Create an `A` record for a dedicated Mission Control hostname pointing to this
engineering host. After DNS resolves, run the reviewed installer once:

```bash
sudo /home/talifly/projects/Talifly-AgentMonitor/deploy/install-mission-control.sh \
  --domain mission-control.example.com \
  --email operator@example.com
```

The installer fails before mutation unless both repositories are clean and
contain the reviewed commits, DNS resolves to a local public IPv4 address, the
adapter token is mode 0600, targets are unused and all standard host tools are
present. It builds as `talifly`, installs the two hardened systemd units,
obtains a Let's Encrypt certificate through the existing Nginx webroot pattern,
enables login/general rate limits and verifies that unauthenticated HTTPS access
is rejected with 401.

The generated dashboard password is stored at:

```text
/home/talifly/.local/ai-team/mission-control.dashboard-password
```

It is owned by `talifly` with mode 0600. The adapter token, dashboard password,
environment file and Orchestrator database are never committed.

Rollback removes only the installed services, proxy and replaceable dashboard
secret. It preserves repositories, Orchestrator state, adapter token and the
issued certificate:

```bash
sudo /home/talifly/projects/Talifly-AgentMonitor/deploy/uninstall-mission-control.sh --confirm
```
