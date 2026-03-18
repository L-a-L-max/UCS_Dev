package com.ucs.entity;

import jakarta.persistence.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * Rally Point entity for drone return-to-rally operations.
 * Rally points are predefined landing/staging locations that drones
 * can be directed to return to, with capacity management.
 */
@Data
@Entity
@Table(name = "rally_point", indexes = {
    @Index(name = "idx_rally_point_status", columnList = "status"),
    @Index(name = "idx_rally_point_scope", columnList = "scope"),
    @Index(name = "idx_rally_point_team", columnList = "team_id"),
    @Index(name = "idx_rally_point_name", columnList = "name")
})
public class RallyPoint {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false)
    private Double latitude;

    @Column(nullable = false)
    private Double longitude;

    @Column
    private Float altitude;

    /** City from reverse geocoding */
    @Column(length = 100)
    private String city;

    @Column(length = 200)
    private String address;

    /** Maximum number of drones that can use this rally point */
    @Column(nullable = false)
    private Integer capacity = 10;

    /** Current number of drones occupying this rally point */
    @Column(name = "current_occupancy", nullable = false)
    private Integer currentOccupancy = 0;

    /**
     * Status: 0=disabled, 1=enabled, 2=maintenance
     */
    @Column(nullable = false)
    private Integer status = 1;

    /**
     * Scope: 0=global (all teams), 1=team-specific
     */
    @Column(nullable = false)
    private Integer scope = 0;

    /** Team ID if scope=1 (team-specific) */
    @Column(name = "team_id", length = 50)
    private String teamId;

    /** Acceptance radius in meters (default 5.0m) */
    @Column(nullable = false)
    private Float radius = 5.0f;

    /**
     * Service type: 0=parking, 1=charging, 2=maintenance, 3=supply
     */
    @Column(name = "service_type", nullable = false)
    private Integer serviceType = 0;

    @Column(length = 500)
    private String description;

    @Column(name = "created_by", length = 50)
    private String createdBy;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;

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
