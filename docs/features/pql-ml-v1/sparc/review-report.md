# Brutal Honesty Review: FR-10 PQL ML v1

**Feature ID:** FR-10
**Reviewer:** Brutal Honesty Review
**Date:** 2026-03-04
**Overall Verdict:** APPROVED with significant technical debt and one deferred integration risk

---

## 1. Architecture Compliance

### FF-02: No Cross-BC Imports — PASS

All imports in FR-10 files use `@pql/` or `@shared/` path aliases. Verified:
- `ml-model-service.ts`: imports `@pql/domain/value-objects/rule-set`, `@pql/domain/rule-engine`, `@pql/domain/value-objects/pql-score`, `@pql/infrastructure/repositories/ml-model-repository`
- `ml-training-service.ts`: imports `pg` only (no BC boundary crossing)
- `ml-routes.ts`: imports `@shared/middleware/tenant.middleware` (allowed shared import)
- `feedback-routes.ts`: imports `@shared/middleware/tenant.middleware` (allowed)

No violations found. The import graph is cleaner than FR-03 (which had a NotificationService cross-BC import that FR-10 correctly avoided).

---

### FF-03: Tenant RLS Isolation — PARTIAL PASS

**What is correctly done:**
- `pql.detection_feedback` has `ENABLE ROW LEVEL SECURITY` and the `tenant_isolation_feedback` policy per migration 007
- `PgMLModelRepository.findByTenantId()` uses `WHERE tenant_id = $1` — explicit tenant scope on the model load
- `MLTrainingService.collectTrainingData()` uses `WHERE d.tenant_id = $1` — correctly scoped

**Issue found — feedback-routes.ts does not verify the detection belongs to the tenant:**

```typescript
// feedback-routes.ts lines 29-43
const { tenantId, operatorId } = req as TenantRequest
const detectionId = req.params.id

const feedback = await trainingService.submitFeedback(
  detectionId,
  tenantId,
  operatorId,
  parsed.data.label as FeedbackLabel,
  parsed.data.comment,
)
```

The `submitFeedback` SQL is:
```sql
INSERT INTO pql.detection_feedback
  (detection_id, tenant_id, operator_id, label, comment)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (detection_id, operator_id)
DO UPDATE SET label = $4, comment = $5, updated_at = NOW()
```

There is no `WHERE EXISTS (SELECT 1 FROM pql.detections WHERE id = $1 AND tenant_id = $2)` check. An operator from Tenant A can submit feedback on any `detection_id` UUID, including one that belongs to Tenant B. The RLS policy on `pql.detection_feedback` only protects reads, not the INSERT here — because the INSERT hardcodes the `tenant_id` from the JWT, so the row lands in Tenant A's RLS partition. The data is not exposed to Tenant B, but an operator can write garbage feedback rows that reference a Tenant B detection UUID, creating orphaned cross-tenant feedback records that will corrupt Tenant A's training data.

**Severity:** MEDIUM. Not a data leak, but a data integrity violation that can degrade model quality.

**Fix:** Add a validation step in `submitFeedback` or the route handler to confirm the `detection_id` belongs to `tenantId` before inserting.

---

### FF-05: RuleEngine Coverage >= 95% — PASS (with caveat)

21 unit tests cover all service methods. The training logic, prediction, readiness threshold, accuracy metrics, and UNSURE exclusion are all explicitly tested. The integration test (train + predict) validates the end-to-end weight adjustment flow.

**Caveat:** The 95% coverage threshold is stated for the RuleEngine (`src/pql/rule-engine/**`). The tests here are in `ml-model-service.test.ts` and cover the MLModelService logic — not the rule engine itself. The rule engine tests live in `rule-engine.test.ts` and are unchanged. This is correct by design (FR-10 reuses the rule engine; it does not replace it). The coverage claim should be scoped appropriately: ML layer coverage is high, rule engine coverage is unchanged from FR-03.

---

### ADR-009: No LLM in v1 — PASS

Verified: no LLM imports anywhere in FR-10 files. The weight adjustment is arithmetic (`base_weight * (1 + adjustmentFactor)`). No TensorFlow, scikit-learn, or Cloud.ru AI Fabric calls. The feature header comment explicitly states "This is NOT a real ML model." Nomenclature could mislead external readers, but within the codebase context it is well-documented.

---

### ADR-007: JWT + RLS — PASS with caveat noted in FF-03 above

Tenant ID is always extracted from `TenantRequest` (JWT-derived), never from user input. Role checks are explicit strings compared against `role !== 'ADMIN'`. The approach is consistent with the rest of the codebase.

---

## 2. Code Quality Review

### Strengths

1. **Clean service boundaries.** `MLModelService` handles model inference and training. `MLTrainingService` handles data plumbing. The separation is clean and both are independently testable.

