package com.ucs.service.impl;

import com.ucs.dto.CreateTaskRequest;
import com.ucs.dto.TaskDTO;
import com.ucs.dto.TaskSummaryDTO;
import com.ucs.entity.Task;
import com.ucs.entity.TaskAssignment;
import com.ucs.entity.TaskDroneMap;
import com.ucs.repository.TaskAssignmentRepository;
import com.ucs.repository.TaskDroneMapRepository;
import com.ucs.repository.TaskRepository;
import com.ucs.service.IDroneService;
import com.ucs.service.ITaskService;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Task Service Implementation
 * Following MyBatis-Plus convention with ServiceImpl pattern
 */
@Service
public class TaskServiceImpl implements ITaskService {
    
    private final TaskRepository taskRepository;
    private final TaskAssignmentRepository taskAssignmentRepository;
    private final TaskDroneMapRepository taskDroneMapRepository;
    private final IDroneService droneService;
    
    public TaskServiceImpl(TaskRepository taskRepository,
                           TaskAssignmentRepository taskAssignmentRepository,
                           TaskDroneMapRepository taskDroneMapRepository,
                           @Lazy IDroneService droneService) {
        this.taskRepository = taskRepository;
        this.taskAssignmentRepository = taskAssignmentRepository;
        this.taskDroneMapRepository = taskDroneMapRepository;
        this.droneService = droneService;
    }
    
    @Override
    public TaskSummaryDTO getTaskSummary() {
        TaskSummaryDTO summary = new TaskSummaryDTO();
        summary.setTotal(taskRepository.count());
        summary.setPending(taskRepository.countByStatus(0));
        summary.setExecuting(taskRepository.countByStatus(1));
        summary.setCompleted(taskRepository.countByStatus(3));
        summary.setAbnormal(taskRepository.countByStatus(4));
        return summary;
    }
    
    @Override
    public List<Task> getTasksByTeamId(Long teamId) {
        // No findByTeamId method exists in TaskRepository
        // Return all tasks for now - can be filtered by team when method is added
        return taskRepository.findAll();
    }
    
    @Override
    public List<Task> getTasksByUserId(Long userId) {
        return taskRepository.findByAssignedUserId(userId);
    }
    
    @Override
    @Transactional
    public Task createTask(Task task) {
        return taskRepository.save(task);
    }
    
    @Override
    @Transactional
    public Task updateTaskStatus(Long taskId, String status) {
        Task task = taskRepository.findById(taskId)
                .orElseThrow(() -> new RuntimeException("Task not found"));
        task.setStatus(parseStatus(status));
        return taskRepository.save(task);
    }
    
    @Override
    public Task getTaskById(Long taskId) {
        return taskRepository.findById(taskId)
                .orElseThrow(() -> new RuntimeException("Task not found"));
    }
    
    public List<TaskDTO> getTaskDTOsByUserId(Long userId) {
        List<Task> tasks = taskRepository.findByAssignedUserId(userId);
        return tasks.stream().map(this::convertToDTO).collect(Collectors.toList());
    }
    
    public List<TaskDTO> getAllTaskDTOs() {
        List<Task> tasks = taskRepository.findAll();
        return tasks.stream().map(this::convertToDTO).collect(Collectors.toList());
    }
    
    @Transactional
    public Task createTask(CreateTaskRequest request, Long createdBy) {
        Task task = new Task();
        task.setTaskName(request.getTaskName());
        task.setTaskType(request.getTaskType());
        task.setDescription(request.getDescription());
        task.setPriority(request.getPriority() != null ? request.getPriority() : 0);
        task.setStartTime(request.getStartTime());
        task.setEndTime(request.getEndTime());
        task.setCreatedBy(createdBy);
        task.setStatus(0);
        task = taskRepository.save(task);
        
        if (request.getAssignedUserIds() != null) {
            for (String userIdStr : request.getAssignedUserIds()) {
                Long userId = parseUserId(userIdStr);
                TaskAssignment assignment = new TaskAssignment();
                assignment.setTaskId(task.getId());
                assignment.setUserId(userId);
                assignment.setRole("EXECUTOR");
                taskAssignmentRepository.save(assignment);
            }
        }
        
        if (request.getAssignedDroneIds() != null) {
            for (String droneIdStr : request.getAssignedDroneIds()) {
                Long droneId = droneService.parseDroneId(droneIdStr);
                TaskDroneMap droneMap = new TaskDroneMap();
                droneMap.setTaskId(task.getId());
                droneMap.setDroneId(droneId);
                droneMap.setProgress(0f);
                droneMap.setStatus(0);
                taskDroneMapRepository.save(droneMap);
            }
        }
        
        return task;
    }
    
    private TaskDTO convertToDTO(Task task) {
        TaskDTO dto = new TaskDTO();
        dto.setTaskId("TASK_" + String.format("%02d", task.getId()));
        dto.setTaskName(task.getTaskName());
        dto.setTaskType(task.getTaskType());
        dto.setStartTime(task.getStartTime());
        dto.setEndTime(task.getEndTime());
        dto.setStatus(getStatusString(task.getStatus()));
        dto.setPriority(task.getPriority());
        dto.setDescription(task.getDescription());
        
        List<TaskDroneMap> droneMaps = taskDroneMapRepository.findByTaskId(task.getId());
        if (!droneMaps.isEmpty()) {
            float avgProgress = (float) droneMaps.stream()
                    .mapToDouble(TaskDroneMap::getProgress)
                    .average()
                    .orElse(0);
            dto.setProgress(avgProgress);
        } else {
            dto.setProgress(0f);
        }
        
        return dto;
    }
    
    private String getStatusString(Integer status) {
        if (status == null) return "UNKNOWN";
        return switch (status) {
            case 0 -> "PENDING";
            case 1 -> "EXECUTING";
            case 2 -> "PAUSED";
            case 3 -> "COMPLETED";
            case 4 -> "ABNORMAL";
            default -> "UNKNOWN";
        };
    }
    
    private Integer parseStatus(String status) {
        return switch (status.toUpperCase()) {
            case "PENDING" -> 0;
            case "EXECUTING" -> 1;
            case "PAUSED" -> 2;
            case "COMPLETED" -> 3;
            case "ABNORMAL" -> 4;
            default -> 0;
        };
    }
    
    private Long parseUserId(String userId) {
        if (userId.startsWith("U")) {
            return Long.parseLong(userId.substring(1));
        }
        return Long.parseLong(userId);
    }
}
