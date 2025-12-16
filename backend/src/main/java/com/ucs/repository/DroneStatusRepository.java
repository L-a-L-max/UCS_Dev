package com.ucs.repository;

import com.ucs.entity.DroneStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public interface DroneStatusRepository extends JpaRepository<DroneStatus, Long> {
    @Query("SELECT ds FROM DroneStatus ds WHERE ds.droneId = :droneId ORDER BY ds.timestamp DESC LIMIT 1")
    Optional<DroneStatus> findLatestByDroneId(Long droneId);
    
    @Query("SELECT ds FROM DroneStatus ds WHERE ds.droneId IN :droneIds AND ds.id IN " +
           "(SELECT MAX(ds2.id) FROM DroneStatus ds2 WHERE ds2.droneId IN :droneIds GROUP BY ds2.droneId)")
    List<DroneStatus> findLatestByDroneIds(List<Long> droneIds);
    
    @Query("SELECT ds FROM DroneStatus ds WHERE ds.id IN " +
           "(SELECT MAX(ds2.id) FROM DroneStatus ds2 GROUP BY ds2.droneId)")
    List<DroneStatus> findAllLatest();
    
    @Query("SELECT ds.gridX, ds.gridY, COUNT(ds) as count FROM DroneStatus ds " +
           "WHERE ds.id IN (SELECT MAX(ds2.id) FROM DroneStatus ds2 GROUP BY ds2.droneId) " +
           "GROUP BY ds.gridX, ds.gridY")
    List<Object[]> getHeatmapData();
}
