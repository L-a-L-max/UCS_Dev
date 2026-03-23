package com.ucs.common.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * Viewport request DTO for frontend viewport clipping (Phase 4.4).
 * Frontend sends current map viewport bounds so backend can filter drones.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ViewportRequest implements Serializable {

    private double minLat;
    private double maxLat;
    private double minLon;
    private double maxLon;
    private int zoomLevel;
}
