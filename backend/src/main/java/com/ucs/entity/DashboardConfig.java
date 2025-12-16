package com.ucs.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "dashboard_config")
public class DashboardConfig {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "config_name", length = 100)
    private String configName;
    
    @Column(name = "display_layers", columnDefinition = "JSON")
    private String displayLayers;
    
    @Column(name = "auto_refresh_interval")
    private Integer autoRefreshInterval;
    
    @Column(name = "created_at")
    private LocalDateTime createdAt;
    
    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
