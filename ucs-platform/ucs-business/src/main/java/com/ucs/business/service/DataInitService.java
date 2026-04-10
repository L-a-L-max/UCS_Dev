package com.ucs.business.service;

import com.ucs.business.entity.*;
import com.ucs.business.repository.*;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ucs.business.util.PartitionNameUtil;
import java.time.LocalDateTime;
import java.util.*;

/**
 * Data initialization service.
 * Creates initial data for H2 in-memory database on startup.
 * 
 * Teams: 巡检队伍 (Inspection), 应急队伍 (Emergency)
 * Personnel: 8 total (2 leaders, 4 operators, 1 observer, 1 commander)
 * Partition naming: observer/commander fixed, others {username_initials}_{id}
 * (e.g., zhangsan id=2 -> "zs_2", lisi id=3 -> "ls_3")
 */
@Slf4j
@Service
@Profile("h2dev")
public class DataInitService {
    
    private final RoleRepository roleRepository;
    private final UserRepository userRepository;
    private final UserRoleMapRepository userRoleMapRepository;
    private final TeamRepository teamRepository;
    private final TeamRoleRepository teamRoleRepository;
    private final TeamMemberRepository teamMemberRepository;
    private final DroneRepository droneRepository;
    private final DroneStatusRepository droneStatusRepository;
    private final DroneOwnershipRepository droneOwnershipRepository;
    private final DronePartitionMapRepository dronePartitionMapRepository;
    private final TeamDroneMapRepository teamDroneMapRepository;
    private final TaskRepository taskRepository;
    private final TaskAssignmentRepository taskAssignmentRepository;
    private final WeatherSnapshotRepository weatherSnapshotRepository;
    private final PasswordEncoder passwordEncoder;
    
    private final Random random = new Random(42); // Fixed seed for reproducibility
    
    public DataInitService(RoleRepository roleRepository,
                          UserRepository userRepository,
                          UserRoleMapRepository userRoleMapRepository,
                          TeamRepository teamRepository,
                          TeamRoleRepository teamRoleRepository,
                          TeamMemberRepository teamMemberRepository,
                          DroneRepository droneRepository,
                          DroneStatusRepository droneStatusRepository,
                          DroneOwnershipRepository droneOwnershipRepository,
                          DronePartitionMapRepository dronePartitionMapRepository,
                          TeamDroneMapRepository teamDroneMapRepository,
                          TaskRepository taskRepository,
                          TaskAssignmentRepository taskAssignmentRepository,
                          WeatherSnapshotRepository weatherSnapshotRepository,
                          PasswordEncoder passwordEncoder) {
        this.roleRepository = roleRepository;
        this.userRepository = userRepository;
        this.userRoleMapRepository = userRoleMapRepository;
        this.teamRepository = teamRepository;
        this.teamRoleRepository = teamRoleRepository;
        this.teamMemberRepository = teamMemberRepository;
        this.droneRepository = droneRepository;
        this.droneStatusRepository = droneStatusRepository;
        this.droneOwnershipRepository = droneOwnershipRepository;
        this.dronePartitionMapRepository = dronePartitionMapRepository;
        this.teamDroneMapRepository = teamDroneMapRepository;
        this.taskRepository = taskRepository;
        this.taskAssignmentRepository = taskAssignmentRepository;
        this.weatherSnapshotRepository = weatherSnapshotRepository;
        this.passwordEncoder = passwordEncoder;
    }
    
    @PostConstruct
    @Transactional
    public void initData() {
        if (roleRepository.count() > 0) {
            return;
        }
        
        initRoles();
        initTeams();
        initUsers();
        initDrones();
        initTasks();
        initWeather();
        
        log.info("=== Data initialization complete ===");
        logUserPartitions();
    }
    
    private void initRoles() {
        String[][] roles = {
                {"operator", "队员 - 普通飞手，可查看和控制自己的无人机"},
                {"leader", "队长 - 可管理队员和分配任务"},
                {"observer", "观察员 - 全局只读权限，用于大屏展示"},
                {"commander", "指挥员 - 最高权限，可创建队伍和分配资源"}
        };
        
        for (String[] roleData : roles) {
            Role role = new Role();
            role.setRoleName(roleData[0]);
            role.setDescription(roleData[1]);
            roleRepository.save(role);
        }
    }
    
