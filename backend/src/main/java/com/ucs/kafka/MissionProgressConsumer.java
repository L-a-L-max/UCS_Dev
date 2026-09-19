package com.ucs.kafka;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ucs.entity.Drone;
import com.ucs.entity.TaskDroneMap;
import com.ucs.repository.DroneRepository;
import com.ucs.repository.TaskDroneMapRepository;
import com.ucs.repository.TaskRepository;
import com.ucs.service.WaypointTaskService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * 航点任务进度消费者。
 *
 * 网关在无人机每到达一个航点、执行一个动作、或任务终结时，向 mission.progress
 * 发一条消息。后端在这里把进度落库，并通过 STOMP 推给前端。
 *
 * 之所以让网关自己判定到点、后端只做记录与监督，是因为网关的心跳循环里
 * 本来就在算与目标点的距离——在那里判定零网络延迟，比后端逐条消费遥测再算
 * 一次要省得多，也不会在切换航点时出现 200~500ms 的空档。
 *
 * 消息格式：
 * <pre>
 * {
 *   "event": "WAYPOINT_STARTED",   // ACTION_EXECUTED / MISSION_COMPLETED
 *                                  // MISSION_FAILED / MISSION_INTERRUPTED
 *   "uavId": "px4_1",
 *   "taskId": 12,
 *   "missionId": "a1b2c3...",
 *   "seq": 2,
 *   "total": 5,
 *   "label": 3.0,
 *   "reason": "waypoint timeout",  // 仅失败/中断时
 *   "timestamp": "2026-01-01T00:00:00Z"
 * }
 * </pre>
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "kafka.enabled", havingValue = "true", matchIfMissing = true)
public class MissionProgressConsumer {

    public static final String TOPIC_TASK_PROGRESS = "/topic/task-progress";
    public static final String TOPIC_TASK_ALERT = "/topic/task-alert";

    private final ObjectMapper objectMapper;
    private final SimpMessagingTemplate messagingTemplate;
    private final DroneRepository droneRepository;
    private final TaskRepository taskRepository;
    private final TaskDroneMapRepository taskDroneMapRepository;
    private final WaypointTaskService waypointTaskService;

    @KafkaListener(
            topics = "${kafka.topic.mission-progress:mission.progress}",
            groupId = "ucs-mission-progress-consumer",
            concurrency = "2"
    )
    @Transactional
    public void consumeMissionProgress(String message) {
        try {
            Map<String, Object> payload = objectMapper.readValue(
                    message, new TypeReference<Map<String, Object>>() {});

            String event = str(payload.get("event"));
            String uavId = str(payload.get("uavId"));
            Long taskId = lng(payload.get("taskId"));
            String missionId = str(payload.get("missionId"));

            if (event == null || uavId == null || taskId == null) {
                log.warn("[MissionProgress] Malformed message discarded: {}", message);
                return;
            }

            Optional<Drone> droneOpt = droneRepository.findByUavId(uavId);
            if (droneOpt.isEmpty()) {
                log.warn("[MissionProgress] Unknown uavId={}, discarded", uavId);
                return;
            }
            Long droneId = droneOpt.get().getId();

            Optional<TaskDroneMap> mapOpt =
                    taskDroneMapRepository.findByTaskIdAndDroneId(taskId, droneId);
            if (mapOpt.isEmpty()) {
                log.warn("[MissionProgress] No task_drone_map for task={} drone={}, discarded",
                        taskId, uavId);
                return;
            }
            TaskDroneMap map = mapOpt.get();

            // 丢弃上一轮执行残留的迟到消息
            if (missionId != null && map.getMissionId() != null
                    && !missionId.equals(map.getMissionId())) {
                log.info("[MissionProgress] Stale missionId={} for task={} drone={}, discarded",
                        missionId, taskId, uavId);
                return;
            }

            int seq = intOr(payload.get("seq"), -1);
            int total = intOr(payload.get("total"), 0);
            String reason = str(payload.get("reason"));

            switch (event) {
                case "WAYPOINT_STARTED", "ACTION_EXECUTED" -> {
                    map.setStatus(WaypointTaskService.STATUS_EXECUTING);
                    map.setCurrentSeq(seq);
                    map.setProgress(computeProgress(seq, total, false));
                }
                case "MISSION_COMPLETED" -> {
                    map.setStatus(WaypointTaskService.STATUS_COMPLETED);
                    map.setCurrentSeq(total > 0 ? total - 1 : seq);
                    map.setProgress(100f);
                    map.setErrorMessage(null);
                }
                case "MISSION_FAILED", "MISSION_INTERRUPTED" -> {
                    map.setStatus(WaypointTaskService.STATUS_ABNORMAL);
                    map.setCurrentSeq(seq);
                    map.setErrorMessage(reason != null ? reason : event);
                    pushAlert(taskId, uavId, event, reason);
                }
                default -> {
                    log.warn("[MissionProgress] Unknown event '{}' discarded", event);
                    return;
                }
            }
            taskDroneMapRepository.save(map);

            // 所有机都终结时收敛父任务状态
            if (!"WAYPOINT_STARTED".equals(event) && !"ACTION_EXECUTED".equals(event)) {
                waypointTaskService.rollUpTaskStatus(taskId);
            }

            pushProgress(taskId, uavId, event, map, total, reason);

            log.info("[MissionProgress] {} task={} drone={} seq={}/{} progress={}%",
                    event, taskId, uavId, seq, total, map.getProgress());

        } catch (Exception e) {
            log.error("[MissionProgress] Failed to process message: {}", e.getMessage(), e);
        }
    }

