package com.ucs.business.service;

import com.ucs.business.entity.Drone;
import com.ucs.business.entity.DronePartitionMap;
import com.ucs.business.repository.DronePartitionMapRepository;
import com.ucs.business.repository.DroneRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Partition routing service for drone-to-partition mapping.
 * Implements Redis-first lookup with DB fallback.
 * Handles auto-creation of new drones with default partitions (observer + commander).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PartitionRoutingService {

    private final RedisService redisService;
    private final DroneRepository droneRepository;
    private final DronePartitionMapRepository dronePartitionMapRepository;

    /**
     * Get partitions for a drone. Priority: Redis -> Database -> Auto-create.
     *
     * @param uavId DDS drone identifier (e.g., "px4_1")
     * @return Set of partition names this drone's data should be routed to
     */
    public Set<String> getPartitionsForDrone(String uavId) {
        // 1. Try Redis first
        Set<String> cached = redisService.getDronePartitions(uavId);
        if (!cached.isEmpty()) {
            log.info("[PartitionRouting] Cache HIT for drone '{}': partitions={}", uavId, cached);
            return cached;
        }
        log.info("[PartitionRouting] Cache MISS for drone '{}', querying database...", uavId);

        // 2. Fallback to database
        List<String> dbPartitions = dronePartitionMapRepository.findActivePartitionNamesByUavId(uavId);
        if (!dbPartitions.isEmpty()) {
            Set<String> partitionSet = new LinkedHashSet<>(dbPartitions);
            // Write back to Redis for next lookup
            redisService.setDronePartitions(uavId, partitionSet);
            syncPartitionDroneIndex(uavId, partitionSet);
            log.info("Loaded partitions for drone {} from DB: {}", uavId, partitionSet);
            return partitionSet;
        }

        // 3. New drone: auto-create with default partitions (observer + commander)
        log.info("[PartitionRouting] Drone '{}' not in DB, auto-creating with default partitions...", uavId);
        return autoCreateDroneWithDefaultPartitions(uavId);
    }

    /**
     * Auto-create a new drone entry with default partitions (observer + commander).
     */
    @Transactional
    public Set<String> autoCreateDroneWithDefaultPartitions(String uavId) {
        log.info("Auto-creating new drone: {}", uavId);

        // Check if drone already exists in DB
        Optional<Drone> existingDrone = droneRepository.findByUavId(uavId);
        Drone drone;
        if (existingDrone.isPresent()) {
            drone = existingDrone.get();
        } else {
            drone = new Drone();
            drone.setUavId(uavId);
            drone.setDroneSn("AUTO-" + uavId);
            drone.setModel("PX4-SITL");
            drone.setManufacturer("PX4");
            drone.setOnlineStatus(true);
            drone = droneRepository.save(drone);
            log.info("Created new drone record: {} (id={})", uavId, drone.getId());
        }

        // Default partitions: observer + commander
        Set<String> defaultPartitions = new LinkedHashSet<>();
        defaultPartitions.add("observer");
        defaultPartitions.add("commander");

        // Save partition mappings to DB
        for (String partition : defaultPartitions) {
            DronePartitionMap dpm = new DronePartitionMap();
            dpm.setDroneId(drone.getId());
            dpm.setUavId(uavId);
            dpm.setPartitionName(partition);
            dpm.setIsActive(true);
            dronePartitionMapRepository.save(dpm);
        }

        // Cache in Redis
        redisService.setDronePartitions(uavId, defaultPartitions);
        syncPartitionDroneIndex(uavId, defaultPartitions);

        log.info("Auto-created drone {} with default partitions: {}", uavId, defaultPartitions);
        return defaultPartitions;
    }

    /**
     * Update partitions for a drone (e.g., when ownership changes).
     * Updates both DB and Redis.
     */
    @Transactional
    public void updateDronePartitions(String uavId, Set<String> newPartitions) {
        // Deactivate old partition mappings and collect old partition names for Redis cleanup
        List<DronePartitionMap> existingMaps = dronePartitionMapRepository.findByUavIdAndIsActiveTrue(uavId);
        Set<String> oldPartitions = new LinkedHashSet<>();
        for (DronePartitionMap dpm : existingMaps) {
            oldPartitions.add(dpm.getPartitionName());
            dpm.setIsActive(false);
            dronePartitionMapRepository.save(dpm);
        }

        // Get drone ID
        Optional<Drone> droneOpt = droneRepository.findByUavId(uavId);
        if (droneOpt.isEmpty()) {
            log.error("Cannot update partitions for unknown drone: {}", uavId);
            return;
        }
        Long droneId = droneOpt.get().getId();

        // Create new partition mappings
        for (String partition : newPartitions) {
            DronePartitionMap dpm = new DronePartitionMap();
            dpm.setDroneId(droneId);
            dpm.setUavId(uavId);
            dpm.setPartitionName(partition);
            dpm.setIsActive(true);
            dronePartitionMapRepository.save(dpm);
        }

        // Clean up old partition reverse indexes in Redis
        for (String oldPartition : oldPartitions) {
            if (!newPartitions.contains(oldPartition)) {
                redisService.removeDroneFromPartition(uavId, oldPartition);
            }
        }

        // Update Redis with new partitions
        redisService.setDronePartitions(uavId, newPartitions);
        syncPartitionDroneIndex(uavId, newPartitions);

        log.info("Updated drone {} partitions: {} -> {}", uavId, oldPartitions, newPartitions);
    }

    /**
     * Get all drones visible to a specific partition.
     */
    public Set<String> getDronesForPartition(String partitionName) {
        // Try Redis first
        Set<String> cached = redisService.getDronesInPartition(partitionName);
        if (!cached.isEmpty()) {
            return cached;
        }

        // Fallback to DB
        List<String> dbDrones = dronePartitionMapRepository.findActiveUavIdsByPartitionName(partitionName);
        return new LinkedHashSet<>(dbDrones);
    }

    /**
     * Sync the reverse index: partition -> drones in Redis.
     */
    private void syncPartitionDroneIndex(String uavId, Set<String> partitions) {
        for (String partition : partitions) {
            redisService.addDroneToPartition(uavId, partition);
        }
    }

    /**
     * Initialize Redis cache from database on startup.
     * Called after DataInitService completes.
     */
    public void warmUpCache() {
        log.info("Warming up partition cache from database...");
        List<DronePartitionMap> allMaps = dronePartitionMapRepository.findAll().stream()
                .filter(dpm -> Boolean.TRUE.equals(dpm.getIsActive()))
                .collect(Collectors.toList());

        // Group by uavId
        Map<String, Set<String>> dronePartitions = new LinkedHashMap<>();
        for (DronePartitionMap dpm : allMaps) {
            dronePartitions.computeIfAbsent(dpm.getUavId(), k -> new LinkedHashSet<>())
                    .add(dpm.getPartitionName());
        }

        // Write to Redis
        for (Map.Entry<String, Set<String>> entry : dronePartitions.entrySet()) {
            redisService.setDronePartitions(entry.getKey(), entry.getValue());
            syncPartitionDroneIndex(entry.getKey(), entry.getValue());
        }

        log.info("Cache warmed up: {} drones loaded", dronePartitions.size());
    }
}
