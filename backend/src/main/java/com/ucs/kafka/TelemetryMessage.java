package com.ucs.kafka;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

/**
 * T-20: Kafka 遥测消息 POJO — 替代 Map<String, Object> 手动解析。
 *
 * 优势:
 *   1. 类型安全 — 编译期检查字段类型，避免 ClassCastException
 *   2. 性能提升 — Jackson 反序列化到 POJO 比 TypeReference<Map> 快约 30%
 *   3. 可读性 — 明确数据结构，新人一目了然
 *   4. 可校验 — 可配合 @Valid 做字段校验
 *
 * 对应 DDS/MAVLink 网关发送的遥测 JSON 格式。
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class TelemetryMessage {

    /** 无人机唯一标识 (e.g., "px4_1", "mav_192.168.80.11_14550") */
    @JsonProperty("uavId")
    private String uavId;

    /** 遥测时间戳 (ISO-8601 格式) */
    @JsonProperty("timestamp")
    private String timestamp;

    /** 网关代际 epoch — 用于丢弃僵尸数据 */
    @JsonProperty("epoch")
    private Long epoch;

    // ---- GPS 坐标 (WGS84) ----
    @JsonProperty("lat")
    private Double lat;

    @JsonProperty("lon")
    private Double lon;

    /** 海拔高度 (AMSL, 米) */
    @JsonProperty("alt")
    private Double alt;

    // ---- 运动状态 ----
    /** 航向角 (度, 0-360) */
    @JsonProperty("heading")
    private Double heading;

    /** 地速 (m/s) */
    @JsonProperty("groundSpeed")
    private Double groundSpeed;

    /** 垂直速度 (m/s, 正=上升) */
    @JsonProperty("verticalSpeed")
    private Double verticalSpeed;

    // ---- NED 本地坐标 (相对Home点) ----
    @JsonProperty("nedX")
    private Double nedX;

    @JsonProperty("nedY")
    private Double nedY;

    @JsonProperty("nedZ")
    private Double nedZ;

    // ---- NED 速度分量 ----
    @JsonProperty("vx")
    private Double vx;

    @JsonProperty("vy")
    private Double vy;

    @JsonProperty("vz")
    private Double vz;

    // ---- 飞控状态 ----
    /** 飞行模式 (e.g., "MANUAL", "OFFBOARD", "AUTO.TAKEOFF") */
    @JsonProperty("flightMode")
    private String flightMode;

    /** 是否已解锁 */
    @JsonProperty("armed")
    private Boolean armed;

    /** 电池电压 (V) */
    @JsonProperty("batteryVoltage")
    private Double batteryVoltage;

    /** 电池剩余百分比 (0-100) */
    @JsonProperty("batteryPercent")
    private Double batteryPercent;

    // ---- 数据质量 ----
    /** 数据年龄 (秒) */
    @JsonProperty("dataAge")
    private Double dataAge;

    /** 消息计数 */
    @JsonProperty("msgCount")
    private Long msgCount;

    /** 是否活跃 */
    @JsonProperty("isActive")
    private Boolean isActive;

    /** 网关类型标识 ("DDS" / "MAVLINK") */
    @JsonProperty("gatewayType")
    private String gatewayType;

    /** AGL 相对高度 (米, 由网关计算) */
    @JsonProperty("altAgl")
    private Double altAgl;
}
