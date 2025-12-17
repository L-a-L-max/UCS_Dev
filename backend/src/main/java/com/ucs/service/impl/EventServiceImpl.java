package com.ucs.service.impl;

import com.ucs.dto.EventDTO;
import com.ucs.entity.EventLog;
import com.ucs.repository.EventLogRepository;
import com.ucs.service.IEventService;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Event Service Implementation
 * Following MyBatis-Plus convention with ServiceImpl pattern
 */
@Service
public class EventServiceImpl implements IEventService {
    
    private final EventLogRepository eventLogRepository;
    
    public EventServiceImpl(EventLogRepository eventLogRepository) {
        this.eventLogRepository = eventLogRepository;
    }
    
    @Override
    public List<EventDTO> getRecentEvents(int limit) {
        List<EventLog> events = eventLogRepository.findLatest(PageRequest.of(0, limit));
        return events.stream().map(this::convertToDTO).collect(Collectors.toList());
    }
    
    @Override
    public List<EventDTO> getEventsByDroneId(Long droneId, int limit) {
        // findByDroneId doesn't support pagination, get all and limit manually
        List<EventLog> events = eventLogRepository.findByDroneId(droneId);
        return events.stream()
                .limit(limit)
                .map(this::convertToDTO)
                .collect(Collectors.toList());
    }
    
    @Override
    public List<EventDTO> getEventsByUserId(Long userId, int limit) {
        // No findByUserId method exists, return empty list for now
        // This can be implemented when the repository method is added
        return List.of();
    }
    
    @Override
    public void logEvent(String eventType, Long droneId, Long userId, String level, String message) {
        EventLog event = new EventLog();
        event.setEventType(eventType);
        event.setDroneId(droneId);
        event.setUserId(userId);
        event.setLevel(level);
        event.setMessage(message);
        eventLogRepository.save(event);
    }
    
    public List<EventDTO> getLatestEvents(int limit) {
        List<EventLog> events = eventLogRepository.findLatest(PageRequest.of(0, limit));
        return events.stream().map(this::convertToDTO).collect(Collectors.toList());
    }
    
    public List<EventDTO> getAlerts(int limit) {
        List<EventLog> alerts = eventLogRepository.findAlerts(PageRequest.of(0, limit));
        return alerts.stream().map(this::convertToDTO).collect(Collectors.toList());
    }
    
    private EventDTO convertToDTO(EventLog event) {
        EventDTO dto = new EventDTO();
        dto.setEventType(event.getEventType());
        if (event.getDroneId() != null) {
            dto.setUavId("UAV_" + String.format("%03d", event.getDroneId()));
        }
        dto.setLevel(event.getLevel());
        dto.setTime(event.getCreatedAt());
        dto.setMessage(event.getMessage());
        return dto;
    }
}
