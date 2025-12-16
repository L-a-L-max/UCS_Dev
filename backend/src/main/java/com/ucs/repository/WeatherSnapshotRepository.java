package com.ucs.repository;

import com.ucs.entity.WeatherSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import java.util.Optional;

@Repository
public interface WeatherSnapshotRepository extends JpaRepository<WeatherSnapshot, Long> {
    @Query("SELECT w FROM WeatherSnapshot w ORDER BY w.createdAt DESC LIMIT 1")
    Optional<WeatherSnapshot> findLatest();
    
    @Query("SELECT w FROM WeatherSnapshot w WHERE w.location = :location ORDER BY w.createdAt DESC LIMIT 1")
    Optional<WeatherSnapshot> findLatestByLocation(String location);
}
