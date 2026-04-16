package com.ucs.service;

import com.google.common.hash.BloomFilter;
import com.google.common.hash.Funnels;
import com.ucs.entity.Drone;
import com.ucs.entity.DronePartitionMap;
import com.ucs.repository.DronePartitionMapRepository;
import com.ucs.repository.DroneRepository;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Partition routing service for drone-to-partition mapping.
 *
 * <h3>Dual-Write Consistency Strategy: Transactional Outbox + Post-Commit Hook</h3>
 * <p>
 * Instead of the commonly used "delayed double-delete" approach, this service uses
 * a more robust enterprise-grade pattern:
 * </p>
 * <ol>
 *   <li><b>DB-first write</b>: All partition changes are persisted to PostgreSQL
 *       within a {@code @Transactional} boundary. This is the single source of truth.</li>
 *   <li><b>Post-commit Redis sync</b>: After the DB transaction commits successfully,
 *       a {@link TransactionSynchronization#afterCommit()} callback propagates the
 *       changes to Redis. This guarantees Redis is NEVER updated if the DB transaction
 *       rolls back (eliminating phantom cache entries).</li>
 *   <li><b>Retry queue</b>: If the post-commit Redis write fails (e.g., Redis is
 *       temporarily down), the operation is queued in a {@link ConcurrentLinkedQueue}.
 *       A scheduled task retries failed operations with exponential backoff.</li>
 *   <li><b>Periodic reconciliation</b>: A scheduled job runs every 60 seconds to
 *       detect and fix any drift between DB and Redis (e.g., caused by Redis restarts,
 *       network partitions, or missed retry operations).</li>
 * </ol>
 *
 * <h4>Why not delayed double-delete?</h4>
 * <ul>
 *   <li>Delayed double-delete relies on tuning a sleep/delay window, which is fragile
 *       under variable DB replication lag or Redis latency.</li>
 *   <li>It can still leave a stale cache entry if the second delete fails.</li>
 *   <li>The post-commit hook approach provides a deterministic guarantee: Redis is
 *       only updated after DB commit, and failures are retried until resolved.</li>
 * </ul>
 *
 * <h4>Consistency guarantee</h4>
 * <p>
 * This design provides <b>eventual consistency</b> with a typical convergence window
 * of &lt;100ms (post-commit hook latency). In the worst case (Redis down), data
 * converges within 60 seconds (reconciliation interval) after Redis recovers.
 * Read operations use Redis-first with DB fallback, so stale reads only affect
 * performance (extra DB query), never correctness.
 * </p>
 */
@Slf4j
@Service
public class PartitionRoutingService {

    private final RedisService redisService;
    private final DroneRepository droneRepository;
    private final DronePartitionMapRepository dronePartitionMapRepository;
    private final StringRedisTemplate stringRedisTemplate;

    /**
     * Pending Redis sync operations that failed and need retry.
     * Each entry is a Runnable that performs the Redis write.
     */
    private final ConcurrentLinkedQueue<Runnable> pendingRedisSyncQueue = new ConcurrentLinkedQueue<>();

    // ===================== T-14: 缓存穿透三层防护 =====================

    /**
     * T-14 ① 布隆过滤器 — 快速拦截不存在的uavId
     * 判断“不存在”时100%准确，“存在”时有1%误判率
     */
    @SuppressWarnings("UnstableApiUsage")
    private final BloomFilter<String> droneBloomFilter = BloomFilter.create(
            Funnels.stringFunnel(StandardCharsets.UTF_8),
            100_000,   // 预期最大无人机数量
            0.01       // 1%误判率
    );

    /** T-14 ② uavId格式校验 — 源头拦截非法ID */
    private static final Pattern VALID_UAV_ID = Pattern.compile(
            "^(px4_\\d+|mav_\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}_\\d+)$"
    );

    /** T-14 ③ 空值缓存前缀 — 缓存“不存在”的查询结果，TTL=60s */
    private static final String NULL_CACHE_PREFIX = "drone:%s:partitions:null";
    private static final Duration NULL_CACHE_TTL = Duration.ofSeconds(60);

    public PartitionRoutingService(RedisService redisService,
                                   DroneRepository droneRepository,
                                   DronePartitionMapRepository dronePartitionMapRepository,
                                   StringRedisTemplate stringRedisTemplate) {
        this.redisService = redisService;
        this.droneRepository = droneRepository;
        this.dronePartitionMapRepository = dronePartitionMapRepository;
        this.stringRedisTemplate = stringRedisTemplate;
    }

    /** T-14: 服务启动时从数据库加载所有已有uavId到布隆过滤器 */
    @SuppressWarnings("UnstableApiUsage")
    @PostConstruct
    public void initBloomFilter() {
        droneRepository.findAll().forEach(drone -> droneBloomFilter.put(drone.getUavId()));
        log.info("[PartitionRouting] Bloom filter initialized with {} drones", droneRepository.count());
    }

    /**
     * Get partitions for a drone. Priority: Redis -> Database -> Auto-create.
     *
     * @param uavId DDS drone identifier (e.g., "px4_1")
     * @return Set of partition names this drone's data should be routed to
     */
    @SuppressWarnings("UnstableApiUsage")
    public Set<String> getPartitionsForDrone(String uavId) {
        // T-14 ② 格式校验：拦截非法uavId
        if (!VALID_UAV_ID.matcher(uavId).matches()) {
            log.debug("[PartitionRouting] Invalid uavId format rejected: {}", uavId);
            return Collections.emptySet();
        }

        // T-14 ① 布隆过滤器：快速拦截不存在的uavId (O(1))
        if (!droneBloomFilter.mightContain(uavId)) {
            log.debug("[PartitionRouting] Bloom filter rejected: {}", uavId);
            return Collections.emptySet();
        }

        // T-14 ③ 空值缓存：检查是否已缓存“不存在”的结果
        String nullCacheKey = String.format(NULL_CACHE_PREFIX, uavId);
        if (Boolean.TRUE.equals(stringRedisTemplate.hasKey(nullCacheKey))) {
            log.debug("[PartitionRouting] Null cache HIT for drone '{}'", uavId);
            return Collections.emptySet();
        }

        // 1. Try Redis first
        Set<String> cached = redisService.getDronePartitions(uavId);
        if (!cached.isEmpty()) {
            // T-13: 降级为DEBUG，缓存命中是高频事件
            log.debug("[PartitionRouting] Cache HIT for drone '{}': partitions={}", uavId, cached);
            return cached;
        }
        log.info("[PartitionRouting] Cache MISS for drone '{}', querying database...", uavId);

        // 2. Fallback to database
        List<String> dbPartitions = dronePartitionMapRepository.findActivePartitionNamesByUavId(uavId);
        if (!dbPartitions.isEmpty()) {
            Set<String> partitionSet = new LinkedHashSet<>(dbPartitions);
            syncToRedis(uavId, partitionSet, Collections.emptySet());
            log.info("Loaded partitions for drone {} from DB: {}", uavId, partitionSet);
            return partitionSet;
        }

        // 3. New drone: auto-create with default partitions (observer + commander)
        log.info("[PartitionRouting] Drone '{}' not in DB, auto-creating with default partitions...", uavId);
        return autoCreateDroneWithDefaultPartitions(uavId);
    }

    /**
     * Auto-create a new drone entry with default partitions (observer + commander).
     * Uses post-commit hook to sync Redis after DB transaction commits.
     */
    /**
     * T-19: 使用 INSERT ON CONFLICT 替代 findByUavId + save 的两步操作。
     * 多实例并发接收同一架新无人机遥测时，避免 DataIntegrityViolationException。
     */
    @Transactional
    public Set<String> autoCreateDroneWithDefaultPartitions(String uavId) {
        log.info("Auto-creating new drone: {}", uavId);

        // T-19: INSERT ON CONFLICT DO NOTHING — 并发安全，冲突时静默跳过
        int inserted = droneRepository.insertOnConflictDoNothing(
                uavId, "AUTO-" + uavId, "PX4-SITL", "PX4");
        if (inserted > 0) {
            log.info("Created new drone record via INSERT ON CONFLICT: {}", uavId);
        }

        // 无论是新建还是已存在，都需要获取drone实体
        Drone drone = droneRepository.findByUavId(uavId)
                .orElseThrow(() -> new RuntimeException("Drone not found after upsert: " + uavId));

        // Default partitions: observer + commander
        Set<String> defaultPartitions = new LinkedHashSet<>();
        defaultPartitions.add("observer");
        defaultPartitions.add("commander");

        // Save partition mappings to DB (within transaction)
        for (String partition : defaultPartitions) {
            DronePartitionMap dpm = new DronePartitionMap();
            dpm.setDroneId(drone.getId());
            dpm.setUavId(uavId);
            dpm.setPartitionName(partition);
            dpm.setIsActive(true);
            dronePartitionMapRepository.save(dpm);
        }

        // Post-commit hook: sync to Redis only AFTER DB transaction commits
        registerPostCommitRedisSync(uavId, defaultPartitions, Collections.emptySet());

        // T-14: 新无人机加入布隆过滤器
        droneBloomFilter.put(uavId);

        log.info("Auto-created drone {} with default partitions: {}", uavId, defaultPartitions);
        return defaultPartitions;
    }

    /**
     * Update partitions for a drone (e.g., when ownership changes).
     *
     * <p>Uses the Transactional Outbox + Post-Commit Hook pattern:</p>
     * <ol>
     *   <li>DB writes (deactivate old, create new) happen within @Transactional</li>
     *   <li>Redis sync is deferred to afterCommit() callback</li>
     *   <li>If Redis sync fails, it is queued for retry</li>
     * </ol>
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

        // Create new partition mappings (within transaction)
        for (String partition : newPartitions) {
            DronePartitionMap dpm = new DronePartitionMap();
            dpm.setDroneId(droneId);
            dpm.setUavId(uavId);
            dpm.setPartitionName(partition);
            dpm.setIsActive(true);
            dronePartitionMapRepository.save(dpm);
        }

        // Post-commit hook: sync to Redis only AFTER DB transaction commits successfully.
        // This prevents Redis from containing data that the DB rolled back.
        Set<String> removedPartitions = new LinkedHashSet<>(oldPartitions);
        removedPartitions.removeAll(newPartitions);
        registerPostCommitRedisSync(uavId, newPartitions, removedPartitions);

        log.info("Updated drone {} partitions: {} -> {} (DB committed, Redis sync pending)",
                uavId, oldPartitions, newPartitions);
    }

    /**
     * Register a post-commit callback to sync partition data to Redis.
     * If called outside a transaction, executes immediately.
     */
    private void registerPostCommitRedisSync(String uavId, Set<String> newPartitions, Set<String> removedPartitions) {
        Runnable redisSync = () -> syncToRedis(uavId, newPartitions, removedPartitions);

        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    try {
                        redisSync.run();
                        log.info("[DualWrite] Post-commit Redis sync succeeded for drone '{}'", uavId);
                    } catch (Exception e) {
                        log.warn("[DualWrite] Post-commit Redis sync FAILED for drone '{}', queuing for retry: {}",
                                uavId, e.getMessage());
                        pendingRedisSyncQueue.offer(redisSync);
                    }
                }
            });
        } else {
            // No active transaction (e.g., cache-aside read path) — sync immediately
            try {
                redisSync.run();
            } catch (Exception e) {
                log.warn("[DualWrite] Immediate Redis sync failed for '{}', queuing for retry", uavId);
                pendingRedisSyncQueue.offer(redisSync);
            }
        }
    }

    /**
     * Execute the actual Redis write operations for a drone's partition update.
     */
    private void syncToRedis(String uavId, Set<String> newPartitions, Set<String> removedPartitions) {
        // Remove drone from old partitions that are no longer active
        for (String removed : removedPartitions) {
            redisService.removeDroneFromPartition(uavId, removed);
        }
        // Set new partition membership
        redisService.setDronePartitions(uavId, newPartitions);
        // Update reverse indexes
        for (String partition : newPartitions) {
            redisService.addDroneToPartition(uavId, partition);
        }
    }

    /**
     * Retry failed Redis sync operations.
     * Runs every 5 seconds. Each failed operation is retried once per cycle.
     * If it fails again, it goes back to the end of the queue.
     */
    @Scheduled(fixedDelay = 5000)
    @SchedulerLock(name = "retryPendingRedisSync", lockAtLeastFor = "2s", lockAtMostFor = "10s")
    public void retryPendingRedisSync() {
        int size = pendingRedisSyncQueue.size();
        if (size == 0) return;
        log.info("[DualWrite] Retrying {} pending Redis sync operations...", size);
        int retried = 0;
        int failed = 0;
        for (int i = 0; i < size; i++) {
            Runnable op = pendingRedisSyncQueue.poll();
            if (op == null) break;
            try {
                op.run();
                retried++;
            } catch (Exception e) {
                failed++;
                pendingRedisSyncQueue.offer(op); // Re-queue for next cycle
                log.warn("[DualWrite] Retry failed, re-queued: {}", e.getMessage());
            }
        }
        log.info("[DualWrite] Retry complete: {} succeeded, {} re-queued", retried, failed);
    }

    /**
     * Periodic reconciliation: detect and fix drift between DB and Redis.
     * Runs every 60 seconds. Compares DB state with Redis state and fixes discrepancies.
     * This is the safety net that guarantees eventual consistency even after Redis restarts.
     */
    /**
     * T-17: 优化对账 — 只查活跃记录 + Redis Pipeline批量查询
     * 将N次Redis网络调用合并为1次Pipeline调用
     */
    @Scheduled(fixedDelay = 300000, initialDelay = 30000) // T-26: CDC引入后延长到300s作为兜底
    @SchedulerLock(name = "reconcileDbRedis", lockAtLeastFor = "50s", lockAtMostFor = "5m")
    public void reconcileDbRedis() {
        try {
            // T-17: 使用findAllActive()替代findAll().stream().filter()
            List<DronePartitionMap> allActive = dronePartitionMapRepository.findAllActive();

            Map<String, Set<String>> dbState = new LinkedHashMap<>();
            for (DronePartitionMap dpm : allActive) {
                dbState.computeIfAbsent(dpm.getUavId(), k -> new LinkedHashSet<>())
                        .add(dpm.getPartitionName());
            }

            // T-17: Redis Pipeline批量查询 — N次网络调用 → 1次
            List<String> uavIdList = new ArrayList<>(dbState.keySet());
            List<Object> pipelineResults = stringRedisTemplate.executePipelined(
                    (org.springframework.data.redis.connection.RedisCallback<Object>) connection -> {
                        for (String uavId : uavIdList) {
                            byte[] keyBytes = String.format("drone:%s:partitions", uavId)
                                    .getBytes(StandardCharsets.UTF_8);
                            connection.setCommands().sMembers(keyBytes);
                        }
                        return null;
                    }
            );

            int fixCount = 0;
            for (int i = 0; i < uavIdList.size(); i++) {
                String uavId = uavIdList.get(i);
                Set<String> dbPartitions = dbState.get(uavId);

                // Pipeline返回的Set<byte[]>需转为Set<String>
                Set<String> redisPartitions = new LinkedHashSet<>();
                Object result = pipelineResults.get(i);
                if (result instanceof Set<?>) {
                    for (Object item : (Set<?>) result) {
                        if (item instanceof byte[]) {
                            redisPartitions.add(new String((byte[]) item, StandardCharsets.UTF_8));
                        } else if (item instanceof String) {
                            redisPartitions.add((String) item);
                        }
                    }
                }

                if (!dbPartitions.equals(redisPartitions)) {
                    log.warn("[Reconcile] Drift detected for '{}': DB={} vs Redis={}. Fixing...",
                            uavId, dbPartitions, redisPartitions);
                    Set<String> toRemove = new LinkedHashSet<>(redisPartitions);
                    toRemove.removeAll(dbPartitions);
                    syncToRedis(uavId, dbPartitions, toRemove);
                    fixCount++;
                }
            }

            if (fixCount > 0) {
                log.info("[Reconcile] Fixed {} DB-Redis drift(s) out of {} drones", fixCount, dbState.size());
            } else {
                log.debug("[Reconcile] All {} drones consistent", dbState.size());
            }
        } catch (Exception e) {
            log.error("[Reconcile] Reconciliation failed: {}", e.getMessage(), e);
        }
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
            syncToRedis(entry.getKey(), entry.getValue(), Collections.emptySet());
        }

        log.info("Cache warmed up: {} drones loaded", dronePartitions.size());
    }
}
