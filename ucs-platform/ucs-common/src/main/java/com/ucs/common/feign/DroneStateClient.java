package com.ucs.common.feign;

import com.ucs.common.dto.ApiResponse;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

import java.util.Map;

/**
 * T-68: OpenFeign client for ucs-drone-state service.
 * Provides type-safe HTTP calls with FallbackFactory for graceful degradation.
 */
@FeignClient(
        name = "ucs-drone-state",
        url = "${ucs.feign.drone-state-url:http://localhost:8085}",
        fallbackFactory = DroneStateClient.DroneStateClientFallbackFactory.class
)
public interface DroneStateClient {

    @GetMapping("/api/v1/drones/{uavId}/state")
    ApiResponse<Map<String, Object>> getDroneState(@PathVariable("uavId") String uavId);

    @GetMapping("/api/v1/drones/online")
    ApiResponse<Map<String, Object>> getOnlineDrones();

    class DroneStateClientFallbackFactory implements org.springframework.cloud.openfeign.FallbackFactory<DroneStateClient> {
        @Override
        public DroneStateClient create(Throwable cause) {
            return new DroneStateClient() {
                @Override
                public ApiResponse<Map<String, Object>> getDroneState(String uavId) {
                    return ApiResponse.fail(503, "Drone state service unavailable: " + cause.getMessage());
                }
                @Override
                public ApiResponse<Map<String, Object>> getOnlineDrones() {
                    return ApiResponse.fail(503, "Drone state service unavailable: " + cause.getMessage());
                }
            };
        }
    }
}
