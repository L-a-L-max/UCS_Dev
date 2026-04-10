package com.ucs.repository;

import com.ucs.entity.RallyPoint;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Repository for RallyPoint CRUD operations.
 */
@Repository
public interface RallyPointRepository extends JpaRepository<RallyPoint, Long> {

    /** Find all non-deleted rally points ordered by name. */
    List<RallyPoint> findByDeletedAtIsNullOrderByNameAsc();

    /** Find enabled rally points (status=1) that are not deleted. */
    List<RallyPoint> findByStatusAndDeletedAtIsNullOrderByNameAsc(Integer status);

    /** Find rally points by scope (0=global, 1=team-specific). */
    List<RallyPoint> findByScopeAndDeletedAtIsNullOrderByNameAsc(Integer scope);

    /** Find rally points for a specific team (scope=1 AND matching teamId, or scope=0 global). */
    @Query("SELECT r FROM RallyPoint r WHERE r.deletedAt IS NULL AND (r.scope = 0 OR (r.scope = 1 AND r.teamId = :teamId)) ORDER BY r.name ASC")
    List<RallyPoint> findAccessibleByTeamId(@Param("teamId") String teamId);

    /** Find enabled rally points with available capacity. */
    @Query("SELECT r FROM RallyPoint r WHERE r.deletedAt IS NULL AND r.status = 1 AND r.currentOccupancy < r.capacity ORDER BY r.name ASC")
    List<RallyPoint> findAvailableRallyPoints();

    /** Search rally points by name (case-insensitive LIKE). */
    @Query("SELECT r FROM RallyPoint r WHERE r.deletedAt IS NULL AND LOWER(r.name) LIKE LOWER(CONCAT('%', :keyword, '%')) ORDER BY r.name ASC")
    List<RallyPoint> searchByName(@Param("keyword") String keyword);

    /** Search by name or address (case-insensitive). */
    @Query("SELECT r FROM RallyPoint r WHERE r.deletedAt IS NULL AND " +
           "(LOWER(r.name) LIKE LOWER(CONCAT('%', :keyword, '%')) OR LOWER(r.address) LIKE LOWER(CONCAT('%', :keyword, '%')) OR LOWER(r.city) LIKE LOWER(CONCAT('%', :keyword, '%'))) " +
           "ORDER BY r.name ASC")
    List<RallyPoint> searchByKeyword(@Param("keyword") String keyword);

    /** Paginated listing for commander UI. */
    Page<RallyPoint> findByDeletedAtIsNullOrderByCreatedAtDesc(Pageable pageable);
}
