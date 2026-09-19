package com.ucs.service;

import com.ucs.dto.AssignedDroneDTO;
import com.ucs.dto.TaskAssignRequest;
import com.ucs.dto.TaskCreateRequest;
import com.ucs.dto.TaskDetailDTO;
import com.ucs.dto.TaskExecuteRequest;
import com.ucs.dto.WaypointDTO;
import com.ucs.entity.Drone;
import com.ucs.entity.Task;
import com.ucs.entity.TaskDroneMap;
import com.ucs.entity.TaskWaypoint;
import com.ucs.entity.User;
import com.ucs.repository.DroneOwnershipRepository;
import com.ucs.repository.DroneRepository;
import com.ucs.repository.TaskAssignmentRepository;
import com.ucs.repository.TaskDroneMapRepository;
import com.ucs.repository.TaskRepository;
import com.ucs.repository.TaskWaypointRepository;
import com.ucs.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 航点任务服务：任务的增删改查、指派、执行入口。
 *
 * 与既有 {@link TaskService} 并存——TaskService 仍服务于原有的批量指令建任务场景，
 * 本服务只负责「路径预规划」这一条业务线，互不影响。
 *
 * 权限说明：本服务不新增也不修改任何权限规则。指派时复用
 * {@link DroneOwnershipRepository#findActiveByDroneId} 这一既有归属判断，
 * 执行时的真正下发走 {@link ControlService#sendControlCommand}，
 * 其中的归属校验保持原样。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class WaypointTaskService {

    /** 任务状态 */
    public static final int STATUS_PENDING = 0;
    public static final int STATUS_EXECUTING = 1;
    public static final int STATUS_PAUSED = 2;
    public static final int STATUS_COMPLETED = 3;
    public static final int STATUS_ABNORMAL = 4;
    public static final int STATUS_ASSIGNED = 5;

    /** 单个任务最多航点数 */
    public static final int MAX_WAYPOINTS = 256;

    /** 单点超时保护的取值范围（秒） */
    public static final int MIN_WAYPOINT_TIMEOUT = 10;
    public static final int MAX_WAYPOINT_TIMEOUT = 7200;
    public static final int DEFAULT_WAYPOINT_TIMEOUT = 300;

    private static final Set<String> VALID_ON_FINISH = Set.of("HOLD", "RTL", "LAND");

    private final TaskRepository taskRepository;
    private final TaskWaypointRepository waypointRepository;
    private final TaskDroneMapRepository taskDroneMapRepository;
    private final TaskAssignmentRepository taskAssignmentRepository;
    private final DroneRepository droneRepository;
    private final DroneOwnershipRepository droneOwnershipRepository;
    private final UserRepository userRepository;
    private final RedisService redisService;
    private final MissionExecutionService missionExecutionService;

    // ------------------------------------------------------------------
    // 创建 / 修改
    // ------------------------------------------------------------------

    @Transactional
    public TaskDetailDTO createTask(TaskCreateRequest request, Long userId) {
        String name = normalizeName(request.getTaskName());
        if (taskRepository.existsByCreatedByAndTaskName(userId, name)) {
            throw new TaskConflictException("任务名称「" + name + "」已存在，请更换名称");
        }

        List<WaypointDTO> waypoints = validateWaypoints(request.getWaypoints());

        Task task = new Task();
        task.setTaskName(name);
        task.setTaskType(request.getTaskType() != null ? request.getTaskType() : "WAYPOINT");
        task.setDescription(request.getDescription());
        task.setPriority(request.getPriority() != null ? request.getPriority() : 0);
        task.setCreatedBy(userId);
        task.setStatus(STATUS_PENDING);
        task.setExecCount(0);
        applyExecutionParams(task, request.getWaypointTimeoutSec(), request.getArrivalRadius(),
                request.getArrivalAltTol(), request.getOnFinish(), true);
        task = taskRepository.save(task);

        persistWaypoints(task.getId(), waypoints);

        log.info("[Task] Created task {} (id={}) with {} waypoint(s), waypointTimeout={}s",
                name, task.getId(), waypoints.size(), task.getWaypointTimeoutSec());
        return toDetail(task, true);
    }

    /**
     * 修改任务。只有待执行 / 已完成 / 异常 / 已分配的任务可以改，
     * 执行中的任务要改航点必须走 {@link #updateWaypointsInFlight}。
     */
    @Transactional
    public TaskDetailDTO updateTask(Long taskId, TaskCreateRequest request, Long userId) {
        Task task = requireOwnedTask(taskId, userId);
        requireEditable(task);

        if (request.getTaskName() != null) {
            String name = normalizeName(request.getTaskName());
            if (taskRepository.existsByCreatedByAndTaskNameAndIdNot(userId, name, taskId)) {
                throw new TaskConflictException("任务名称「" + name + "」已存在，请更换名称");
            }
            task.setTaskName(name);
        }
        if (request.getTaskType() != null) task.setTaskType(request.getTaskType());
        if (request.getDescription() != null) task.setDescription(request.getDescription());
        if (request.getPriority() != null) task.setPriority(request.getPriority());
        applyExecutionParams(task, request.getWaypointTimeoutSec(), request.getArrivalRadius(),
                request.getArrivalAltTol(), request.getOnFinish(), false);

        if (request.getWaypoints() != null) {
            List<WaypointDTO> waypoints = validateWaypoints(request.getWaypoints());
            waypointRepository.deleteByTaskId(taskId);
            waypointRepository.flush();
            persistWaypoints(taskId, waypoints);
        }

        // 改过之后回到待执行/已分配，避免沿用上一轮的完成状态
        if (task.getStatus() == STATUS_COMPLETED || task.getStatus() == STATUS_ABNORMAL) {
            task.setStatus(taskDroneMapRepository.findByTaskId(taskId).isEmpty()
                    ? STATUS_PENDING : STATUS_ASSIGNED);
        }
        task = taskRepository.save(task);
        log.info("[Task] Updated task id={}", taskId);
        return toDetail(task, true);
    }

    @Transactional
    public void deleteTask(Long taskId, Long userId) {
        Task task = requireOwnedTask(taskId, userId);
        if (task.getStatus() == STATUS_EXECUTING) {
            throw new TaskConflictException("任务正在执行中，请先中止后再删除");
        }
        waypointRepository.deleteByTaskId(taskId);
        taskDroneMapRepository.deleteByTaskId(taskId);
        taskAssignmentRepository.findByTaskId(taskId)
                .forEach(taskAssignmentRepository::delete);
        taskRepository.delete(task);
        log.info("[Task] Deleted task id={}", taskId);
    }

    // ------------------------------------------------------------------
    // 查询
    // ------------------------------------------------------------------

    public List<TaskDetailDTO> listTasks(Long userId, String sort) {
        List<Task> tasks = "time_asc".equalsIgnoreCase(sort)
                ? taskRepository.findByCreatedByOrderByCreatedAtAsc(userId)
                : taskRepository.findByCreatedByOrderByCreatedAtDesc(userId);
        return tasks.stream().map(t -> toDetail(t, false)).collect(Collectors.toList());
    }

    public TaskDetailDTO getTaskDetail(Long taskId, Long userId) {
        Task task = requireOwnedTask(taskId, userId);
        return toDetail(task, true);
    }

    /** 进度轮询接口：只返回各机进度，比详情接口轻 */
    public Map<String, Object> getProgress(Long taskId, Long userId) {
        Task task = requireOwnedTask(taskId, userId);
        List<AssignedDroneDTO> drones = buildAssignedDrones(taskId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("taskId", taskId);
        result.put("status", task.getStatus());
        result.put("statusText", statusText(task.getStatus()));
        result.put("progress", averageProgress(drones));
        result.put("drones", drones);
        return result;
    }

    // ------------------------------------------------------------------
    // 指派
    // ------------------------------------------------------------------

    /**
     * 指派无人机。一次性覆盖该任务的无人机列表。
     *
     * 权限判断沿用既有的 drone_ownership 归属规则：只有当前持有该机控制权的
     * 用户才能把任务指派给它，规则本身不做任何改动。
     */
    @Transactional
    public TaskDetailDTO assignDrones(Long taskId, TaskAssignRequest request, Long userId) {
        Task task = requireOwnedTask(taskId, userId);
        if (task.getStatus() == STATUS_EXECUTING) {
            throw new TaskConflictException("任务正在执行中，无法重新指派");
        }
        if (request.getUavIds() == null || request.getUavIds().isEmpty()) {
            throw new TaskValidationException("请至少选择一架无人机");
        }
        if (waypointRepository.countNavByTaskId(taskId) == 0) {
            throw new TaskValidationException("任务没有任何导航航点，无法指派");
        }

        List<Drone> drones = new ArrayList<>();
        List<String> denied = new ArrayList<>();
        Set<Long> seen = new HashSet<>();
        for (String uavId : request.getUavIds()) {
            Drone drone = resolveDrone(uavId);
            if (drone == null) {
                denied.add(uavId + "（未找到）");
                continue;
            }
            if (!seen.add(drone.getId())) {
                continue;
            }
            if (!hasControlPermission(drone.getId(), userId)) {
                denied.add((drone.getUavId() != null ? drone.getUavId() : uavId) + "（无控制权限）");
                continue;
            }
            drones.add(drone);
        }
        if (!denied.isEmpty()) {
            throw new TaskValidationException("以下无人机无法指派：" + String.join("、", denied));
        }

        taskDroneMapRepository.deleteByTaskId(taskId);
        taskDroneMapRepository.flush();
        for (Drone drone : drones) {
            TaskDroneMap map = new TaskDroneMap();
            map.setTaskId(taskId);
            map.setDroneId(drone.getId());
            map.setProgress(0f);
            map.setStatus(STATUS_ASSIGNED);
            map.setCurrentSeq(-1);
            taskDroneMapRepository.save(map);
        }

        task.setStatus(STATUS_ASSIGNED);
        task = taskRepository.save(task);
        log.info("[Task] Assigned task id={} to {} drone(s)", taskId, drones.size());
        return toDetail(task, true);
    }

    // ------------------------------------------------------------------
    // 执行 / 中止 / 改航
    // ------------------------------------------------------------------

    /**
     * 执行任务：向每架已指派的无人机下发 START_MISSION。
     *
     * 单点超时等执行参数优先取本次请求中的覆盖值，其次取任务上保存的配置。
     */
    @Transactional
    public TaskDetailDTO executeTask(Long taskId, TaskExecuteRequest request,
                                      Long userId, String username) {
        Task task = requireOwnedTask(taskId, userId);
        if (task.getStatus() == STATUS_EXECUTING) {
            throw new TaskConflictException("任务已在执行中");
        }
        if (task.getStatus() != STATUS_ASSIGNED) {
            throw new TaskConflictException("任务尚未指派无人机，无法执行");
        }

        List<TaskWaypoint> waypoints = waypointRepository.findByTaskIdOrderBySeqAsc(taskId);
        if (waypoints.stream().noneMatch(TaskWaypoint::isNav)) {
            throw new TaskValidationException("任务没有任何导航航点，无法执行");
        }

        List<TaskDroneMap> maps = taskDroneMapRepository.findByTaskId(taskId);
        if (maps.isEmpty()) {
            throw new TaskConflictException("任务尚未指派无人机，无法执行");
        }

        // 本次执行的参数：请求覆盖值 > 任务保存值
        int timeoutSec = resolveTimeout(request != null ? request.getWaypointTimeoutSec() : null,
                task.getWaypointTimeoutSec());
        float radius = firstNonNull(request != null ? request.getArrivalRadius() : null,
                task.getArrivalRadius(), 3.0f);
        float altTol = firstNonNull(request != null ? request.getArrivalAltTol() : null,
                task.getArrivalAltTol(), 2.0f);
        String onFinish = normalizeOnFinish(
                request != null && request.getOnFinish() != null
                        ? request.getOnFinish() : task.getOnFinish());
        validateRadius(radius, altTol);

        if (request != null && Boolean.TRUE.equals(request.getPersistOverrides())) {
            task.setWaypointTimeoutSec(timeoutSec);
            task.setArrivalRadius(radius);
            task.setArrivalAltTol(altTol);
            task.setOnFinish(onFinish);
        }

        // 全部无人机必须在线，避免半数起飞半数掉线
        List<String> offline = new ArrayList<>();
        Map<Long, Drone> droneMap = new LinkedHashMap<>();
        for (TaskDroneMap map : maps) {
            Drone drone = droneRepository.findById(map.getDroneId()).orElse(null);
            if (drone == null || drone.getUavId() == null) {
                offline.add("droneId=" + map.getDroneId());
                continue;
            }
            droneMap.put(map.getDroneId(), drone);
            if (!redisService.isDroneOnline(drone.getUavId())) {
                offline.add(drone.getUavId());
            }
        }
        if (!offline.isEmpty()) {
            throw new TaskConflictException("以下无人机不在线，无法执行：" + String.join("、", offline));
        }

        List<String> failed = new ArrayList<>();
        for (TaskDroneMap map : maps) {
            Drone drone = droneMap.get(map.getDroneId());
            MissionExecutionService.DispatchResult result = missionExecutionService.startMission(
                    task, drone, waypoints, timeoutSec, radius, altTol, onFinish, userId, username);
            if (!result.success()) {
                failed.add(drone.getUavId() + "（" + result.message() + "）");
                map.setStatus(STATUS_ABNORMAL);
                map.setErrorMessage(result.message());
            } else {
                map.setStatus(STATUS_EXECUTING);
                map.setMissionId(result.missionId());
                map.setCurrentSeq(-1);
                map.setProgress(0f);
                map.setErrorMessage(null);
            }
            taskDroneMapRepository.save(map);
        }

        if (failed.size() == maps.size()) {
            task.setStatus(STATUS_ABNORMAL);
            taskRepository.save(task);
            throw new TaskConflictException("所有无人机的任务指令下发失败：" + String.join("、", failed));
        }

        task.setStatus(STATUS_EXECUTING);
        task.setExecCount((task.getExecCount() == null ? 0 : task.getExecCount()) + 1);
        task.setLastExecTime(LocalDateTime.now());
        task.setStartTime(LocalDateTime.now());
        task.setEndTime(null);
        task = taskRepository.save(task);

        log.info("[Task] Executing task id={} on {} drone(s), waypointTimeout={}s, radius={}m",
                taskId, maps.size() - failed.size(), timeoutSec, radius);
        return toDetail(task, true);
    }

    @Transactional
    public TaskDetailDTO abortTask(Long taskId, Long userId, String username) {
        final Task task = requireOwnedTask(taskId, userId);
        if (task.getStatus() != STATUS_EXECUTING) {
            throw new TaskConflictException("任务不在执行中，无需中止");
        }

        for (TaskDroneMap map : taskDroneMapRepository.findByTaskId(taskId)) {
            droneRepository.findById(map.getDroneId()).ifPresent(drone ->
                    missionExecutionService.abortMission(task, drone, userId, username));
            map.setStatus(STATUS_ABNORMAL);
            map.setErrorMessage("操作人员手动中止");
            taskDroneMapRepository.save(map);
        }

        task.setStatus(STATUS_ABNORMAL);
        task.setEndTime(LocalDateTime.now());
        taskRepository.save(task);
        log.info("[Task] Aborted task id={}", taskId);
        return toDetail(task, true);
    }

    /**
     * 执行中改航：替换 fromSeq 之后的航点并推送给无人机。
     *
     * @param fromSeq -1 表示连当前正在飞的这一段也一起改（立即改向）
     */
    @Transactional
    public TaskDetailDTO updateWaypointsInFlight(Long taskId, Integer fromSeq,
                                                  List<WaypointDTO> newWaypoints,
                                                  Long userId, String username) {
        Task task = requireOwnedTask(taskId, userId);
        if (task.getStatus() != STATUS_EXECUTING) {
            throw new TaskConflictException("任务不在执行中，请直接修改任务");
        }

        List<TaskWaypoint> kept = waypointRepository.findByTaskIdOrderBySeqAsc(taskId);
        int resolved = (fromSeq == null || fromSeq < 0) ? currentMinSeq(taskId) : fromSeq;
        final int cut = Math.max(resolved, 0);
        long keptCount = kept.stream().filter(w -> w.getSeq() < cut).count();
        if (keptCount + newWaypoints.size() > MAX_WAYPOINTS) {
            throw new TaskValidationException("航点总数超过上限 " + MAX_WAYPOINTS);
        }

        waypointRepository.deleteByTaskIdAndSeqGreaterThanEqual(taskId, cut);
        waypointRepository.flush();

        List<WaypointDTO> sorted = sortByLabel(newWaypoints);
        int seq = cut;
        for (WaypointDTO dto : sorted) {
            validateWaypoint(dto);
            waypointRepository.save(toEntity(taskId, dto, seq++));
        }

        List<TaskWaypoint> all = waypointRepository.findByTaskIdOrderBySeqAsc(taskId);
        for (TaskDroneMap map : taskDroneMapRepository.findByTaskIdAndStatus(taskId, STATUS_EXECUTING)) {
            droneRepository.findById(map.getDroneId()).ifPresent(drone ->
                    missionExecutionService.updateMission(task, drone, all,
                            (fromSeq == null || fromSeq < 0) ? -1 : fromSeq, userId, username));
        }

        log.info("[Task] Updated waypoints in flight for task id={} fromSeq={}", taskId, fromSeq);
        return toDetail(task, true);
    }

    // ------------------------------------------------------------------
    // 供 MissionProgressConsumer 回写
    // ------------------------------------------------------------------

    /**
     * 判断任务下所有无人机是否都已终结（完成或异常），是则收敛父任务状态。
     * 由进度消费者在每次更新单机状态后调用。
     */
    @Transactional
    public void rollUpTaskStatus(Long taskId) {
        List<TaskDroneMap> maps = taskDroneMapRepository.findByTaskId(taskId);
        if (maps.isEmpty()) return;

        boolean anyRunning = maps.stream().anyMatch(m -> m.getStatus() != null
                && m.getStatus() == STATUS_EXECUTING);
        if (anyRunning) return;

        boolean anyFailed = maps.stream().anyMatch(m -> m.getStatus() != null
                && m.getStatus() == STATUS_ABNORMAL);
        taskRepository.findById(taskId).ifPresent(task -> {
            if (task.getStatus() != STATUS_EXECUTING) return;
            task.setStatus(anyFailed ? STATUS_ABNORMAL : STATUS_COMPLETED);
            task.setEndTime(LocalDateTime.now());
            taskRepository.save(task);
            log.info("[Task] Task id={} rolled up to status={}", taskId, task.getStatus());
        });
    }

    // ------------------------------------------------------------------
    // 内部工具
    // ------------------------------------------------------------------

    /** 执行中各机当前 seq 的最小值，用于 fromSeq=-1 的立即改向 */
    private int currentMinSeq(Long taskId) {
        return taskDroneMapRepository.findByTaskIdAndStatus(taskId, STATUS_EXECUTING).stream()
                .map(TaskDroneMap::getCurrentSeq)
                .filter(s -> s != null && s >= 0)
                .min(Comparator.naturalOrder())
                .orElse(0);
    }

    private Task requireOwnedTask(Long taskId, Long userId) {
        Task task = taskRepository.findById(taskId)
                .orElseThrow(() -> new TaskNotFoundException("任务不存在：" + taskId));
        if (task.getCreatedBy() != null && !task.getCreatedBy().equals(userId)) {
            throw new TaskForbiddenException("无权操作他人创建的任务");
        }
        return task;
    }

    private void requireEditable(Task task) {
        Integer s = task.getStatus();
        if (s != null && s == STATUS_EXECUTING) {
            throw new TaskConflictException("任务正在执行中，无法修改");
        }
    }

    /** 沿用既有的 drone_ownership 归属规则，不新增权限逻辑 */
    private boolean hasControlPermission(Long droneId, Long userId) {
        return droneOwnershipRepository.findActiveByDroneId(droneId)
                .map(ownership -> ownership.getUserId().equals(userId))
                .orElse(false);
    }

    private Drone resolveDrone(String identifier) {
        if (identifier == null || identifier.isBlank()) return null;
        Optional<Drone> byUavId = droneRepository.findByUavId(identifier.trim());
        if (byUavId.isPresent()) return byUavId.get();
        try {
            return droneRepository.findById(Long.parseLong(identifier.trim())).orElse(null);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private String normalizeName(String raw) {
        String name = raw == null ? "" : raw.trim();
        if (name.isEmpty()) {
            throw new TaskValidationException("任务名称不能为空");
        }
        if (name.length() > 200) {
            throw new TaskValidationException("任务名称过长，最多 200 个字符");
        }
        return name;
    }

    private void applyExecutionParams(Task task, Integer timeoutSec, Float radius,
                                       Float altTol, String onFinish, boolean useDefaults) {
        if (timeoutSec != null || useDefaults) {
            task.setWaypointTimeoutSec(resolveTimeout(timeoutSec, DEFAULT_WAYPOINT_TIMEOUT));
        }
        if (radius != null || useDefaults) {
            task.setArrivalRadius(radius != null ? radius : 3.0f);
        }
        if (altTol != null || useDefaults) {
            task.setArrivalAltTol(altTol != null ? altTol : 2.0f);
        }
        if (onFinish != null || useDefaults) {
            task.setOnFinish(normalizeOnFinish(onFinish));
        }
        validateRadius(task.getArrivalRadius(), task.getArrivalAltTol());
    }

    private int resolveTimeout(Integer requested, Integer fallback) {
        Integer value = requested != null ? requested
                : (fallback != null ? fallback : DEFAULT_WAYPOINT_TIMEOUT);
        if (value < MIN_WAYPOINT_TIMEOUT || value > MAX_WAYPOINT_TIMEOUT) {
            throw new TaskValidationException("单点超时时间需在 " + MIN_WAYPOINT_TIMEOUT
                    + " ~ " + MAX_WAYPOINT_TIMEOUT + " 秒之间，当前值：" + value);
        }
        return value;
    }

    private void validateRadius(Float radius, Float altTol) {
        if (radius != null && (radius < 0.5f || radius > 100f)) {
            throw new TaskValidationException("到点判定半径需在 0.5 ~ 100 米之间");
        }
        if (altTol != null && (altTol < 0.5f || altTol > 100f)) {
            throw new TaskValidationException("到点高度容差需在 0.5 ~ 100 米之间");
        }
    }

    private String normalizeOnFinish(String raw) {
        if (raw == null || raw.isBlank()) return "HOLD";
        String value = raw.trim().toUpperCase();
        if (!VALID_ON_FINISH.contains(value)) {
            throw new TaskValidationException("任务结束动作只支持 HOLD / RTL / LAND");
        }
        return value;
    }

    private List<WaypointDTO> validateWaypoints(List<WaypointDTO> raw) {
        if (raw == null || raw.isEmpty()) {
            throw new TaskValidationException("请至少规划一个航点");
        }
        if (raw.size() > MAX_WAYPOINTS) {
            throw new TaskValidationException("航点数量超过上限 " + MAX_WAYPOINTS
                    + "，当前 " + raw.size());
        }
        List<WaypointDTO> sorted = sortByLabel(raw);
        Set<BigDecimal> labels = new HashSet<>();
        for (WaypointDTO dto : sorted) {
            validateWaypoint(dto);
            if (!labels.add(dto.getDisplayLabel())) {
                throw new TaskValidationException("航点编号重复：" + dto.getDisplayLabel());
            }
        }
        if (sorted.stream().noneMatch(d -> !TaskWaypoint.TYPE_ACTION.equalsIgnoreCase(d.getItemType()))) {
            throw new TaskValidationException("任务至少需要一个导航航点");
        }
        return sorted;
    }

    private void validateWaypoint(WaypointDTO dto) {
        if (dto.getDisplayLabel() == null) {
            throw new TaskValidationException("航点缺少编号");
        }
        String type = dto.getItemType() == null ? TaskWaypoint.TYPE_NAV
                : dto.getItemType().toUpperCase();
        if (TaskWaypoint.TYPE_ACTION.equals(type)) {
            if (dto.getActionCommand() == null || dto.getActionCommand().isBlank()) {
                throw new TaskValidationException("动作项 " + dto.getDisplayLabel() + " 缺少动作指令");
            }
            return;
        }
        if (!TaskWaypoint.TYPE_NAV.equals(type)) {
            throw new TaskValidationException("未知的航点类型：" + dto.getItemType());
        }
        if (dto.getLatitude() == null || dto.getLongitude() == null || dto.getAltitude() == null) {
            throw new TaskValidationException("航点 " + dto.getDisplayLabel() + " 的经纬度或高度不完整");
        }
        if (dto.getLatitude() < -90 || dto.getLatitude() > 90) {
            throw new TaskValidationException("航点 " + dto.getDisplayLabel() + " 的纬度超出范围");
        }
        if (dto.getLongitude() < -180 || dto.getLongitude() > 180) {
            throw new TaskValidationException("航点 " + dto.getDisplayLabel() + " 的经度超出范围");
        }
        if (dto.getAltitude() < 0 || dto.getAltitude() > 1000) {
            throw new TaskValidationException("航点 " + dto.getDisplayLabel()
                    + " 的相对高度需在 0 ~ 1000 米之间");
        }
    }

    /** 按展示编号数值升序——这就是最终的执行顺序（4 < 4.1 < 4.9 < 5） */
    private List<WaypointDTO> sortByLabel(List<WaypointDTO> raw) {
        List<WaypointDTO> copy = new ArrayList<>(raw);
        copy.sort(Comparator.comparing(WaypointDTO::getDisplayLabel,
                Comparator.nullsLast(Comparator.naturalOrder())));
        return copy;
    }

    private void persistWaypoints(Long taskId, List<WaypointDTO> sorted) {
        int seq = 0;
        for (WaypointDTO dto : sorted) {
            waypointRepository.save(toEntity(taskId, dto, seq++));
        }
    }

    private TaskWaypoint toEntity(Long taskId, WaypointDTO dto, int seq) {
        TaskWaypoint w = new TaskWaypoint();
        w.setTaskId(taskId);
        w.setSeq(seq);
        w.setDisplayLabel(dto.getDisplayLabel());
        w.setItemType(dto.getItemType() == null ? TaskWaypoint.TYPE_NAV
                : dto.getItemType().toUpperCase());
        w.setLatitude(dto.getLatitude());
        w.setLongitude(dto.getLongitude());
        w.setAltitude(dto.getAltitude());
        w.setHoldTime(dto.getHoldTime() != null ? dto.getHoldTime() : 0);
        w.setActionCommand(dto.getActionCommand());
        w.setActionParams(dto.getActionParams());
        return w;
    }

    private TaskDetailDTO toDetail(Task task, boolean includeWaypoints) {
        TaskDetailDTO dto = new TaskDetailDTO();
        dto.setId(task.getId());
        dto.setTaskName(task.getTaskName());
        dto.setTaskType(task.getTaskType());
        dto.setStatus(task.getStatus());
        dto.setStatusText(statusText(task.getStatus()));
        dto.setPriority(task.getPriority());
        dto.setDescription(task.getDescription());
        dto.setExecCount(task.getExecCount() != null ? task.getExecCount() : 0);
        dto.setWaypointTimeoutSec(task.getWaypointTimeoutSec() != null
                ? task.getWaypointTimeoutSec() : DEFAULT_WAYPOINT_TIMEOUT);
        dto.setArrivalRadius(task.getArrivalRadius());
        dto.setArrivalAltTol(task.getArrivalAltTol());
        dto.setOnFinish(task.getOnFinish());
        dto.setCreatedBy(task.getCreatedBy());
        dto.setCreatedByName(resolveUserName(task.getCreatedBy()));
        dto.setCreatedAt(task.getCreatedAt());
        dto.setUpdatedAt(task.getUpdatedAt());
        dto.setLastExecTime(task.getLastExecTime());
        dto.setWaypointCount((int) waypointRepository.countByTaskId(task.getId()));

        List<AssignedDroneDTO> drones = buildAssignedDrones(task.getId());
        dto.setDrones(drones);
        dto.setProgress(averageProgress(drones));

        if (includeWaypoints) {
            dto.setWaypoints(waypointRepository.findByTaskIdOrderBySeqAsc(task.getId()).stream()
                    .map(this::toWaypointDTO).collect(Collectors.toList()));
        }
        return dto;
    }

    private WaypointDTO toWaypointDTO(TaskWaypoint w) {
        WaypointDTO dto = new WaypointDTO();
        dto.setId(w.getId());
        dto.setSeq(w.getSeq());
        dto.setDisplayLabel(w.getDisplayLabel());
        dto.setItemType(w.getItemType());
        dto.setLatitude(w.getLatitude());
        dto.setLongitude(w.getLongitude());
        dto.setAltitude(w.getAltitude());
        dto.setHoldTime(w.getHoldTime());
        dto.setActionCommand(w.getActionCommand());
        dto.setActionParams(w.getActionParams());
        return dto;
    }

    private List<AssignedDroneDTO> buildAssignedDrones(Long taskId) {
        List<TaskDroneMap> maps = taskDroneMapRepository.findByTaskId(taskId);
        if (maps.isEmpty()) return List.of();

        List<Long> droneIds = maps.stream().map(TaskDroneMap::getDroneId).collect(Collectors.toList());
        Map<Long, Drone> drones = droneRepository.findByIdIn(droneIds).stream()
                .collect(Collectors.toMap(Drone::getId, d -> d, (a, b) -> a));

        return maps.stream().map(map -> {
            AssignedDroneDTO dto = new AssignedDroneDTO();
            dto.setDroneId(map.getDroneId());
            Drone drone = drones.get(map.getDroneId());
            if (drone != null) {
                dto.setUavId(drone.getUavId());
                dto.setDroneSn(drone.getDroneSn());
                dto.setOnline(drone.getUavId() != null && redisService.isDroneOnline(drone.getUavId()));
            }
            dto.setStatus(map.getStatus());
            dto.setStatusText(statusText(map.getStatus()));
            dto.setProgress(map.getProgress() != null ? map.getProgress() : 0f);
            dto.setCurrentSeq(map.getCurrentSeq() != null ? map.getCurrentSeq() : -1);
            dto.setErrorMessage(map.getErrorMessage());
            dto.setLastUpdateTime(map.getLastUpdateTime());
            return dto;
        }).collect(Collectors.toList());
    }

    private Float averageProgress(List<AssignedDroneDTO> drones) {
        if (drones == null || drones.isEmpty()) return 0f;
        return (float) drones.stream()
                .mapToDouble(d -> d.getProgress() != null ? d.getProgress() : 0f)
                .average().orElse(0);
    }

    private String resolveUserName(Long userId) {
        if (userId == null) return null;
        return userRepository.findById(userId)
                .map(u -> u.getRealName() != null ? u.getRealName() : u.getUsername())
                .orElse(null);
    }

    public static String statusText(Integer status) {
        if (status == null) return "未知";
        return switch (status) {
            case STATUS_PENDING -> "待执行";
            case STATUS_EXECUTING -> "执行中";
            case STATUS_PAUSED -> "已暂停";
            case STATUS_COMPLETED -> "已完成";
            case STATUS_ABNORMAL -> "异常";
            case STATUS_ASSIGNED -> "已分配";
            default -> "未知";
        };
    }

    private static float firstNonNull(Float a, Float b, float fallback) {
        if (a != null) return a;
        if (b != null) return b;
        return fallback;
    }

    // ------------------------------------------------------------------
    // 业务异常：由 TaskController 映射为不同的 HTTP 状态码
    // ------------------------------------------------------------------

    public static class TaskValidationException extends RuntimeException {
        public TaskValidationException(String message) { super(message); }
    }

    public static class TaskConflictException extends RuntimeException {
        public TaskConflictException(String message) { super(message); }
    }

    public static class TaskNotFoundException extends RuntimeException {
        public TaskNotFoundException(String message) { super(message); }
    }

    public static class TaskForbiddenException extends RuntimeException {
        public TaskForbiddenException(String message) { super(message); }
    }
}
