package com.ucs.repository;

import com.ucs.entity.UserRoleMap;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface UserRoleMapRepository extends JpaRepository<UserRoleMap, Long> {
    List<UserRoleMap> findByUserId(Long userId);
    
    @Query("SELECT urm FROM UserRoleMap urm JOIN FETCH urm.role WHERE urm.userId = :userId")
    List<UserRoleMap> findByUserIdWithRole(Long userId);
}
