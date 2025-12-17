package com.ucs.service;

import com.ucs.dto.EventDTO;

import java.util.List;

/**
 * Event Service Interface
 * Following MyBatis-Plus convention with I prefix for interfaces
 */
public interface IEventService {
    
    /**
     * Get recent events
     */
    List<EventDTO> getRecentEvents(int limit);
    
    /**
     * Get events by drone ID
     */
    List<EventDTO> getEventsByDroneId(Long droneId, int limit);
    
    /**
     * Get events by user ID
     */
    List<EventDTO> getEventsByUserId(Long userId, int limit);
    
    /**
     * Log new event
     */
    void logEvent(String eventType, Long droneId, Long userId, String level, String message);
}
