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

    /**
     * T-18: Batch query — fetch all active tasks assigned to any user in the list.
     * Replaces N individual queries with 1 batch query for N+1 optimization.
     * Active tasks: status = 1 (IN_PROGRESS)
     */
    @Query("SELECT t FROM Task t WHERE t.status = 1 AND t.id IN " +
           "(SELECT ta.taskId FROM TaskAssignment ta WHERE ta.userId IN :userIds)")
    List<Task> findActiveByAssignedUserIdIn(List<Long> userIds);
}
