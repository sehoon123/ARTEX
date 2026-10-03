<div align="center">

# ARTEX

AI Autonomous Penetration Testing System (Go Backend + Next.js Frontend)

🌐 **Online Demo**: [https://artex-demo.vercel.app/](https://artex-demo.vercel.app/)

🌍 **Language / 언어**: English | [한국어](README.ko.md)

</div>

---

## Screenshots

> Full interactive demo at [Online Demo](https://artex-demo.vercel.app/).

| Dashboard (Overview / Token Usage / Activity) | Task List |
| :---: | :---: |
| ![Dashboard](screenshots/dashboard.png) | ![Tasks](screenshots/tasks.png) |

| Task · Execution (Sessions / Tool Calls) | Exploration Path |
| :---: | :---: |
| ![Sessions](screenshots/sessions.png) | ![Graph](screenshots/graph.png) |

| Findings | Assets |
| :---: | :---: |
| ![Findings](screenshots/findings.png) | ![Assets](screenshots/assets.png) |

| Asset Coverage Map (Force-directed Layout · Tested Highlight · Collapse/Expand) |
| :---: |
| ![Coverage](screenshots/assets_test.png) |

| Traffic Recording | Human-in-the-Loop Chat |
| :---: | :---: |
| ![Traffic](screenshots/traffic.png) | ![Chat](screenshots/chat.png) |

| Agent Management | LLM Configuration |
| :---: | :---: |
| ![Agent](screenshots/agents.png) | ![LLM](screenshots/llm.png) |

| Intercept Approval | Backend Logs |
| :---: | :---: |
| ![Intercept](screenshots/intercept.png) | ![Logs](screenshots/logs.png) |

---

## Approval Record Details

Global "Approval Records", in-task "Intercept Approvals", and approval cards in chat all support expanding to view details.

## Asset Sync (ScopeSentry)

Supports syncing asset data directly from [ScopeSentry](https://github.com/Autumn-27/ScopeSentry):

- Configure the ScopeSentry address and API Key on the **Asset Sync** page;
- Select sync targets and asset types (domains / subdomains / IPs / ports / sites / endpoints…) by **project** or **task**;
- One-click import and merge by company asset scope, directly into ARTEX's asset graph for agent exploration.

---

## Installation

> Requires **PostgreSQL** database; exploration needs **LLM** configuration (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, also configurable in UI).

### Option 1: One-click Install Script (Recommended)

```bash
git clone https://github.com/sehoon123/ARTEX.git
cd ARTEX
./install.sh
```

The script will: detect/auto-install Docker → let you choose **① All Docker** or **② Local Build**:

- **① All Docker**: Enter a Postgres password (or press Enter for random) → auto-writes `.env` → `docker compose up -d`.
- **② Local Build**: Choose database (connect existing / start via Docker) → generates `config.json` → `go` compiles embedded single binary → starts.

After installation, open **http://localhost:8787** (first visit goes to `/setup` to set admin password).

### Option 2: Docker Compose (Manual)

```bash
git clone https://github.com/sehoon123/ARTEX.git
cd ARTEX
cp .env.example .env          # Fill POSTGRES_PASSWORD, optional ANTHROPIC_API_KEY
docker compose up -d          # Pulls autumn27/artex image + postgres
# → http://localhost:8787
```

The image includes common tools (ripgrep/curl/vim/npm/nmap…); `./skills` and `./data` are bind-mounted for persistence.

Remote MCP can be configured in system settings as `http` (Streamable HTTP) or `sse` (legacy SSE).

---

## Internationalization (i18n)

ARTEX supports **English** and **Korean**. The language can be switched via the user menu in the sidebar. The system auto-detects browser language on first visit.

---

## License

[AGPL-3.0](LICENSE)
