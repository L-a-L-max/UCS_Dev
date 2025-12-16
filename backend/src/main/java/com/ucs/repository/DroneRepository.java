package com.ucs.repository;

import com.ucs.entity.Drone;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public interface DroneRepository extends JpaRepository<Drone, Long> {
    Optional<Drone> findByDroneSn(String droneSn);
    List<Drone> findByDefaultTeamId(Long teamId);
    
    @Query("SELECT d FROM Drone d WHERE d.id IN :ids")
    List<Drone> findByIdIn(List<Long> ids);
}
