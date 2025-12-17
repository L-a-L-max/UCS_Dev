package com.ucs.service.impl;

import com.ucs.dto.TeamInfoDTO;
import com.ucs.dto.TeamMemberDTO;
import com.ucs.dto.TeamStatusDTO;
import com.ucs.entity.Team;
import com.ucs.entity.TeamMember;
import com.ucs.entity.User;
import com.ucs.repository.*;
import com.ucs.service.ITeamService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Team Service Implementation
 * Following MyBatis-Plus convention with ServiceImpl pattern
 */
@Service
public class TeamServiceImpl implements ITeamService {
    
    private final TeamRepository teamRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final UserRepository userRepository;
    private final UserRoleMapRepository userRoleMapRepository;
    private final DroneOwnershipRepository droneOwnershipRepository;
    private final TeamDroneMapRepository teamDroneMapRepository;
    private final TaskRepository taskRepository;
    private final TeamRoleRepository teamRoleRepository;
    
    private final Map<Long, Boolean> onlineUsers = new ConcurrentHashMap<>();
    
    public TeamServiceImpl(TeamRepository teamRepository,
                           TeamMemberRepository teamMemberRepository,
                           UserRepository userRepository,
                           UserRoleMapRepository userRoleMapRepository,
                           DroneOwnershipRepository droneOwnershipRepository,
                           TeamDroneMapRepository teamDroneMapRepository,
                           TaskRepository taskRepository,
                           TeamRoleRepository teamRoleRepository) {
        this.teamRepository = teamRepository;
        this.teamMemberRepository = teamMemberRepository;
        this.userRepository = userRepository;
        this.userRoleMapRepository = userRoleMapRepository;
        this.droneOwnershipRepository = droneOwnershipRepository;
        this.teamDroneMapRepository = teamDroneMapRepository;
        this.taskRepository = taskRepository;
        this.teamRoleRepository = teamRoleRepository;
    }
    
    @Override
    public List<TeamStatusDTO> getAllTeamsWithStatus() {
        List<Team> teams = teamRepository.findAll();
        return teams.stream().map(team -> {
            TeamStatusDTO dto = new TeamStatusDTO();
            dto.setTeamId("T" + team.getId());
            dto.setTeamName(team.getTeamName());
            
            List<TeamMember> members = teamMemberRepository.findByTeamIdWithUser(team.getId());
            dto.setMemberCount(members.size());
            
            members.stream()
                    .filter(m -> m.getTeamRole() != null && 
                            m.getTeamRole().getRoleName().equalsIgnoreCase("Leader"))
                    .findFirst()
                    .ifPresent(m -> dto.setLeader(m.getUser().getRealName()));
            
            return dto;
        }).collect(Collectors.toList());
    }
    
    @Override
    public Team getTeamById(Long teamId) {
        return teamRepository.findById(teamId)
                .orElseThrow(() -> new RuntimeException("Team not found"));
    }
    
    @Override
    public List<Team> getTeamsByUserId(Long userId) {
        List<TeamMember> memberships = teamMemberRepository.findByUserId(userId);
        return memberships.stream()
                .map(m -> teamRepository.findById(m.getTeamId()).orElse(null))
                .filter(t -> t != null)
                .collect(Collectors.toList());
    }
    
    @Override
    @Transactional
    public Team createTeam(Team team) {
        return teamRepository.save(team);
    }
    
    @Override
    @Transactional
    public void addMemberToTeam(Long teamId, Long userId, String role) {
        TeamMember member = new TeamMember();
        member.setTeamId(teamId);
        member.setUserId(userId);
        
        // Find role by iterating through team roles
        List<com.ucs.entity.TeamRole> teamRoles = teamRoleRepository.findByTeamId(teamId);
        teamRoles.stream()
                .filter(r -> r.getRoleName().equalsIgnoreCase(role))
                .findFirst()
                .ifPresent(teamRole -> member.setTeamRoleId(teamRole.getId()));
        
        teamMemberRepository.save(member);
    }
    
