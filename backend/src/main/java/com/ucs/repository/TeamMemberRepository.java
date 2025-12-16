package com.ucs.repository;

import com.ucs.entity.TeamMember;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public interface TeamMemberRepository extends JpaRepository<TeamMember, Long> {
    List<TeamMember> findByTeamId(Long teamId);
    List<TeamMember> findByUserId(Long userId);
    Optional<TeamMember> findByTeamIdAndUserId(Long teamId, Long userId);
    
    @Query("SELECT tm FROM TeamMember tm JOIN FETCH tm.user WHERE tm.teamId = :teamId")
    List<TeamMember> findByTeamIdWithUser(Long teamId);
    
    @Query("SELECT COUNT(tm) FROM TeamMember tm WHERE tm.teamId = :teamId")
    Long countByTeamId(Long teamId);
}
