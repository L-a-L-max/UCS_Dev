package com.ucs.service;

import com.ucs.dto.EventDTO;
import com.ucs.entity.EventLog;
import com.ucs.repository.EventLogRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class EventService {
    
    private final EventLogRepository eventLogRepository;
    
    public EventService(EventLogRepository eventLogRepository) {
        this.eventLogRepository = eventLogRepository;
    }
    
    public List<EventDTO> getLatestEvents(int limit) {
        List<EventLog> events = eventLogRepository.findLatest(PageRequest.of(0, limit));
        return events.stream().map(this::convertToDTO).collect(Collectors.toList());
    }
    
    public List<EventDTO> getAlerts(int limit) {
        List<EventLog> alerts = eventLogRepository.findAlerts(PageRequest.of(0, limit));
        return alerts.stream().map(this::convertToDTO).collect(Collectors.toList());
    }
    
    public void createEvent(String eventType, Long droneId, Long userId, String level, String message) {
        EventLog event = new EventLog();
        event.setEventType(eventType);
        event.setDroneId(droneId);
        event.setUserId(userId);
        event.setLevel(level);
        event.setMessage(message);
        eventLogRepository.save(event);
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
