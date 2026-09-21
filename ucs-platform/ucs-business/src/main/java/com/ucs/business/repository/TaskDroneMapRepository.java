package com.ucs.business.repository;

import com.ucs.business.entity.TaskDroneMap;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public interface TaskDroneMapRepository extends JpaRepository<TaskDroneMap, Long> {
    List<TaskDroneMap> findByTaskId(Long taskId);
    List<TaskDroneMap> findByDroneId(Long droneId);

    List<TaskDroneMap> findByTaskIdAndStatus(Long taskId, Integer status);

    long countByTaskIdAndStatus(Long taskId, Integer status);

    Optional<TaskDroneMap> findByTaskIdAndDroneId(Long taskId, Long droneId);

    /** 查询某架无人机当前正在执行的任务映射（status=1 执行中） */
    List<TaskDroneMap> findByDroneIdAndStatus(Long droneId, Integer status);

    /** 批量查询多架无人机正在执行的任务映射，用于无人机卡片展示任务名 */
    @Query("SELECT m FROM TaskDroneMap m WHERE m.droneId IN :droneIds AND m.status = :status")
    List<TaskDroneMap> findByDroneIdInAndStatus(List<Long> droneIds, Integer status);

    @Modifying
    @Query("DELETE FROM TaskDroneMap m WHERE m.taskId = :taskId")
    void deleteByTaskId(Long taskId);
}
