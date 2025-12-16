package com.ucs.dto;

import lombok.Data;
import java.util.List;

@Data
public class TeamMemberDTO {
    private String userId;
    private String name;
    private Boolean online;
    private String currentTask;
    private List<String> uavIds;
    private String status;
    private String role;
    private String avatarUrl;
}
