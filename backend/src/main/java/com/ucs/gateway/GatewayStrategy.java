package com.ucs.gateway;

/**
 * T-03: 网关策略模式接口 — 抽象网关类型差异，支持多种接入方式扩展。
 *
 * 每种网关类型（DDS / MAVLink / 未来可能的其他类型）各自实现此接口，
 * 由 GatewayRouter 根据无人机的 gatewayType 字段动态路由到对应策略。
 *
 * 设计目标：
 *   - 消除 ControlService 中对 uavId 前缀的硬编码检查
 *   - 新增网关类型只需实现此接口 + 注册到 GatewayRouter，无需修改已有业务代码
 *   - 每种策略封装各自的 Kafka Topic、HTTP Fallback 地址、心跳管理逻辑
 */
public interface GatewayStrategy {

    /**
     * 返回此策略对应的网关类型标识。
     * 例如 "DDS"、"MAVLINK"。
     */
    String getGatewayType();

    /**
     * 判断此策略是否支持给定的无人机。
     *
     * @param uavId 无人机唯一标识
     * @return true 表示此策略可以处理该无人机的指令
     */
    boolean supports(String uavId);

    /**
     * 通过此网关发送控制命令。
     * 优先走 Kafka，Kafka 不可用时走 HTTP Fallback。
     *
     * @param uavId       目标无人机 ID
     * @param commandType 命令类型 (ARM, TAKEOFF, LAND, RTL, GOTO, ...)
     * @param params      命令参数 JSON
     * @param userId      操作用户 ID
     * @param commandLogId 命令日志 ID（用于 ACK 回溯）
     * @return true = 命令已成功投递（不代表执行成功）
     */
    boolean sendCommand(String uavId, String commandType, String params,
                        Long userId, Long commandLogId);

    /**
     * 获取此网关的 Kafka 下行指令 Topic。
     * DDS: "commands.down"
     * MAVLink: "commands.mavlink.down"
     */
    String getCommandTopic();

    /**
     * 启动 OFFBOARD 心跳。
     * DDS 网关通过 ROS2 OffboardControlMode 发布；
     * MAVLink 网关通过 SET_POSITION_TARGET_LOCAL_NED 发送。
     */
    void startHeartbeat(String uavId);

    /**
     * 停止 OFFBOARD 心跳。
     */
    void stopHeartbeat(String uavId);

    /**
     * 检查网关是否可达（健康检查）。
     */
    boolean isAvailable();
}
