package com.ucs.business.repository;

import com.ucs.business.entity.UavLatestState;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Repository for UAV latest state data
 */
@Repository
public interface UavLatestStateRepository extends JpaRepository<UavLatestState, String> {
    
    /**
     * Find all active UAVs
     */
    List<UavLatestState> findByIsActiveTrue();
    
    /**
     * Find all UAVs ordered by ID
     */
    List<UavLatestState> findAllByOrderByUavIdAsc();
}
