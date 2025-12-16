package com.ucs.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "weather_snapshot")
public class WeatherSnapshot {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column
    private Float temperature;
    
    @Column
    private Float humidity;
    
    @Column(name = "wind_speed")
    private Float windSpeed;
    
    @Column(name = "wind_direction")
    private Float windDirection;
    
    @Column(name = "risk_level", length = 20)
    private String riskLevel;
    
    @Column(length = 100)
    private String location;
    
    @Column(name = "created_at")
    private LocalDateTime createdAt;
    
    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
