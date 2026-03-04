# FR-06: Revenue Intelligence Report -- Refinement

**Feature ID:** FR-06
**Bounded Context:** BC-03 Revenue

---

## 1. Edge Cases

### EC-01: Empty Period (No Detections, No Deals)

**Scenario:** Report is generated for a period with zero activity.
**Handling:** Report is still created with GENERATED status. Summary shows all zeros. HTML renders "No revenue attributions for this period" placeholder.
**Test:** `should handle empty period with no detections` -- verified all summary fields are 0.

### EC-02: Detections Without Matching Deals

**Scenario:** PQL detections exist but no WON deals in the period.
**Handling:** Attributions array is empty. Summary shows pqlDetected > 0 but pqlConvertedToDeals = 0, totalRevenue = 0.
**Test:** `should handle detections with no matching deals`.

### EC-03: COLD Tier Exclusion

**Scenario:** Only COLD-tier PQL detections exist for the period.
**Handling:** COLD detections are filtered out before attribution matching. Even with available deals, no attributions are created.
**Test:** `should not attribute COLD tier detections to deals`.

### EC-04: Idempotent Re-generation

**Scenario:** `generateReportForTenant` is called twice for the same tenant+period.
**Handling:** Second call finds existing GENERATED report and returns it immediately without re-computation.
**Test:** `should not regenerate an existing GENERATED report (idempotency)`.

### EC-05: DRAFT Report Recovery

**Scenario:** Previous generation failed mid-way, leaving a DRAFT report.
**Handling:** DRAFT status triggers full re-generation using the existing report ID (update instead of insert).
**Test:** `should re-generate a DRAFT report that was left incomplete`.

### EC-06: Attribution Beyond 90-Day Window

**Scenario:** PQL detection was 91+ days before deal closure.
**Handling:** `calculateAttributionConfidence` returns 0 for timeToClose > 90 days. The attribution record is still created but with zero confidence, effectively flagging it as unreliable.

### EC-07: Missing Tenant for Email

**Scenario:** `sendReport` called but tenant record not found.
**Handling:** Throws explicit error: "Tenant {id} not found".

### EC-08: Send DRAFT Report Attempt

**Scenario:** Operator tries to send a report that has not been generated yet.
**Handling:** Throws error: "Report {id} is not yet generated (status: DRAFT)".
**Test:** `should throw if report is still DRAFT`.

### EC-09: Puppeteer Unavailable for PDF

**Scenario:** PDF download requested but Puppeteer is not installed.
**Handling:** Graceful fallback to serving raw HTML with `Content-Type: text/html; charset=utf-8`.

### EC-10: Batch Generation Partial Failure

**Scenario:** One of N tenants fails during monthly batch generation.
**Handling:** Error is captured in the errors array. Remaining tenants continue processing. Return value includes both generated count and error details.
**Test:** `should collect errors without stopping other tenants`.

### EC-11: Unassigned Operator in Attribution

**Scenario:** Dialog has no assigned operator (operator_id is NULL).
**Handling:** operatorId defaults to 'unassigned' in summary grouping. Attribution record stores NULL.

## 2. Performance Considerations

| Concern | Mitigation |
|---------|------------|
| Large JSONB in reports table | Attributions/summary stored as JSONB; htmlContent stripped from list responses |
| Batch generation for many tenants | Sequential processing with error isolation (parallelization planned for v2) |
| Analytics dashboard queries | All 8 metrics fetched via `Promise.all` in parallel |
| HTML report size | Inline styles (no external CSS); reasonable with typical attribution counts |
| PDF generation | On-demand via Puppeteer (not pre-generated); fallback to HTML if unavailable |

## 3. Technical Debt

| ID | Debt | Impact | Planned Resolution |
|----|------|--------|-------------------|
| TD-01 | MockCRMDealReader instead of real amoCRM adapter | Reports use deterministic mock data | Replace with AmoCRM MCP adapter when CRM integration is live |
| TD-02 | Round-robin attribution matching | Inaccurate deal-to-detection mapping | v2: Match via contact email linkage between PQL detection and CRM contact |
| TD-03 | Sequential batch generation | Slow for large tenant counts | Parallelize with configurable concurrency limit |
| TD-04 | USD-only currency formatting | Incorrect for Russian market | Add RUB formatting with locale support |
| TD-05 | No cron scheduler | generateMonthlyReports must be called manually | Add node-cron or external scheduler |
| TD-06 | StubEmailService | Emails are not actually sent | Integrate with Resend API (metadata only per SH-02) |
| TD-07 | No pagination in attribution table | HTML report could be very large with many attributions | Add pagination or top-N limit |

## 4. Security Refinement

| Area | Current State | Risk | Mitigation |
|------|--------------|------|------------|
| RLS on revenue.reports | Enabled | Medium: JSONB could leak cross-tenant data if RLS misconfigured | Integration test verifying tenant A cannot see tenant B reports |
| HTML content injection | tenantName, operatorId rendered in HTML | Low: values come from DB, not user input | Sanitize before HTML rendering in v2 |
| PDF generation | Puppeteer with --no-sandbox | Low: only processes trusted HTML from our own generator | Run in isolated container |
| Email delivery | StubEmailService (no-op) | None (v1) | Resend API for metadata only; never send raw PII |

## 5. Scalability Notes

- **Current capacity:** Suitable for up to ~100 tenants with ~1000 detections per period.
- **Bottleneck:** Sequential tenant processing in batch generation.
- **Scale strategy:** Parallelize batch processing with `Promise.allSettled` and concurrency limiter (e.g., p-limit). Partition by tenant group if needed.
- **Storage growth:** ~50KB per report (HTML + JSONB). At 100 tenants * 12 months = ~60MB/year.
