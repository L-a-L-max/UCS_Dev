package com.ucs.command.controller;

import com.ucs.command.producer.CommandProducer;
import com.ucs.common.dto.CommandMessage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

/**
 * 指令下发REST控制器。
 * 接收前端/API指令请求，通过Kafka commands.down发送到Gateway。
 */
@Slf4j
@RestController
@RequestMapping("/api/v1/commands")
@RequiredArgsConstructor
public class CommandController {

    private final CommandProducer commandProducer;

    /**
     * POST /api/v1/commands/send
     * 通用指令下发接口
     */
    @PostMapping("/send")
    public ResponseEntity<Map<String, Object>> sendCommand(@RequestBody CommandMessage command) {
        if (command.getCommandId() == null || command.getCommandId().isEmpty()) {
            command.setCommandId(UUID.randomUUID().toString());
        }
        if (command.getTimestamp() == 0) {
            command.setTimestamp(System.currentTimeMillis());
        }

        boolean sent = commandProducer.send(command);
        if (sent) {
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "commandId", command.getCommandId(),
                    "message", "Command sent to Kafka"
            ));
        } else {
            return ResponseEntity.internalServerError().body(Map.of(
                    "success", false,
                    "message", "Failed to send command"
            ));
        }
    }

    /**
     * POST /api/v1/commands/takeoff
     * 起飞指令快捷接口
     */
    @PostMapping("/takeoff")
    public ResponseEntity<Map<String, Object>> takeoff(@RequestParam String uavId,
                                                        @RequestParam(defaultValue = "10") double altitude) {
        CommandMessage cmd = CommandMessage.builder()
                .commandId(UUID.randomUUID().toString())
                .uavId(uavId)
                .command(22)  // MAV_CMD_NAV_TAKEOFF
                .param7(altitude)
                .timestamp(System.currentTimeMillis())
                .build();

        boolean sent = commandProducer.send(cmd);
        return ResponseEntity.ok(Map.of(
                "success", sent,
                "commandId", cmd.getCommandId()
        ));
    }

    /**
     * POST /api/v1/commands/land
     * 降落指令快捷接口
     */
    @PostMapping("/land")
    public ResponseEntity<Map<String, Object>> land(@RequestParam String uavId) {
        CommandMessage cmd = CommandMessage.builder()
                .commandId(UUID.randomUUID().toString())
                .uavId(uavId)
                .command(21)  // MAV_CMD_NAV_LAND
                .timestamp(System.currentTimeMillis())
                .build();

        boolean sent = commandProducer.send(cmd);
        return ResponseEntity.ok(Map.of(
                "success", sent,
                "commandId", cmd.getCommandId()
        ));
    }
}
