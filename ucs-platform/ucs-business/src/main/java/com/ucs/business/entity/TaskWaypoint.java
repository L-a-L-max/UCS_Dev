package com.ucs.business.entity;

import jakarta.persistence.*;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 任务航点。
 *
 * 一个任务由一串有序的航点组成，网关按 {@code seq} 升序依次飞行。
 *
 * seq 与 displayLabel 的区别：
 *   seq          — 连续执行序号（0,1,2...），创建/修改时由后端重新编排，网关只认它
 *   displayLabel — 前端展示编号。删除中间点时后续编号不回退（删掉 3，4/5/6 保持不变，
 *                  新增点从 7 开始）；插入点用 4.1 ~ 4.9 表示。
 *                  因此「按 displayLabel 数值升序」与「按 seq 升序」结果一致。
 */
@Data
@Entity
@Table(name = "task_waypoints")
public class TaskWaypoint {

    /** NAV：导航航点，无人机飞到该经纬高 */
    public static final String TYPE_NAV = "NAV";
    /** ACTION：载荷动作，不移动，执行完立即进入下一项 */
    public static final String TYPE_ACTION = "ACTION";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "task_id", nullable = false)
    private Long taskId;

    /** 连续执行序号，从 0 开始 */
    @Column(nullable = false)
    private Integer seq;

    /** 前端展示编号，支持一位小数（4.1 表示插入在 4 和 5 之间） */
    @Column(name = "display_label", nullable = false, precision = 5, scale = 1)
    private BigDecimal displayLabel;

    @Column(name = "item_type", nullable = false, length = 20)
    private String itemType = TYPE_NAV;

    @Column
    private Double latitude;

    @Column
    private Double longitude;

    /** 相对 Home 点的高度，单位米 */
    @Column
    private Double altitude;

    /** 到点后的悬停时长（秒），0 表示不停留 */
    @Column(name = "hold_time")
    private Integer holdTime = 0;

    /** ACTION 类型的动作指令，如 GIMBAL_CONTROL / CAMERA_CAPTURE / HOLD_TIME */
    @Column(name = "action_command", length = 50)
    private String actionCommand;

    /** ACTION 类型的动作参数，JSON 字符串 */
    @Column(name = "action_params", length = 2000)
    private String actionParams;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }

    public boolean isNav() {
        return TYPE_NAV.equalsIgnoreCase(itemType);
    }
}
