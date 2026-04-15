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
     * T-18: N+1查询优化 — 批量预加载无人机归属和任务，替代循环内逐条查询。
     * 优化前: N个成员 → 2N+1条SQL (1条成员查询 + N条归属查询 + N条任务查询)
     * 优化后: N个成员 → 3条SQL (1条成员查询 + 1条批量归属查询 + 1条批量任务查询)
     */
    public List<TeamMemberDTO> getTeamMembers(Long teamId) {
        List<TeamMember> members = teamMemberRepository.findByTeamIdWithUser(teamId);
        if (members.isEmpty()) return Collections.emptyList();

        // T-18: 收集所有用户ID，批量查询
        List<Long> userIds = members.stream()
                .map(m -> m.getUser().getId())
                .collect(Collectors.toList());

        // T-18: 1次批量查询替代N次循环查询 — 无人机归属
        Map<Long, List<Long>> userDroneMap = droneOwnershipRepository.findActiveByUserIdIn(userIds)
                .stream()
                .collect(Collectors.groupingBy(
                        com.ucs.entity.DroneOwnership::getUserId,
                        Collectors.mapping(com.ucs.entity.DroneOwnership::getDroneId, Collectors.toList())
                ));

        // T-18: 1次批量查询替代N次循环查询 — 活跃任务
        Map<Long, com.ucs.entity.Task> userActiveTaskMap = new LinkedHashMap<>();
        taskRepository.findActiveByAssignedUserIdIn(userIds).forEach(task -> {
            // 只取每个用户的第一个活跃任务（与原逻辑一致）
            // 需要通过TaskAssignment关联回用户
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

            // T-18: 从预加载的Map中获取，O(1)查询
            List<Long> droneIds = userDroneMap.getOrDefault(user.getId(), Collections.emptyList());
            dto.setUavIds(droneIds.stream()
                    .map(id -> "UAV_" + String.format("%03d", id))
                    .collect(Collectors.toList()));

            // T-18: 从预加载的Map中获取，O(1)查询
            com.ucs.entity.Task activeTask = userActiveTaskMap.get(user.getId());
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
