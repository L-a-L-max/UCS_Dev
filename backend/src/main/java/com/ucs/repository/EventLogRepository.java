package com.ucs.repository;

import com.ucs.entity.EventLog;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface EventLogRepository extends JpaRepository<EventLog, Long> {
    List<EventLog> findByDroneId(Long droneId);
    
    @Query("SELECT e FROM EventLog e ORDER BY e.createdAt DESC")
    List<EventLog> findLatest(Pageable pageable);
    
    @Query("SELECT e FROM EventLog e WHERE e.level = 'WARN' OR e.level = 'ERROR' ORDER BY e.createdAt DESC")
    List<EventLog> findAlerts(Pageable pageable);
}
