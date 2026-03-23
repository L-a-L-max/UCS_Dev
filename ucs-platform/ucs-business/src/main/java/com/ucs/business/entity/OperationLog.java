package com.ucs.business.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * Operation log entity for audit trail.
 * Records all user operations: control commands, permission changes,
 * drone assignments, etc. Used for the operation log UI.
 */
@Data
@Entity
@Table(name = "operation_log", indexes = {
    @Index(name = "idx_operation_log_user_id", columnList = "user_id"),
    @Index(name = "idx_operation_log_type", columnList = "operation_type"),
    @Index(name = "idx_operation_log_created", columnList = "created_at")
})
public class OperationLog {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "user_id", nullable = false)
    private Long userId;
    
    @Column(name = "username", length = 50)
    private String username;
    
    /**
     * Operation type enum values:
     * CONTROL_COMMAND - Send control command to drone
     * PERMISSION_TRANSFER - Transfer drone control permission
     * DRONE_ASSIGN - Assign drone to user
     * DRONE_UNASSIGN - Unassign drone from user
     * TASK_CREATE - Create task
     * TASK_ASSIGN - Assign task
     * LOGIN - User login
     * LOGOUT - User logout
     */
    @Column(name = "operation_type", nullable = false, length = 50)
    private String operationType;
    
    @Column(name = "target_drone_id")
    private Long targetDroneId;
    
    @Column(name = "target_uav_id", length = 50)
    private String targetUavId;
    
    @Column(name = "target_user_id")
    private Long targetUserId;
    
    /**
     * JSON detail of the operation, e.g.:
     * {"commandType":"TAKEOFF","payload":{"altitude":50}}
     * {"fromUserId":2,"toUserId":3,"droneId":1}
     */
    @Column(length = 2000)
    private String detail;
    
    /**
     * Operation result: SUCCESS, FAILED, PENDING
     */
    @Column(length = 20)
    private String result;
    
    @Column(name = "error_message", length = 2000)
    private String errorMessage;
    
    @Column(name = "ip_address", length = 50)
    private String ipAddress;
    
    @Column(name = "created_at")
    private LocalDateTime createdAt;
    
    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
