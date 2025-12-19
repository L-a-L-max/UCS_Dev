package com.ucs.controller;

import com.ucs.dto.ApiResponse;
import com.ucs.dto.UavTelemetryBatchDTO;
import com.ucs.entity.UavLatestState;
import com.ucs.entity.UavTelemetry;
import com.ucs.service.ITelemetryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;

/**
 * REST API controller for UAV telemetry data
 * Receives data from ROS 2 gateway and provides query endpoints
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/telemetry")
@RequiredArgsConstructor
@Tag(name = "Telemetry", description = "UAV Telemetry API")
public class TelemetryController {
    
    private final ITelemetryService telemetryService;
    
    /**
     * Receive batch telemetry data from ROS 2 gateway
     * This endpoint is called by the ROS 2 gateway node
     */
    @PostMapping("/batch")
    @Operation(summary = "Receive batch telemetry from ROS 2 gateway")
    public ResponseEntity<ApiResponse<Void>> receiveBatchTelemetry(
            @RequestBody UavTelemetryBatchDTO batch) {
        try {
            telemetryService.processBatchTelemetry(batch);
            return ResponseEntity.ok(ApiResponse.success(null));
        } catch (Exception e) {
            log.error("Failed to process telemetry batch", e);
            return ResponseEntity.internalServerError()
                    .body(ApiResponse.error("Failed to process telemetry: " + e.getMessage()));
        }
    }
    
    /**
     * Get all latest UAV states for dashboard
     */
    @GetMapping("/latest")
    @Operation(summary = "Get all latest UAV states")
    public ResponseEntity<ApiResponse<List<UavLatestState>>> getAllLatestStates() {
        List<UavLatestState> states = telemetryService.getAllLatestStates();
        return ResponseEntity.ok(ApiResponse.success(states));
    }
    
    /**
     * Get latest state for a specific UAV
     */
    @GetMapping("/latest/{uavId}")
    @Operation(summary = "Get latest state for a specific UAV")
    public ResponseEntity<ApiResponse<UavLatestState>> getLatestState(
            @PathVariable Integer uavId) {
        UavLatestState state = telemetryService.getLatestState(uavId);
        if (state == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(ApiResponse.success(state));
    }
    
    /**
     * Get telemetry history for path replay
     */
    @GetMapping("/history/{uavId}")
    @Operation(summary = "Get telemetry history for path replay")
    public ResponseEntity<ApiResponse<List<UavTelemetry>>> getTelemetryHistory(
            @PathVariable Integer uavId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant startTime,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant endTime) {
        List<UavTelemetry> history = telemetryService.getTelemetryHistory(uavId, startTime, endTime);
        return ResponseEntity.ok(ApiResponse.success(history));
    }
}
