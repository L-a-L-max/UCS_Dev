package com.ucs.service;

import com.ucs.dto.TeamStatusDTO;
import com.ucs.entity.Team;

import java.util.List;

/**
 * Team Service Interface
 * Following MyBatis-Plus convention with I prefix for interfaces
 */
public interface ITeamService {
    
    /**
     * Get all teams with status
     */
    List<TeamStatusDTO> getAllTeamsWithStatus();
    
    /**
     * Get team by ID
     */
    Team getTeamById(Long teamId);
    
    /**
     * Get teams by user ID
     */
    List<Team> getTeamsByUserId(Long userId);
    
    /**
     * Create new team
     */
    Team createTeam(Team team);
    
    /**
     * Add member to team
     */
    void addMemberToTeam(Long teamId, Long userId, String role);
    
    /**
     * Remove member from team
     */
    void removeMemberFromTeam(Long teamId, Long userId);
}