    /**
     * Initialize 2 teams: 巡检队伍 and 应急队伍.
     * Each team has Leader and Pilot team roles.
     */
    private void initTeams() {
        String[][] teams = {
                {"巡检队伍", "负责河道、管线等基础设施巡检"},
                {"应急队伍", "负责紧急救援和应急响应任务"}
        };
        
        // Create team roles first (lookup table, only 2 entries)
        TeamRole leaderRole = new TeamRole();
        leaderRole.setRoleName("Leader");
        leaderRole.setDescription("队长");
        teamRoleRepository.save(leaderRole);
        
        TeamRole pilotRole = new TeamRole();
        pilotRole.setRoleName("Pilot");
        pilotRole.setDescription("飞手");
        teamRoleRepository.save(pilotRole);
        
        for (String[] teamData : teams) {
            Team team = new Team();
            team.setTeamName(teamData[0]);
            team.setDescription(teamData[1]);
            // created_by removed per user request
            teamRepository.save(team);
        }
    }
    
    /**
     * Initialize 8 users with partition naming:
     * - commander: partition = "commander"
     * - observer: partition = "observer"
     * - others: partition = "{username_initials}_{id}" (e.g., zhangsan id=2 -> "zs_2")
     * 
     * Team 1 (巡检队伍): zhangsan(leader), lisi(operator), wangwu(operator)
     * Team 2 (应急队伍): zhaoliu(leader), qianqi(operator), sunba(operator)
     * No team: commander, observer
     */
    private void initUsers() {
        Role operatorRole = roleRepository.findByRoleName("operator").orElseThrow();
        Role leaderRole = roleRepository.findByRoleName("leader").orElseThrow();
        Role observerRole = roleRepository.findByRoleName("observer").orElseThrow();
        Role commanderRole = roleRepository.findByRoleName("commander").orElseThrow();
        
        // username, realName, teamId(null=no team), roleName
        String[][] users = {
                {"commander", "指挥官", null, "commander"},
                {"zhangsan", "张三", "1", "leader"},
                {"lisi", "李四", "1", "operator"},
                {"wangwu", "王五", "1", "operator"},
                {"zhaoliu", "赵六", "2", "leader"},
                {"qianqi", "钱七", "2", "operator"},
                {"sunba", "孙八", "2", "operator"},
                {"observer", "观察员", null, "observer"}
        };
        
        for (String[] userData : users) {
            User user = new User();
            user.setUsername(userData[0]);
            user.setPasswordHash(passwordEncoder.encode("123456"));
            user.setRealName(userData[1]);
            user.setPilotLicenseId("AOPA-" + userData[0].toUpperCase());
            user.setPhone("138" + String.format("%08d", random.nextInt(100000000)));
            user.setEmail(userData[0] + "@ucs.com");
            user.setStatus(1);
            
            if (userData[2] != null) {
                user.setTeamId(Long.parseLong(userData[2]));
            }
            
            // Save first to get auto-generated ID
            user = userRepository.save(user);
            
            // Set partition name based on role and username initials
            String partitionName = PartitionNameUtil.computePartitionName(userData[3], userData[0], user.getId());
            user.setPartitionName(partitionName);
            user = userRepository.save(user);
            
            // Assign system role
            UserRoleMap urm = new UserRoleMap();
            urm.setUserId(user.getId());
            switch (userData[3]) {
                case "commander" -> urm.setRoleId(commanderRole.getId());
                case "leader" -> urm.setRoleId(leaderRole.getId());
                case "observer" -> urm.setRoleId(observerRole.getId());
                default -> urm.setRoleId(operatorRole.getId());
            }
            userRoleMapRepository.save(urm);
            
            // Assign to team if applicable
            if (userData[2] != null) {
                Long teamId = Long.parseLong(userData[2]);
                String teamRoleName = "leader".equals(userData[3]) ? "Leader" : "Pilot";
                TeamRole teamRole = teamRoleRepository.findByRoleName(teamRoleName)
                        .orElse(null);
                
                TeamMember tm = new TeamMember();
                tm.setTeamId(teamId);
                tm.setUserId(user.getId());
                if (teamRole != null) {
                    tm.setTeamRoleId(teamRole.getId());
                }
                teamMemberRepository.save(tm);
            }
            
            log.info("Created user: {} (id={}, partition={})", 
                    userData[0], user.getId(), partitionName);
        }
    }
    
