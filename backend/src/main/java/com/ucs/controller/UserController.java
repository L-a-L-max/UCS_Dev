package com.ucs.controller;

import com.ucs.dto.ApiResponse;
import com.ucs.dto.UserProfileDTO;
import com.ucs.security.UserPrincipal;
import com.ucs.service.UserService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/user")
public class UserController {
    
    private final UserService userService;
    
    public UserController(UserService userService) {
        this.userService = userService;
    }
    
    @GetMapping("/profile")
    public ApiResponse<UserProfileDTO> getProfile(@AuthenticationPrincipal UserPrincipal principal) {
        UserProfileDTO profile = userService.getUserProfile(principal.getUserId());
        return ApiResponse.success(profile);
    }
}
