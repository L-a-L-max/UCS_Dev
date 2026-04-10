package com.ucs.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class LoginResponse {
    /** Access Token（短命，用于接口鉴权） */
    private String token;
    /** Refresh Token（长命，用于刷新 Access Token） */
    private String refreshToken;
    private Long userId;
    private String username;
    private String realName;
    private List<String> roles;
    private Long teamId;
    private String teamName;
    
    /**
     * User's subscription partitions for DDS data routing.
     * e.g., ["user_10001"] or ["observer"] or ["commander"]
     */
    private List<String> partitions;
}
