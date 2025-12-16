package com.ucs.dto;

import lombok.Data;

@Data
public class TeamInfoDTO {
    private String teamId;
    private String teamName;
    private String leader;
    private Integer memberCount;
    private String area;
    private String description;
    private Integer leaderCount;
    private Integer pilotCount;
    private Integer droneCount;
    private Integer todayTasks;
}
