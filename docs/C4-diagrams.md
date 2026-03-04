# C4 Architecture Diagrams: КоммуниК
**Version:** 1.0 | **Date:** 2026-03-04

---

## C4 Level 1: System Context

```mermaid
graph TB
    Operator["👤 Оператор поддержки<br/>(использует Workspace)"]
    CEO["👤 SaaS CEO<br/>(читает Revenue Report)"]
    Client["👤 Клиент SaaS<br/>(пишет в поддержку)"]

    KQ["🏢 КоммуниК<br/>Revenue Intelligence Platform<br/>(Next.js + Node.js + PostgreSQL)"]

    AmoCRM["🔗 amoCRM<br/>(CRM система клиента)"]
    Telegram["💬 Telegram<br/>(канал сообщений)"]
    VKMax["💬 Мессенджер Max<br/>(VK корп. мессенджер)"]
    Resend["📧 Resend<br/>(email delivery)"]
    CloudMCP["☁️ Cloud.ru AI Fabric<br/>(MCP Servers)"]

    Client -->|"пишет сообщение"| Telegram
    Client -->|"пишет сообщение"| VKMax
    Client -->|"web chat widget (JS embed)"| KQ
    Telegram -->|"Telegram Bot API"| KQ
    VKMax -->|"через Мессенджер Max MCP"| CloudMCP
    CloudMCP -->|"нормализованные события"| KQ
    KQ -->|"читает/обновляет контакты и сделки"| AmoCRM
    AmoCRM -->|"через amoCRM MCP"| CloudMCP
    KQ -->|"показывает диалоги + PQL флаги"| Operator
    KQ -->|"отправляет Revenue Report PDF"| CEO
    KQ -->|"email delivery (Revenue Report)"| Resend
```

---

## C4 Level 2: Container Diagram

```mermaid
graph TB
    subgraph KQ["КоммуниК System (VPS HOSTKEY)"]
        WEB["📱 Next.js 14 App<br/>Operator WS + Admin Dashboard<br/>Server + Client Components<br/>:3000"]
        API["⚙️ Node.js API Server<br/>Express + Socket.io<br/>REST endpoints + WS namespace<br/>:4000"]
        PQL["🧠 PQL Engine Module<br/>Rule-based v1 → ML v2 → LLM v3<br/>(embedded в API, async)"]
        WORKER["⏰ Worker Service<br/>Revenue Report cron (1st of month)<br/>PDF generation via Puppeteer"]
        MCP_LAYER["🔌 MCP Client Layer<br/>ACL Adapters + Circuit Breakers<br/>(opossum)"]
        WIDGET["📦 Chat Widget<br/>Vanilla JS embed<br/>(~20KB gzip)"]
    end

    subgraph GPU["GPU Node (optional from M4+)"]
        VLLM["🤖 vLLM Server<br/>GLM-5 / MiniMax M2.5 MoE<br/>+ Mistral Small validator<br/>:8000"]
    end

    subgraph DATA["Data Layer (same VPS)"]
        PG[("🗄️ PostgreSQL 16<br/>schemas: conversations,<br/>pql, revenue, iam,<br/>notifications")]
        REDIS[("⚡ Redis 7<br/>Streams (events)<br/>Sessions + Socket adapter")]
    end

    subgraph MCP["Cloud.ru AI Fabric MCP Servers"]
        AMCP["amoCRM MCP<br/>(38★)"]
        MMCP["Мессенджер Max MCP<br/>(23★)"]
        PGMCP["Postgres MCP<br/>(7★, 133 uses)"]
        GMCP["Grafana MCP<br/>(8★, 85 uses)"]
        RMCP["Evolution RAG MCP<br/>(1★, 49 uses)"]
    end

    WEB -->|"REST API calls"| API
    WEB -->|"Socket.io WS"| API
    WIDGET -->|"REST + WS"| API
    API -->|"publish events"| REDIS
    API -->|"read/write"| PG
    API --> MCP_LAYER
    PQL -->|"subscribe MessageReceived"| REDIS
    PQL -->|"publish PQLDetected"| REDIS
    PQL -->|"write detections"| PG
    PQL -->|"inference (v3)"| VLLM
    PQL --> MCP_LAYER
    WORKER -->|"read revenue data"| PG
    WORKER --> MCP_LAYER
    MCP_LAYER -->|"HTTP/SSE MCP protocol"| AMCP
    MCP_LAYER -->|"HTTP/SSE MCP protocol"| MMCP
    MCP_LAYER -->|"HTTP/SSE MCP protocol"| PGMCP
    MCP_LAYER -->|"HTTP/SSE MCP protocol"| GMCP
    MCP_LAYER -->|"HTTP/SSE MCP protocol"| RMCP
```

---

## C4 Level 3: Component — PQL Intelligence BC

