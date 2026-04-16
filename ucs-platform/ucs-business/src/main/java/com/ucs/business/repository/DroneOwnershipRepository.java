package com.ucs.business.repository;

import com.ucs.business.entity.DroneOwnership;
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

    /**
     * T-18: Batch query — fetch all active ownerships for a list of userIds in one SQL.
     * Replaces N individual queries with 1 batch query for N+1 optimization.
     */
    @Query("SELECT do FROM DroneOwnership do WHERE do.userId IN :userIds AND do.expiredAt IS NULL")
    List<DroneOwnership> findActiveByUserIdIn(List<Long> userIds);
}
