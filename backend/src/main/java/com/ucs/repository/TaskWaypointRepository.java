package com.ucs.repository;

import com.ucs.entity.TaskWaypoint;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TaskWaypointRepository extends JpaRepository<TaskWaypoint, Long> {

    List<TaskWaypoint> findByTaskIdOrderBySeqAsc(Long taskId);

    long countByTaskId(Long taskId);

    @Modifying
    @Query("DELETE FROM TaskWaypoint w WHERE w.taskId = :taskId")
    void deleteByTaskId(Long taskId);

    /** 局部改航：删除 seq >= fromSeq 的航点，后面再写入新的航点序列 */
    @Modifying
    @Query("DELETE FROM TaskWaypoint w WHERE w.taskId = :taskId AND w.seq >= :fromSeq")
    void deleteByTaskIdAndSeqGreaterThanEqual(Long taskId, Integer fromSeq);

    @Query("SELECT COUNT(w) FROM TaskWaypoint w WHERE w.taskId = :taskId AND w.itemType = 'NAV'")
    long countNavByTaskId(Long taskId);
}
