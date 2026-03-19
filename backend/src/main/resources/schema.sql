-- =====================================================
-- UCS PostgreSQL Schema DDL
-- Execute this script to create all tables before starting the backend.
-- Usage: psql -U ucs_user -d ucsdb -f schema.sql
-- =====================================================

-- 1. Roles
CREATE TABLE IF NOT EXISTS roles (
    id BIGSERIAL PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL,
    description VARCHAR(500),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- 2. Teams
CREATE TABLE IF NOT EXISTS teams (
    id BIGSERIAL PRIMARY KEY,
    team_name VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- 3. Team Roles (lookup table: defines what roles a team can have)
CREATE TABLE IF NOT EXISTS team_roles (
    id BIGSERIAL PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(500),
    created_at TIMESTAMP
);

-- 4. Users
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    real_name VARCHAR(100),
    avatar_url VARCHAR(255),
    pilot_license_id VARCHAR(100),
    phone VARCHAR(20),
    email VARCHAR(100),
    team_id BIGINT,
    partition_name VARCHAR(100),
    status INTEGER DEFAULT 1,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    CONSTRAINT fk_users_team FOREIGN KEY (team_id) REFERENCES teams(id)
);

-- 5. User-Role Mapping
CREATE TABLE IF NOT EXISTS user_role_map (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    role_id BIGINT NOT NULL,
    assigned_at TIMESTAMP,
    CONSTRAINT fk_urm_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_urm_role FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- 6. Team Members
CREATE TABLE IF NOT EXISTS team_members (
    id BIGSERIAL PRIMARY KEY,
    team_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    team_role_id BIGINT,
    joined_at TIMESTAMP,
    CONSTRAINT fk_tm_team FOREIGN KEY (team_id) REFERENCES teams(id),
    CONSTRAINT fk_tm_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_tm_team_role FOREIGN KEY (team_role_id) REFERENCES team_roles(id)
);

-- 7. Drones
CREATE TABLE IF NOT EXISTS drones (
    id BIGSERIAL PRIMARY KEY,
    drone_sn VARCHAR(100) NOT NULL UNIQUE,
    uav_id VARCHAR(50) UNIQUE,
    mavlink_system_id INTEGER,
    model VARCHAR(100),
    manufacturer VARCHAR(100),
    capabilities VARCHAR(2000),
    default_team_id BIGINT,
    control_owner_id BIGINT,
    view_owner_id BIGINT,
    online_status BOOLEAN DEFAULT FALSE,
    last_heartbeat TIMESTAMP,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    CONSTRAINT fk_drones_team FOREIGN KEY (default_team_id) REFERENCES teams(id),
    CONSTRAINT fk_drones_control_owner FOREIGN KEY (control_owner_id) REFERENCES users(id),
    CONSTRAINT fk_drones_view_owner FOREIGN KEY (view_owner_id) REFERENCES users(id)
);

-- 8. Drone Status
CREATE TABLE IF NOT EXISTS drone_status (
    id BIGSERIAL PRIMARY KEY,
    drone_id BIGINT NOT NULL,
    timestamp TIMESTAMP,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    alt DOUBLE PRECISION,
    heading REAL,
    velocity REAL,
    battery REAL,
    health_status INTEGER DEFAULT 0,
    risk_level INTEGER DEFAULT 0,
    payload_state VARCHAR(2000),
    grid_x INTEGER,
    grid_y INTEGER,
    flight_status VARCHAR(50),
    task_status VARCHAR(50),
    CONSTRAINT fk_ds_drone FOREIGN KEY (drone_id) REFERENCES drones(id)
);

-- 9. Drone Specs
CREATE TABLE IF NOT EXISTS drone_specs (
    id BIGSERIAL PRIMARY KEY,
    drone_id BIGINT NOT NULL,
    max_flight_time INTEGER,
    max_speed REAL,
    weight REAL,
    sensors VARCHAR(2000),
    CONSTRAINT fk_dspec_drone FOREIGN KEY (drone_id) REFERENCES drones(id)
);

-- 10. Drone Network Status
CREATE TABLE IF NOT EXISTS drone_network_status (
    id BIGSERIAL PRIMARY KEY,
    drone_id BIGINT NOT NULL,
    network_type VARCHAR(50),
    signal_strength REAL,
    latency REAL,
    timestamp TIMESTAMP,
    CONSTRAINT fk_dns_drone FOREIGN KEY (drone_id) REFERENCES drones(id)
);

-- 11. Drone Ownership
CREATE TABLE IF NOT EXISTS drone_ownership (
    id BIGSERIAL PRIMARY KEY,
    drone_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    assigned_by BIGINT,
    assigned_at TIMESTAMP,
    expired_at TIMESTAMP,
    CONSTRAINT fk_do_drone FOREIGN KEY (drone_id) REFERENCES drones(id),
    CONSTRAINT fk_do_user FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 12. Drone Partition Map
CREATE TABLE IF NOT EXISTS drone_partition_map (
    id BIGSERIAL PRIMARY KEY,
    drone_id BIGINT NOT NULL,
    uav_id VARCHAR(50),
    partition_name VARCHAR(200) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_partition_drone_id ON drone_partition_map(drone_id);
CREATE INDEX IF NOT EXISTS idx_partition_name ON drone_partition_map(partition_name);

-- 13. Team-Drone Mapping
CREATE TABLE IF NOT EXISTS team_drone_map (
    id BIGSERIAL PRIMARY KEY,
    team_id BIGINT NOT NULL,
    drone_id BIGINT NOT NULL,
    assigned_at TIMESTAMP,
    removed_at TIMESTAMP,
    CONSTRAINT fk_tdm_team FOREIGN KEY (team_id) REFERENCES teams(id),
    CONSTRAINT fk_tdm_drone FOREIGN KEY (drone_id) REFERENCES drones(id)
);

-- 14. Tasks
CREATE TABLE IF NOT EXISTS tasks (
    id BIGSERIAL PRIMARY KEY,
    task_name VARCHAR(200) NOT NULL,
    task_type VARCHAR(50),
    status INTEGER DEFAULT 0,
    priority INTEGER DEFAULT 0,
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    created_by BIGINT,
    description VARCHAR(2000),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- 15. Task Assignments
CREATE TABLE IF NOT EXISTS task_assignments (
    id BIGSERIAL PRIMARY KEY,
    task_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    assigned_at TIMESTAMP,
    role VARCHAR(50),
    CONSTRAINT fk_ta_task FOREIGN KEY (task_id) REFERENCES tasks(id),
    CONSTRAINT fk_ta_user FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 16. Task-Drone Map
CREATE TABLE IF NOT EXISTS task_drone_map (
    id BIGSERIAL PRIMARY KEY,
    task_id BIGINT NOT NULL,
    drone_id BIGINT NOT NULL,
    progress REAL DEFAULT 0,
    status INTEGER DEFAULT 0,
    last_update_time TIMESTAMP,
    CONSTRAINT fk_tdmap_task FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- 17. Command Log
CREATE TABLE IF NOT EXISTS command_log (
    id BIGSERIAL PRIMARY KEY,
    drone_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    command_type VARCHAR(50) NOT NULL,
    payload VARCHAR(2000),
    status VARCHAR(20),
    created_at TIMESTAMP
);

-- 18. Event Log
CREATE TABLE IF NOT EXISTS event_log (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    drone_id BIGINT,
    user_id BIGINT,
    level VARCHAR(20),
    message VARCHAR(2000),
    created_at TIMESTAMP
);

-- 19. Operation Log
CREATE TABLE IF NOT EXISTS operation_log (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    username VARCHAR(50),
    operation_type VARCHAR(50) NOT NULL,
    target_drone_id BIGINT,
    target_uav_id VARCHAR(50),
    target_user_id BIGINT,
    detail VARCHAR(2000),
    result VARCHAR(20),
    error_message VARCHAR(2000),
    ip_address VARCHAR(50),
    created_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_operation_log_user_id ON operation_log(user_id);
CREATE INDEX IF NOT EXISTS idx_operation_log_type ON operation_log(operation_type);
CREATE INDEX IF NOT EXISTS idx_operation_log_created ON operation_log(created_at);

-- 20. Dashboard Config
CREATE TABLE IF NOT EXISTS dashboard_config (
    id BIGSERIAL PRIMARY KEY,
    config_name VARCHAR(100),
    display_layers VARCHAR(2000),
    auto_refresh_interval INTEGER,
    created_at TIMESTAMP
);

-- 21. Weather Snapshot
CREATE TABLE IF NOT EXISTS weather_snapshot (
    id BIGSERIAL PRIMARY KEY,
    temperature REAL,
    humidity REAL,
    wind_speed REAL,
    wind_direction REAL,
    risk_level VARCHAR(20),
    location VARCHAR(100),
    created_at TIMESTAMP
);

-- 22. Rally Points (集结点信息表)
CREATE TABLE IF NOT EXISTS rally_points (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    altitude REAL,
    city VARCHAR(100),
    address VARCHAR(200),
    capacity INTEGER NOT NULL,
    current_occupancy INTEGER NOT NULL DEFAULT 0,
    status SMALLINT NOT NULL DEFAULT 1,
    scope SMALLINT NOT NULL DEFAULT 0,
    team_id VARCHAR(50),
    radius REAL NOT NULL DEFAULT 5.0,
    service_type SMALLINT,
    description TEXT,
    created_by VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rally_points_lng_lat ON rally_points (longitude, latitude);
CREATE INDEX IF NOT EXISTS idx_rally_points_city ON rally_points (city);
CREATE INDEX IF NOT EXISTS idx_rally_points_scope_team ON rally_points (scope, team_id);
CREATE INDEX IF NOT EXISTS idx_rally_points_deleted_at ON rally_points (deleted_at);

-- Create trigger function for auto-updating updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for rally_points
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_update_rally_points') THEN
        CREATE TRIGGER trigger_update_rally_points
        BEFORE UPDATE ON rally_points
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
END;
$$;

-- 23. UAV Telemetry (time-series history)
CREATE TABLE IF NOT EXISTS uav_telemetry (
    id BIGSERIAL PRIMARY KEY,
    uav_id VARCHAR(50) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    alt DOUBLE PRECISION NOT NULL,
    heading REAL,
    ground_speed REAL,
    vertical_speed REAL,
    ned_x DOUBLE PRECISION,
    ned_y DOUBLE PRECISION,
    ned_z DOUBLE PRECISION,
    vx DOUBLE PRECISION,
    vy DOUBLE PRECISION,
    vz DOUBLE PRECISION,
    data_age DOUBLE PRECISION,
    msg_count BIGINT,
    is_active BOOLEAN
);
CREATE INDEX IF NOT EXISTS idx_uav_telemetry_uav_id ON uav_telemetry(uav_id);
CREATE INDEX IF NOT EXISTS idx_uav_telemetry_timestamp ON uav_telemetry(timestamp);

-- 23. UAV Latest State (one row per UAV, upserted)
CREATE TABLE IF NOT EXISTS uav_latest_state (
    uav_id VARCHAR(50) PRIMARY KEY,
    last_update TIMESTAMP WITH TIME ZONE NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    alt DOUBLE PRECISION NOT NULL,
    heading REAL,
    ground_speed REAL,
    vertical_speed REAL,
    ned_x DOUBLE PRECISION,
    ned_y DOUBLE PRECISION,
    ned_z DOUBLE PRECISION,
    vx DOUBLE PRECISION,
    vy DOUBLE PRECISION,
    vz DOUBLE PRECISION,
    data_age DOUBLE PRECISION,
    msg_count BIGINT,
    is_active BOOLEAN
);
