# PRD: FR-01 PQL Detector v1 (Rule-Based)

**Feature ID:** FR-01
**Bounded Context:** BC-02 PQL Intelligence
**Priority:** MUST HAVE (MVP)
**Status:** Implemented
**Version:** 1.0 | **Date:** 2026-03-04

---

## 1. Problem Statement

PLG/SaaS support teams interact daily with clients who exhibit clear purchase intent — asking about pricing, requesting demos, mentioning budget, comparing with competitors. These signals are lost because operators manually process hundreds of messages and cannot reliably identify purchase-qualified leads (PQL) in real time.

КоммуниК turns this problem into a revenue opportunity by automatically detecting PQL signals in every incoming client message, enabling operators to immediately escalate high-intent conversations to sales.

---

## 2. Feature Scope

**FR-01** implements the foundational PQL detection pipeline using pure rule-based pattern matching (no LLM, per ADR-009). It is the prerequisite for:

- FR-02 PQL Flag in Operator Workspace
- FR-10 PQL ML v1 (upgrade path after 1,000 labeled dialogs)
- FR-11 PQL Pulse Notifications
- FR-06 Revenue Intelligence Report

---

## 3. Functional Requirements

| ID | Requirement | Acceptance Criteria |
|----|-------------|---------------------|
| FR-01.1 | Detect 15+ PQL signal patterns in incoming client messages | 15 rules shipped (R01–R15), each with regex, weight, and type |
| FR-01.2 | Normalize score to 0.0–1.0 range | Score = min(sum_weights / MAX_POSSIBLE_WEIGHT, 1.0) |
| FR-01.3 | Classify messages into tiers: HOT / WARM / COLD | HOT >= 0.80, WARM >= 0.65, COLD < 0.65 |
| FR-01.4 | Only analyze CLIENT messages | OPERATOR and BOT messages are skipped |
| FR-01.5 | Return top-3 signals per detection | Sorted by weight descending |
| FR-01.6 | Support Cyrillic and Latin in all patterns | Case-insensitive, bilingual regex patterns |
| FR-01.7 | Persist detection record with signals JSON | Stored in pql.detections table (PostgreSQL) |
| FR-01.8 | Update dialog's pqlScore/pqlTier on detection | Via DialogPQLUpdater interface |
| FR-01.9 | Return null when no signals detected | No persistence for zero-signal messages |
| FR-01.10 | Handle long messages (>2000 chars) | Truncate to first 2,000 characters before analysis |
| FR-01.11 | Strip emoji before analysis | Unicode emoji range stripped via regex |
| FR-01.12 | Expose REST API for detection history | GET /api/pql/detections and GET /api/pql/detections/:dialogId |

---

## 4. Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-01 | PQL detection latency | < 2,000 ms end-to-end (FF-01) |
| NFR-02 | RuleEngine internal latency | < 50 ms per analysis |
| NFR-03 | PQL precision on synthetic test set | >= 65% (NFR-07 from PRD) |
| NFR-04 | RuleEngine test coverage | >= 95% (FF-05) |
| NFR-05 | Tenant data isolation | 100% RLS enforcement (FF-03) |
| NFR-06 | No LLM calls | Pure rule-based only in v1 (ADR-009) |

---

## 5. User Stories

```
US-01 [MUST] As a support operator, I want to see a HOT/WARM label on a dialog
      when the client asks about pricing, enterprise plans, or signing a contract,
      so that I can immediately escalate this conversation to sales.
      Acceptance: PQL flag appears < 2 seconds after the client message is received.

US-04 [MUST] As a product engineer, I want PQL detection to run automatically
      on every incoming client message without blocking the chat response,
      so that detection latency never degrades the chat experience.
      Acceptance: PQL analysis runs async (fire-and-forget via Socket.io event).

US-05 [MUST] As a data engineer, I want every PQL detection persisted to the database
      with full signal metadata,
      so that it can feed revenue attribution and ML training pipelines.
      Acceptance: pql.detections row created with signals[], score, tier, message_id.
```

---

## 6. Signal Catalog (15 Default Rules)

| Rule ID | Pattern (Cyrillic + Latin) | Weight | Signal Type |
|---------|---------------------------|--------|-------------|
| R01 | тариф / pricing / стоимость | 0.40 | PRICING |
| R02 | enterprise / корпоратив | 0.50 | ENTERPRISE |
| R03 | команда / пользователей / seats | 0.35 | SCALE |
| R04 | интеграц / api / webhook | 0.30 | TECHNICAL |
| R05 | демо / показать / посмотреть | 0.45 | DEMO |
| R06 | договор / счёт / оплат | 0.60 | PURCHASE |
| R07 | руководитель / директор / ceo / cto | 0.40 | DECISION_MAKER |
| R08 | сравни / vs / альтернатив | 0.35 | EVALUATION |
| R09 | внедрен / migrate / перейти | 0.45 | MIGRATION |
| R10 | sla / uptime / гарантия | 0.30 | RELIABILITY |
| R11 | безопасност / 152-фз / gdpr | 0.30 | COMPLIANCE |
| R12 | пилот / тест / попробова | 0.40 | TRIAL |
| R13 | бюджет / квартал / план | 0.45 | BUDGET |
| R14 | партнёр / реселл / агент | 0.35 | PARTNERSHIP |
| R15 | обучен / onboard / внедр | 0.30 | ONBOARDING |

**MAX_POSSIBLE_WEIGHT** = sum of top-5 weights = 0.60 + 0.50 + 0.45 + 0.45 + 0.45 = **2.25**

---

## 7. Acceptance Criteria (Testable)

- [ ] A message "Хотим оформить договор на enterprise тариф" produces tier=HOT (score >= 0.80)
- [ ] A message "ENTERPRISE ТАРИФ" (all caps) is detected (case-insensitive)
- [ ] A message with emoji "🔥 Нужен Enterprise тариф! 🚀" detects ENTERPRISE signal
- [ ] A 5,000-character message is processed without error (truncated at 2,000)
- [ ] An OPERATOR-sent message returns null (no detection)
- [ ] A message "Спасибо, всё понятно" returns null (no signals, no persistence)
- [ ] pql.detections row is inserted for every non-null detection
- [ ] GET /api/pql/detections/:dialogId returns detections for that dialog only
- [ ] GET /api/pql/detections respects tenant isolation (RLS)

---

## 8. Out of Scope (v1)

- LLM-based scoring (scheduled for v3 after 10K dialogs + GPU, ADR-009)
- ML-based scoring (FR-10, after 1K labeled dialogs)
- Per-tenant custom rule weights (v2)
- Context boost via CRM data (PS-01 describes this as part of full PS-01 pipeline; current v1 uses rule-only score)
- Feedback recording to ML training set (FR-10, separate endpoint)
