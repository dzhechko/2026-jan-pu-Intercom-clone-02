# Insight: Jest coverageThreshold requires exact property names and nested structure

**Date:** 2026-03-04 | **Area:** infra | **Category:** bug-fix

## Context
Setting up jest.config.ts with per-directory coverage thresholds for PQL domain (95% lines, 100% functions, 90% branches).

## Insight
Two gotchas with Jest coverage config:
1. Property name is `coverageThreshold` (singular), NOT `coverageThresholds` (plural) — silent failure
2. Per-directory thresholds require a `global` key even if you only care about specific directories: `coverageThreshold: { global: { lines: 50 }, 'src/pql/domain/': { lines: 95 } }`
3. ts-jest requires `ts-node` as a peer dependency for `.ts` config files — must be in devDependencies

## Impact
Always verify Jest config property names against official docs. The silent failure mode (wrong property name = no coverage enforcement) is particularly dangerous for fitness functions like FF-05.
