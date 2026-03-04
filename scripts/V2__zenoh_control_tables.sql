-- =====================================================
-- V2: Zenoh Closed-Loop Control System - Database Migration
-- =====================================================
-- This migration adds tables and columns required for the
-- Zenoh-based UAV closed-loop control system.
--
-- Changes:
-- 1. ALTER drones: add uav_id, mavlink_system_id, online_status, last_heartbeat
-- 2. CREATE operation_log: audit trail for all user operations
-- 3. CREATE drone_partition_map: Zenoh partition routing configuration
-- =====================================================

-- -----------------------------------------------
-- 1. Modify drones table - add Zenoh control fields
-- -----------------------------------------------

-- uav_id: Unique identifier derived from MAC address on onboard computer.
-- This is the permanent identifier used throughout the system instead of
-- volatile MAC address. Format: UAV_001, UAV_002, etc.
ALTER TABLE drones ADD COLUMN IF NOT EXISTS uav_id VARCHAR(50) UNIQUE;

-- mavlink_system_id: PX4 MAVLink system ID for this drone.
-- Used for PX4 SITL simulation addressing.
ALTER TABLE drones ADD COLUMN IF NOT EXISTS mavlink_system_id INTEGER;

-- online_status: Whether the drone is currently connected to Zenoh network.
-- Updated by Redis heartbeat mechanism (30s TTL).
ALTER TABLE drones ADD COLUMN IF NOT EXISTS online_status BOOLEAN DEFAULT FALSE;

-- last_heartbeat: Timestamp of last Zenoh heartbeat received.
ALTER TABLE drones ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMP;

-- Create index on uav_id for fast lookup
CREATE INDEX IF NOT EXISTS idx_drones_uav_id ON drones(uav_id);

-- Create index on online_status for fleet queries
CREATE INDEX IF NOT EXISTS idx_drones_online_status ON drones(online_status);

-- -----------------------------------------------
-- 2. Create operation_log table
-- -----------------------------------------------
-- Records all user operations for audit trail.
-- Used for the operation log UI and compliance tracking.
--
-- Operation types:
--   CONTROL_COMMAND      - Drone control command sent
--   PERMISSION_TRANSFER  - Drone control permission transferred
--   DRONE_ASSIGN         - Drone assigned to user
--   DRONE_UNASSIGN       - Drone unassigned from user
--   TASK_CREATE          - Task created
--   TASK_ASSIGN          - Task assigned to user
--   LOGIN                - User login
--   LOGOUT               - User logout

CREATE TABLE IF NOT EXISTS operation_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    
    -- Who performed the operation
    user_id BIGINT NOT NULL,
    username VARCHAR(100) NOT NULL,
    
    -- What operation was performed
    operation_type VARCHAR(50) NOT NULL,
    
    -- Target of the operation (nullable depending on operation type)
    target_drone_id BIGINT,
    target_uav_id VARCHAR(50),
    target_user_id BIGINT,
    
    -- Operation details (JSON format for flexible storage)
    detail TEXT,
    
    -- Result
    result VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    error_message TEXT,
    
    -- Request context
    ip_address VARCHAR(50),
    
    -- Timestamp
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_operation_log_user_id ON operation_log(user_id);
CREATE INDEX IF NOT EXISTS idx_operation_log_type ON operation_log(operation_type);
CREATE INDEX IF NOT EXISTS idx_operation_log_created_at ON operation_log(created_at);
CREATE INDEX IF NOT EXISTS idx_operation_log_drone_id ON operation_log(target_drone_id);

-- -----------------------------------------------
-- 3. Create drone_partition_map table
-- -----------------------------------------------
-- Maps drones to Zenoh partitions for data distribution.
-- Each drone can belong to multiple partitions.
-- Partitions determine which users receive which drone data.
--
-- Partition naming convention: partition_{team_name} or partition_{user_id}
-- Example: partition_recon_team_1, partition_user_3

CREATE TABLE IF NOT EXISTS drone_partition_map (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    
    -- Drone reference (both DB id and uav_id for convenience)
    drone_id BIGINT NOT NULL,
    uav_id VARCHAR(50) NOT NULL,
    
    -- Partition name
    partition_name VARCHAR(100) NOT NULL,
    
    -- Whether this mapping is active
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_partition_map_drone_id ON drone_partition_map(drone_id);
CREATE INDEX IF NOT EXISTS idx_partition_map_partition ON drone_partition_map(partition_name);
CREATE INDEX IF NOT EXISTS idx_partition_map_uav_id ON drone_partition_map(uav_id);
CREATE INDEX IF NOT EXISTS idx_partition_map_active ON drone_partition_map(is_active);

-- Unique constraint: one drone can only appear once per partition
CREATE UNIQUE INDEX IF NOT EXISTS idx_partition_map_unique 
    ON drone_partition_map(drone_id, partition_name) WHERE is_active = TRUE;
