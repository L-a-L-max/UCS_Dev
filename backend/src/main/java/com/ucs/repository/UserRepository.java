package com.ucs.repository;

import com.ucs.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByUsername(String username);
    List<User> findByTeamId(Long teamId);
    
    @Query("SELECT u FROM User u WHERE u.teamId = :teamId AND u.status = 1")
    List<User> findActiveByTeamId(Long teamId);
    
    boolean existsByUsername(String username);
}
