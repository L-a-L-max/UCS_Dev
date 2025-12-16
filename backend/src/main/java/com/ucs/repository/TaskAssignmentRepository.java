package com.ucs.repository;

import com.ucs.entity.TaskAssignment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface TaskAssignmentRepository extends JpaRepository<TaskAssignment, Long> {
    List<TaskAssignment> findByTaskId(Long taskId);
    List<TaskAssignment> findByUserId(Long userId);
    
    @Query("SELECT ta FROM TaskAssignment ta JOIN FETCH ta.task WHERE ta.userId = :userId")
    List<TaskAssignment> findByUserIdWithTask(Long userId);
}
