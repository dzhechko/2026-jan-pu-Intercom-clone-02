# IAM-01: Pseudocode — Auth Flow, RLS Setup, Middleware Chain

**Feature ID:** IAM-01
**BC:** BC-05 Identity & Access
**Date:** 2026-03-04

---

## Algorithm 1: Tenant Registration (Atomic)

```
FUNCTION register(input):
  // Phase 1: Input validation
  parsed = RegisterSchema.safeParse(input)
  IF parsed.failed:
    RETURN err("Validation: " + parsed.issues.join("; "))

  { tenantName, email, password, name } = parsed.data

  // Phase 2: Acquire transaction connection
  client = pool.connect()

  TRY:
    client.query("BEGIN")

    // Phase 3: Create Tenant
    tenant = INSERT INTO iam.tenants(name, billing_email, settings)
             VALUES (tenantName, email, DEFAULT_SETTINGS)
             RETURNING *
    IF insert_failed:
      THROW tenant_error

    // Phase 4: Hash password
    // bcrypt cost=12 → ~200ms on modern CPU (acceptable for registration)
    passwordHash = bcrypt.hash(password, rounds=12)

    // Phase 5: Create first ADMIN operator
    operator = INSERT INTO iam.operators(tenant_id, email, name, password_hash, role)
               VALUES (tenant.id, email.lower().trim(), name, passwordHash, 'ADMIN')
               RETURNING *
    IF insert_failed:
      THROW operator_error

    client.query("COMMIT")

    // Phase 6: Issue JWT
    token = issueToken(operator)

    RETURN ok({ tenant, operator, token })

  CATCH error:
    client.query("ROLLBACK")
    RETURN err(error)

  FINALLY:
    client.release()   // Always return connection to pool
```

**Transaction invariant:** Either BOTH tenant AND operator exist, or NEITHER does. No orphaned records.

---

## Algorithm 2: Operator Login

```
FUNCTION login(input):
  // Phase 1: Input validation
  parsed = LoginSchema.safeParse(input)
  IF parsed.failed:
    RETURN err("Validation error")

  { email, password } = parsed.data

  // Phase 2: Lookup operator by email
  // NOTE: Uses pool.query directly (not tenant-scoped client)
  // RLS bypass is intentional — tenant unknown at login time
  row = SELECT * FROM iam.operators
        WHERE email = email.lower().trim()
          AND status != 'DISABLED'
  IF row is null:
    RETURN err("Invalid email or password")  // Generic — no enumeration

  // Phase 3: Password verification
  // bcrypt.compare is timing-safe by design
  match = bcrypt.compare(password, row.password_hash)
  IF NOT match:
    RETURN err("Invalid email or password")  // Same message as "not found"

  // Phase 4: Issue JWT
  token = issueToken(row)
  RETURN ok({ operator: row, token })
```

**Security note:** Both "not found" and "wrong password" return identical error messages. This prevents email enumeration attacks where an attacker could distinguish which emails exist in the system.

---

## Algorithm 3: JWT Issuance

```
FUNCTION issueToken(operator):
  payload = {
    tenantId:   operator.tenantId,
    operatorId: operator.id,
    role:       operator.role,
    email:      operator.email
  }

  secret = process.env.JWT_SECRET   // Read at call time (not import time)
                                    // Allows tests to set JWT_SECRET in beforeEach

  token = jwt.sign(payload, secret, { expiresIn: '24h' })
  // Algorithm: HS256 (default)
  // Sets iat = now(), exp = iat + 86400

  RETURN token

FUNCTION verifyToken(token):
  TRY:
    payload = jwt.verify(token, process.env.JWT_SECRET)
    RETURN ok(payload as JwtPayload)
  CATCH:
    RETURN err("Invalid token")
```

---

## Algorithm 4: Tenant Middleware (RLS Enforcement)

```
FUNCTION createTenantMiddleware(pool):
  RETURN ASYNC FUNCTION middleware(req, res, next):

    // Phase 1: Extract Bearer token
    authHeader = req.headers.authorization
    IF NOT authHeader OR NOT authHeader.startsWith("Bearer "):
      RETURN res.status(401).json({ error: "Missing authorization header" })

    token = authHeader.slice(7)  // Remove "Bearer " prefix

    TRY:
      // Phase 2: Verify JWT signature and expiry
      payload = jwt.verify(token, process.env.JWT_SECRET)
      // Throws if: expired, invalid signature, malformed

      // Phase 3: Acquire dedicated DB client for this request
      // CRITICAL: Must be dedicated (not pool.query) so SET persists
      client = await pool.connect()

      // Phase 4: Set RLS GUC — this is the security enforcement point
      await client.query(`SET app.tenant_id = '${payload.tenantId}'`)
      // Now ALL queries on this client will be filtered by RLS policy:
      // tenant_id = current_setting('app.tenant_id')::UUID

      // Phase 5: Guarantee client release on response close
      // Covers: normal response, error response, connection drop
      res.on('close', () => client.release())

      // Phase 6: Attach context to request for downstream use
      req.tenantId   = payload.tenantId
      req.operatorId = payload.operatorId
      req.role       = payload.role
      req.dbClient   = client

      next()  // Proceed to route handler

    CATCH:
      RETURN res.status(401).json({ error: "Invalid token" })
```

**Connection lifecycle:**
```
Request arrives → pool.connect() → SET app.tenant_id → route handler → res.close → client.release()
```

---

