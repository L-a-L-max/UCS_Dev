package com.ucs.entity;

import jakarta.persistence.*;
import lombok.Data;

@Data
@Entity
@Table(name = "drone_specs")
public class DroneSpec {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    @Column(name = "drone_id", nullable = false)
    private Long droneId;
    
    @Column(name = "max_flight_time")
    private Integer maxFlightTime;
    
    @Column(name = "max_speed")
    private Float maxSpeed;
    
    @Column
    private Float weight;
    
    @Column(columnDefinition = "JSON")
    private String sensors;
    
    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "drone_id", insertable = false, updatable = false)
    private Drone drone;
}
