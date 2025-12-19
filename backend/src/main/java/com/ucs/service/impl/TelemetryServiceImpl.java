package com.ucs.service.impl;

import com.ucs.dto.UavTelemetryBatchDTO;
import com.ucs.dto.UavTelemetryDTO;
import com.ucs.entity.UavLatestState;
import com.ucs.entity.UavTelemetry;
import com.ucs.repository.UavLatestStateRepository;
import com.ucs.repository.UavTelemetryRepository;
import com.ucs.service.ITelemetryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * Service implementation for UAV telemetry data
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TelemetryServiceImpl implements ITelemetryService {
    
    private final UavTelemetryRepository telemetryRepository;
    private final UavLatestStateRepository latestStateRepository;
    private final SimpMessagingTemplate messagingTemplate;
    
    @Override
    @Transactional
    public void processBatchTelemetry(UavTelemetryBatchDTO batch) {
        if (batch == null || batch.getUavs() == null || batch.getUavs().isEmpty()) {
            log.warn("Received empty telemetry batch");
            return;
        }
        
        log.debug("Processing telemetry batch with {} UAVs, seq={}", 
                batch.getUavs().size(), batch.getMsgSeqNumber());
        
        List<UavTelemetry> telemetryList = new ArrayList<>();
        List<UavLatestState> latestStates = new ArrayList<>();
        
        Instant batchTimestamp = batch.getTimestamp() != null ? batch.getTimestamp() : Instant.now();
        
        for (UavTelemetryDTO dto : batch.getUavs()) {
            // Create telemetry record for history
            UavTelemetry telemetry = new UavTelemetry();
            telemetry.setUavId(dto.getUavId());
            telemetry.setTimestamp(dto.getTimestamp() != null ? dto.getTimestamp() : batchTimestamp);
            telemetry.setLat(dto.getLat());
            telemetry.setLon(dto.getLon());
            telemetry.setAlt(dto.getAlt());
            telemetry.setHeading(dto.getHeading());
            telemetry.setGroundSpeed(dto.getGroundSpeed());
            telemetry.setVerticalSpeed(dto.getVerticalSpeed());
            telemetry.setNedX(dto.getNedX());
            telemetry.setNedY(dto.getNedY());
            telemetry.setNedZ(dto.getNedZ());
            telemetry.setVx(dto.getVx());
            telemetry.setVy(dto.getVy());
            telemetry.setVz(dto.getVz());
            telemetry.setDataAge(dto.getDataAge());
            telemetry.setMsgCount(dto.getMsgCount());
            telemetry.setIsActive(dto.getIsActive());
            telemetryList.add(telemetry);
            
            // Create/update latest state record
            UavLatestState latestState = new UavLatestState();
            latestState.setUavId(dto.getUavId());
            latestState.setLastUpdate(dto.getTimestamp() != null ? dto.getTimestamp() : batchTimestamp);
            latestState.setLat(dto.getLat());
            latestState.setLon(dto.getLon());
            latestState.setAlt(dto.getAlt());
            latestState.setHeading(dto.getHeading());
            latestState.setGroundSpeed(dto.getGroundSpeed());
            latestState.setVerticalSpeed(dto.getVerticalSpeed());
            latestState.setNedX(dto.getNedX());
            latestState.setNedY(dto.getNedY());
            latestState.setNedZ(dto.getNedZ());
            latestState.setVx(dto.getVx());
            latestState.setVy(dto.getVy());
            latestState.setVz(dto.getVz());
            latestState.setDataAge(dto.getDataAge());
            latestState.setMsgCount(dto.getMsgCount());
            latestState.setIsActive(dto.getIsActive());
            latestStates.add(latestState);
        }
        
        // Batch save telemetry history
        telemetryRepository.saveAll(telemetryList);
        
        // Batch save/update latest states (JPA will handle upsert via @Id)
        latestStateRepository.saveAll(latestStates);
        
        // Broadcast to WebSocket subscribers
        messagingTemplate.convertAndSend("/topic/telemetry", batch);
        
        log.debug("Processed and broadcast {} UAV telemetry records", telemetryList.size());
    }
    
    @Override
    public List<UavLatestState> getAllLatestStates() {
        return latestStateRepository.findAllByOrderByUavIdAsc();
    }
    
    @Override
    public UavLatestState getLatestState(Integer uavId) {
        return latestStateRepository.findById(uavId).orElse(null);
    }
    
    @Override
    public List<UavTelemetry> getTelemetryHistory(Integer uavId, Instant startTime, Instant endTime) {
        return telemetryRepository.findByUavIdAndTimestampBetweenOrderByTimestampAsc(
                uavId, startTime, endTime);
    }
    
    @Override
    @Transactional
    public void cleanupOldTelemetry(int retentionDays) {
        Instant cutoffTime = Instant.now().minus(retentionDays, ChronoUnit.DAYS);
        telemetryRepository.deleteByTimestampBefore(cutoffTime);
        log.info("Cleaned up telemetry data older than {} days", retentionDays);
    }
}
