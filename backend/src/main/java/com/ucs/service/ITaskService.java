package com.ucs.service;

import com.ucs.dto.TaskSummaryDTO;
import com.ucs.entity.Task;

import java.util.List;

/**
 * Task Service Interface
 * Following MyBatis-Plus convention with I prefix for interfaces
 */
public interface ITaskService {
    
    /**
     * Get task summary for dashboard
     */
    TaskSummaryDTO getTaskSummary();
    
    /**
     * Get tasks by team ID
     */
    List<Task> getTasksByTeamId(Long teamId);
    
    /**
     * Get tasks by user ID
     */
    List<Task> getTasksByUserId(Long userId);
    
    /**
     * Create new task
     */
    Task createTask(Task task);
    
    /**
     * Update task status
     */
    Task updateTaskStatus(Long taskId, String status);
    
    /**
     * Get task by ID
     */
    Task getTaskById(Long taskId);
}
