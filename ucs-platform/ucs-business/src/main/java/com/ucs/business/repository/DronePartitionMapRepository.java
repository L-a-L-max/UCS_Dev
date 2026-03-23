package com.ucs.business.repository;

import com.ucs.business.entity.DronePartitionMap;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface DronePartitionMapRepository extends JpaRepository<DronePartitionMap, Long> {
    
    List<DronePartitionMap> findByDroneIdAndIsActiveTrue(Long droneId);
    
    List<DronePartitionMap> findByUavIdAndIsActiveTrue(String uavId);
    
    List<DronePartitionMap> findByPartitionNameAndIsActiveTrue(String partitionName);
    
    @Query("SELECT DISTINCT d.partitionName FROM DronePartitionMap d WHERE d.uavId = :uavId AND d.isActive = true")
    List<String> findActivePartitionNamesByUavId(String uavId);
    
    @Query("SELECT DISTINCT d.uavId FROM DronePartitionMap d WHERE d.partitionName = :partitionName AND d.isActive = true")
    List<String> findActiveUavIdsByPartitionName(String partitionName);
}