    @Override
    @Transactional
    public void removeMemberFromTeam(Long teamId, Long userId) {
        // Find and delete the team member
        teamMemberRepository.findByTeamIdAndUserId(teamId, userId)
                .ifPresent(member -> teamMemberRepository.delete(member));
    }
    
    public TeamInfoDTO getTeamInfo(Long teamId) {
        Team team = teamRepository.findById(teamId)
                .orElseThrow(() -> new RuntimeException("Team not found"));
        
        TeamInfoDTO dto = new TeamInfoDTO();
        dto.setTeamId("T" + team.getId());
        dto.setTeamName(team.getTeamName());
        dto.setDescription(team.getDescription());
        
        List<TeamMember> members = teamMemberRepository.findByTeamIdWithUser(teamId);
        dto.setMemberCount(members.size());
        
        long leaderCount = members.stream()
                .filter(m -> m.getTeamRole() != null && 
                        m.getTeamRole().getRoleName().equalsIgnoreCase("Leader"))
                .count();
        dto.setLeaderCount((int) leaderCount);
        dto.setPilotCount(members.size() - (int) leaderCount);
        
        if (leaderCount > 0) {
            members.stream()
                    .filter(m -> m.getTeamRole() != null && 
                            m.getTeamRole().getRoleName().equalsIgnoreCase("Leader"))
                    .findFirst()
                    .ifPresent(m -> dto.setLeader(m.getUser().getRealName()));
        }
        
        List<Long> droneIds = teamDroneMapRepository.findDroneIdsByTeamId(teamId);
        dto.setDroneCount(droneIds.size());
        
        return dto;
    }
    
    public List<TeamMemberDTO> getTeamMembers(Long teamId) {
        List<TeamMember> members = teamMemberRepository.findByTeamIdWithUser(teamId);
        
        return members.stream().map(member -> {
            TeamMemberDTO dto = new TeamMemberDTO();
            User user = member.getUser();
            dto.setUserId("U" + user.getId());
            dto.setName(user.getRealName());
            dto.setAvatarUrl(user.getAvatarUrl());
            dto.setOnline(isUserOnline(user.getId()));
            dto.setStatus(isUserOnline(user.getId()) ? "ONLINE" : "OFFLINE");
            
            if (member.getTeamRole() != null) {
                dto.setRole(member.getTeamRole().getRoleName());
            }
            
            List<Long> droneIds = droneOwnershipRepository.findDroneIdsByUserId(user.getId());
            dto.setUavIds(droneIds.stream()
                    .map(id -> "UAV_" + String.format("%03d", id))
                    .collect(Collectors.toList()));
            
            List<com.ucs.entity.Task> tasks = taskRepository.findByAssignedUserId(user.getId());
            tasks.stream()
                    .filter(t -> t.getStatus() == 1)
                    .findFirst()
                    .ifPresent(t -> dto.setCurrentTask(t.getTaskName()));
            
            return dto;
        }).collect(Collectors.toList());
    }
    
    public List<TeamInfoDTO> getAllTeams() {
        List<Team> teams = teamRepository.findAll();
        return teams.stream().map(team -> {
            TeamInfoDTO dto = new TeamInfoDTO();
            dto.setTeamId("T" + team.getId());
            dto.setTeamName(team.getTeamName());
            
            List<TeamMember> members = teamMemberRepository.findByTeamIdWithUser(team.getId());
            dto.setMemberCount(members.size());
            
            members.stream()
                    .filter(m -> m.getTeamRole() != null && 
                            m.getTeamRole().getRoleName().equalsIgnoreCase("Leader"))
                    .findFirst()
                    .ifPresent(m -> dto.setLeader(m.getUser().getRealName()));
            
            return dto;
        }).collect(Collectors.toList());
    }
    
    public void setUserOnline(Long userId, boolean online) {
        onlineUsers.put(userId, online);
    }
    
    public boolean isUserOnline(Long userId) {
        return onlineUsers.getOrDefault(userId, false);
    }
}
