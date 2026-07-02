package com.ucs.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "users")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(nullable = false, unique = true, length = 50)
    private String username;
    
    @Column(name = "password_hash", nullable = false)
    private String passwordHash;
    
    @Column(name = "real_name", length = 100)
    private String realName;
    
    @Column(name = "avatar_url")
    private String avatarUrl;
    
    @Column(name = "pilot_license_id", length = 100)
    private String pilotLicenseId;
    
    @Column(length = 20)
    private String phone;
    
    @Column(length = 100)
    private String email;
    
    @Column(name = "team_id")
    private Long teamId;
    
    /**
     * User's subscription partition name for DDS data routing.
     * Naming rules:
     * - observer role: fixed "observer"
     * - commander role: fixed "commander"
     * - others: "{username_initials}_{id}" (e.g., zhangsan id=2 -> "zs_2", lisi id=3 -> "ls_3")
     * Computed dynamically by PartitionNameUtil.computePartitionName()
     */
    @Column(name = "partition_name", length = 100)
    private String partitionName;
    
    @Column
    private Integer status = 1;

    /**
     * Whether the user is currently online (logged in).
     * Updated by AuthService on login/logout via Kafka events.
     */
    @Column(name = "is_online")
    private Boolean isOnline = false;

    /**
     * Timestamp of last login for online duration tracking.
     */
    @Column(name = "last_login_time")
    private LocalDateTime lastLoginTime;

    /**
     * Total accumulated online time in seconds.
     * Updated on logout: onlineSeconds += (now - lastLoginTime).
     */
    @Column(name = "online_seconds")
    private Long onlineSeconds = 0L;
    
    @Column(name = "created_at")
    private LocalDateTime createdAt;
    
    @Column(name = "updated_at")
    private LocalDateTime updatedAt;
    
    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }
    
    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
