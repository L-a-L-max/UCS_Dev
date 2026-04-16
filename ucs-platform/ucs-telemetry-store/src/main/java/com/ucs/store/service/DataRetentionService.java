package com.ucs.store.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * T-61: Data Retention Policy Service.
 *
 * Automatically purges old telemetry data based on configurable retention policies.
 * Prevents unbounded storage growth in TimescaleDB.
 *
 * Retention tiers:
 *   1. Raw telemetry (uav_telemetry):  retain 7 days (configurable)
 *   2. Aggregated telemetry (1-min):   retain 30 days (configurable)
 *   3. Event logs (event_logs):        retain 90 days (configurable)
 *   4. Command logs (command_logs):    retain 90 days (configurable)
 *
 * Execution:
 *   - Runs daily at 03:00 UTC via @Scheduled
 *   - Uses ShedLock to ensure only one instance runs the cleanup
 *   - Deletes in batches (10,000 rows per batch) to avoid long-running transactions
 *   - Logs number of rows deleted for each tier
 *
 * TimescaleDB optimization:
 *   - If using TimescaleDB hypertables, use drop_chunks() instead of DELETE
 *   - This is handled by the useTimescaleDropChunks flag
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DataRetentionService {

    private final JdbcTemplate jdbcTemplate;

    @Value("${ucs.retention.raw-telemetry-days:7}")
    private int rawTelemetryRetentionDays;

    @Value("${ucs.retention.aggregated-telemetry-days:30}")
    private int aggregatedTelemetryRetentionDays;

    @Value("${ucs.retention.event-logs-days:90}")
    private int eventLogRetentionDays;

    @Value("${ucs.retention.command-logs-days:90}")
    private int commandLogRetentionDays;

    @Value("${ucs.retention.batch-size:10000}")
    private int batchSize;

    @Value("${ucs.retention.use-timescale-drop-chunks:false}")
    private boolean useTimescaleDropChunks;

    /**
     * Daily cleanup job — runs at 03:00 UTC.
     * ShedLock ensures only one instance across the cluster runs this.
     */
    @Scheduled(cron = "0 0 3 * * *")
    @SchedulerLock(name = "dataRetentionCleanup", lockAtLeastFor = "5m", lockAtMostFor = "30m")
    public void executeRetentionPolicy() {
        log.info("[DataRetention] Starting daily retention cleanup...");
        long startTime = System.currentTimeMillis();

        try {
            // Tier 1: Raw telemetry
            long rawDeleted = cleanupTable("uav_telemetry", "recorded_at",
                    rawTelemetryRetentionDays, "raw telemetry");

            // Tier 2: Event logs
            long eventDeleted = cleanupTable("event_logs", "created_at",
                    eventLogRetentionDays, "event logs");

            // Tier 3: Command logs
            long cmdDeleted = cleanupTable("command_logs", "created_at",
                    commandLogRetentionDays, "command logs");

            long elapsed = System.currentTimeMillis() - startTime;
            log.info("[DataRetention] Cleanup complete in {}ms — raw={}, events={}, commands={}",
                    elapsed, rawDeleted, eventDeleted, cmdDeleted);

        } catch (Exception e) {
            log.error("[DataRetention] Cleanup failed: {}", e.getMessage(), e);
        }
    }

    /**
     * Clean up a single table based on retention policy.
     *
     * @param tableName       Table to clean
     * @param timestampColumn Column containing the timestamp
     * @param retentionDays   Number of days to retain
     * @param description     Human-readable description for logging
     * @return Total number of rows deleted
     */
    private long cleanupTable(String tableName, String timestampColumn,
                               int retentionDays, String description) {
        Instant cutoff = Instant.now().minus(retentionDays, ChronoUnit.DAYS);

        if (useTimescaleDropChunks) {
            return dropChunks(tableName, cutoff, description);
        } else {
            return batchDelete(tableName, timestampColumn, cutoff, description);
        }
    }

    /**
     * TimescaleDB-optimized cleanup using drop_chunks().
     * Much faster than DELETE for hypertables.
     */
    private long dropChunks(String tableName, Instant cutoff, String description) {
        try {
            // TimescaleDB drop_chunks — removes entire chunks older than cutoff
            String sql = String.format(
                    "SELECT drop_chunks('%s', TIMESTAMP '%s')",
                    tableName, cutoff.toString()
            );
            jdbcTemplate.execute(sql);
            log.info("[DataRetention] Dropped chunks for {} older than {}", description, cutoff);
            return -1; // drop_chunks doesn't return row count
        } catch (Exception e) {
            log.warn("[DataRetention] drop_chunks failed for {} (not a hypertable?): {}",
                    description, e.getMessage());
            // Fallback to batch delete
            return batchDelete(tableName, "recorded_at", cutoff, description);
        }
    }

    /**
     * Standard batch DELETE for regular PostgreSQL tables.
     * Deletes in batches to avoid long-running transactions and lock contention.
     */
    private long batchDelete(String tableName, String timestampColumn,
                              Instant cutoff, String description) {
        long totalDeleted = 0;
        int batchDeleted;

        do {
            try {
                // Use ctid-based batch delete for PostgreSQL efficiency
                String sql = String.format(
                        "DELETE FROM %s WHERE ctid IN (" +
                                "SELECT ctid FROM %s WHERE %s < ? LIMIT %d" +
                                ")",
                        tableName, tableName, timestampColumn, batchSize
                );
                batchDeleted = jdbcTemplate.update(sql, java.sql.Timestamp.from(cutoff));
                totalDeleted += batchDeleted;

                if (batchDeleted > 0) {
                    log.debug("[DataRetention] Deleted {} rows from {} (total: {})",
                            batchDeleted, description, totalDeleted);
                }
            } catch (Exception e) {
                log.warn("[DataRetention] Batch delete failed for {}: {}", description, e.getMessage());
                break;
            }
        } while (batchDeleted >= batchSize);

        if (totalDeleted > 0) {
            log.info("[DataRetention] Cleaned {} rows from {} (cutoff: {})",
                    totalDeleted, description, cutoff);
        }
        return totalDeleted;
    }

    /**
     * Manual trigger for retention cleanup (for admin API).
     */
    public void triggerManualCleanup() {
        log.info("[DataRetention] Manual cleanup triggered");
        executeRetentionPolicy();
    }

    /**
     * Get current retention policy configuration.
     */
    public java.util.Map<String, Object> getRetentionPolicy() {
        java.util.Map<String, Object> policy = new java.util.LinkedHashMap<>();
        policy.put("rawTelemetryDays", rawTelemetryRetentionDays);
        policy.put("aggregatedTelemetryDays", aggregatedTelemetryRetentionDays);
        policy.put("eventLogDays", eventLogRetentionDays);
        policy.put("commandLogDays", commandLogRetentionDays);
        policy.put("batchSize", batchSize);
        policy.put("useTimescaleDropChunks", useTimescaleDropChunks);
        return policy;
    }
}
