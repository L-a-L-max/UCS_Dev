package com.ucs.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

/**
 * Cache warmup service.
 * Initializes the PartitionRoutingService Redis cache from database on startup.
 * This runs independently from DataInitService (which is disabled for PostgreSQL).
 * 
 * For PostgreSQL mode: user executes schema.sql + data.sql manually,
 * then this service loads partition mappings into Redis on backend startup.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CacheWarmupService {

    private final PartitionRoutingService partitionRoutingService;

    /**
     * Warm up Redis cache after application is fully ready.
     * Uses ApplicationReadyEvent to ensure all beans and DB connections are ready.
     */
    @EventListener(ApplicationReadyEvent.class)
    public void onApplicationReady() {
        log.info("Application ready - warming up partition cache from database...");
        try {
            partitionRoutingService.warmUpCache();
            log.info("Partition cache warmup completed successfully");
        } catch (Exception e) {
            log.warn("Partition cache warmup failed (database may not be initialized yet): {}", e.getMessage());
            log.warn("Run schema.sql and data.sql to initialize the database, then restart the backend.");
        }
    }
}
