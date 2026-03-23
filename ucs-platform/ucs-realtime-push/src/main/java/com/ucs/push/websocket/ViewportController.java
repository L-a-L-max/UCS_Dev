package com.ucs.push.websocket;

import com.ucs.common.dto.ViewportRequest;
import com.ucs.common.service.GeoSpatialService;
import com.ucs.common.service.ViewportFilterService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.stereotype.Controller;

import java.util.Set;

/**
 * WebSocket STOMP 视口控制器 (Phase 4.4)。
 * 客户端通过 /app/viewport/update 发送当前地图视口边界，
 * 后端根据视口过滤无人机并推送可见无人机列表。
 */
@Slf4j
@Controller
@RequiredArgsConstructor
public class ViewportController {

    private final ViewportFilterService viewportFilter;
    private final GeoSpatialService geoService;
    private final org.springframework.messaging.simp.SimpMessagingTemplate messagingTemplate;

    /**
     * 接收客户端视口更新。
     * Frontend: stompClient.publish({ destination: '/app/viewport/update', body: JSON.stringify(viewport) })
     */
    @MessageMapping("/viewport/update")
    public void updateViewport(@Payload ViewportRequest viewport,
                                SimpMessageHeaderAccessor headerAccessor) {
        String sessionId = headerAccessor.getSessionId();
        if (sessionId == null) return;

        viewportFilter.updateViewport(sessionId, viewport);

        // Query GeoHash index for drones in the new viewport
        Set<String> visibleDrones = geoService.getDronesInViewport(
                viewport.getMinLat(), viewport.getMaxLat(),
                viewport.getMinLon(), viewport.getMaxLon()
        );

        // Send the visible drone list back to this specific client
        messagingTemplate.convertAndSend(
                "/topic/viewport/" + sessionId,
                visibleDrones
        );

        log.debug("[Viewport] Session {} updated: zoom={}, visible drones={}",
                sessionId, viewport.getZoomLevel(), visibleDrones.size());
    }
}
