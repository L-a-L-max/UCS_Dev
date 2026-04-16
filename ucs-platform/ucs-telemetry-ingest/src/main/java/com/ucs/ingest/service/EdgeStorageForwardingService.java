package com.ucs.ingest.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicLong;

/**
 * T-62: Edge Storage Forwarding Service.
 *
 * Provides local buffering and store-and-forward capability for telemetry data
 * when the central cloud/Kafka infrastructure is temporarily unavailable.
 *
 * Architecture:
 *   Edge Gateway (DDS/MAVLink) -> EdgeStorageForwardingService -> Kafka
 *                                        |
 *                                  [Local Buffer]
 *                                  (Redis List as WAL)
 *
 * When Kafka is available:
 *   - Data flows directly to Kafka (normal path)
 *   - Buffer is empty
 *
 * When Kafka is unavailable:
 *   - Data is buffered in Redis List (acts as Write-Ahead Log)
 *   - Buffer has configurable max size (default 100,000 messages)
 *   - When buffer is full, oldest messages are dropped (circular buffer behavior)
 *
 * When Kafka recovers:
 *   - Buffered messages are forwarded in order (FIFO)
 *   - Forward rate is throttled to avoid overwhelming Kafka (batch of 500 every 100ms)
 *   - Original timestamps preserved for accurate data reconstruction
 *
 * Monitoring:
 *   - Buffer depth exposed via /actuator/metrics
 *   - Alert triggered when buffer exceeds 50% capacity
 *   - Forward progress logged every 1000 messages
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EdgeStorageForwardingService {

    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;

    private static final String BUFFER_KEY = "edge:buffer:telemetry";
    private static final String BUFFER_STATS_KEY = "edge:buffer:stats";

    @Value("${ucs.edge.buffer.max-size:100000}")
    private long maxBufferSize;

    @Value("${ucs.edge.buffer.forward-batch-size:500}")
    private int forwardBatchSize;

    /** Tracks total messages buffered since startup */
    private final AtomicLong totalBuffered = new AtomicLong(0);

    /** Tracks total messages forwarded since startup */
    private final AtomicLong totalForwarded = new AtomicLong(0);

    /** In-memory overflow queue when Redis is also unavailable */
    private final ConcurrentLinkedQueue<String> memoryBuffer = new ConcurrentLinkedQueue<>();
    private static final int MEMORY_BUFFER_MAX = 10000;

    /** Callback interface for forwarding buffered messages */
    private ForwardCallback forwardCallback;

    /**
     * Set the callback for forwarding buffered messages to Kafka.
     * Called by the Kafka producer during initialization.
     */
    public void setForwardCallback(ForwardCallback callback) {
        this.forwardCallback = callback;
    }

    /**
     * Buffer a telemetry message for later forwarding.
     * Called when Kafka send fails.
     *
     * @param message JSON-serialized telemetry message
     */
    public void bufferMessage(String message) {
        try {
            // Add timestamp wrapper for ordering
            Map<String, Object> wrapped = new LinkedHashMap<>();
            wrapped.put("bufferedAt", Instant.now().toString());
            wrapped.put("payload", message);
            String json = objectMapper.writeValueAsString(wrapped);

            // Try Redis buffer first
            Long size = redisTemplate.opsForList().rightPush(BUFFER_KEY, json);
            if (size != null && size > maxBufferSize) {
                // Trim oldest messages (circular buffer)
                redisTemplate.opsForList().trim(BUFFER_KEY, size - maxBufferSize, -1);
                log.debug("[EdgeBuffer] Buffer full, trimmed oldest messages (size: {})", maxBufferSize);
            }

            totalBuffered.incrementAndGet();
            log.debug("[EdgeBuffer] Buffered message (buffer depth: {})", size);

        } catch (Exception e) {
            // Redis also unavailable — use in-memory buffer as last resort
            if (memoryBuffer.size() < MEMORY_BUFFER_MAX) {
                memoryBuffer.offer(message);
                log.debug("[EdgeBuffer] Redis unavailable, using memory buffer (size: {})", memoryBuffer.size());
            } else {
                log.warn("[EdgeBuffer] All buffers full, dropping message");
            }
        }
    }

    /**
     * Attempt to forward buffered messages to Kafka.
     * Runs every 100ms when buffer is non-empty.
     */
    @Scheduled(fixedDelay = 100)
    public void forwardBufferedMessages() {
        if (forwardCallback == null) return;

        try {
            // First, drain memory buffer to Redis buffer
            drainMemoryBufferToRedis();

            // Check buffer depth
            Long depth = redisTemplate.opsForList().size(BUFFER_KEY);
            if (depth == null || depth == 0) return;

            // Forward a batch
            int forwarded = 0;
            for (int i = 0; i < forwardBatchSize; i++) {
                String json = redisTemplate.opsForList().leftPop(BUFFER_KEY);
                if (json == null) break;

                try {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> wrapped = objectMapper.readValue(json, Map.class);
                    String payload = (String) wrapped.get("payload");
                    if (payload != null) {
                        forwardCallback.forward(payload);
                        forwarded++;
                    }
                } catch (Exception e) {
                    log.debug("[EdgeBuffer] Failed to forward message: {}", e.getMessage());
                    // Re-queue failed message at the front
                    redisTemplate.opsForList().leftPush(BUFFER_KEY, json);
                    break; // Stop forwarding on failure (Kafka likely still down)
                }
            }

            if (forwarded > 0) {
                totalForwarded.addAndGet(forwarded);
                long remaining = depth - forwarded;
                log.debug("[EdgeBuffer] Forwarded {} messages, {} remaining", forwarded, remaining);

                if (totalForwarded.get() % 1000 == 0) {
                    log.info("[EdgeBuffer] Forward progress: total forwarded={}, remaining={}",
                            totalForwarded.get(), remaining);
                }
            }

        } catch (Exception e) {
            log.debug("[EdgeBuffer] Forward cycle failed: {}", e.getMessage());
        }
    }

    /**
     * Get current buffer statistics.
     */
    public BufferStats getStats() {
        BufferStats stats = new BufferStats();
        try {
            Long depth = redisTemplate.opsForList().size(BUFFER_KEY);
            stats.setRedisBufferDepth(depth != null ? depth : 0);
        } catch (Exception e) {
            stats.setRedisBufferDepth(-1); // Redis unavailable
        }
        stats.setMemoryBufferDepth(memoryBuffer.size());
        stats.setTotalBuffered(totalBuffered.get());
        stats.setTotalForwarded(totalForwarded.get());
        stats.setMaxBufferSize(maxBufferSize);
        stats.setBufferUtilization(stats.getRedisBufferDepth() >= 0
                ? (double) stats.getRedisBufferDepth() / maxBufferSize * 100.0
                : -1.0);
        return stats;
    }

    /**
     * Clear the buffer (admin operation).
     */
    public long clearBuffer() {
        Long size = redisTemplate.opsForList().size(BUFFER_KEY);
        redisTemplate.delete(BUFFER_KEY);
        memoryBuffer.clear();
        log.info("[EdgeBuffer] Buffer cleared ({} messages discarded)", size);
        return size != null ? size : 0;
    }

    // ---- Internal helpers ----

    private void drainMemoryBufferToRedis() {
        if (memoryBuffer.isEmpty()) return;

        int drained = 0;
        String message;
        while ((message = memoryBuffer.poll()) != null) {
            try {
                Map<String, Object> wrapped = new LinkedHashMap<>();
                wrapped.put("bufferedAt", Instant.now().toString());
                wrapped.put("payload", message);
                String json = objectMapper.writeValueAsString(wrapped);
                redisTemplate.opsForList().rightPush(BUFFER_KEY, json);
                drained++;
            } catch (Exception e) {
                // Redis still down, put back in memory
                memoryBuffer.offer(message);
                break;
            }
        }
        if (drained > 0) {
            log.debug("[EdgeBuffer] Drained {} messages from memory to Redis buffer", drained);
        }
    }

    // ---- Data classes ----

    @Data
    public static class BufferStats {
        private long redisBufferDepth;
        private int memoryBufferDepth;
        private long totalBuffered;
        private long totalForwarded;
        private long maxBufferSize;
        private double bufferUtilization; // percentage
    }

    /**
     * Callback interface for forwarding messages to Kafka.
     */
    @FunctionalInterface
    public interface ForwardCallback {
        void forward(String message) throws Exception;
    }
}
