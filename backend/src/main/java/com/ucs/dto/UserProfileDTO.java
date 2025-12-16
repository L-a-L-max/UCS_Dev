package com.ucs.dto;

import lombok.Data;

@Data
public class UserProfileDTO {
    private String userId;
    private String name;
    private String role;
    private String teamName;
    private String position;
    private Integer uavCount;
    private String certificate;
    private String avatarUrl;
    private String phone;
    private String email;
}
