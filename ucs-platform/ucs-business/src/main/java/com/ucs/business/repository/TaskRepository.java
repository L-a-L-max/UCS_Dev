package com.ucs.business.repository;

import com.ucs.business.entity.Task;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface TaskRepository extends JpaRepository<Task, Long> {
    List<Task> findByCreatedBy(Long userId);
    List<Task> findByStatus(Integer status);
    
    @Query("SELECT COUNT(t) FROM Task t WHERE t.status = :status")
    Long countByStatus(Integer status);
    
    @Query("SELECT t FROM Task t WHERE t.id IN " +
           "(SELECT ta.taskId FROM TaskAssignment ta WHERE ta.userId = :userId)")
    List<Task> findByAssignedUserId(Long userId);

    /** 任务重名校验：同一创建人下任务名唯一 */
    boolean existsByCreatedByAndTaskName(Long createdBy, String taskName);

    /** 修改任务名时排除自身 */
    boolean existsByCreatedByAndTaskNameAndIdNot(Long createdBy, String taskName, Long id);

    List<Task> findByCreatedByOrderByCreatedAtDesc(Long createdBy);

    List<Task> findByCreatedByOrderByCreatedAtAsc(Long createdBy);
}
