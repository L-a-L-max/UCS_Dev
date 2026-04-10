package com.ucs.business.service;

import com.ucs.business.dto.UserProfileDTO;
import com.ucs.business.entity.Team;
import com.ucs.business.entity.TeamMember;
import com.ucs.business.entity.User;
import com.ucs.business.entity.UserRoleMap;
import com.ucs.business.repository.*;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class UserService {
    
    private final UserRepository userRepository;
    private final UserRoleMapRepository userRoleMapRepository;
    private final TeamRepository teamRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final DroneOwnershipRepository droneOwnershipRepository;
    
    public UserService(UserRepository userRepository,
                       UserRoleMapRepository userRoleMapRepository,
                       TeamRepository teamRepository,
                       TeamMemberRepository teamMemberRepository,
                       DroneOwnershipRepository droneOwnershipRepository) {
        this.userRepository = userRepository;
        this.userRoleMapRepository = userRoleMapRepository;
        this.teamRepository = teamRepository;
        this.teamMemberRepository = teamMemberRepository;
        this.droneOwnershipRepository = droneOwnershipRepository;
    }
    
    public UserProfileDTO getUserProfile(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));
        
        UserProfileDTO dto = new UserProfileDTO();
        dto.setUserId("U" + user.getId());
        dto.setName(user.getRealName());
        dto.setAvatarUrl(user.getAvatarUrl());
        dto.setPhone(user.getPhone());
        dto.setEmail(user.getEmail());
        dto.setCertificate(user.getPilotLicenseId());
        
        List<UserRoleMap> roles = userRoleMapRepository.findByUserIdWithRole(userId);
        if (!roles.isEmpty()) {
            dto.setRole(roles.get(0).getRole().getRoleName().toUpperCase());
        }
        
        if (user.getTeamId() != null) {
            teamRepository.findById(user.getTeamId())
                    .ifPresent(team -> dto.setTeamName(team.getTeamName()));
            
            teamMemberRepository.findByTeamIdAndUserId(user.getTeamId(), userId)
                    .ifPresent(tm -> {
                        if (tm.getTeamRole() != null) {
                            dto.setPosition(tm.getTeamRole().getRoleName());
                        }
                    });
        }
        
        List<Long> droneIds = droneOwnershipRepository.findDroneIdsByUserId(userId);
        dto.setUavCount(droneIds.size());
        
        return dto;
    }
    
    public User getUserById(Long userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found"));
    }
    
    public List<User> getUsersByTeamId(Long teamId) {
        return userRepository.findByTeamId(teamId);
    }
}
