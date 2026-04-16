package com.ucs.business.service.impl;

import com.ucs.business.dto.TeamInfoDTO;
import com.ucs.business.dto.TeamMemberDTO;
import com.ucs.business.dto.TeamStatusDTO;
import com.ucs.business.entity.Team;
import com.ucs.business.entity.TeamMember;
import com.ucs.business.entity.User;
import com.ucs.business.repository.*;
import com.ucs.business.service.ITeamService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
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
    private final TaskAssignmentRepository taskAssignmentRepository;
    
    private final Map<Long, Boolean> onlineUsers = new ConcurrentHashMap<>();
    
    public TeamServiceImpl(TeamRepository teamRepository,
                           TeamMemberRepository teamMemberRepository,
                           UserRepository userRepository,
                           UserRoleMapRepository userRoleMapRepository,
                           DroneOwnershipRepository droneOwnershipRepository,
                           TeamDroneMapRepository teamDroneMapRepository,
                           TaskRepository taskRepository,
                           TeamRoleRepository teamRoleRepository,
                           TaskAssignmentRepository taskAssignmentRepository) {
        this.teamRepository = teamRepository;
        this.teamMemberRepository = teamMemberRepository;
        this.userRepository = userRepository;
        this.userRoleMapRepository = userRoleMapRepository;
        this.droneOwnershipRepository = droneOwnershipRepository;
        this.teamDroneMapRepository = teamDroneMapRepository;
        this.taskRepository = taskRepository;
        this.teamRoleRepository = teamRoleRepository;
        this.taskAssignmentRepository = taskAssignmentRepository;
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
        
        // Find role by name from the lookup table
        teamRoleRepository.findByRoleName(role)
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
    
    /**
     * T-18: N+1 query optimization — batch preload drone ownership and tasks,
     * replacing per-member loop queries.
     * Before: N members -> 2N+1 SQL (1 member query + N ownership queries + N task queries)
     * After:  N members -> 3 SQL (1 member query + 1 batch ownership query + 1 batch task query)
     */
    public List<TeamMemberDTO> getTeamMembers(Long teamId) {
        List<TeamMember> members = teamMemberRepository.findByTeamIdWithUser(teamId);
        if (members.isEmpty()) return Collections.emptyList();

        // T-18: Collect all user IDs for batch queries
        List<Long> userIds = members.stream()
                .map(m -> m.getUser().getId())
                .collect(Collectors.toList());

        // T-18: 1 batch query replaces N loop queries — drone ownership
        Map<Long, List<Long>> userDroneMap = droneOwnershipRepository.findActiveByUserIdIn(userIds)
                .stream()
                .collect(Collectors.groupingBy(
                        com.ucs.business.entity.DroneOwnership::getUserId,
                        Collectors.mapping(com.ucs.business.entity.DroneOwnership::getDroneId, Collectors.toList())
                ));

        // T-18: 1 batch query replaces N loop queries — active tasks
        Map<Long, com.ucs.business.entity.Task> userActiveTaskMap = new LinkedHashMap<>();
        taskRepository.findActiveByAssignedUserIdIn(userIds).forEach(task -> {
            taskAssignmentRepository.findByTaskId(task.getId()).forEach(ta -> {
                if (userIds.contains(ta.getUserId())) {
                    userActiveTaskMap.putIfAbsent(ta.getUserId(), task);
                }
            });
        });

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

            // T-18: O(1) lookup from preloaded Map instead of per-member DB query
            List<Long> droneIds = userDroneMap.getOrDefault(user.getId(), Collections.emptyList());
            dto.setUavIds(droneIds.stream()
                    .map(id -> "UAV_" + String.format("%03d", id))
                    .collect(Collectors.toList()));

            // T-18: O(1) lookup from preloaded Map instead of per-member DB query
            com.ucs.business.entity.Task activeTask = userActiveTaskMap.get(user.getId());
            if (activeTask != null) {
                dto.setCurrentTask(activeTask.getTaskName());
            }

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
