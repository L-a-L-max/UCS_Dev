package com.ucs.business.repository;

import com.ucs.business.entity.TeamRole;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface TeamRoleRepository extends JpaRepository<TeamRole, Long> {
    java.util.Optional<TeamRole> findByRoleName(String roleName);
}
