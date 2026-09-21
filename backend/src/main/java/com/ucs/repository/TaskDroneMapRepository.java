package com.ucs.repository;

import com.ucs.entity.TaskDroneMap;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface TaskDroneMapRepository extends JpaRepository<TaskDroneMap, Long> {
    List<TaskDroneMap> findByTaskId(Long taskId);
    List<TaskDroneMap> findByDroneId(Long droneId);
}
