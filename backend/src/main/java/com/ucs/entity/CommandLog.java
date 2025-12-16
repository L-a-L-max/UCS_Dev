package com.ucs.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "command_log")
public class CommandLog {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "drone_id", nullable = false)
    private Long droneId;
    
    @Column(name = "user_id", nullable = false)
    private Long userId;
    
    @Column(name = "command_type", nullable = false, length = 50)
    private String commandType;
    
    @Column(columnDefinition = "JSON")
    private String payload;
    
    @Column(length = 20)
    private String status;
    
    @Column(name = "created_at")
    private LocalDateTime createdAt;
    
    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
