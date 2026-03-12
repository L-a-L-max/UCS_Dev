package com.ucs.service;

import com.ucs.dto.DroneStatusDTO;
import com.ucs.dto.HeatmapPointDTO;
import com.ucs.entity.*;
import com.ucs.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

@Service
public class DroneService {
    
    private final DroneRepository droneRepository;
    private final DroneStatusRepository droneStatusRepository;
    private final DroneOwnershipRepository droneOwnershipRepository;
    private final TeamDroneMapRepository teamDroneMapRepository;
    private final UserRepository userRepository;
    private final CommandLogRepository commandLogRepository;
    private final EventLogRepository eventLogRepository;
    
    public DroneService(DroneRepository droneRepository,
                        DroneStatusRepository droneStatusRepository,
                        DroneOwnershipRepository droneOwnershipRepository,
                        TeamDroneMapRepository teamDroneMapRepository,
                        UserRepository userRepository,
                        CommandLogRepository commandLogRepository,
                        EventLogRepository eventLogRepository) {
        this.droneRepository = droneRepository;
        this.droneStatusRepository = droneStatusRepository;
        this.droneOwnershipRepository = droneOwnershipRepository;
        this.teamDroneMapRepository = teamDroneMapRepository;
        this.userRepository = userRepository;
        this.commandLogRepository = commandLogRepository;
        this.eventLogRepository = eventLogRepository;
    }
    
    public List<DroneStatusDTO> getDronesByUserId(Long userId) {
        List<Long> droneIds = droneOwnershipRepository.findDroneIdsByUserId(userId);
        if (droneIds.isEmpty()) {
            return new ArrayList<>();
        }
        return getDroneStatusList(droneIds);
    }
    
    public List<DroneStatusDTO> getDronesByTeamId(Long teamId) {
        List<Long> droneIds = teamDroneMapRepository.findDroneIdsByTeamId(teamId);
        if (droneIds.isEmpty()) {
            return new ArrayList<>();
        }
        return getDroneStatusList(droneIds);
    }
    
    public List<DroneStatusDTO> getAllDrones() {
        List<Drone> drones = droneRepository.findAll();
        List<Long> droneIds = drones.stream().map(Drone::getId).collect(Collectors.toList());
        return getDroneStatusList(droneIds);
    }
    
    private List<DroneStatusDTO> getDroneStatusList(List<Long> droneIds) {
        List<Drone> drones = droneRepository.findByIdIn(droneIds);
        List<DroneStatus> statuses = droneStatusRepository.findLatestByDroneIds(droneIds);
        
        Map<Long, DroneStatus> statusMap = statuses.stream()
                .collect(Collectors.toMap(DroneStatus::getDroneId, s -> s));
        
        Map<Long, String> ownerMap = getOwnerMap(droneIds);
        
        // Build control owner name map: droneId -> actual controller's realName
        Map<Long, String> controlOwnerMap = getControlOwnerMap(droneIds);
        
        return drones.stream().map(drone -> {
            DroneStatusDTO dto = new DroneStatusDTO();
            dto.setUavId(drone.getUavId() != null ? drone.getUavId() : "UNKNOWN_" + drone.getId());
            dto.setDroneSn(drone.getDroneSn());
            dto.setModel(drone.getModel());
            dto.setOwner(ownerMap.get(drone.getId()));
            dto.setControlOwnerName(controlOwnerMap.get(drone.getId()));
            
            DroneStatus status = statusMap.get(drone.getId());
            if (status != null) {
                dto.setLat(status.getLat());
                dto.setLng(status.getLng());
                dto.setAltitude(status.getAlt());
                dto.setBattery(status.getBattery());
                dto.setVelocity(status.getVelocity());
                dto.setHeading(status.getHeading());
                dto.setFlightStatus(status.getFlightStatus());
                dto.setTaskStatus(status.getTaskStatus());
                dto.setHardwareStatus(getHardwareStatusString(status.getHealthStatus()));
                dto.setColor(getStatusColor(status));
            }
            
            return dto;
        }).collect(Collectors.toList());
    }
    
    private Map<Long, String> getOwnerMap(List<Long> droneIds) {
        return droneIds.stream()
                .collect(Collectors.toMap(
                        id -> id,
                        id -> droneOwnershipRepository.findActiveByDroneId(id)
                                .map(ownership -> userRepository.findById(ownership.getUserId())
                                        .map(User::getRealName)
                                        .orElse("Unknown"))
                                .orElse("Unassigned")
                ));
    }

