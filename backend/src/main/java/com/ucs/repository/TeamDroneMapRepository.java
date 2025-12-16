package com.ucs.repository;

import com.ucs.entity.TeamDroneMap;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface TeamDroneMapRepository extends JpaRepository<TeamDroneMap, Long> {
    @Query("SELECT tdm FROM TeamDroneMap tdm WHERE tdm.teamId = :teamId AND tdm.removedAt IS NULL")
    List<TeamDroneMap> findActiveByTeamId(Long teamId);
    
    @Query("SELECT tdm.droneId FROM TeamDroneMap tdm WHERE tdm.teamId = :teamId AND tdm.removedAt IS NULL")
    List<Long> findDroneIdsByTeamId(Long teamId);
}