2. **Proper mock discipline in tests.** `createMockModelRepo()` returns a `jest.Mocked<MLModelRepository>` with type safety. No `as any` casts in the test suite.

3. **Explicit null semantics.** `predict()` returning `null` as the "model not ready" signal is semantically clear and forces the caller to handle the fallback. This is better than returning a zero-score MLPrediction that could be misinterpreted.

4. **Privacy-first training data.** `messageContent: ''` deliberately discards raw dialog content. Only signal metadata is stored. This is correct per SH-02.

5. **Conservative learning rate.** Learning rate 0.3 with clamping [0.2, 2.0] applied to the DEFAULT weight (not to previously adjusted weight) prevents runaway adjustments across training cycles. The compounding concern is correctly documented in Refinement.md.

---

### Issues Found

#### Issue 1: The "accuracy" metric is not accuracy (MEDIUM)

The `getModelMetrics` precision and recall calculations are formally incorrect:

```typescript
// ml-model-service.ts lines 187-194
const withSignals = labeled.filter((d) => d.signals.length > 0)
const correctWithSignals = withSignals.filter((d) => d.feedback === 'CORRECT')
const precision = withSignals.length > 0
  ? correctWithSignals.length / withSignals.length
  : 0

const recall = correct.length > 0
  ? correctWithSignals.length / correct.length
  : 0
```

This is operator agreement rate, not ML precision/recall. In binary classification terms:
- **Precision** should be: of all detections the model predicted as PQL, what fraction were actually PQL (i.e., had CORRECT feedback)?
- **Recall** should be: of all actual PQLs (CORRECT feedback), what fraction did the model detect with signals?

The current formula calculates "what fraction of detections with signals were labeled CORRECT" — which is only meaningful if you assume all detections have signals, which they do (COLD detections with no signals return null and are never persisted). In practice, `withSignals` will nearly always equal `labeled`, making precision == accuracy in this implementation.

More importantly, the `recall` calculation (`correctWithSignals / correct`) measures "of CORRECT-labeled detections, how many had signals." Since all stored detections have signals (zero-signal messages return null from the detector), this will nearly always be 1.0 — a meaningless metric.

The Refinement.md acknowledges this: "Accuracy metric is operator agreement, not predictive accuracy in the traditional ML sense." However, the metrics endpoint presents `precision` and `recall` as named fields without caveats in the API response. Operators or admins reading the API response will incorrectly interpret these as standard ML metrics.

**Severity:** MEDIUM. No functional bug, but misleading metrics could lead to bad decisions about when to trust the model.

**Fix:** Either rename the metrics to `operatorAgreementRate`, `signalCoverageRate`, and `feedbackCoverageRate`, or add a `note` field in the response explaining the non-standard definitions. Do not expose fields named `precision` and `recall` without ML semantics.

---

#### Issue 2: No validation that detectionId exists and belongs to tenant in submitFeedback (MEDIUM)

Detailed in FF-03 section above. An operator can submit feedback to a random UUID that belongs to another tenant's detection. The row is still inserted with the correct `tenant_id` (no data leak), but the foreign key constraint on `detection_id -> pql.detections(id)` will accept it if the UUID happens to match a detection from any tenant, polluting the training data with misattributed feedback.

**Fix:**
```typescript
// In submitFeedback or as a pre-check in the route:
const { rows } = await this.pool.query(
  `SELECT 1 FROM pql.detections WHERE id = $1 AND tenant_id = $2`,
  [detectionId, tenantId],
)
if (rows.length === 0) throw new Error('Detection not found')
```

---

#### Issue 3: `collectTrainingData` loads all data with no LIMIT — scalability time bomb (MEDIUM)

```typescript
// ml-training-service.ts lines 85-97
const { rows } = await this.pool.query(
  `SELECT d.id AS detection_id, d.score AS pql_score, d.signals, d.created_at, f.label AS feedback_label
   FROM pql.detections d
   LEFT JOIN pql.detection_feedback f ON f.detection_id = d.id
   WHERE d.tenant_id = $1
   ORDER BY d.created_at DESC`,
  [tenantId],
)
```

This is called by both `POST /api/pql/ml/train` and `GET /api/pql/ml/metrics`. With 100K detections, each with a JSONB `signals` array (~5KB per row), this is ~500MB loaded into Node.js heap on a single request. This will OOM the server.

The Refinement.md acknowledges this risk (EC-06) and says "consider adding LIMIT or pagination in future versions." However, calling this a v1 acceptable risk is problematic because:
1. `GET /api/pql/ml/metrics` is not admin-only — any operator can trigger it
2. It runs the full data load every time metrics are requested, with no caching
3. There is no rate limit specific to this endpoint

