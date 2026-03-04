---
name: project-context
description: >
  КоммуниК domain knowledge and project context.
  Revenue Intelligence Platform for PLG/SaaS companies.
  Provides domain glossary, bounded context map, key decisions.
version: "1.0"
maturity: production
---

# Project Context: КоммуниК

## What is КоммуниК?
Revenue Intelligence Platform that turns support into a revenue center.
Automatically detects Product-Qualified Leads (PQL) in support dialogs
and attributes revenue back to support team.

## Core Value Proposition
1. **PQL Detection** — rule-based signals in chat messages (v1), ML (v2), LLM (v3)
2. **Memory AI** — auto-load CRM context from amoCRM before operator responds
3. **Revenue Attribution** — link PQL flags to closed CRM deals, monthly reports
4. **Russian Infrastructure** — 152-ФЗ compliant, on-premise LLM

## Bounded Contexts
- BC-01 Conversation: message intake, channels (web/Telegram/VK Max), WebSocket
- BC-02 PQL Intelligence ⭐: PQL detection, Memory AI, ML pipeline
- BC-03 Revenue ⭐: attribution, Revenue Report PDF, dashboard
- BC-04 Integration: MCP adapters (amoCRM, Max, Grafana, RAG, Postgres)
- BC-05 Identity & Access: multi-tenancy, JWT, RLS
- BC-06 Notifications: PQL Pulse, email, push

## Primary Event Flow
```
Client message → MessageReceived (Redis Stream) → PQLDetector
  → [amoCRM MCP context + Rule matching] → PQLDetected
  → [WS push to operator + Revenue Attribution + PQL Pulse notification]
```

## MCP Integrations (Cloud.ru AI Fabric)
- amoCRM MCP (38★) — CRM context, deal creation
- Мессенджер Max MCP (23★) — VK Max channel
- Postgres MCP (7★) — AI analytics
- Grafana MCP (8★) — monitoring
- Evolution RAG MCP — knowledge base

## Key Documents
All in `docs/`: PRD.md, bounded-contexts.md, tactical-design.md,
pseudocode.md, C4-diagrams.md, ADR.md, refinement.md,
test-scenarios.feature, fitness-functions.md, ai-context.md