    // Partition name computation delegated to PartitionNameUtil
    
    /**
     * Initialize drones with DDS-style identifiers (px4_1, px4_2, etc.)
     * matching PX4 simulation topic naming convention.
     * 
     * Each drone gets default partition mappings (observer + commander)
     * plus the partition of its assigned operator.
     */
    private void initDrones() {
        // droneSn, uavId (DDS identifier), model, manufacturer, teamId, mavlinkSystemId
        String[][] drones = {
                {"PX4-SIM-001", "px4_1", "PX4-SITL", "PX4", "1", "1"},
                {"PX4-SIM-002", "px4_2", "PX4-SITL", "PX4", "1", "2"},
                {"PX4-SIM-003", "px4_3", "PX4-SITL", "PX4", "1", "3"},
                {"PX4-SIM-004", "px4_4", "PX4-SITL", "PX4", "2", "4"},
        };
        
        double baseLat = 39.9042;
        double baseLng = 116.4074;
        
        // Drone ownership: [ownerUserId, assignedByUserId]
        // User IDs (based on init order): 1=commander, 2=zhangsan, 3=lisi, 4=wangwu
        // 5=zhaoliu, 6=qianqi, 7=sunba, 8=observer
        long[][] droneOwners = {
                {3L, 1L},  // px4_1 → lisi (operator, 巡检队伍)
                {3L, 1L},  // px4_2 → lisi
                {4L, 1L},  // px4_3 → wangwu (operator, 巡检队伍)
                {6L, 1L},  // px4_4 → qianqi (operator, 应急队伍)
        };
        
        for (int i = 0; i < drones.length; i++) {
            String[] droneData = drones[i];
            
            Drone drone = new Drone();
            drone.setDroneSn(droneData[0]);
            drone.setUavId(droneData[1]);
            drone.setModel(droneData[2]);
            drone.setManufacturer(droneData[3]);
            drone.setDefaultTeamId(Long.parseLong(droneData[4]));
            drone.setMavlinkSystemId(Integer.parseInt(droneData[5]));
            drone.setOnlineStatus(false);
            drone.setCapabilities("{\"camera\": true, \"thermal\": " + (i < 2) + ", \"zoom\": true}");
            drone = droneRepository.save(drone);
            
            // Assign drone to team
            TeamDroneMap tdm = new TeamDroneMap();
            tdm.setTeamId(Long.parseLong(droneData[4]));
            tdm.setDroneId(drone.getId());
            teamDroneMapRepository.save(tdm);
            
            // Assign drone to operator
            DroneOwnership ownership = new DroneOwnership();
            ownership.setDroneId(drone.getId());
            ownership.setUserId(droneOwners[i][0]);
            ownership.setAssignedBy(droneOwners[i][1]);
            droneOwnershipRepository.save(ownership);
            
            // Create partition mappings: observer + commander + owner's partition + leader's partition
            createDronePartitions(drone, droneOwners[i][0], Long.parseLong(droneData[4]));
            
            // Create initial drone status
            DroneStatus status = new DroneStatus();
            status.setDroneId(drone.getId());
            status.setLat(baseLat + (random.nextDouble() - 0.5) * 0.02);
            status.setLng(baseLng + (random.nextDouble() - 0.5) * 0.02);
            status.setAlt(0.0);
            status.setHeading((float) (random.nextDouble() * 360));
            status.setVelocity(0f);
            status.setBattery((float) (80 + random.nextDouble() * 20));
            status.setHealthStatus(0);
            status.setRiskLevel(0);
            status.setFlightStatus("IDLE");
            status.setTaskStatus("IDLE");
            status.setGridX((int) ((status.getLng() - 116.0) * 1000));
            status.setGridY((int) ((status.getLat() - 39.0) * 1000));
            droneStatusRepository.save(status);
            
            log.info("Created drone: {} (id={}) with partition mappings", droneData[1], drone.getId());
        }
    }
    
