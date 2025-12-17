package com.ucs.dto;

import lombok.Data;

/**
 * Team Status DTO for dashboard display
 */
@Data
public class TeamStatusDTO {
    private String teamId;
    private String teamName;
    private String leader;
    private Integer memberCount;
    private String status;
}
