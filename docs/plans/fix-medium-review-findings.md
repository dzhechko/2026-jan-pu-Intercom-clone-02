# Fix MEDIUM Review Findings

## 5 Fixes

1. **ARIA violations in ShortcutHelp.tsx** — add `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trap
2. **Keyboard shortcuts tests test local copy** — import SHORTCUT_MAP from source instead of re-declaring
3. **Circuit breaker gaps** — wrap setWebhook/getMe in circuit breaker for both Telegram and VK Max
4. **MLTrainingService missing tests** — find and add basic tests
5. **Race condition on dialog external_id** — add migration comment for UNIQUE constraint (no migration runner available)
