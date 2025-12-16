package com.ucs.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "drone_network_status")
public class DroneNetworkStatus {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "drone_id", nullable = false)
    private Long droneId;
    
    @Column(name = "network_type", length = 50)
    private String networkType;
    
    @Column(name = "signal_strength")
    private Float signalStrength;
    
    @Column
    private Float latency;
    
    @Column
    private LocalDateTime timestamp;
    
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "drone_id", insertable = false, updatable = false)
    private Drone drone;
    
    @PrePersist
    protected void onCreate() {
        timestamp = LocalDateTime.now();
    }
}
