package com.ucs.repository;

import com.ucs.entity.CommandLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface CommandLogRepository extends JpaRepository<CommandLog, Long> {
    List<CommandLog> findByDroneId(Long droneId);
    List<CommandLog> findByUserId(Long userId);
}
