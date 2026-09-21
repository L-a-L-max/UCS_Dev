package com.ucs.repository;

import com.ucs.entity.Task;
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
}