```mermaid
graph TB
    subgraph PQL_BC["BC-02: PQL Intelligence Context"]
        DETECTOR["🔍 PQLDetectorService<br/>(оркестратор — координирует<br/>Rules + ML + Memory)"]
        RULES["📋 RuleEngine<br/>15+ rule-based сигналов<br/>(regex + keyword matching)"]
        SCORER["📊 PQLScorer<br/>confidence calculation<br/>weighted sum → tier (HOT/WARM/COLD)"]
        ML["🤖 MLPredictor<br/>v2: BERT/E5 fine-tune<br/>v3: GLM-5 via vLLM"]
        MEM["🧠 MemoryAIService<br/>CRM context assembler<br/>(contact + deals + history)"]
        REPO["💾 PQLRepository<br/>PostgreSQL: pql schema<br/>(detections + training data)"]
        FEEDBACK["🔄 FeedbackCollector<br/>Operator corrections →<br/>ML training data"]
    end

    EVT_IN["📨 Redis Stream<br/>MessageReceived"]
    EVT_OUT["📤 Redis Stream<br/>PQLDetected"]
    WS_PUSH["🔔 Socket.io<br/>WS push to operator"]
    CRM_PORT["🔌 CRMPort interface<br/>(AmoCRM ACL Adapter)"]
    RAG_PORT["🔌 RAGPort interface<br/>(Evolution RAG ACL)"]
    VLLM_SVC["🤖 vLLM Service<br/>GLM-5 inference"]

    EVT_IN -->|"consume event"| DETECTOR
    DETECTOR -->|"analyze rules"| RULES
    DETECTOR -->|"predict (v2+)"| ML
    RULES -->|"signal weights"| SCORER
    ML -->|"ml score"| SCORER
    DETECTOR -->|"fetch context"| MEM
    MEM -->|"getContactContext()"| CRM_PORT
    MEM -->|"searchKB()"| RAG_PORT
    ML -->|"inference request"| VLLM_SVC
    SCORER -->|"score > threshold"| EVT_OUT
    EVT_OUT -->|"broadcast"| WS_PUSH
    DETECTOR -->|"save detection"| REPO
    FEEDBACK -->|"save label"| REPO
```

---

## C4 Level 3: Component — Integration Context (MCP Layer)

```mermaid
graph LR
    subgraph INT_BC["BC-04: Integration Context (MCP Layer)"]
        AMOCRM_ACL["AmoCRM MCP Adapter<br/>implements CRMPort<br/>+ Circuit Breaker"]
        MAX_ACL["MessengerMax MCP Adapter<br/>implements ChannelPort<br/>+ Circuit Breaker"]
        RAG_ACL["EvolutionRAG MCP Adapter<br/>implements RAGPort<br/>+ Circuit Breaker"]
        GRAFANA_ACL["Grafana MCP Adapter<br/>implements MonitoringPort<br/>+ Circuit Breaker"]
        WEBHOOK["Webhook Handler<br/>amoCRM deal.closed →<br/>RevenueAttributed event"]
    end

    DOMAIN_PORTS["Domain Ports<br/>(CRMPort, ChannelPort,<br/>RAGPort, MonitoringPort)"]
    CLOUD_MCP["Cloud.ru AI Fabric<br/>MCP Servers"]
    REDIS_OUT["Redis Streams<br/>ChannelMessageReceived<br/>RevenueAttributed"]

    DOMAIN_PORTS -->|"calls"| AMOCRM_ACL
    DOMAIN_PORTS -->|"calls"| MAX_ACL
    DOMAIN_PORTS -->|"calls"| RAG_ACL
    DOMAIN_PORTS -->|"calls"| GRAFANA_ACL
    AMOCRM_ACL -->|"MCP protocol"| CLOUD_MCP
    MAX_ACL -->|"MCP protocol"| CLOUD_MCP
    RAG_ACL -->|"MCP protocol"| CLOUD_MCP
    GRAFANA_ACL -->|"MCP protocol"| CLOUD_MCP
    WEBHOOK -->|"publish events"| REDIS_OUT
```

---

## Deployment Diagram (Docker Compose на VPS)

```
VPS HOSTKEY (минимум 8GB RAM, 4 vCPU)
├── docker-compose.yml
│   ├── app (Next.js 14 + Node.js API)    port 3000, 4000
│   │   └── embeds: PQL Engine + MCP Layer + Worker
│   ├── postgres (PostgreSQL 16)           port 5432 (internal)
│   ├── redis (Redis 7)                    port 6379 (internal)
│   └── nginx (reverse proxy + SSL)        port 80, 443
│
├── Volumes:
│   ├── postgres_data
│   ├── redis_data
│   └── uploads (chat attachments)
│
└── Networks:
    ├── internal (app ↔ postgres ↔ redis)
    └── external (nginx → internet)

GPU Node (опционально с M4+, VPS HOSTKEY GPU)
└── docker-compose.gpu.yml
    └── vllm (GLM-5 + Mistral Small)       port 8000 (internal VPN)
```
