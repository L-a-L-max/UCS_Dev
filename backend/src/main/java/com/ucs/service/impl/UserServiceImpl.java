package com.ucs.service.impl;

import com.ucs.dto.UserProfileDTO;
import com.ucs.entity.User;
import com.ucs.entity.UserRoleMap;
import com.ucs.repository.*;
import com.ucs.service.IUserService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

/**
 * User Service Implementation
 * Following MyBatis-Plus convention with ServiceImpl pattern
 */
@Service
public class UserServiceImpl implements IUserService {
    
    private final UserRepository userRepository;
    private final UserRoleMapRepository userRoleMapRepository;
    private final TeamRepository teamRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final DroneOwnershipRepository droneOwnershipRepository;
    
    public UserServiceImpl(UserRepository userRepository,
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
    
    @Override
    public Optional<User> findByUsername(String username) {
        return userRepository.findByUsername(username);
    }
    
    @Override
    public Optional<User> findById(Long userId) {
        return userRepository.findById(userId);
    }
    
    @Override
    public List<User> getAllUsers() {
        return userRepository.findAll();
    }
    
    @Override
    @Transactional
    public User createUser(User user) {
        return userRepository.save(user);
    }
    
    @Override
    @Transactional
    public User updateUser(User user) {
        return userRepository.save(user);
    }
    
    @Override
    @Transactional
    public void deleteUser(Long userId) {
        userRepository.deleteById(userId);
    }
    
    @Override
    public boolean existsByUsername(String username) {
        return userRepository.existsByUsername(username);
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
