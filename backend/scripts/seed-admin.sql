-- Seed default admin user
-- Run with: docker exec -i pcl-postgres psql -U pcl_user -d pcl_analysis < scripts/seed-admin.sql
-- Default: admin@pcl.com / admin123

INSERT INTO users (email, password_hash, display_name, role, department, is_active)
VALUES (
    'admin@pcl.com',
    '$2a$10$N9qo8uLOickgx2ZMRZoMye.IjUQZVqDXPBW.1fKQgNlWVW8K1kRQ2',
    'System Administrator',
    'admin',
    'ALL',
    true
)
ON CONFLICT (email) DO NOTHING;
