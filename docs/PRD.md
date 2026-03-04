# PRD: КоммуниК v1.0 — Revenue Intelligence Platform
**Version:** 1.0 | **Date:** 2026-03-04 | **Status:** Draft

---

## 1. VISION & SCOPE

**Product Vision:** Превратить службу поддержки PLG/SaaS компаний из центра затрат в источник выручки через автоматическое обнаружение Product-Qualified Leads (PQL) в диалогах.

**MVP Scope:** Chat widget + PQL Detector + Memory AI (CRM context) + Revenue Intelligence Dashboard

**Out of Scope v1:** Email automation, Product Tours, Phone/video support

**Architecture Constraints:**
- Pattern: Distributed Monolith (Monorepo)
- Containers: Docker + Docker Compose
- Infrastructure: VPS (AdminVPS/HOSTKEY) — российский контур
- Deploy: Docker Compose direct deploy (SSH)
- AI Integration: Cloud.ru AI Fabric MCP Servers
- LLM: MiniMax M2.5 / GLM-5 MoE (on-premise via vLLM)

---

## 2. FUNCTIONAL REQUIREMENTS (MoSCoW)

### MUST HAVE — Core Revenue Intelligence

| ID | Требование | Acceptance Criteria |
|----|-----------|---------------------|
| FR-01 | **PQL Detector v1 (rule-based)** | 15+ сигналов (вопросы про тарифы/Enterprise/объём/команду/интеграции). Точность ≥65% на синтетике. Срабатывает в <2 сек |
| FR-02 | **PQL Flag в диалоге** | Оператор видит 🔥-метку + объяснение «Почему лид» в сайдбаре. Click-through в CRM-карточку |
| FR-03 | **Memory AI (CRM Context)** | До первого слова оператора — автоподгрузка из amoCRM: сделки, контакты, история. Через **amoCRM MCP** (Cloud.ru) |
| FR-04 | **Chat Widget** | JS-виджет для встройки на сайт/в продукт. Поддержка: web chat. Брендинг клиента |
| FR-05 | **Telegram канал** | Входящие через Telegram Business/Bot API. Единая очередь с web chat |
| FR-06 | **Revenue Intelligence Report** | Автоматический PDF/email ежемесячно: X лидов найдено, Y закрыто, ₽Z выручки атрибутировано |
| FR-07 | **Operator Workspace** | Unified inbox: очередь + сайдбар (Memory AI) + PQL-панель + быстрые ответы |
| FR-08 | **Базовая аналитика** | Dashboard: кол-во диалогов, PQL%, время ответа, конверсия PQL→deal |

### SHOULD HAVE — Retention & Growth

| ID | Требование | Acceptance Criteria |
|----|-----------|---------------------|
| FR-09 | **VK Max / Мессенджер Max** | Входящие через **Мессенджер Max MCP** (Cloud.ru). Российский корпоративный мессенджер |
| FR-10 | **PQL ML v1** | После 1K диалогов — дообучение на реальных данных. Точность ≥75% |
| FR-11 | **PQL Pulse Notifications** | Push/email оператору при каждом новом горячем лиде (real-time) |
| FR-12 | **amoCRM Auto-Update** | При закрытии PQL-сделки — автоматически атрибутировать в Revenue Report через amoCRM MCP |
| FR-13 | **Multi-operator** | До 10 операторов, роли: admin/operator, assignment queue |
| FR-14 | **Keyboard shortcuts** | Горячие клавиши для быстрых ответов, смены статуса, эскалации |

### COULD HAVE — Advanced

| ID | Требование | Acceptance Criteria |
|----|-----------|---------------------|
| FR-15 | **Confluence KB integration** | Через **Confluence MCP** (Cloud.ru) — база знаний для авто-саджестов операторам |
| FR-16 | **AI Auto-Reply draft** | Черновик ответа на основе **Evolution Managed RAG MCP** + history |
| FR-17 | **Grafana Monitoring** | Через **Grafana MCP** (Cloud.ru) — health dashboard для enterprise-клиентов |
| FR-18 | **Bitrix24 sync** | CRM-интеграция для клиентов на Bitrix24 (альтернатива amoCRM MCP) |

### WON'T HAVE v1

| ID | Что НЕ делаем | Почему |
|----|--------------|--------|
| FR-X1 | Email marketing automation | Scope creep, отдельный продукт |
| FR-X2 | Voice/video support | Сложность + нишевый запрос |
| FR-X3 | White-label reselling | Слишком рано |

---

## 3. NON-FUNCTIONAL REQUIREMENTS

| ID | Требование | Target | Метод проверки |
|----|-----------|:------:|---------------|
| NFR-01 | **Latency: PQL detection** | <2 сек от сообщения до флага | Load test: 100 concurrent dialogs |
| NFR-02 | **Uptime** | ≥99.5% monthly | Grafana MCP uptime monitor |
| NFR-03 | **Message delivery** | <500ms p95 для operator workspace | Websocket latency test |
| NFR-04 | **Data residency** | 100% данные на российских VPS | Аудит конфигурации |
| NFR-05 | **152-ФЗ compliance** | Персональные данные хранятся зашифрованно | Security audit + шифрование at rest |
| NFR-06 | **Scalability** | До 1,000 одновременных диалогов на старте | Horizontal scaling Docker |
| NFR-07 | **PQL Accuracy** | ≥65% precision rule-based v1, ≥75% ML v1 | Offline eval на test set |
| NFR-08 | **MCP Reliability** | amoCRM MCP failover <30 сек | Circuit breaker pattern |

