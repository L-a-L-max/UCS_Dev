package com.ucs.service;

import com.ucs.dto.LoginRequest;
import com.ucs.dto.LoginResponse;
import com.ucs.entity.Role;
import com.ucs.entity.Team;
import com.ucs.entity.User;
import com.ucs.entity.UserRoleMap;
import com.ucs.repository.RoleRepository;
import com.ucs.repository.TeamRepository;
import com.ucs.repository.UserRepository;
import com.ucs.repository.UserRoleMapRepository;
import com.ucs.security.JwtUtil;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class AuthService {
    
    private final UserRepository userRepository;
    private final UserRoleMapRepository userRoleMapRepository;
    private final TeamRepository teamRepository;
    private final RoleRepository roleRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;
    
    public AuthService(UserRepository userRepository, 
                       UserRoleMapRepository userRoleMapRepository,
                       TeamRepository teamRepository,
                       RoleRepository roleRepository,
                       PasswordEncoder passwordEncoder, 
                       JwtUtil jwtUtil) {
        this.userRepository = userRepository;
        this.userRoleMapRepository = userRoleMapRepository;
        this.teamRepository = teamRepository;
        this.roleRepository = roleRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtUtil = jwtUtil;
    }
    
    public LoginResponse login(LoginRequest request) {
        User user = userRepository.findByUsername(request.getUsername())
                .orElseThrow(() -> new RuntimeException("User not found"));
        
        if (!passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
            throw new RuntimeException("Invalid password");
        }
        
        if (user.getStatus() != 1) {
            throw new RuntimeException("User is disabled");
        }
        
        List<UserRoleMap> userRoles = userRoleMapRepository.findByUserIdWithRole(user.getId());
        List<String> roles = userRoles.stream()
                .map(urm -> urm.getRole().getRoleName())
                .collect(Collectors.toList());
        
        String token = jwtUtil.generateToken(user.getId(), user.getUsername(), roles);
        
        LoginResponse response = new LoginResponse();
        response.setToken(token);
        response.setUserId(user.getId());
        response.setUsername(user.getUsername());
        response.setRealName(user.getRealName());
        response.setRoles(roles);
        response.setTeamId(user.getTeamId());
        
        if (user.getTeamId() != null) {
            teamRepository.findById(user.getTeamId())
                    .ifPresent(team -> response.setTeamName(team.getTeamName()));
        }
        
        return response;
    }
    
    public User register(String username, String password, String realName, String roleName) {
        if (userRepository.existsByUsername(username)) {
            throw new RuntimeException("Username already exists");
        }
        
        User user = new User();
        user.setUsername(username);
        user.setPasswordHash(passwordEncoder.encode(password));
        user.setRealName(realName);
        user.setStatus(1);
        user = userRepository.save(user);
        
        Role role = roleRepository.findByRoleName(roleName)
                .orElseThrow(() -> new RuntimeException("Role not found: " + roleName));
        
        UserRoleMap userRoleMap = new UserRoleMap();
        userRoleMap.setUserId(user.getId());
        userRoleMap.setRoleId(role.getId());
        userRoleMapRepository.save(userRoleMap);
        
        return user;
    }
}
