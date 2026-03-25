package com.ucs.business.service;

import com.ucs.business.entity.RallyPoint;
import com.ucs.business.repository.RallyPointRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * Service for Rally Point CRUD operations.
 * Rally points are predefined locations for drone return-to-rally operations.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RallyPointService {

    private final RallyPointRepository rallyPointRepository;

    /**
     * Create a new rally point.
     */
    @Transactional
    public RallyPoint create(RallyPoint rallyPoint) {
        RallyPoint saved = rallyPointRepository.save(rallyPoint);
        log.info("Created rally point: id={}, name={}, lat={}, lon={}",
                saved.getId(), saved.getName(), saved.getLatitude(), saved.getLongitude());
        return saved;
    }

    /**
     * Update an existing rally point.
     */
    @Transactional
    public Optional<RallyPoint> update(Long id, RallyPoint updated) {
        return rallyPointRepository.findById(id)
                .filter(rp -> rp.getDeletedAt() == null)
                .map(existing -> {
                    if (updated.getName() != null) existing.setName(updated.getName());
                    if (updated.getLatitude() != null) existing.setLatitude(updated.getLatitude());
                    if (updated.getLongitude() != null) existing.setLongitude(updated.getLongitude());
                    if (updated.getAltitude() != null) existing.setAltitude(updated.getAltitude());
                    if (updated.getCity() != null) existing.setCity(updated.getCity());
                    if (updated.getAddress() != null) existing.setAddress(updated.getAddress());
                    if (updated.getCapacity() != null) existing.setCapacity(updated.getCapacity());
                    if (updated.getStatus() != null) existing.setStatus(updated.getStatus());
                    if (updated.getScope() != null) existing.setScope(updated.getScope());
                    if (updated.getTeamId() != null) existing.setTeamId(updated.getTeamId());
                    if (updated.getRadius() != null) existing.setRadius(updated.getRadius());
                    if (updated.getServiceType() != null) existing.setServiceType(updated.getServiceType());
                    if (updated.getDescription() != null) existing.setDescription(updated.getDescription());
                    RallyPoint saved = rallyPointRepository.save(existing);
                    log.info("Updated rally point: id={}, name={}", saved.getId(), saved.getName());
                    return saved;
                });
    }

    /**
     * Soft-delete a rally point.
     */
    @Transactional
    public boolean softDelete(Long id) {
        return rallyPointRepository.findById(id)
                .filter(rp -> rp.getDeletedAt() == null)
                .map(rp -> {
                    rp.setDeletedAt(LocalDateTime.now());
                    rallyPointRepository.save(rp);
                    log.info("Soft-deleted rally point: id={}, name={}", rp.getId(), rp.getName());
                    return true;
                })
                .orElse(false);
    }

    /**
     * Get a single rally point by ID.
     */
    public Optional<RallyPoint> getById(Long id) {
        return rallyPointRepository.findById(id)
                .filter(rp -> rp.getDeletedAt() == null);
    }

    /**
     * Get all non-deleted rally points.
     */
    public List<RallyPoint> getAll() {
        return rallyPointRepository.findByDeletedAtIsNullOrderByNameAsc();
    }

    /**
     * Get enabled rally points (status=1).
     */
    public List<RallyPoint> getEnabled() {
        return rallyPointRepository.findByStatusAndDeletedAtIsNullOrderByNameAsc(1);
    }

    /**
     * Get rally points accessible by a team (global + team-specific).
     */
    public List<RallyPoint> getAccessibleByTeam(String teamId) {
        return rallyPointRepository.findAccessibleByTeamId(teamId);
    }

    /**
     * Get enabled rally points with available capacity.
     */
    public List<RallyPoint> getAvailable() {
        return rallyPointRepository.findAvailableRallyPoints();
    }

    /**
     * Search rally points by keyword (name, address, city).
     */
    public List<RallyPoint> search(String keyword) {
        if (keyword == null || keyword.trim().isEmpty()) {
            return getAll();
        }
        return rallyPointRepository.searchByKeyword(keyword.trim());
    }

    /**
     * Get paginated rally points for commander UI.
     */
    public Page<RallyPoint> getPage(int page, int size) {
        return rallyPointRepository.findByDeletedAtIsNullOrderByCreatedAtDesc(
                PageRequest.of(page, size));
    }

    /**
     * Increment occupancy when a drone arrives at this rally point.
     */
    @Transactional
    public boolean incrementOccupancy(Long id) {
        return rallyPointRepository.findById(id)
                .filter(rp -> rp.getDeletedAt() == null && rp.getCurrentOccupancy() < rp.getCapacity())
                .map(rp -> {
                    rp.setCurrentOccupancy(rp.getCurrentOccupancy() + 1);
                    rallyPointRepository.save(rp);
                    return true;
                })
                .orElse(false);
    }

    /**
     * Decrement occupancy when a drone leaves this rally point.
     */
    @Transactional
    public boolean decrementOccupancy(Long id) {
        return rallyPointRepository.findById(id)
                .filter(rp -> rp.getDeletedAt() == null && rp.getCurrentOccupancy() > 0)
                .map(rp -> {
                    rp.setCurrentOccupancy(rp.getCurrentOccupancy() - 1);
                    rallyPointRepository.save(rp);
                    return true;
                })
                .orElse(false);
    }
}
