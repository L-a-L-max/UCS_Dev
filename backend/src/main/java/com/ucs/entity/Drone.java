package com.ucs.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "drones")
public class Drone {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "drone_sn", nullable = false, unique = true, length = 100)
    private String droneSn;
    
    @Column(length = 100)
    private String model;
    
    @Column(length = 100)
    private String manufacturer;
    
    @Column(columnDefinition = "JSON")
    private String capabilities;
    
    @Column(name = "default_team_id")
    private Long defaultTeamId;
    
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
