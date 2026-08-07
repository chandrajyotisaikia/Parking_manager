// db/db.js — Postgres connection (using a free Supabase database) + table setup.
// Reads the connection string from the DATABASE_URL environment variable.
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // required for Supabase's hosted Postgres
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id SERIAL PRIMARY KEY,
      vehicle_number TEXT UNIQUE NOT NULL,
      owner_name TEXT NOT NULL,
      phone TEXT,
      vehicle_type TEXT NOT NULL,
      subscription_start DATE,
      subscription_end DATE NOT NULL,
      amount_due NUMERIC DEFAULT 0,
      payment_status TEXT DEFAULT 'PAID'
    );
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS subscription_start DATE;
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS amount_due NUMERIC DEFAULT 0;
    ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'PAID';
    
    CREATE TABLE IF NOT EXISTS daily_entries (
      id SERIAL PRIMARY KEY,
      vehicle_number TEXT NOT NULL,
      vehicle_type TEXT NOT NULL,
      is_subscriber BOOLEAN NOT NULL DEFAULT FALSE,
      amount_charged NUMERIC NOT NULL DEFAULT 0,
      entry_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      exit_time TIMESTAMPTZ,
      status TEXT DEFAULT 'ACTIVE',
      attendant_name TEXT,
      payment_status TEXT DEFAULT 'PAID'
    );
    ALTER TABLE daily_entries ADD COLUMN IF NOT EXISTS exit_time TIMESTAMPTZ;
    ALTER TABLE daily_entries ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'PAID';
    
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    
    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      amount NUMERIC NOT NULL,
      description TEXT NOT NULL,
      expense_date DATE NOT NULL,
      attendant_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

module.exports = { pool, initDb };
