package com.ucs.service;

import com.ucs.dto.TeamInfoDTO;
import com.ucs.dto.TeamMemberDTO;
import com.ucs.entity.Team;
import com.ucs.entity.TeamMember;
import com.ucs.entity.User;
import com.ucs.repository.*;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
public class TeamService {
    
    private final TeamRepository teamRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final UserRepository userRepository;
    private final UserRoleMapRepository userRoleMapRepository;
    private final DroneOwnershipRepository droneOwnershipRepository;
    private final TeamDroneMapRepository teamDroneMapRepository;
    private final TaskRepository taskRepository;
    
    private final Map<Long, Boolean> onlineUsers = new ConcurrentHashMap<>();
    
    public TeamService(TeamRepository teamRepository,
                       TeamMemberRepository teamMemberRepository,
                       UserRepository userRepository,
                       UserRoleMapRepository userRoleMapRepository,
                       DroneOwnershipRepository droneOwnershipRepository,
                       TeamDroneMapRepository teamDroneMapRepository,
                       TaskRepository taskRepository) {
        this.teamRepository = teamRepository;
        this.teamMemberRepository = teamMemberRepository;
        this.userRepository = userRepository;
        this.userRoleMapRepository = userRoleMapRepository;
        this.droneOwnershipRepository = droneOwnershipRepository;
        this.teamDroneMapRepository = teamDroneMapRepository;
        this.taskRepository = taskRepository;
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
            
            long onlineCount = members.stream()
                    .filter(m -> isUserOnline(m.getUserId()))
                    .count();
            
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
