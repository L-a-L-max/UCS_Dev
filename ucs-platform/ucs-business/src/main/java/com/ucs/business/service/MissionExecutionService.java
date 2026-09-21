package com.ucs.business.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ucs.business.dto.ControlCommandRequest;
import com.ucs.business.dto.ControlCommandResponse;
import com.ucs.business.entity.Drone;
import com.ucs.business.entity.Task;
import com.ucs.business.entity.TaskWaypoint;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 航点任务的指令下发。
 *
 * 只负责把任务翻译成网关能懂的 START_MISSION / UPDATE_MISSION / ABORT_MISSION
 * 三条指令，并通过既有的 {@link ControlService#sendControlCommand} 下发。
 *
 * 之所以复用 ControlService 而不是直接调 Kafka 生产者，是为了让航点任务
 * 与手动单点控制走完全相同的链路：同样的归属校验、同样的在线判断、
 * 同样的 command_log / operation_log 记录。权限规则不做任何改动。
 *
 * 指令参数结构（params 字段是一个 JSON 字符串）：
 * <pre>
 * START_MISSION:
 * {
 *   "taskId": 12,
 *   "taskName": "巡检A线",
 *   "missionId": "a1b2c3...",
 *   "arrivalRadius": 3.0,
 *   "arrivalAltTol": 2.0,
 *   "waypointTimeoutSec": 300,     // 操作人员可配置的单点超时保护
 *   "onFinish": "HOLD",
 *   "waypoints": [
 *     {"seq":0,"type":"NAV","lat":30.1,"lon":120.1,"alt":30,"holdTime":0},
 *     {"seq":1,"type":"ACTION","action":"CAMERA_CAPTURE","actionParams":{}}
 *   ]
 * }
 *
 * UPDATE_MISSION: 同上，额外带 "fromSeq"（-1 表示连当前这一段也立即改向）
 * ABORT_MISSION:  {"taskId":12,"missionId":"...","onAbort":"HOLD"}
 * </pre>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MissionExecutionService {

    public static final String CMD_START = "START_MISSION";
    public static final String CMD_UPDATE = "UPDATE_MISSION";
    public static final String CMD_ABORT = "ABORT_MISSION";

    private final ControlService controlService;
    private final ObjectMapper objectMapper;

    /** 下发结果：成功时带 missionId，失败时带可展示给操作人员的原因 */
    public record DispatchResult(boolean success, String missionId, String message) {
        public static DispatchResult ok(String missionId) {
            return new DispatchResult(true, missionId, null);
        }
        public static DispatchResult fail(String message) {
            return new DispatchResult(false, null, message);
        }
    }

    /**
     * 下发任务开始指令。
     *
     * @param timeoutSec 本次执行生效的单点超时保护（秒），由操作人员配置
     */
    public DispatchResult startMission(Task task, Drone drone, List<TaskWaypoint> waypoints,
                                        int timeoutSec, float arrivalRadius, float arrivalAltTol,
                                        String onFinish, Long userId, String username) {
        String missionId = UUID.randomUUID().toString().replace("-", "");

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("taskId", task.getId());
        payload.put("taskName", task.getTaskName());
        payload.put("missionId", missionId);
        payload.put("arrivalRadius", arrivalRadius);
        payload.put("arrivalAltTol", arrivalAltTol);
        payload.put("waypointTimeoutSec", timeoutSec);
        payload.put("onFinish", onFinish != null ? onFinish : "HOLD");
        payload.put("waypoints", toWaypointPayload(waypoints));

        DispatchResult result = dispatch(drone, CMD_START, payload, userId, username);
        if (!result.success()) {
            log.warn("[Mission] START_MISSION dispatch failed for {} (task={}): {}",
                    drone.getUavId(), task.getId(), result.message());
            return result;
        }
        log.info("[Mission] START_MISSION -> {} task={} missionId={} waypoints={} timeout={}s",
                drone.getUavId(), task.getId(), missionId, waypoints.size(), timeoutSec);
        return DispatchResult.ok(missionId);
    }

    /**
     * 执行中改航。
     *
     * @param fromSeq 从该序号起替换；-1 表示连当前正在飞的这一段也立即改向
     */
    public boolean updateMission(Task task, Drone drone, List<TaskWaypoint> waypoints,
                                  int fromSeq, Long userId, String username) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("taskId", task.getId());
        payload.put("fromSeq", fromSeq);
        payload.put("waypointTimeoutSec", task.getWaypointTimeoutSec());
        payload.put("waypoints", toWaypointPayload(waypoints));

        DispatchResult result = dispatch(drone, CMD_UPDATE, payload, userId, username);
        log.info("[Mission] UPDATE_MISSION -> {} task={} fromSeq={} ok={}",
                drone.getUavId(), task.getId(), fromSeq, result.success());
        return result.success();
    }

    /** 中止任务，无人机原地悬停 */
    public boolean abortMission(Task task, Drone drone, Long userId, String username) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("taskId", task.getId());
        payload.put("onAbort", "HOLD");

        DispatchResult result = dispatch(drone, CMD_ABORT, payload, userId, username);
        log.info("[Mission] ABORT_MISSION -> {} task={} ok={}",
                drone.getUavId(), task.getId(), result.success());
        return result.success();
    }

    // ------------------------------------------------------------------

    /**
     * 把航点序列转成网关的紧凑格式。
     *
     * ACTION 项的 actionParams 存的是 JSON 字符串，这里解析成对象再塞进去，
     * 免得网关拿到一层转义后的字符串。
     */
    private List<Map<String, Object>> toWaypointPayload(List<TaskWaypoint> waypoints) {
        List<Map<String, Object>> items = new ArrayList<>(waypoints.size());
        for (TaskWaypoint w : waypoints) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("seq", w.getSeq());
            item.put("label", w.getDisplayLabel());
            if (w.isNav()) {
                item.put("type", TaskWaypoint.TYPE_NAV);
                item.put("lat", w.getLatitude());
                item.put("lon", w.getLongitude());
                item.put("alt", w.getAltitude());
                item.put("holdTime", w.getHoldTime() != null ? w.getHoldTime() : 0);
            } else {
                item.put("type", TaskWaypoint.TYPE_ACTION);
                item.put("action", w.getActionCommand());
                item.put("actionParams", parseActionParams(w.getActionParams()));
            }
            items.add(item);
        }
        return items;
    }

    private Object parseActionParams(String raw) {
        if (raw == null || raw.isBlank()) return Map.of();
        try {
            return objectMapper.readTree(raw);
        } catch (Exception e) {
            log.warn("[Mission] Invalid actionParams JSON, sending as empty: {}", e.getMessage());
            return Map.of();
        }
    }

    /**
     * 走既有控制链路下发。ControlService 内部会做归属校验、在线校验、
     * command_log 记录并投递到 Kafka commands.down，这里不绕过其中任何一环。
     */
    private DispatchResult dispatch(Drone drone, String commandType, Map<String, Object> payload,
                                     Long userId, String username) {
        String params;
        try {
            params = objectMapper.writeValueAsString(payload);
        } catch (Exception e) {
            log.error("[Mission] Failed to serialize {} payload: {}", commandType, e.getMessage(), e);
            return DispatchResult.fail("指令序列化失败");
        }

        ControlCommandRequest request = new ControlCommandRequest();
        request.setUavId(drone.getUavId());
        request.setCommandType(commandType);
        request.setParams(params);

        ControlCommandResponse response =
                controlService.sendControlCommand(request, userId, username);
        if (response == null) {
            return DispatchResult.fail("控制服务无响应");
        }
        if (!"ACCEPTED".equals(response.getStatus())) {
            return DispatchResult.fail(response.getMessage() != null
                    ? response.getMessage() : "指令被拒绝");
        }
        return DispatchResult.ok(null);
    }
}
