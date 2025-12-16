package com.ucs.dto;

import lombok.Data;
import java.time.LocalDateTime;

@Data
public class EventDTO {
    private String eventType;
    private String uavId;
    private String level;
    private LocalDateTime time;
    private String message;
}
