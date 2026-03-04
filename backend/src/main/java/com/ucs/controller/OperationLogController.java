package com.ucs.controller;

import com.ucs.dto.ApiResponse;
import com.ucs.dto.OperationLogDTO;
import com.ucs.entity.OperationLog;
import com.ucs.service.OperationLogService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.data.domain.Page;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Controller for querying operation logs.
 * Provides the API backing the operation log audit UI.
 * 
 * All user operations (control commands, permission changes, assignments)
 * are queryable through this API.
 */
@RestController
@RequestMapping("/api/v1/operations")
@Tag(name = "Operation Log", description = "Operation Log Query API")
public class OperationLogController {
    
    private final OperationLogService operationLogService;
    
    public OperationLogController(OperationLogService operationLogService) {
        this.operationLogService = operationLogService;
    }
    
    /**
     * Get all operation logs with pagination.
     */
    @GetMapping("/logs")
    @Operation(summary = "Get all operation logs (paginated)")
    public ApiResponse<Map<String, Object>> getAllLogs(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        Page<OperationLog> logs = operationLogService.getAllLogs(page, size);
        return ApiResponse.success(buildPageResponse(logs));
    }
    
    /**
     * Get operation logs filtered by user ID.
     */
    @GetMapping("/logs/user/{userId}")
    @Operation(summary = "Get operation logs by user ID")
    public ApiResponse<Map<String, Object>> getLogsByUser(
            @PathVariable Long userId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        Page<OperationLog> logs = operationLogService.getLogsByUserId(userId, page, size);
        return ApiResponse.success(buildPageResponse(logs));
    }
    
    /**
     * Get operation logs filtered by operation type.
     */
    @GetMapping("/logs/type/{operationType}")
    @Operation(summary = "Get operation logs by operation type")
    public ApiResponse<Map<String, Object>> getLogsByType(
            @PathVariable String operationType,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        Page<OperationLog> logs = operationLogService.getLogsByOperationType(operationType, page, size);
        return ApiResponse.success(buildPageResponse(logs));
    }
    
    /**
     * Get operation logs filtered by drone.
     */
    @GetMapping("/logs/drone/{droneId}")
    @Operation(summary = "Get operation logs by drone ID")
    public ApiResponse<Map<String, Object>> getLogsByDrone(
            @PathVariable Long droneId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        Page<OperationLog> logs = operationLogService.getLogsByDroneId(droneId, page, size);
        return ApiResponse.success(buildPageResponse(logs));
    }
    
    /**
     * Get a single operation log detail.
     */
    @GetMapping("/logs/{logId}")
    @Operation(summary = "Get operation log detail by ID")
    public ApiResponse<OperationLogDTO> getLogDetail(@PathVariable Long logId) {
        return operationLogService.getLogById(logId)
                .map(log -> ApiResponse.success(operationLogService.toDTO(log)))
                .orElse(ApiResponse.error(-1, "Log not found"));
    }
    
    private Map<String, Object> buildPageResponse(Page<OperationLog> logs) {
        return Map.of(
                "content", logs.getContent().stream()
                        .map(operationLogService::toDTO)
                        .toList(),
                "totalElements", logs.getTotalElements(),
                "totalPages", logs.getTotalPages(),
                "currentPage", logs.getNumber(),
                "pageSize", logs.getSize()
        );
    }
}
