package com.ucs.dto;

import lombok.Data;
import java.util.List;

@Data
public class AssignDroneRequest {
    private List<String> uavIds;
    private String userId;
}
