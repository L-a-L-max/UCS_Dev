package com.ucs.common.feign;

import com.ucs.common.dto.ApiResponse;
import com.ucs.common.dto.CommandMessage;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

/**
 * T-68: OpenFeign client for ucs-command service.
 * Provides type-safe HTTP calls with FallbackFactory for graceful degradation.
 */
@FeignClient(
        name = "ucs-command",
        url = "${ucs.feign.command-url:http://localhost:8084}",
        fallbackFactory = CommandServiceClient.CommandServiceClientFallbackFactory.class
)
public interface CommandServiceClient {

    @PostMapping("/api/v1/commands/send")
    ApiResponse<Void> sendCommand(@RequestBody CommandMessage command);

    class CommandServiceClientFallbackFactory implements org.springframework.cloud.openfeign.FallbackFactory<CommandServiceClient> {
        @Override
        public CommandServiceClient create(Throwable cause) {
            return command -> ApiResponse.fail(503, "Command service unavailable: " + cause.getMessage());
        }
    }
}
