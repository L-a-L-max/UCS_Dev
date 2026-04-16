-- ============================================================================
-- T-72: Database Schema Isolation per Microservice
-- ============================================================================
-- Purpose: Separate database schemas for each microservice to enforce data
-- ownership boundaries. Each service owns its schema and should NOT directly
-- access another service's tables.
--
-- Execution: Run this script once on the PostgreSQL cluster before deploying
-- the microservices in multi-instance mode.
--
-- Schema Mapping:
--   ucs_business   → ucs-business service (users, teams, events, tasks, drones, partitions)
--   ucs_telemetry  → ucs-telemetry-store service (telemetry records, latest states)
--   ucs_command    → ucs-command service (command logs, idempotency keys)
--   ucs_drone      → ucs-drone-state service (drone state snapshots)
-- ============================================================================

-- 1. Create schemas
CREATE SCHEMA IF NOT EXISTS ucs_business;
CREATE SCHEMA IF NOT EXISTS ucs_telemetry;
CREATE SCHEMA IF NOT EXISTS ucs_command;
CREATE SCHEMA IF NOT EXISTS ucs_drone;

-- 2. Create dedicated database users per service (least-privilege principle)
DO $$
BEGIN
    -- ucs-business service user
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ucs_business_svc') THEN
        CREATE ROLE ucs_business_svc LOGIN PASSWORD 'changeme_business';
    END IF;
    -- ucs-telemetry-store service user
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ucs_telemetry_svc') THEN
        CREATE ROLE ucs_telemetry_svc LOGIN PASSWORD 'changeme_telemetry';
    END IF;
    -- ucs-command service user
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ucs_command_svc') THEN
        CREATE ROLE ucs_command_svc LOGIN PASSWORD 'changeme_command';
    END IF;
    -- ucs-drone-state service user
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ucs_drone_svc') THEN
        CREATE ROLE ucs_drone_svc LOGIN PASSWORD 'changeme_drone';
    END IF;
END
$$;

-- 3. Grant schema ownership and usage
GRANT ALL ON SCHEMA ucs_business TO ucs_business_svc;
GRANT ALL ON SCHEMA ucs_telemetry TO ucs_telemetry_svc;
GRANT ALL ON SCHEMA ucs_command TO ucs_command_svc;
GRANT ALL ON SCHEMA ucs_drone TO ucs_drone_svc;

-- 4. Set default search_path for each service user
ALTER ROLE ucs_business_svc SET search_path TO ucs_business, public;
ALTER ROLE ucs_telemetry_svc SET search_path TO ucs_telemetry, public;
ALTER ROLE ucs_command_svc SET search_path TO ucs_command, public;
ALTER ROLE ucs_drone_svc SET search_path TO ucs_drone, public;

-- 5. Grant default privileges (future tables auto-grant)
ALTER DEFAULT PRIVILEGES FOR ROLE ucs_business_svc IN SCHEMA ucs_business
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ucs_business_svc;
ALTER DEFAULT PRIVILEGES FOR ROLE ucs_telemetry_svc IN SCHEMA ucs_telemetry
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ucs_telemetry_svc;
ALTER DEFAULT PRIVILEGES FOR ROLE ucs_command_svc IN SCHEMA ucs_command
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ucs_command_svc;
ALTER DEFAULT PRIVILEGES FOR ROLE ucs_drone_svc IN SCHEMA ucs_drone
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ucs_drone_svc;

-- 6. Cross-service read-only access (where needed)
-- ucs-telemetry-store needs READ access to ucs_business.drones for drone metadata
GRANT USAGE ON SCHEMA ucs_business TO ucs_telemetry_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA ucs_business TO ucs_telemetry_svc;

-- ucs-drone-state needs READ access to ucs_business.drones
GRANT USAGE ON SCHEMA ucs_business TO ucs_drone_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA ucs_business TO ucs_drone_svc;

-- 7. Revoke public schema access (prevent accidental cross-schema writes)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ============================================================================
-- Migration Guide:
-- After running this script, update each service's application.properties:
--
-- ucs-business:
--   spring.datasource.url=jdbc:postgresql://db:5432/ucs?currentSchema=ucs_business
--   spring.datasource.username=ucs_business_svc
--
-- ucs-telemetry-store:
--   spring.datasource.url=jdbc:postgresql://db:5432/ucs?currentSchema=ucs_telemetry
--   spring.datasource.username=ucs_telemetry_svc
--
-- ucs-command:
--   spring.datasource.url=jdbc:postgresql://db:5432/ucs?currentSchema=ucs_command
--   spring.datasource.username=ucs_command_svc
--
-- ucs-drone-state:
--   spring.datasource.url=jdbc:postgresql://db:5432/ucs?currentSchema=ucs_drone
--   spring.datasource.username=ucs_drone_svc
-- ============================================================================
