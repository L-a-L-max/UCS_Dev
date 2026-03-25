package com.ucs.business.dto;

import lombok.Data;

@Data
public class CommandRequest {
    private String commandType;
    private String payload;
}
