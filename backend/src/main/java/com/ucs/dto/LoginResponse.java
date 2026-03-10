package com.ucs.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class LoginResponse {
    private String token;
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
