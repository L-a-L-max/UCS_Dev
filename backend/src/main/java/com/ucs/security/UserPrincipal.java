package com.ucs.security;

import lombok.AllArgsConstructor;
import lombok.Data;
import java.util.List;

@Data
@AllArgsConstructor
public class UserPrincipal {
    private Long userId;
    private String username;
    private List<String> roles;
    
    public boolean hasRole(String role) {
        return roles != null && roles.contains(role);
    }
    
    public boolean isLeader() {
        return hasRole("LEADER") || hasRole("leader");
    }
    
    public boolean isObserver() {
        return hasRole("OBSERVER") || hasRole("observer");
    }
    
    public boolean isPilot() {
        return hasRole("PILOT") || hasRole("pilot") || hasRole("OPERATOR") || hasRole("operator");
    }
}
