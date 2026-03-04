# КоммуниК — Revenue Intelligence Platform

> Превращаем поддержку PLG/SaaS компаний из центра затрат в источник выручки.

## What is КоммуниК?

КоммуниК автоматически обнаруживает горячих лидов (Product-Qualified Leads) в диалогах поддержки и атрибутирует выручку команде саппорта.

### Core Features (MVP)
- **PQL Detection** — 15+ rule-based сигналов в чат-сообщениях
- **Memory AI** — автозагрузка CRM-контекста из amoCRM через MCP
- **Revenue Report** — ежемесячный PDF: "поддержка принесла ₽X выручки"
- **Unified Inbox** — web chat + Telegram + VK Max в одном окне
- **PQL Pulse** — real-time push-уведомления о горячих лидах

### Differentiators (vs Intercom/Zendesk)
- PQL Detection (нет у конкурентов в RU)
- Revenue Intelligence Report
- 100% российская инфраструктура (152-ФЗ)
- Цена: ₽5K–35K/мес vs $139–899/мес

## Tech Stack

```
Frontend:  Next.js 14 + Tailwind + shadcn/ui
Backend:   Node.js + Express + Socket.io
Database:  PostgreSQL 16 (RLS) + Redis 7 (Streams)
AI:        Rule-based v1 → ML v2 → GLM-5/vLLM v3
MCP:       Cloud.ru AI Fabric (amoCRM, Max, Postgres, Grafana, RAG)
Deploy:    Docker Compose → VPS HOSTKEY
```

## Quick Start

```bash
npm install
docker compose up -d
npm run dev
```

## Documentation

See `docs/` for full SPARC documentation:
- [PRD](docs/PRD.md) — requirements and user stories
- [Architecture](docs/C4-diagrams.md) — C4 diagrams
- [Domain Model](docs/bounded-contexts.md) — DDD strategic design
- [Algorithms](docs/pseudocode.md) — pseudocode for core algorithms
- [Tests](docs/test-scenarios.feature) — BDD scenarios

## Development

See [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) for detailed instructions.

## License

Proprietary. All rights reserved.