    /**
     * 进度按「已完成的航点数 / 总航点数」计算。
     * WAYPOINT_STARTED(seq=n) 表示前 n 个已经飞完，所以用 seq 而不是 seq+1。
     */
    private float computeProgress(int seq, int total, boolean finished) {
        if (finished) return 100f;
        if (total <= 0 || seq < 0) return 0f;
        return Math.min(100f, (float) seq * 100f / total);
    }

    private void pushProgress(Long taskId, String uavId, String event,
                               TaskDroneMap map, int total, String reason) {
        Map<String, Object> msg = new LinkedHashMap<>();
        msg.put("type", "task_progress");
        msg.put("event", event);
        msg.put("taskId", taskId);
        msg.put("taskName", taskRepository.findById(taskId)
                .map(t -> t.getTaskName()).orElse(null));
        msg.put("uavId", uavId);
        msg.put("droneId", map.getDroneId());
        msg.put("status", map.getStatus());
        msg.put("statusText", WaypointTaskService.statusText(map.getStatus()));
        msg.put("currentSeq", map.getCurrentSeq());
        msg.put("totalWaypoints", total);
        msg.put("progress", map.getProgress());
        msg.put("errorMessage", reason);
        msg.put("timestamp", Instant.now().toString());
        messagingTemplate.convertAndSend(TOPIC_TASK_PROGRESS, msg);
    }

    private void pushAlert(Long taskId, String uavId, String event, String reason) {
        Map<String, Object> msg = new LinkedHashMap<>();
        msg.put("type", "task_alert");
        msg.put("event", event);
        msg.put("taskId", taskId);
        msg.put("uavId", uavId);
        msg.put("reason", reason);
        msg.put("timestamp", Instant.now().toString());
        messagingTemplate.convertAndSend(TOPIC_TASK_ALERT, msg);
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static Long lng(Object o) {
        if (o instanceof Number n) return n.longValue();
        try {
            return o == null ? null : Long.parseLong(String.valueOf(o));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static int intOr(Object o, int fallback) {
        if (o instanceof Number n) return n.intValue();
        try {
            return o == null ? fallback : Integer.parseInt(String.valueOf(o));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
