package com.ucs.service;

import com.ucs.entity.Drone;
import com.ucs.entity.DroneOwnership;
import com.ucs.entity.User;
import com.ucs.repository.DroneOwnershipRepository;
import com.ucs.repository.DroneRepository;
import com.ucs.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
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
    private final RedisService redisService;
    private final OperationLogService operationLogService;
    
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
            
            // 3. Update Redis cache
            redisService.setDroneController(uavId, toUserId);
            
            // 4. Log operation
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
    
    private String buildTransferDetail(Long fromUserId, Long toUserId) {
        return String.format("{\"fromUserId\":%s,\"toUserId\":%d}",
                fromUserId != null ? fromUserId.toString() : "null", toUserId);
    }
}
