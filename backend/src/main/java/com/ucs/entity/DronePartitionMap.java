package com.ucs.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * Maps drones to Zenoh partitions.
 * Each drone belongs to one or more partitions for data distribution.
 * Partition naming convention: partition_{teamName}_{phone} or partition_{uavId}
 */
@Data
@Entity
@Table(name = "drone_partition_map", indexes = {
    @Index(name = "idx_partition_drone_id", columnList = "drone_id"),
    @Index(name = "idx_partition_name", columnList = "partition_name")
})
public class DronePartitionMap {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "drone_id", nullable = false)
    private Long droneId;
    
    @Column(name = "uav_id", length = 50)
    private String uavId;
    
    @Column(name = "partition_name", nullable = false, length = 200)
    private String partitionName;
    
    @Column(name = "is_active", columnDefinition = "BOOLEAN DEFAULT TRUE")
    private Boolean isActive = true;
    
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