    /**
     * Create partition mappings for a drone.
     * Default: observer + commander
     * Plus: owner's partition + team leader's partition
     */
    private void createDronePartitions(Drone drone, Long ownerUserId, Long teamId) {
        Set<String> partitions = new LinkedHashSet<>();
        
        // Always include observer and commander
        partitions.add("observer");
        partitions.add("commander");
        
        // Add owner's partition
        userRepository.findById(ownerUserId).ifPresent(owner -> {
            if (owner.getPartitionName() != null) {
                partitions.add(owner.getPartitionName());
            }
        });
        
        // Add team leader's partition
        // Use teamRoleRepository.findById instead of lazy tm.getTeamRole() to avoid
        // LazyInitializationException when @PostConstruct + @Transactional don't cooperate
        List<TeamMember> teamMembers = teamMemberRepository.findByTeamId(teamId);
        for (TeamMember tm : teamMembers) {
            if (tm.getTeamRoleId() != null) {
                teamRoleRepository.findById(tm.getTeamRoleId()).ifPresent(teamRole -> {
                    if ("Leader".equalsIgnoreCase(teamRole.getRoleName())) {
                        userRepository.findById(tm.getUserId()).ifPresent(leader -> {
                            if (leader.getPartitionName() != null) {
                                partitions.add(leader.getPartitionName());
                            }
                        });
                    }
                });
            }
        }
        
        // Save all partition mappings
        for (String partitionName : partitions) {
            DronePartitionMap dpm = new DronePartitionMap();
            dpm.setDroneId(drone.getId());
            dpm.setUavId(drone.getUavId());
            dpm.setPartitionName(partitionName);
            dpm.setIsActive(true);
            dronePartitionMapRepository.save(dpm);
        }
        
        log.info("Drone {} partitions: {}", drone.getUavId(), partitions);
    }
    
    private void initTasks() {
        String[][] tasks = {
                {"河道巡检任务A", "INSPECTION", "对河道进行日常巡检", "1"},
                {"管线监测任务B", "MONITORING", "对输油管线进行热成像监测", "0"},
                {"应急响应任务C", "EMERGENCY", "响应突发事件", "0"},
        };
        
        for (String[] taskData : tasks) {
            Task task = new Task();
            task.setTaskName(taskData[0]);
            task.setTaskType(taskData[1]);
            task.setDescription(taskData[2]);
            task.setStatus(Integer.parseInt(taskData[3]));
            task.setPriority(random.nextInt(5));
            task.setStartTime(LocalDateTime.now().minusHours(random.nextInt(24)));
            task.setCreatedBy(1L);
            task = taskRepository.save(task);
            
            TaskAssignment assignment = new TaskAssignment();
            assignment.setTaskId(task.getId());
            assignment.setUserId((long) (2 + random.nextInt(6)));
            assignment.setRole("EXECUTOR");
            taskAssignmentRepository.save(assignment);
        }
    }
    
    private void initWeather() {
        WeatherSnapshot weather = new WeatherSnapshot();
        weather.setTemperature(-2.0f);
        weather.setHumidity(35.0f);
        weather.setWindSpeed(3.5f);
        weather.setWindDirection(315.0f);
        weather.setRiskLevel("MEDIUM");
        weather.setLocation("Beijing");
        weatherSnapshotRepository.save(weather);
    }
    
    /**
     * Log all user partition assignments for debugging.
     */
    private void logUserPartitions() {
        log.info("=== User Partition Assignments ===");
        userRepository.findAll().forEach(user -> 
            log.info("  {} (id={}, role={}) -> partition: {}", 
                    user.getUsername(), user.getId(), 
                    user.getTeamId() != null ? "team:" + user.getTeamId() : "global",
                    user.getPartitionName())
        );
        
        log.info("=== Drone Partition Mappings ===");
        dronePartitionMapRepository.findAll().forEach(dpm ->
            log.info("  drone {} -> partition: {}", dpm.getUavId(), dpm.getPartitionName())
        );
    }
}
