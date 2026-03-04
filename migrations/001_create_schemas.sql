-- Migration 001: Create database schemas for all Bounded Contexts
-- Reference: docs/tactical-design.md

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Schema per Bounded Context (ADR-004)
CREATE SCHEMA IF NOT EXISTS conversations;
CREATE SCHEMA IF NOT EXISTS pql;
CREATE SCHEMA IF NOT EXISTS revenue;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS notifications;
CREATE SCHEMA IF NOT EXISTS integrations;
