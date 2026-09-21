package com.ucs.business.controller;

import com.ucs.business.dto.ApiResponse;
import com.ucs.business.dto.TaskAssignRequest;
import com.ucs.business.dto.TaskCreateRequest;
import com.ucs.business.dto.TaskDetailDTO;
import com.ucs.business.dto.TaskExecuteRequest;
import com.ucs.business.dto.WaypointDTO;
import com.ucs.business.security.UserPrincipal;
import com.ucs.business.service.WaypointTaskService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 航点任务 API。
 *
 * 路径 /api/v1/tasks/** 落在 SecurityConfig 的 anyRequest().authenticated()
 * 兜底规则里——已登录即可访问，能操作哪些任务由服务层按创建人与既有的
 * drone_ownership 归属规则判断。安全配置不做改动。
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/tasks")
@RequiredArgsConstructor
public class TaskController {

    private final WaypointTaskService taskService;

    /** 创建航点任务 */
    @PostMapping
    public ResponseEntity<ApiResponse<TaskDetailDTO>> create(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestBody TaskCreateRequest request) {
        TaskDetailDTO task = taskService.createTask(request, principal.getUserId());
        return ResponseEntity.ok(ApiResponse.success("任务创建成功", task));
    }

    /**
     * 任务列表。
     *
     * @param sort time_desc（默认，新的在前）或 time_asc
     */
    @GetMapping
    public ApiResponse<List<TaskDetailDTO>> list(
            @AuthenticationPrincipal UserPrincipal principal,
            @RequestParam(defaultValue = "time_desc") String sort) {
        return ApiResponse.success(taskService.listTasks(principal.getUserId(), sort));
    }

    /** 任务详情（含航点明细与各机进度） */
    @GetMapping("/{id}")
    public ApiResponse<TaskDetailDTO> detail(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable Long id) {
        return ApiResponse.success(taskService.getTaskDetail(id, principal.getUserId()));
    }

    /** 修改任务（执行中的任务不可改，需先中止或走 /waypoints 改航） */
    @PutMapping("/{id}")
    public ApiResponse<TaskDetailDTO> update(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable Long id,
            @RequestBody TaskCreateRequest request) {
        return ApiResponse.success("任务已更新",
                taskService.updateTask(id, request, principal.getUserId()));
    }

    /** 删除任务（连同航点、指派关系一并删除） */
    @DeleteMapping("/{id}")
    public ApiResponse<Object> delete(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable Long id) {
        taskService.deleteTask(id, principal.getUserId());
        return ApiResponse.success("任务已删除", null);
    }

    /** 指派无人机（复选框结果，一次性覆盖） */
    @PostMapping("/{id}/assign")
    public ApiResponse<TaskDetailDTO> assign(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable Long id,
            @RequestBody TaskAssignRequest request) {
        return ApiResponse.success("指派成功",
                taskService.assignDrones(id, request, principal.getUserId()));
    }

    /** 执行任务，可在此临时覆盖单点超时等执行参数 */
    @PostMapping("/{id}/execute")
    public ApiResponse<TaskDetailDTO> execute(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable Long id,
            @RequestBody(required = false) TaskExecuteRequest request) {
        return ApiResponse.success("任务已下发",
                taskService.executeTask(id, request,
                        principal.getUserId(), principal.getUsername()));
    }

    /** 中止执行中的任务，无人机原地悬停 */
    @PostMapping("/{id}/abort")
    public ApiResponse<TaskDetailDTO> abort(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable Long id) {
        return ApiResponse.success("任务已中止",
                taskService.abortTask(id, principal.getUserId(), principal.getUsername()));
    }

    /**
     * 执行中改航：替换 fromSeq 之后的航点。
     * fromSeq 传 -1 表示连当前正在飞的这一段也立即改向。
     */
    @PutMapping("/{id}/waypoints")
    public ApiResponse<TaskDetailDTO> updateWaypoints(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable Long id,
            @RequestParam(defaultValue = "-1") Integer fromSeq,
            @RequestBody List<WaypointDTO> waypoints) {
        return ApiResponse.success("航路已更新",
                taskService.updateWaypointsInFlight(id, fromSeq, waypoints,
                        principal.getUserId(), principal.getUsername()));
    }

    /** 进度轮询（WebSocket 断线时的兜底） */
    @GetMapping("/{id}/progress")
    public ApiResponse<Map<String, Object>> progress(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable Long id) {
        return ApiResponse.success(taskService.getProgress(id, principal.getUserId()));
    }

    // ------------------------------------------------------------------
    // 业务异常映射
    // ------------------------------------------------------------------

    @ExceptionHandler(WaypointTaskService.TaskValidationException.class)
    public ResponseEntity<ApiResponse<Object>> onValidation(
            WaypointTaskService.TaskValidationException e) {
        return ResponseEntity.badRequest().body(ApiResponse.error(400, e.getMessage()));
    }

    /** 重名、状态不允许等冲突场景 —— 前端据此提示操作人员更换名称 */
    @ExceptionHandler(WaypointTaskService.TaskConflictException.class)
    public ResponseEntity<ApiResponse<Object>> onConflict(
            WaypointTaskService.TaskConflictException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiResponse.error(409, e.getMessage()));
    }

    @ExceptionHandler(WaypointTaskService.TaskNotFoundException.class)
    public ResponseEntity<ApiResponse<Object>> onNotFound(
            WaypointTaskService.TaskNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.error(404, e.getMessage()));
    }

    @ExceptionHandler(WaypointTaskService.TaskForbiddenException.class)
    public ResponseEntity<ApiResponse<Object>> onForbidden(
            WaypointTaskService.TaskForbiddenException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ApiResponse.error(403, e.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Object>> onError(Exception e) {
        log.error("[TaskController] Unhandled error: {}", e.getMessage(), e);
        return ResponseEntity.internalServerError()
                .body(ApiResponse.error(500, "服务器内部错误：" + e.getMessage()));
    }
}
