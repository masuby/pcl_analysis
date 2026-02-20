#!/usr/bin/env node
/**
 * Reset admin password to admin123
 * Run: node scripts/reset-admin-password.mjs
 * Requires: Docker containers running (postgres)
 */

import pg from 'pg';
import bcrypt from 'bcrypt';
import { readFileSync, existsSync } from 'fs';

const { Client } = pg;
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load backend/.env - Docker postgres uses pcl_user + DB_PASSWORD
let dbPassword = 'pcl_secure_password_change_me';
const envPath = join(__dirname, '..', 'backend', '.env');
if (existsSync(envPath)) {
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*DB_PASSWORD=(.+)$/);
    if (m) dbPassword = m[1].trim().replace(/^["']|["']$/g, '');
  }
}

const client = new Client({
  host: 'localhost',
  port: 5432,
  user: 'pcl_user',  // Docker postgres user (from docker-compose)
  password: dbPassword,
  database: 'pcl_analysis',
});

async function resetPassword() {
  try {
    await client.connect();
    const hash = await bcrypt.hash('admin123', 10);
    
    await client.query(
      `INSERT INTO users (email, password_hash, display_name, role, department, is_active)
       VALUES ('admin@pcl.com', $1, 'System Administrator', 'admin', 'ALL', true)
       ON CONFLICT (email) DO UPDATE SET password_hash = $1, updated_at = NOW()`,
      [hash]
    );
    console.log('Password reset! Login: admin@pcl.com / admin123');
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.error('Cannot connect to PostgreSQL. Is Docker running? Run: cd backend && docker compose up -d');
    } else if (err.code === '28P01' || err.message?.includes('password') || err.message?.includes('authentication')) {
      console.error('Wrong DB password. Your backend/.env has DB_PASSWORD=Masubi98%');
      console.error('If postgres was first created with a different password, try: docker compose down -v && docker compose up -d');
    } else {
      console.error('Error:', err.message);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

resetPassword();
