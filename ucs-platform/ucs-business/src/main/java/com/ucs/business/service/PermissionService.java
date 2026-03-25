package com.ucs.business.service;

import com.ucs.business.entity.*;
import com.ucs.business.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ucs.business.util.PartitionNameUtil;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Service for managing drone control permissions with strong consistency.
 * 
 * Uses Redis distributed lock to ensure atomic permission transfer:
 * 1. Acquire lock: lock:drone:{uavId} with 5s TTL (setIfAbsent)
 * 2. Within lock: DB update drone_ownership + Redis cache update
 * 3. Log operation to operation_log
 * 4. Release lock
 * 
 * This prevents race conditions when multiple users try to claim
 * or transfer control of the same drone simultaneously.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PermissionService {
    
    private final DroneRepository droneRepository;
    private final DroneOwnershipRepository droneOwnershipRepository;
    private final UserRepository userRepository;
    private final TeamRepository teamRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final TeamDroneMapRepository teamDroneMapRepository;
    private final RedisService redisService;
    private final OperationLogService operationLogService;
    private final PartitionRoutingService partitionRoutingService;
    private final UserRoleMapRepository userRoleMapRepository;
    private final WebSocketGatewayService webSocketGatewayService;
    
    /**
     * Transfer control permission for a drone from current owner to target user.
     * Uses Redis distributed lock for strong consistency.
     * 
     * @param uavId         The drone's unique identifier
     * @param toUserId      Target user to receive control
     * @param operatorId    The user performing the transfer (must be leader/commander)
     * @param operatorName  The username for logging
     * @return true if transfer succeeded
     */
    @Transactional
    public boolean transferPermission(String uavId, Long toUserId,
                                       Long operatorId, String operatorName) {
        // Find the drone
        Optional<Drone> droneOpt = droneRepository.findByUavId(uavId);
        if (droneOpt.isEmpty()) {
            operationLogService.logFailure(operatorId, operatorName, "PERMISSION_TRANSFER",
                    null, uavId, buildTransferDetail(null, toUserId),
                    "Drone not found: " + uavId);
            return false;
        }
        Drone drone = droneOpt.get();
        
        // Verify target user exists
        Optional<User> targetUserOpt = userRepository.findById(toUserId);
        if (targetUserOpt.isEmpty()) {
            operationLogService.logFailure(operatorId, operatorName, "PERMISSION_TRANSFER",
                    drone.getId(), uavId, buildTransferDetail(null, toUserId),
                    "Target user not found: " + toUserId);
            return false;
        }
        
        // Acquire distributed lock
        String lockValue = UUID.randomUUID().toString();
        boolean lockAcquired = redisService.tryAcquireLock(uavId, lockValue);
        if (!lockAcquired) {
            operationLogService.logFailure(operatorId, operatorName, "PERMISSION_TRANSFER",
                    drone.getId(), uavId, buildTransferDetail(null, toUserId),
                    "Failed to acquire lock - another transfer in progress");
            return false;
        }
        
        try {
            // Within lock: perform the transfer atomically
            
            // 1. Expire current ownership
            Optional<DroneOwnership> currentOwnership = droneOwnershipRepository.findActiveByDroneId(drone.getId());
            Long fromUserId = null;
            if (currentOwnership.isPresent()) {
                fromUserId = currentOwnership.get().getUserId();
                currentOwnership.get().setExpiredAt(LocalDateTime.now());
                droneOwnershipRepository.save(currentOwnership.get());
            }
            
            // 2. Create new ownership
            DroneOwnership newOwnership = new DroneOwnership();
            newOwnership.setDroneId(drone.getId());
            newOwnership.setUserId(toUserId);
            newOwnership.setAssignedBy(operatorId);
            droneOwnershipRepository.save(newOwnership);
            
            // 2.5 同步更新无人机所属队伍：转接给个人时，无人机队伍应变为目标人员所在队伍
            List<TeamMember> targetMemberships = teamMemberRepository.findByUserId(toUserId);
            if (!targetMemberships.isEmpty()) {
                Long targetTeamId = targetMemberships.get(0).getTeamId();
                // 将旧的队伍-无人机映射标记为移除
                List<TeamDroneMap> oldMappings = teamDroneMapRepository.findActiveByDroneId(drone.getId());
                for (TeamDroneMap tdm : oldMappings) {
                    if (!tdm.getTeamId().equals(targetTeamId)) {
                        tdm.setRemovedAt(LocalDateTime.now());
                        teamDroneMapRepository.save(tdm);
                    }
                }
                // 添加新的队伍-无人机映射（如果不存在）
                List<Long> existingDroneIds = teamDroneMapRepository.findDroneIdsByTeamId(targetTeamId);
                if (!existingDroneIds.contains(drone.getId())) {
                    TeamDroneMap newTdm = new TeamDroneMap();
                    newTdm.setTeamId(targetTeamId);
                    newTdm.setDroneId(drone.getId());
                    teamDroneMapRepository.save(newTdm);
                }
            }
            
            // 3. Update Redis cache
            redisService.setDroneController(uavId, toUserId);
            
            // 4. Recalculate and update drone partitions based on new ownership
            recalculateDronePartitions(uavId, toUserId);
            
            // 5. Log operation
            operationLogService.recordOperation(operatorId, operatorName, "PERMISSION_TRANSFER",
                    drone.getId(), uavId, toUserId,
                    buildTransferDetail(fromUserId, toUserId),
                    "SUCCESS", null, null);
            
            log.info("Permission transferred: drone={}, from={}, to={}, by={}",
                    uavId, fromUserId, toUserId, operatorId);
            return true;
            
        } catch (Exception e) {
            log.error("Permission transfer failed for drone {}: {}", uavId, e.getMessage());
            operationLogService.logFailure(operatorId, operatorName, "PERMISSION_TRANSFER",
                    drone.getId(), uavId, buildTransferDetail(null, toUserId),
                    e.getMessage());
            throw e; // Re-throw to trigger transaction rollback
        } finally {
            // Always release the lock
            redisService.releaseLock(uavId, lockValue);
        }
    }
    
    /**
     * Batch transfer permissions for multiple drones.
     * 
     * @return List of uavIds that were successfully transferred
     */
    public List<String> batchTransferPermission(List<String> uavIds, Long toUserId,
                                                  Long operatorId, String operatorName) {
        List<String> successList = new ArrayList<>();
        for (String uavId : uavIds) {
            try {
                boolean ok = transferPermission(uavId, toUserId, operatorId, operatorName);
                if (ok) {
                    successList.add(uavId);
                }
            } catch (Exception e) {
                log.error("Batch transfer failed for drone {}: {}", uavId, e.getMessage());
            }
        }
        return successList;
    }
    
    /**
     * Get the current controller user ID for a drone.
     * First checks Redis cache, falls back to DB.
     */
    public Long getCurrentController(String uavId) {
        // Try Redis first
        Long cachedController = redisService.getDroneController(uavId);
        if (cachedController != null) {
            return cachedController;
        }
        
        // Fall back to DB
        Optional<Drone> droneOpt = droneRepository.findByUavId(uavId);
        if (droneOpt.isPresent()) {
            Optional<DroneOwnership> ownership = droneOwnershipRepository
                    .findActiveByDroneId(droneOpt.get().getId());
            if (ownership.isPresent()) {
                Long controller = ownership.get().getUserId();
                // Update Redis cache
                redisService.setDroneController(uavId, controller);
                return controller;
            }
        }
        return null;
    }
    
    /**
     * Build human-readable transfer detail instead of raw JSON.
     */
    private String buildTransferDetail(Long fromUserId, Long toUserId) {
        String fromName = "未分配";
        String toName = "未知用户";
        if (fromUserId != null) {
            fromName = userRepository.findById(fromUserId)
                    .map(u -> u.getRealName() != null ? u.getRealName() : u.getUsername())
                    .orElse("用户#" + fromUserId);
        }
        toName = userRepository.findById(toUserId)
                .map(u -> u.getRealName() != null ? u.getRealName() : u.getUsername())
                .orElse("用户#" + toUserId);
        return String.format("控制权转移: %s → %s", fromName, toName);
    }
    
    /**
     * Transfer drone control to a team (assigns to team leader).
     * Implements Issue #4: Permission transfer should target teams, not just users.
     * The drone is assigned to the team's leader, and the team-drone mapping is updated.
     *
     * @param uavId         The drone's unique identifier
     * @param toTeamId      Target team to receive control
     * @param operatorId    The user performing the transfer
     * @param operatorName  The username for logging
     * @return true if transfer succeeded
     */
    @Transactional
    public boolean transferPermissionToTeam(String uavId, Long toTeamId,
                                             Long operatorId, String operatorName) {
        // Find the drone
        Optional<Drone> droneOpt = droneRepository.findByUavId(uavId);
        if (droneOpt.isEmpty()) {
            operationLogService.logFailure(operatorId, operatorName, "PERMISSION_TRANSFER",
                    null, uavId, "无人机不存在: " + uavId, "Drone not found: " + uavId);
            return false;
        }
        Drone drone = droneOpt.get();
        
        // Verify target team exists
        Optional<Team> teamOpt = teamRepository.findById(toTeamId);
        if (teamOpt.isEmpty()) {
            operationLogService.logFailure(operatorId, operatorName, "PERMISSION_TRANSFER",
                    drone.getId(), uavId, "目标队伍不存在: " + toTeamId, "Team not found: " + toTeamId);
            return false;
        }
        Team team = teamOpt.get();
        
        // Find team leader to assign control to
        List<TeamMember> members = teamMemberRepository.findByTeamIdWithUser(toTeamId);
        Optional<TeamMember> leaderMember = members.stream()
                .filter(m -> m.getTeamRole() != null &&
                        m.getTeamRole().getRoleName().equalsIgnoreCase("Leader"))
                .findFirst();
        
        Long toUserId;
        if (leaderMember.isPresent()) {
            toUserId = leaderMember.get().getUserId();
        } else if (!members.isEmpty()) {
            // Fallback: assign to first member if no leader
            toUserId = members.get(0).getUserId();
        } else {
            operationLogService.logFailure(operatorId, operatorName, "PERMISSION_TRANSFER",
                    drone.getId(), uavId, "队伍 " + team.getTeamName() + " 没有成员",
                    "Team has no members");
            return false;
        }
        
        // Acquire distributed lock
        String lockValue = UUID.randomUUID().toString();
        boolean lockAcquired = redisService.tryAcquireLock(uavId, lockValue);
        if (!lockAcquired) {
            operationLogService.logFailure(operatorId, operatorName, "PERMISSION_TRANSFER",
                    drone.getId(), uavId, "获取锁失败，另一个转移正在进行中",
                    "Failed to acquire lock");
            return false;
        }
        
        try {
            // 1. Expire current ownership
            Optional<DroneOwnership> currentOwnership = droneOwnershipRepository.findActiveByDroneId(drone.getId());
            String fromName = "未分配";
            if (currentOwnership.isPresent()) {
                Long fromUserId = currentOwnership.get().getUserId();
                fromName = userRepository.findById(fromUserId)
                        .map(u -> u.getRealName() != null ? u.getRealName() : u.getUsername())
                        .orElse("用户#" + fromUserId);
                currentOwnership.get().setExpiredAt(LocalDateTime.now());
                droneOwnershipRepository.save(currentOwnership.get());
            }
            
            // 2. Create new ownership (assigned to team leader)
            DroneOwnership newOwnership = new DroneOwnership();
            newOwnership.setDroneId(drone.getId());
            newOwnership.setUserId(toUserId);
            newOwnership.setAssignedBy(operatorId);
            droneOwnershipRepository.save(newOwnership);
            
            // 3. Update team-drone mapping: 先移除旧队伍映射，再添加新队伍映射
            List<TeamDroneMap> oldMappings = teamDroneMapRepository.findActiveByDroneId(drone.getId());
            for (TeamDroneMap oldTdm : oldMappings) {
                if (!oldTdm.getTeamId().equals(toTeamId)) {
                    oldTdm.setRemovedAt(LocalDateTime.now());
                    teamDroneMapRepository.save(oldTdm);
                }
            }
            List<Long> existingTeamDroneIds = teamDroneMapRepository.findDroneIdsByTeamId(toTeamId);
            if (!existingTeamDroneIds.contains(drone.getId())) {
                TeamDroneMap tdm = new TeamDroneMap();
                tdm.setTeamId(toTeamId);
                tdm.setDroneId(drone.getId());
                teamDroneMapRepository.save(tdm);
            }
            
            // 4. Update Redis cache
            redisService.setDroneController(uavId, toUserId);
            
            // 5. Recalculate and update drone partitions based on new team ownership
            recalculateDronePartitionsForTeam(uavId, toTeamId, toUserId);
            
            // 6. Log operation with human-readable detail
            String leaderName = userRepository.findById(toUserId)
                    .map(u -> u.getRealName() != null ? u.getRealName() : u.getUsername())
                    .orElse("用户#" + toUserId);
            String detail = String.format("控制权转移至队伍[%s], 队长[%s]接管 (原控制: %s)",
                    team.getTeamName(), leaderName, fromName);
            
            operationLogService.recordOperation(operatorId, operatorName, "PERMISSION_TRANSFER",
                    drone.getId(), uavId, toUserId, detail, "SUCCESS", null, null);
            
            log.info("Permission transferred to team: drone={}, team={}, leader={}, by={}",
                    uavId, team.getTeamName(), toUserId, operatorId);
            return true;
            
        } catch (Exception e) {
            log.error("Team permission transfer failed for drone {}: {}", uavId, e.getMessage());
            operationLogService.logFailure(operatorId, operatorName, "PERMISSION_TRANSFER",
                    drone.getId(), uavId, "队伍转移失败: " + e.getMessage(), e.getMessage());
            throw e;
        } finally {
            redisService.releaseLock(uavId, lockValue);
        }
    }
    
    /**
     * Recalculate drone partitions after individual ownership transfer.
     * 
     * Rules:
     *   - Always include: observer + commander
     *   - If new owner is a Leader: + leader's partition only
     *   - If new owner is a Pilot: + pilot's partition + their team leader's partition
     */
    private void recalculateDronePartitions(String uavId, Long newOwnerId) {
        Set<String> newPartitions = new LinkedHashSet<>();
        newPartitions.add("observer");
        newPartitions.add("commander");

        // Add new owner's partition
        Optional<User> ownerOpt = userRepository.findById(newOwnerId);
        if (ownerOpt.isPresent()) {
            User owner = ownerOpt.get();
            String ownerPartition = getOrComputePartition(owner);
            if (ownerPartition != null) {
                newPartitions.add(ownerPartition);
            }

            // If target is a Pilot (not Leader), also add their team leader's partition
            List<TeamMember> memberships = teamMemberRepository.findByUserId(newOwnerId);
            if (!memberships.isEmpty()) {
                TeamMember membership = memberships.get(0);
                // Check if this user is a Pilot (not Leader)
                boolean isLeader = membership.getTeamRole() != null &&
                        membership.getTeamRole().getRoleName().equalsIgnoreCase("Leader");
                if (!isLeader) {
                    // Find the team leader and add their partition
                    List<TeamMember> teamMembers = teamMemberRepository.findByTeamIdWithUser(membership.getTeamId());
                    for (TeamMember tm : teamMembers) {
                        if (tm.getTeamRole() != null &&
                                tm.getTeamRole().getRoleName().equalsIgnoreCase("Leader")) {
                            Optional<User> leaderOpt = userRepository.findById(tm.getUserId());
                            if (leaderOpt.isPresent()) {
                                String leaderPartition = getOrComputePartition(leaderOpt.get());
                                if (leaderPartition != null) {
                                    newPartitions.add(leaderPartition);
                                }
                            }
                            break;
                        }
                    }
                }
            }
        }

        // Update drone entity with new control owner
        Optional<Drone> droneOpt = droneRepository.findByUavId(uavId);
        if (droneOpt.isPresent()) {
            Drone drone = droneOpt.get();
            drone.setControlOwnerId(newOwnerId);
            drone.setViewOwnerId(newOwnerId);
            droneRepository.save(drone);
        }

        // Get old partitions before updating to compute removed set
        Set<String> oldPartitions = partitionRoutingService.getPartitionsForDrone(uavId);

        partitionRoutingService.updateDronePartitions(uavId, newPartitions);

        // Notify old partitions (that are no longer in new set) about drone removal
        Set<String> removedPartitions = new LinkedHashSet<>(oldPartitions);
        removedPartitions.removeAll(newPartitions);
        if (!removedPartitions.isEmpty()) {
            webSocketGatewayService.notifyDroneRemoved(uavId, removedPartitions);
        }

        log.info("Recalculated partitions for drone {} after transfer to user {}: {} (removed from: {})",
                uavId, newOwnerId, newPartitions, removedPartitions);
    }

    /**
     * Recalculate drone partitions after team ownership transfer.
     * Assigns to team leader, so partitions = observer + commander + leader's partition ONLY.
     * (Not all team members - they get access only when drone is further transferred to them)
     */
    private void recalculateDronePartitionsForTeam(String uavId, Long teamId, Long leaderId) {
        Set<String> newPartitions = new LinkedHashSet<>();
        newPartitions.add("observer");
        newPartitions.add("commander");

        // Add ONLY the team leader's partition (not all team members)
        Optional<User> leaderOpt = userRepository.findById(leaderId);
        if (leaderOpt.isPresent()) {
            String leaderPartition = getOrComputePartition(leaderOpt.get());
            if (leaderPartition != null) {
                newPartitions.add(leaderPartition);
            }
        }

        // Update drone entity with new control owner (team leader) and view owner
        Optional<Drone> droneOpt = droneRepository.findByUavId(uavId);
        if (droneOpt.isPresent()) {
            Drone drone = droneOpt.get();
            drone.setControlOwnerId(leaderId);
            drone.setViewOwnerId(leaderId);
            droneRepository.save(drone);
        }

        // Get old partitions before updating to compute removed set
        Set<String> oldPartitions = partitionRoutingService.getPartitionsForDrone(uavId);

        partitionRoutingService.updateDronePartitions(uavId, newPartitions);

        // Notify old partitions (that are no longer in new set) about drone removal
        Set<String> removedPartitions = new LinkedHashSet<>(oldPartitions);
        removedPartitions.removeAll(newPartitions);
        if (!removedPartitions.isEmpty()) {
            webSocketGatewayService.notifyDroneRemoved(uavId, removedPartitions);
        }

        log.info("Recalculated partitions for drone {} after transfer to team {}: {} (removed from: {})",
                uavId, teamId, newPartitions, removedPartitions);
    }

    /**
     * Add all team members' partitions to the partition set.
     */
    private void addTeamMemberPartitions(Long teamId, Set<String> partitions) {
        List<TeamMember> members = teamMemberRepository.findByTeamId(teamId);
        for (TeamMember member : members) {
            Optional<User> memberUserOpt = userRepository.findById(member.getUserId());
            if (memberUserOpt.isPresent()) {
                String memberPartition = getOrComputePartition(memberUserOpt.get());
                if (memberPartition != null) {
                    partitions.add(memberPartition);
                }
            }
        }
    }

    /**
     * Get or compute partition name for a user.
     * If partition_name is null in DB, compute it and persist.
     */
    private String getOrComputePartition(User user) {
        if (user.getPartitionName() != null && !user.getPartitionName().isEmpty()) {
            return user.getPartitionName();
        }
        // Compute partition name from role
        List<UserRoleMap> userRoles = userRoleMapRepository.findByUserIdWithRole(user.getId());
        String primaryRole = userRoles.isEmpty() ? "operator" : userRoles.get(0).getRole().getRoleName();
        String partition = PartitionNameUtil.computePartitionName(primaryRole, user.getUsername(), user.getId());
        user.setPartitionName(partition);
        userRepository.save(user);
        return partition;
    }

    /**
     * Batch transfer permissions to a team.
     *
     * @return List of uavIds that were successfully transferred
     */
    public List<String> batchTransferPermissionToTeam(List<String> uavIds, Long toTeamId,
                                                        Long operatorId, String operatorName) {
        List<String> successList = new ArrayList<>();
        for (String uavId : uavIds) {
            try {
                boolean ok = transferPermissionToTeam(uavId, toTeamId, operatorId, operatorName);
                if (ok) {
                    successList.add(uavId);
                }
            } catch (Exception e) {
                log.error("Batch team transfer failed for drone {}: {}", uavId, e.getMessage());
            }
        }
        return successList;
    }
}