---

## 4. USER STORIES

### Epic 1: PQL Revenue Intelligence

```
US-01 [MUST] Как оператор поддержки, я хочу видеть 🔥 метку на диалоге
      когда клиент демонстрирует признаки покупки,
      чтобы немедленно передать лид в продажи без ручного анализа.
      Acceptance: PQL флаг появляется <2 сек после триггерного сообщения.

US-02 [MUST] Как head of sales, я хочу получать ежемесячный отчёт
      «сколько сделок принесла поддержка»,
      чтобы показать ROI от поддержки руководству.
      Acceptance: PDF/email автоматически 1-го числа каждого месяца.

US-03 [MUST] Как оператор, я хочу видеть полную историю клиента из amoCRM
      до первого ответа (тариф, открытые сделки, предыдущие обращения),
      чтобы не задавать повторных вопросов.
      Acceptance: CRM-панель загружается <1 сек через amoCRM MCP.
```

### Epic 2: Operator Workspace

```
US-04 [MUST] Как оператор, я хочу видеть все каналы (web chat + Telegram + VK Max)
      в единой очереди,
      чтобы не переключаться между вкладками.
      Acceptance: Unified inbox с сортировкой по приоритету (PQL first).

US-05 [SHOULD] Как оператор, я хочу получать push-уведомление
      когда система обнаружила горячего лида в моём диалоге,
      чтобы успеть среагировать пока клиент онлайн.
      Acceptance: PQL Pulse <30 сек от триггера до push.
```

### Epic 3: Admin & Analytics

```
US-06 [MUST] Как SaaS CEO, я хочу видеть dashboard:
      «PQL за период / конверсия / выручка из поддержки»,
      чтобы принимать решения об инвестициях в поддержку.
      Acceptance: Dashboard загружается <3 сек, данные real-time.

US-07 [SHOULD] Как admin, я хочу настраивать PQL-сигналы
      (добавлять/удалять ключевые фразы),
      чтобы адаптировать детектор под специфику нашего продукта.
      Acceptance: UI для управления rule set, изменения применяются <1 мин.
```

---

## 5. USER JOURNEYS

### Journey 1: Первый PQL — «Aha Moment»

```
Trigger: Клиент пишет в чат «А у вас есть Enterprise-тариф для 50 пользователей?»
    ↓
[PQL Detector] анализирует сообщение → совпадение с сигналами «Enterprise», «пользователи», «тариф»
    ↓
[Memory AI] подгружает из amoCRM MCP: клиент на Free, 90 дней активен, нет открытых сделок → HIGH VALUE
    ↓
[Operator Workspace] показывает 🔥 ГОРЯЧИЙ ЛИД + сайдбар:
«Спрашивает про Enterprise, активен 90 дней»
    ↓
Оператор отвечает → в сайдбаре кнопка «Создать сделку в amoCRM»
    ↓
amoCRM MCP → создаёт сделку «Enterprise inquiry» → Sales получает задачу
    ↓
Revenue Intelligence Report: +1 PQL атрибутирован поддержке
```

### Journey 2: Revenue Report — Retention Hook

```
1-е число месяца → автотриггер
    ↓
[Report Engine] агрегирует: диалогов 847, PQL найдено 23, передано 19, закрыто 7
    ↓
amoCRM MCP → verifies closed deals из «КоммуниК PQL» источника
    ↓
PDF: «Поддержка принесла ₽2,100,000 выручки в январе»
    ↓
Email CEO + Head of Support → видит ROI → не отпишется
```

---

## 6. MCP INTEGRATIONS (Cloud.ru AI Fabric)

| MCP Server | Cloud.ru Stars | Use Case | Priority |
|------------|:--------------:|----------|:--------:|
| **amoCRM MCP** | 38★ | Memory AI + Deal creation + Revenue attribution | MUST |
| **Мессенджер Max MCP** | 23★ | VK Max channel inbox | SHOULD |
| **Postgres MCP** | 7★ (133 uses) | AI-agent analytics access | SHOULD |
| **Evolution RAG MCP** | 1★ (49 uses) | PQL KB + auto-reply drafts | COULD |
| **Grafana MCP** | 8★ (85 uses) | Enterprise health monitoring | COULD |
| **Confluence MCP** | 11★ (146 uses) | Operator KB suggestions | COULD |

---

## 7. CONSTRAINTS & ASSUMPTIONS

### Constraints
- Инфраструктура: только российские VPS (152-ФЗ, data residency)
- MCP-интеграции: использовать готовые Cloud.ru AI Fabric шаблоны
- LLM: on-premise (не OpenAI/Anthropic API для production data)
- Team: 2 фаундера + 1 senior dev + Claude Code

### Assumptions
- amoCRM MCP поддерживает webhook на closed-won события
- Мессенджер Max MCP поддерживает входящие сообщения
- Evolution Managed RAG MCP совместим с кастомным KB
- Postgres MCP используется как managed analytics layer

---

## 8. SUCCESS METRICS

| Метрика | M3 Target | M6 Target | M12 Target |
|---------|:---------:|:---------:|:----------:|
| PQL Detection Accuracy | ≥65% | ≥72% | ≥80% |
| Trial→Paid Conversion | 8% | 12% | 18% |
| D7 Retention | 50% | 60% | 65% |
| Paying Clients | 10 | 72 | 210 |
| MRR | ₽65K | ₽468K | ₽1,365K |
| NPS | >30 | >40 | >50 |
