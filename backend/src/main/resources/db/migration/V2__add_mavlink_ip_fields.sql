-- Migration: Add MAVLink IP connection fields to drones table
-- These fields support the MAVLink gateway's three-level cache:
--   Local memory -> Redis -> PostgreSQL (this table)
-- The gateway uses these fields to route commands back to real drones.

ALTER TABLE drones ADD COLUMN IF NOT EXISTS mavlink_ip VARCHAR(45);
ALTER TABLE drones ADD COLUMN IF NOT EXISTS mavlink_port INTEGER;
ALTER TABLE drones ADD COLUMN IF NOT EXISTS connection_protocol VARCHAR(10) DEFAULT 'udp';

-- Index for quick lookup by IP (used by gateway IP resolution)
CREATE INDEX IF NOT EXISTS idx_drones_mavlink_ip ON drones(mavlink_ip);

COMMENT ON COLUMN drones.mavlink_ip IS 'MAVLink connection IP address (for real drones)';
COMMENT ON COLUMN drones.mavlink_port IS 'MAVLink connection UDP/TCP port';
COMMENT ON COLUMN drones.connection_protocol IS 'Connection protocol: udp or tcp (default: udp)';