**Severity:** MEDIUM-HIGH for production at scale. Acceptable for early tenants (< 5K detections), but needs to be addressed before any tenant accumulates significant data.

**Minimum fix before production scale:** Add `LIMIT 10000` to the query and document the limitation. Medium-term: batch training with streaming cursor.

---

#### Issue 4: `getMetrics` duplicates heavy data load also done in `train` (LOW)

The route handler for `GET /api/pql/ml/metrics` runs `collectTrainingData()` which issues the full join query. The route for `POST /api/pql/ml/train` does the same. There is no caching. If an admin triggers train and then immediately checks metrics, two full scans of the detections table happen back-to-back. This is wasteful even at moderate scale.

**Fix:** Cache `collectTrainingData()` result in Redis for 60 seconds. The key is `pql:training-data:{tenantId}`. Invalidate on new feedback submission.

---

#### Issue 5: Error type narrowing missing in all route error handlers (LOW)

```typescript
// ml-routes.ts lines 38-41, 82-85, 110-113, 139-142
} catch (err) {
  console.error('[ml-routes] getStatus error', err)
  return res.status(500).json({ error: 'Internal server error' })
}
```

In TypeScript strict mode, `err` is typed as `unknown`. Logging `err` directly passes an `unknown` type to `console.error` which works at runtime but loses type safety. For errors with a `.message` property, the log output contains only `[object Object]` unless the logger knows how to serialize Error objects.

**Fix:** Use `err instanceof Error ? err.message : String(err)` for the log argument. This is a low-priority consistency fix that matches the pattern flagged in the FR-03 review.

---

#### Issue 6: `ml-routes.ts` instantiates services directly instead of dependency injection (LOW/INFO)

```typescript
// ml-routes.ts lines 17-21
export function createMLRouter(pool: Pool): Router {
  const router = Router()
  const trainingService = new MLTrainingService(pool)
  const modelRepo = new PgMLModelRepository(pool)
  const modelService = new MLModelService(modelRepo)
```

Services are constructed inside the factory function. This is consistent with the pattern in `feedback-routes.ts` and other existing routes (`pql-routes.ts`). However, it means services cannot be injected for testing without restructuring the router.

The test suite for `MLModelService` correctly mocks the repository, so unit tests are not affected. But if integration tests ever need to mock `MLTrainingService` in the context of a route test, this structure will require refactoring.

**Severity:** LOW/INFO — acceptable for current project scale. No immediate fix needed.

---

## 3. Security Review

| Check | Status | Notes |
|-------|--------|-------|
| No API keys in code | PASS | No external services in FR-10 |
| Parameterized queries | PASS | All queries use `$1, $2...` parameters |
| Input validation with Zod | PASS | FeedbackSchema validates label enum and comment length |
| Admin role check on sensitive endpoints | PASS | `/train` and `/export` check `role !== 'ADMIN'` |
| RLS on detection_feedback | PASS | Enabled in migration 007 |
| No PII in training data | PASS | messageContent is explicitly empty |
| Detection ownership not verified | FAIL | See Issue 2 — cross-tenant feedback insertion possible |
| Rate limiting on metrics endpoint | PARTIAL | SH-03 specifies 300 req/min on feedback; metrics endpoint has no documented rate limit |

**Unresolved security concern:** `GET /api/pql/ml/metrics` is available to any authenticated operator (not admin-only), and each call loads all training data. This can be used to DoS the server by rapidly calling the endpoint. The feedback route has a 300 req/min limit per SH-03, but the metrics endpoint is not mentioned in the security rules.

---

## 4. Testing Quality Review

### What is good

- 21 tests, all focused and readable
- Boundary condition testing is solid: `sampleCount: 999` (fails) and `sampleCount: 1000` (passes) explicitly tested
- UNSURE exclusion tested both in training (weight calculation) and metrics (accuracy denominator)
- The integration test (train + predict) validates that the full pipeline produces non-null results after training
- `createFeedbackData` helper prevents test boilerplate duplication

### What is missing

**No test for the accuracy >= 75% AC-11 with a model that was actually trained:**

