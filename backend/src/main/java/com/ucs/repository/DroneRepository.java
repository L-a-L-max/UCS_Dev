package com.ucs.repository;

import com.ucs.entity.Drone;
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
     * T-19: INSERT ON CONFLICT — 并发安全的无人机自动创建。
     * 多实例并发接收同一架新无人机遥测时，避免 DataIntegrityViolationException。
     * 使用 PostgreSQL ON CONFLICT DO NOTHING，冲突时静默跳过。
     * 返回受影响行数：1=新建成功，0=已存在（冲突跳过）。
     */
    @Modifying
    @Query(value = "INSERT INTO drones (uav_id, drone_sn, model, manufacturer, online_status, created_at, updated_at) " +
            "VALUES (:uavId, :droneSn, :model, :manufacturer, true, NOW(), NOW()) " +
            "ON CONFLICT (uav_id) DO NOTHING",
            nativeQuery = true)
    int insertOnConflictDoNothing(String uavId, String droneSn, String model, String manufacturer);
}
