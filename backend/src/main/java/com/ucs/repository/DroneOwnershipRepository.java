package com.ucs.repository;

import com.ucs.entity.DroneOwnership;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public interface DroneOwnershipRepository extends JpaRepository<DroneOwnership, Long> {
    @Query("SELECT do FROM DroneOwnership do WHERE do.userId = :userId AND do.expiredAt IS NULL")
    List<DroneOwnership> findActiveByUserId(Long userId);
    
    @Query("SELECT do FROM DroneOwnership do WHERE do.droneId = :droneId AND do.expiredAt IS NULL")
    Optional<DroneOwnership> findActiveByDroneId(Long droneId);
    
    @Query("SELECT do.droneId FROM DroneOwnership do WHERE do.userId = :userId AND do.expiredAt IS NULL")
    List<Long> findDroneIdsByUserId(Long userId);
}