The test `should achieve >= 75% accuracy with balanced feedback` (test #20) calls `getModelMetrics()` with pre-constructed feedback data but with `modelRepo.findByTenantId.mockResolvedValue(null)`. The model is null, so `ruleAdjustments` all show default weights. The test validates operator agreement rate (80%), but does not validate that a trained model actually achieves >= 75% on held-out feedback — because there is no held-out feedback in any test.

This is not a bug in the code, but the acceptance criterion AC-11 ("accuracy >= 75% with balanced feedback distribution") is only validated against a trivial scenario where the model contributes nothing to the accuracy calculation. The metric is purely the input feedback ratio, not a model evaluation metric.

**No test for the detection ownership validation gap (Issue 2).**

**No test for `collectTrainingData()` — the SQL-heavy method with no unit test.**

`MLTrainingService` has no test file at all. The entire data plumbing layer (`submitFeedback`, `collectTrainingData`, `exportTrainingSet`, `getTrainingStats`, `getFeedbackStats`) is not tested. These are PostgreSQL-dependent methods that require integration tests with a real or in-memory DB. Their absence means the feedback collection pipeline — the most critical input to the training system — has no automated validation.

**Severity of missing MLTrainingService tests:** HIGH. If the SQL in `collectTrainingData()` is wrong, the model trains on corrupted data. If `submitFeedback` upsert fails silently, operators think they are providing feedback but the model never learns.

---

## 5. Integration with PQL Detector Service — Deferred Risk

`PQLDetectorService` accepts `MLModelService` as an optional constructor argument:

```typescript
// pql-detector-service.ts lines 66-74
export class PQLDetectorService {
  private readonly mlModelService?: MLModelService

  constructor(
    private readonly detectionRepo: PQLDetectionRepository,
    private readonly dialogUpdater: DialogPQLUpdater,
    mlModelService?: MLModelService,
  ) {
    this.mlModelService = mlModelService
  }
```

The integration is structurally complete. However, there is no evidence in the codebase that `MLModelService` is actually injected anywhere — no `server.ts` or composition root passes the `MLModelService` to `PQLDetectorService`. Unless this wiring exists in an entry point not examined here, the ML model will never activate in production regardless of training.

**Severity:** HIGH if the wiring is missing. Medium if it exists in server bootstrapping.

**Action required:** Verify `server.ts` (or equivalent composition root) constructs and passes `MLModelService` to `PQLDetectorService`. If not wired, the feature is complete on paper but dead at runtime.

---

## 6. Summary Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architecture compliance | 8/10 | FF-02/FF-03/ADR-009 pass; cross-tenant feedback insertion gap |
| Code quality | 7/10 | Good separation; misleading precision/recall names; no-limit query |
| Test coverage | 6/10 | MLModelService: 21 tests, good; MLTrainingService: 0 tests |
| Security | 7/10 | Admin guards correct; metrics endpoint unprotected from DoS; detection ownership gap |
| Performance | 6/10 | Unbounded data load on every metrics call; no caching; no rate limit on metrics |
| Documentation | 9/10 | SPARC docs thorough; known risks documented; precision/recall caveat buried in Refinement.md |

**Overall: 43/60 (72%) — APPROVED with mandatory follow-up**

---

## 7. Issues Ranked by Severity

| # | Issue | Severity | Blocks Production? |
|---|-------|----------|--------------------|
| 1 | MLTrainingService has zero tests — entire feedback pipeline unvalidated | HIGH | Recommended block |
| 2 | MLModelService injection into PQLDetectorService not verified in composition root | HIGH | Yes if missing |
| 3 | Detection ownership not verified in submitFeedback — cross-tenant data corruption risk | MEDIUM | No — data integrity risk |
| 4 | `precision` and `recall` are not standard ML metrics — misleading API | MEDIUM | No — informational |
| 5 | `collectTrainingData()` has no LIMIT — OOM risk at 100K+ detections | MEDIUM-HIGH | No — time bomb |
| 6 | `GET /api/pql/ml/metrics` operator-accessible, no rate limit, triggers full table scan | MEDIUM | No — DoS risk |
| 7 | Error type narrowing missing in route handlers | LOW | No |
| 8 | Service instantiation inside router factory — harder to test routes | LOW/INFO | No |

---

## 8. Mandatory Actions Before Marking Production-Ready

1. **Write integration tests for `MLTrainingService`** using a test database or pg-mem. At minimum: `submitFeedback` upsert semantics, `collectTrainingData` returns correct feedback labels, `getTrainingStats` readiness calculation.

2. **Confirm `MLModelService` is injected into `PQLDetectorService` in `server.ts`.** If the wiring is absent, add it.

3. **Add detection ownership check in `submitFeedback`** — verify the detection belongs to the submitting tenant's scope before inserting feedback.

4. **Add `LIMIT` to `collectTrainingData` query** and document the cap in the API response. Minimum: `LIMIT 10000`.

5. **Rename `precision` and `recall` fields** in `ModelMetrics` or add explicit documentation in the API response that these are not standard ML metrics.

## 9. Recommended Actions (Not Blocking)

- Add rate limiting to `GET /api/pql/ml/metrics` (suggest 10 req/min per operator)
- Add Redis cache for training data summary (60-second TTL) to avoid repeated full table scans
- Error type narrowing in all catch blocks (`err instanceof Error ? err.message : String(err)`)
- Consider storing model history (keep last 3 versions) to enable rollback on degraded training
