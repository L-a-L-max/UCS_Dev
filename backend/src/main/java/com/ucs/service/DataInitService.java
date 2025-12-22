package com.ucs.service;

import com.ucs.entity.*;
import com.ucs.repository.*;
import jakarta.annotation.PostConstruct;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Random;

@Service
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
    private final TeamDroneMapRepository teamDroneMapRepository;
    private final TaskRepository taskRepository;
    private final TaskAssignmentRepository taskAssignmentRepository;
    private final WeatherSnapshotRepository weatherSnapshotRepository;
    private final PasswordEncoder passwordEncoder;
    
    private final Random random = new Random();
    
    public DataInitService(RoleRepository roleRepository,
                          UserRepository userRepository,
                          UserRoleMapRepository userRoleMapRepository,
                          TeamRepository teamRepository,
                          TeamRoleRepository teamRoleRepository,
                          TeamMemberRepository teamMemberRepository,
                          DroneRepository droneRepository,
                          DroneStatusRepository droneStatusRepository,
                          DroneOwnershipRepository droneOwnershipRepository,
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
        initTasks();
        initWeather();
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
    
    private void initTeams() {
        String[][] teams = {
                {"侦察一队", "负责区域侦察和目标跟踪任务"},
                {"巡检二队", "负责河道、管线等基础设施巡检"},
                {"应急三队", "负责紧急救援和应急响应任务"}
        };
        
        for (String[] teamData : teams) {
            Team team = new Team();
            team.setTeamName(teamData[0]);
            team.setDescription(teamData[1]);
            team.setCreatedBy(1L);
            teamRepository.save(team);
            
            TeamRole leaderRole = new TeamRole();
            leaderRole.setTeamId(team.getId());
            leaderRole.setRoleName("Leader");
            leaderRole.setDescription("队长");
            teamRoleRepository.save(leaderRole);
            
            TeamRole pilotRole = new TeamRole();
            pilotRole.setTeamId(team.getId());
            pilotRole.setRoleName("Pilot");
            pilotRole.setDescription("飞手");
            teamRoleRepository.save(pilotRole);
        }
    }
    
    private void initUsers() {
        Role operatorRole = roleRepository.findByRoleName("operator").orElseThrow();
        Role leaderRole = roleRepository.findByRoleName("leader").orElseThrow();
        Role observerRole = roleRepository.findByRoleName("observer").orElseThrow();
        
        String[][] users = {
                {"zhangsan", "张三", "1", "leader"},
                {"lisi", "李四", "1", "operator"},
                {"wangwu", "王五", "1", "operator"},
                {"zhaoliu", "赵六", "2", "leader"},
                {"qianqi", "钱七", "2", "operator"},
                {"sunba", "孙八", "2", "operator"},
                {"zhoujiu", "周九", "3", "leader"},
                {"wushi", "吴十", "3", "operator"},
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
            
            user = userRepository.save(user);
            
            UserRoleMap urm = new UserRoleMap();
            urm.setUserId(user.getId());
            
            switch (userData[3]) {
                case "leader" -> urm.setRoleId(leaderRole.getId());
                case "observer" -> urm.setRoleId(observerRole.getId());
                default -> urm.setRoleId(operatorRole.getId());
            }
            userRoleMapRepository.save(urm);
            
            if (userData[2] != null) {
                Long teamId = Long.parseLong(userData[2]);
                TeamRole teamRole = teamRoleRepository.findAll().stream()
                        .filter(tr -> tr.getTeamId().equals(teamId) && 
                                tr.getRoleName().equalsIgnoreCase(userData[3].equals("leader") ? "Leader" : "Pilot"))
                        .findFirst()
                        .orElse(null);
                
                TeamMember tm = new TeamMember();
                tm.setTeamId(teamId);
                tm.setUserId(user.getId());
                if (teamRole != null) {
                    tm.setTeamRoleId(teamRole.getId());
                }
                teamMemberRepository.save(tm);
            }
        }
    }
    
    private void initDrones() {
        String[][] drones = {
                {"DJI-M300-001", "M300 RTK", "DJI", "1"},
                {"DJI-M300-002", "M300 RTK", "DJI", "1"},
                {"DJI-M300-003", "M300 RTK", "DJI", "1"},
                {"DJI-M30-001", "M30", "DJI", "1"},
                {"DJI-M30-002", "M30", "DJI", "2"},
                {"DJI-M30-003", "M30", "DJI", "2"},
                {"DJI-AIR2S-001", "Air 2S", "DJI", "2"},
                {"DJI-AIR2S-002", "Air 2S", "DJI", "3"},
                {"DJI-MINI3-001", "Mini 3 Pro", "DJI", "3"},
                {"DJI-MINI3-002", "Mini 3 Pro", "DJI", "3"}
        };
        
        double baseLat = 39.9042;
        double baseLng = 116.4074;
        
        for (int i = 0; i < drones.length; i++) {
            String[] droneData = drones[i];
            
            Drone drone = new Drone();
            drone.setDroneSn(droneData[0]);
            drone.setModel(droneData[1]);
            drone.setManufacturer(droneData[2]);
            drone.setDefaultTeamId(Long.parseLong(droneData[3]));
            drone.setCapabilities("{\"camera\": true, \"thermal\": " + (i < 4) + ", \"zoom\": true}");
            drone = droneRepository.save(drone);
            
            TeamDroneMap tdm = new TeamDroneMap();
            tdm.setTeamId(Long.parseLong(droneData[3]));
            tdm.setDroneId(drone.getId());
            teamDroneMapRepository.save(tdm);
            
            Long userId = (long) (2 + (i % 6));
            DroneOwnership ownership = new DroneOwnership();
            ownership.setDroneId(drone.getId());
            ownership.setUserId(userId);
            ownership.setAssignedBy(1L);
            droneOwnershipRepository.save(ownership);
            
            DroneStatus status = new DroneStatus();
            status.setDroneId(drone.getId());
            status.setLat(baseLat + (random.nextDouble() - 0.5) * 0.1);
            status.setLng(baseLng + (random.nextDouble() - 0.5) * 0.1);
            status.setAlt(50.0 + random.nextDouble() * 150);
            status.setHeading((float) (random.nextDouble() * 360));
            status.setVelocity((float) (random.nextDouble() * 15));
            status.setBattery((float) (50 + random.nextDouble() * 50));
            status.setHealthStatus(random.nextInt(10) < 8 ? 0 : 1);
            status.setRiskLevel(random.nextInt(10) < 7 ? 0 : (random.nextInt(10) < 9 ? 1 : 2));
            status.setFlightStatus(random.nextBoolean() ? "FLYING" : "IDLE");
            status.setTaskStatus(random.nextBoolean() ? "EXECUTING" : "IDLE");
            status.setGridX((int) ((status.getLng() - 121.0) * 100));
            status.setGridY((int) ((status.getLat() - 31.0) * 100));
            droneStatusRepository.save(status);
        }
    }
    
    private void initTasks() {
        String[][] tasks = {
                {"河道巡检任务A", "INSPECTION", "对黄浦江段进行日常巡检", "1"},
                {"管线监测任务B", "MONITORING", "对输油管线进行热成像监测", "1"},
                {"区域侦察任务C", "RECONNAISSANCE", "对指定区域进行侦察", "0"},
                {"应急响应任务D", "EMERGENCY", "响应突发事件", "0"},
                {"设施检查任务E", "INSPECTION", "对电力设施进行检查", "3"}
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
}
