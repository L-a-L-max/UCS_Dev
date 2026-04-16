package com.ucs.common.feign;

import com.ucs.common.dto.ApiResponse;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.List;
import java.util.Map;

/**
 * T-68: OpenFeign client for ucs-telemetry-store service.
 * Provides type-safe HTTP calls with FallbackFactory for graceful degradation.
 */
@FeignClient(
        name = "ucs-telemetry-store",
        url = "${ucs.feign.telemetry-store-url:http://localhost:8082}",
        fallbackFactory = TelemetryStoreClient.TelemetryStoreClientFallbackFactory.class
)
public interface TelemetryStoreClient {

    @GetMapping("/api/v1/telemetry/latest")
    ApiResponse<List<Map<String, Object>>> getLatestTelemetry(@RequestParam("uavId") String uavId);

    @GetMapping("/api/v1/telemetry/history")
    ApiResponse<List<Map<String, Object>>> getTelemetryHistory(
            @RequestParam("uavId") String uavId,
            @RequestParam("from") String from,
            @RequestParam("to") String to
    );

    class TelemetryStoreClientFallbackFactory implements org.springframework.cloud.openfeign.FallbackFactory<TelemetryStoreClient> {
        @Override
        public TelemetryStoreClient create(Throwable cause) {
            return new TelemetryStoreClient() {
                @Override
                public ApiResponse<List<Map<String, Object>>> getLatestTelemetry(String uavId) {
                    return ApiResponse.fail(503, "Telemetry store unavailable: " + cause.getMessage());
                }
                @Override
                public ApiResponse<List<Map<String, Object>>> getTelemetryHistory(String uavId, String from, String to) {
                    return ApiResponse.fail(503, "Telemetry store unavailable: " + cause.getMessage());
                }
            };
        }
    }
}
