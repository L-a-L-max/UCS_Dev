package com.ucs.business.controller;

import com.ucs.business.dto.ApiResponse;
import com.ucs.business.entity.RallyPoint;
import com.ucs.business.security.UserPrincipal;
import com.ucs.business.service.RallyPointService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * REST controller for Rally Point CRUD operations.
 * Used by the Commander interface to manage rally points.
 */
@RestController
@RequestMapping("/api/v1/rally-points")
@Tag(name = "RallyPoint", description = "Rally Point Management API")
@RequiredArgsConstructor
public class RallyPointController {

    private final RallyPointService rallyPointService;

    @PostMapping
    @Operation(summary = "Create a new rally point")
    public ApiResponse<RallyPoint> create(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestBody RallyPoint rallyPoint) {
        rallyPoint.setCreatedBy(principal.getUsername());
        RallyPoint created = rallyPointService.create(rallyPoint);
        return ApiResponse.success(created);
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update a rally point")
    public ApiResponse<RallyPoint> update(
            @PathVariable Long id,
            @RequestBody RallyPoint rallyPoint) {
        return rallyPointService.update(id, rallyPoint)
                .map(ApiResponse::success)
                .orElse(ApiResponse.error(-1, "Rally point not found: " + id));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Soft-delete a rally point")
    public ApiResponse<Map<String, Object>> delete(@PathVariable Long id) {
        boolean deleted = rallyPointService.softDelete(id);
        if (deleted) {
            return ApiResponse.success(Map.of("id", id, "deleted", true));
        }
        return ApiResponse.error(-1, "Rally point not found: " + id);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get a rally point by ID")
    public ApiResponse<RallyPoint> getById(@PathVariable Long id) {
        return rallyPointService.getById(id)
                .map(ApiResponse::success)
                .orElse(ApiResponse.error(-1, "Rally point not found: " + id));
    }

    @GetMapping
    @Operation(summary = "Get all rally points (non-deleted)")
    public ApiResponse<List<RallyPoint>> getAll() {
        return ApiResponse.success(rallyPointService.getAll());
    }

    @GetMapping("/enabled")
    @Operation(summary = "Get enabled rally points")
    public ApiResponse<List<RallyPoint>> getEnabled() {
        return ApiResponse.success(rallyPointService.getEnabled());
    }

    @GetMapping("/available")
    @Operation(summary = "Get rally points with available capacity")
    public ApiResponse<List<RallyPoint>> getAvailable() {
        return ApiResponse.success(rallyPointService.getAvailable());
    }

    @GetMapping("/team/{teamId}")
    @Operation(summary = "Get rally points accessible by a team")
    public ApiResponse<List<RallyPoint>> getByTeam(@PathVariable String teamId) {
        return ApiResponse.success(rallyPointService.getAccessibleByTeam(teamId));
    }

    @GetMapping("/search")
    @Operation(summary = "Search rally points by keyword (name, address, city)")
    public ApiResponse<List<RallyPoint>> search(@RequestParam String keyword) {
        return ApiResponse.success(rallyPointService.search(keyword));
    }

    @GetMapping("/page")
    @Operation(summary = "Get paginated rally points for commander UI")
    public ApiResponse<Page<RallyPoint>> getPage(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResponse.success(rallyPointService.getPage(page, size));
    }

    @PostMapping("/{id}/occupy")
    @Operation(summary = "Increment occupancy (drone arrives)")
    public ApiResponse<Map<String, Object>> occupy(@PathVariable Long id) {
        boolean success = rallyPointService.incrementOccupancy(id);
        if (success) {
            return ApiResponse.success(Map.of("id", id, "occupied", true));
        }
        return ApiResponse.error(-1, "Rally point full or not found: " + id);
    }

    @PostMapping("/{id}/release")
    @Operation(summary = "Decrement occupancy (drone leaves)")
    public ApiResponse<Map<String, Object>> release(@PathVariable Long id) {
        boolean success = rallyPointService.decrementOccupancy(id);
        if (success) {
            return ApiResponse.success(Map.of("id", id, "released", true));
        }
        return ApiResponse.error(-1, "Rally point empty or not found: " + id);
    }
}
