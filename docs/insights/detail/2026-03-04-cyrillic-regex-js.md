# Insight: JavaScript \w does NOT match Cyrillic characters

**Date:** 2026-03-04 | **Area:** pql | **Category:** bug-fix

## Context
Writing custom PQL signal rules with regex patterns for Russian text. A test with `/платн\w+ верси/i` failed because `\w` only matches `[a-zA-Z0-9_]` in JavaScript — it does NOT match Cyrillic letters like `а`, `о`, `й`.

## Insight
In JavaScript regex, `\w` is ASCII-only. For Cyrillic matching, use:
- Character classes: `[а-яёА-ЯЁ]`
- Unicode property escapes: `\p{L}` with the `/u` flag
- Or simplify: use partial word stems like `/платн/i` instead of full word matching

The project's DEFAULT_RULES in `rule-set.ts` use full Cyrillic words (not `\w`), so they work correctly. The issue only appeared in custom test rules.

## Impact
All future PQL signal patterns involving Russian text must avoid `\w`. Use explicit Cyrillic ranges or simple substring patterns. Document this in testing-patterns skill.
