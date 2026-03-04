#!/usr/bin/env node
/**
 * Simple migration runner — executes SQL files in order.
 * Reference: docs/tactical-design.md
 */
const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://kommuniq:kommuniq@localhost:5432/kommuniq',
  })

  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  // Get already applied migrations
  const { rows: applied } = await pool.query('SELECT filename FROM public.migrations ORDER BY id')
  const appliedSet = new Set(applied.map(r => r.filename))

  // Get migration files
  const migrationsDir = path.join(__dirname, '..', 'migrations')
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  let count = 0
  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`  ✓ ${file} (already applied)`)
      continue
    }

    console.log(`  → Applying ${file}...`)
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')

    try {
      await pool.query('BEGIN')
      await pool.query(sql)
      await pool.query('INSERT INTO public.migrations (filename) VALUES ($1)', [file])
      await pool.query('COMMIT')
      console.log(`  ✓ ${file} applied`)
      count++
    } catch (err) {
      await pool.query('ROLLBACK')
      console.error(`  ✗ ${file} FAILED:`, err.message)
      process.exit(1)
    }
  }

  console.log(`\nMigrations complete: ${count} new, ${files.length} total`)
  await pool.end()
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
