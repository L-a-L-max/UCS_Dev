package com.ucs.business.repository;

import com.ucs.business.entity.Drone;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public interface DroneRepository extends JpaRepository<Drone, Long> {
    Optional<Drone> findByDroneSn(String droneSn);
    
    Optional<Drone> findByUavId(String uavId);
    
    List<Drone> findByDefaultTeamId(Long teamId);
    
    List<Drone> findByOnlineStatusTrue();
    
    @Query("SELECT d FROM Drone d WHERE d.id IN :ids")
    List<Drone> findByIdIn(List<Long> ids);
    
    @Query("SELECT d FROM Drone d WHERE d.uavId IN :uavIds")
    List<Drone> findByUavIdIn(List<String> uavIds);

    /**
     * T-19: INSERT ON CONFLICT — concurrent-safe drone auto-creation.
     * When multiple instances receive telemetry from the same new drone concurrently,
     * this avoids DataIntegrityViolationException.
     * Uses PostgreSQL ON CONFLICT DO NOTHING, silently skips on conflict.
     * Returns affected row count: 1=created, 0=already exists (conflict skipped).
     */
    @Modifying
    @Query(value = "INSERT INTO drones (uav_id, drone_sn, model, manufacturer, online_status, created_at, updated_at) " +
            "VALUES (:uavId, :droneSn, :model, :manufacturer, true, NOW(), NOW()) " +
            "ON CONFLICT (uav_id) DO NOTHING",
            nativeQuery = true)
    int insertOnConflictDoNothing(String uavId, String droneSn, String model, String manufacturer);
}