    /**
     * Build a map of droneId -> actual control owner's realName.
     * Uses DroneOwnership (active record) to find who currently controls each drone.
     */
    private Map<Long, String> getControlOwnerMap(List<Long> droneIds) {
        return droneIds.stream()
                .collect(Collectors.toMap(
                        id -> id,
                        id -> droneOwnershipRepository.findActiveByDroneId(id)
                                .map(ownership -> {
                                    Long userId = ownership.getUserId();
                                    return userRepository.findById(userId)
                                            .map(u -> u.getRealName() != null ? u.getRealName() : u.getUsername())
                                            .orElse("未知用户");
                                })
                                .orElse("未分配")
                ));
    }
    
    private String getHardwareStatusString(Integer healthStatus) {
        if (healthStatus == null) return "UNKNOWN";
        return switch (healthStatus) {
            case 0 -> "NORMAL";
            case 1 -> "WARNING";
            case 2 -> "DANGER";
            default -> "UNKNOWN";
        };
    }
    
    private String getStatusColor(DroneStatus status) {
        if (status.getRiskLevel() == null) return "#808080";
        return switch (status.getRiskLevel()) {
            case 0 -> "#00FF00";
            case 1 -> "#FFFF00";
            case 2 -> "#FF0000";
            default -> "#808080";
        };
    }
    
    public List<String> filterDrones(Long userId, String filterType) {
        List<Long> droneIds = droneOwnershipRepository.findDroneIdsByUserId(userId);
        if (droneIds.isEmpty()) {
            return new ArrayList<>();
        }
        
        List<DroneStatus> statuses = droneStatusRepository.findLatestByDroneIds(droneIds);
        
        return statuses.stream()
                .filter(status -> matchesFilter(status, filterType))
                .map(status -> {
                    // Use actual uavId from drone entity instead of generated name
                    return droneRepository.findById(status.getDroneId())
                            .map(d -> d.getUavId() != null ? d.getUavId() : "UNKNOWN_" + d.getId())
                            .orElse("UNKNOWN_" + status.getDroneId());
                })
                .collect(Collectors.toList());
    }
    
    private boolean matchesFilter(DroneStatus status, String filterType) {
        return switch (filterType.toLowerCase()) {
            case "low_battery" -> status.getBattery() != null && status.getBattery() < 20;
            case "hardware_error" -> status.getHealthStatus() != null && status.getHealthStatus() > 0;
            case "danger" -> status.getRiskLevel() != null && status.getRiskLevel() == 2;
            default -> true;
        };
    }
    
    @Transactional
    public String sendCommand(Long droneId, Long userId, String commandType, String payload) {
        Drone drone = droneRepository.findById(droneId)
                .orElseThrow(() -> new RuntimeException("Drone not found"));
        
        CommandLog log = new CommandLog();
        log.setDroneId(droneId);
        log.setUserId(userId);
        log.setCommandType(commandType);
        log.setPayload(payload);
        log.setStatus("ACCEPTED");
        commandLogRepository.save(log);
        
        EventLog event = new EventLog();
        event.setEventType("COMMAND_SENT");
        event.setDroneId(droneId);
        event.setUserId(userId);
        event.setLevel("INFO");
        event.setMessage("Command " + commandType + " sent to drone " + drone.getDroneSn());
        eventLogRepository.save(event);
        
        return "CMD_" + log.getId();
    }
    
    @Transactional
    public void assignDronesToUser(List<Long> droneIds, Long userId, Long assignedBy) {
        for (Long droneId : droneIds) {
            droneOwnershipRepository.findActiveByDroneId(droneId)
                    .ifPresent(ownership -> {
                        ownership.setExpiredAt(LocalDateTime.now());
                        droneOwnershipRepository.save(ownership);
                    });
            
            DroneOwnership newOwnership = new DroneOwnership();
            newOwnership.setDroneId(droneId);
            newOwnership.setUserId(userId);
            newOwnership.setAssignedBy(assignedBy);
            droneOwnershipRepository.save(newOwnership);
        }
    }
    
    public List<HeatmapPointDTO> getHeatmapData() {
        List<DroneStatus> allLatest = droneStatusRepository.findAllLatest();
        
        return allLatest.stream()
                .filter(s -> s.getLat() != null && s.getLng() != null)
                .map(s -> new HeatmapPointDTO(s.getLat(), s.getLng(), 0.8))
                .collect(Collectors.toList());
    }
    
    public Drone getDroneById(Long droneId) {
        return droneRepository.findById(droneId)
                .orElseThrow(() -> new RuntimeException("Drone not found"));
    }
    
    public Long parseDroneId(String uavId) {
        // First try to find by uavId (DDS identifier like "px4_1")
        Optional<Drone> droneOpt = droneRepository.findByUavId(uavId);
        if (droneOpt.isPresent()) {
            return droneOpt.get().getId();
        }
        // Legacy fallback: "UAV_001" format
        if (uavId.startsWith("UAV_")) {
            return Long.parseLong(uavId.substring(4));
        }
        return Long.parseLong(uavId);
    }
}