## Algorithm 5: Operator Invitation (Admin-Only)

```
FUNCTION inviteOperator(tenantId, input):
  // Phase 1: Validate input
  parsed = InviteOperatorSchema.safeParse(input)
  IF parsed.failed:
    RETURN err("Validation error")

  { email, name, role } = parsed.data

  // Phase 2: Check duplicate email in this tenant
  existing = findByEmail(email)
  IF existing.tenantId == tenantId:
    RETURN err("Operator with this email already exists in this tenant")
  // Allow same email in DIFFERENT tenants (multi-tenant support)

  // Phase 3: Generate temporary password
  // In production: send invitation email with reset link
  // In v1: auto-generate temp password (operator must know to request reset)
  tempPassword = "temp-" + random(8 chars)
  passwordHash = bcrypt.hash(tempPassword, rounds=12)

  // Phase 4: Create operator
  operator = INSERT INTO iam.operators(tenant_id, email, name, password_hash, role)
             VALUES (tenantId, email, name, passwordHash, role)
             RETURNING *

  RETURN ok(operator)
  // Note: operator.status = 'ACTIVE' (not 'INVITED' — v1 simplification)
```

---

## Algorithm 6: Role Change (Admin Guard)

```
FUNCTION updateRole(req, res):
  tenantReq = req as TenantRequest

  // Guard 1: Must be ADMIN
  IF tenantReq.role != 'ADMIN':
    RETURN res.status(403).json({ error: "Admin role required" })

  // Guard 2: Validate input
  parsed = UpdateRoleSchema.safeParse(req.body)
  IF parsed.failed:
    RETURN res.status(400).json({ error: "Invalid body" })

  // Guard 3: Fetch target operator
  target = operatorRepo.findById(req.params.id)
  IF target is null:
    RETURN res.status(404).json({ error: "Operator not found" })

  // Guard 4: Cross-tenant protection
  IF target.tenantId != tenantReq.tenantId:
    RETURN res.status(404).json({ error: "Operator not found" })
  // Returns 404 (not 403) to avoid confirming the operator exists in another tenant

  // Guard 5: Self-demotion prevention
  IF req.params.id == tenantReq.operatorId AND parsed.data.role != 'ADMIN':
    RETURN res.status(400).json({ error: "Cannot change your own role" })

  // Perform update
  UPDATE iam.operators SET role = parsed.data.role WHERE id = req.params.id

  RETURN res.json({ id: target.id, role: parsed.data.role })
```

---

## Algorithm 7: PostgreSQL RLS Evaluation (DB side)

```
-- When this query executes:
SELECT * FROM iam.operators WHERE id = $1

-- PostgreSQL internally evaluates:
-- Is RLS enabled on iam.operators? YES
-- Apply policy: tenant_isolation_operators
-- Policy USING clause: tenant_id = current_setting('app.tenant_id')::UUID

-- Effective query becomes:
SELECT * FROM iam.operators
WHERE id = $1
  AND tenant_id = current_setting('app.tenant_id')::UUID

-- If app.tenant_id = 'tenant-A-uuid' and the operator belongs to 'tenant-B-uuid':
-- → tenant_B_uuid != tenant_A_uuid → row filtered out → empty result
```

**RLS guarantee:** Even if application code passes a different `tenant_id` in a WHERE clause or omits it entirely, the database enforces isolation. This is defense-in-depth.

---

## Algorithm 8: Deactivation (Soft Delete)

```
FUNCTION deactivateOperator(req, res):
  tenantReq = req as TenantRequest

  // Guard 1: Must be ADMIN
  IF tenantReq.role != 'ADMIN':
    RETURN res.status(403).json({ error: "Admin role required" })

  // Guard 2: Self-deactivation prevention
  IF req.params.id == tenantReq.operatorId:
    RETURN res.status(400).json({ error: "Cannot deactivate yourself" })

  // Guard 3: Fetch and verify cross-tenant
  target = operatorRepo.findById(req.params.id)
  IF target is null OR target.tenantId != tenantReq.tenantId:
    RETURN res.status(404).json({ error: "Operator not found" })

  // Soft delete: status = DISABLED, not DELETE FROM
  UPDATE iam.operators SET status = 'DISABLED' WHERE id = req.params.id

  // Remove from presence tracking
  presenceService.setOffline(req.params.id, tenantReq.tenantId)

  RETURN res.json({ id: req.params.id, status: 'DISABLED' })
```

**No hard deletes in IAM.** Disabled operators retain audit history. `findByEmail()` filters out `DISABLED` operators during login, preventing reuse.

---

## Algorithm 9: Presence Tracking

```
// On WebSocket connect (BC-01):
FUNCTION onOperatorConnect(operatorId, tenantId):
  SADD presence:{tenantId} {operatorId}

// On WebSocket disconnect:
FUNCTION onOperatorDisconnect(operatorId, tenantId):
  SREM presence:{tenantId} {operatorId}

// On operator deactivation:
FUNCTION onOperatorDeactivated(operatorId, tenantId):
  SREM presence:{tenantId} {operatorId}

// Get all online for tenant:
FUNCTION getOnlineOperators(tenantId):
  RETURN SMEMBERS presence:{tenantId}

// Check single operator:
FUNCTION isOnline(operatorId, tenantId):
  RETURN SISMEMBER presence:{tenantId} {operatorId} == 1
```

**Key pattern:** `presence:{tenantId}` → Redis SET (no TTL — membership managed by WebSocket lifecycle events)
