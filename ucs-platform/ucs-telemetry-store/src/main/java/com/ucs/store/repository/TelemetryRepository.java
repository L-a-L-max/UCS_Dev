package com.ucs.store.repository;

import com.ucs.common.dto.TelemetryMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.util.List;

/**
 * 遥测数据持久化仓库。
 * 使用 JDBC batchUpdate 写入 TimescaleDB hypertable，实现高吞吐（>50k rows/s）。
 */
@Slf4j
@Repository
@RequiredArgsConstructor
public class TelemetryRepository {

    private final JdbcTemplate jdbcTemplate;

    private static final String INSERT_SQL =
            "INSERT INTO telemetry_data (time, uav_id, latitude, longitude, altitude, " +
            "speed, heading, battery, status, epoch) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

    /**
     * Batch insert telemetry records into TimescaleDB.
     * Returns number of successfully inserted records.
     */
    public int batchInsert(List<TelemetryMessage> records) {
        try {
            int[][] results = jdbcTemplate.batchUpdate(INSERT_SQL, records, 500,
                    (PreparedStatement ps, TelemetryMessage msg) -> {
                        ps.setTimestamp(1, new Timestamp(msg.getTimestamp()));
                        ps.setString(2, msg.getUavId());
                        ps.setDouble(3, msg.getLat());
                        ps.setDouble(4, msg.getLon());
                        ps.setDouble(5, msg.getAlt());
                        ps.setDouble(6, msg.getGroundSpeed());
                        ps.setDouble(7, msg.getHeading());
                        ps.setDouble(8, msg.getBatteryPercent() != null ? msg.getBatteryPercent() : 0.0);
                        ps.setString(9, msg.getFlightMode() != null ? msg.getFlightMode() : "UNKNOWN");
                        ps.setLong(10, msg.getEpoch());
                    });

            int totalInserted = 0;
            for (int[] batchResult : results) {
                for (int r : batchResult) {
                    if (r >= 0) totalInserted++;
                }
            }
            return totalInserted;
        } catch (Exception e) {
            log.error("[Store] Batch insert failed: {}", e.getMessage());
            return 0;
        }
    }
}
