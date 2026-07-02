package com.ucs.service;

import com.ucs.dto.OperationLogDTO;
import com.ucs.entity.OperationLog;
import com.ucs.repository.OperationLogRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * Service for recording and querying operation logs.
 * All user operations (control commands, permission changes, assignments)
 * are recorded here for audit trail and the operation log UI.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OperationLogService {
    
    private final OperationLogRepository operationLogRepository;
    
    /**
     * Record an operation log entry.
     */
    public OperationLog recordOperation(Long userId, String username, String operationType,
                                         Long targetDroneId, String targetUavId,
                                         Long targetUserId, String detail,
                                         String result, String errorMessage, String ipAddress) {
        OperationLog opLog = new OperationLog();
        opLog.setUserId(userId);
        opLog.setUsername(truncate(username, 50));
        opLog.setOperationType(truncate(operationType, 50));
        opLog.setTargetDroneId(targetDroneId);
        opLog.setTargetUavId(truncate(targetUavId, 500));
        opLog.setTargetUserId(targetUserId);
        opLog.setDetail(truncate(detail, 2000));
        opLog.setResult(truncate(result, 20));
        opLog.setErrorMessage(truncate(errorMessage, 2000));
        opLog.setIpAddress(truncate(ipAddress, 50));
        
        OperationLog saved = operationLogRepository.save(opLog);
        log.info("Operation logged: user={}, type={}, target={}, result={}",
                userId, operationType, targetUavId, result);
        return saved;
    }
    
    /**
     * Quick log for successful operations.
     */
    public OperationLog logSuccess(Long userId, String username, String operationType,
                                    Long targetDroneId, String targetUavId, String detail) {
        return recordOperation(userId, username, operationType, targetDroneId, targetUavId,
                null, detail, "SUCCESS", null, null);
    }
    
    /**
     * Quick log for failed operations.
     */
    public OperationLog logFailure(Long userId, String username, String operationType,
                                    Long targetDroneId, String targetUavId, String detail,
                                    String errorMessage) {
        return recordOperation(userId, username, operationType, targetDroneId, targetUavId,
                null, detail, "FAILED", errorMessage, null);
    }
    
    /**
     * Get operation logs with pagination (all logs, newest first).
     */
    public Page<OperationLog> getAllLogs(int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return operationLogRepository.findAllByOrderByCreatedAtDesc(pageable);
    }
    
    /**
     * Get operation logs filtered by user ID.
     */
    public Page<OperationLog> getLogsByUserId(Long userId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return operationLogRepository.findByUserIdOrderByCreatedAtDesc(userId, pageable);
    }
    
    /**
     * Get operation logs filtered by operation type.
     */
    public Page<OperationLog> getLogsByOperationType(String operationType, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return operationLogRepository.findByOperationTypeOrderByCreatedAtDesc(operationType, pageable);
    }
    
    /**
     * Get operation logs filtered by target drone.
     */
    public Page<OperationLog> getLogsByDroneId(Long targetDroneId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return operationLogRepository.findByTargetDroneIdOrderByCreatedAtDesc(targetDroneId, pageable);
    }
    
    /**
     * Get operation logs filtered by multiple user IDs (for team-scoped logs).
     */
    public Page<OperationLog> getLogsByUserIds(List<Long> userIds, int page, int size) {
        if (userIds == null || userIds.isEmpty()) {
            return Page.empty();
        }
        Pageable pageable = PageRequest.of(page, size);
        return operationLogRepository.findByUserIdInOrderByCreatedAtDesc(userIds, pageable);
    }
    
    /**
     * Get a single operation log by ID.
     */
    public Optional<OperationLog> getLogById(Long id) {
        return operationLogRepository.findById(id);
    }
    
    /**
     * Get operation logs filtered by time range.
     */
    public List<OperationLog> getLogsByTimeRange(LocalDateTime startTime, LocalDateTime endTime) {
        return operationLogRepository.findByTimeRange(startTime, endTime);
    }
    
    /**
     * Convert entity to DTO.
     */
    public OperationLogDTO toDTO(OperationLog entity) {
        OperationLogDTO dto = new OperationLogDTO();
        dto.setId(entity.getId());
        dto.setUserId(entity.getUserId());
        dto.setUsername(entity.getUsername());
        dto.setOperationType(entity.getOperationType());
        dto.setTargetDroneId(entity.getTargetDroneId());
        dto.setTargetUavId(entity.getTargetUavId());
        dto.setTargetUserId(entity.getTargetUserId());
        dto.setDetail(entity.getDetail());
        dto.setResult(entity.getResult());
        dto.setErrorMessage(entity.getErrorMessage());
        dto.setCreatedAt(entity.getCreatedAt());
        return dto;
    }

    /**
     * Truncate a string to fit the database column length.
     * Prevents "value too long for type character varying(N)" errors.
     */
    private String truncate(String value, int maxLength) {
        if (value == null) return null;
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }
}
