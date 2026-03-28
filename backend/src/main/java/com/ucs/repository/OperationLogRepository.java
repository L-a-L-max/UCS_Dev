package com.ucs.repository;

import com.ucs.entity.OperationLog;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;

@Repository
public interface OperationLogRepository extends JpaRepository<OperationLog, Long> {
    
    Page<OperationLog> findByUserIdOrderByCreatedAtDesc(Long userId, Pageable pageable);
    
    Page<OperationLog> findByOperationTypeOrderByCreatedAtDesc(String operationType, Pageable pageable);
    
    Page<OperationLog> findByTargetDroneIdOrderByCreatedAtDesc(Long targetDroneId, Pageable pageable);
    
    @Query("SELECT o FROM OperationLog o WHERE o.createdAt BETWEEN :startTime AND :endTime ORDER BY o.createdAt DESC")
    List<OperationLog> findByTimeRange(LocalDateTime startTime, LocalDateTime endTime);
    
    @Query("SELECT o FROM OperationLog o WHERE o.userId = :userId AND o.operationType = :operationType ORDER BY o.createdAt DESC")
    List<OperationLog> findByUserIdAndOperationType(Long userId, String operationType);
    
    Page<OperationLog> findAllByOrderByCreatedAtDesc(Pageable pageable);
}
