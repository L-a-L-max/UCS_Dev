package com.ucs.repository;

import com.ucs.entity.TeamRole;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface TeamRoleRepository extends JpaRepository<TeamRole, Long> {
    List<TeamRole> findByTeamId(Long teamId);
}
