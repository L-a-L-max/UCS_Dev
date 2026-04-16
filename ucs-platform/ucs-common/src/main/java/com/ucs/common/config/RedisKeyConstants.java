package com.ucs.common.config;

/**
 * Redis key pattern constants shared across all microservices.
 */
public final class RedisKeyConstants {

    /** Drone online heartbeat key (TTL 30s): drone:{uavId}:online */
    public static final String DRONE_ONLINE_PREFIX = "drone:";
    public static final String DRONE_ONLINE_SUFFIX = ":online";

    /** Drone state hash key: drone:{uavId}:state */
    public static final String DRONE_STATE_SUFFIX = ":state";

    /** Drone partition set key: drone:{uavId}:partitions */
    public static final String DRONE_PARTITIONS_SUFFIX = ":partitions";

    /** Partition reverse index set key: partition:{name}:drones */
    public static final String PARTITION_DRONES_PREFIX = "partition:";
    public static final String PARTITION_DRONES_SUFFIX = ":drones";

    /** GeoHash reverse index set key: geohash:{hash} */
    public static final String GEOHASH_PREFIX = "geohash:";

    /** Redis GEO key for all drone positions */
    public static final String DRONE_POSITIONS_GEO = "drone:positions";

    /** Drone heartbeat ZSet key: drone:heartbeat (T-64/T-65) */
    public static final String DRONE_HEARTBEAT_ZSET = "drone:heartbeat";

    /** Drone controller key: drone:{uavId}:controller (T-64) */
    public static final String DRONE_CONTROLLER_SUFFIX = ":controller";

    /** Drone home position key: drone:{uavId}:home (T-64) */
    public static final String DRONE_HOME_SUFFIX = ":home";

    /** Drone distributed lock key: lock:drone:{uavId} (T-64) */
    public static final String LOCK_DRONE_PREFIX = "lock:drone:";

    /** Epoch key per drone: epoch:{uavId} (T-65) */
    public static final String EPOCH_PREFIX = "epoch:";

    /** Epoch last-update key per drone: epoch:{uavId}:lastUpdate (T-65) */
    public static final String EPOCH_LAST_UPDATE_SUFFIX = ":lastUpdate";

    /** JWT blacklist key prefix */
    public static final String JWT_BLACKLIST_PREFIX = "jwt:blacklist:";

    public static String droneOnlineKey(String uavId) {
        return DRONE_ONLINE_PREFIX + uavId + DRONE_ONLINE_SUFFIX;
    }

    public static String droneStateKey(String uavId) {
        return DRONE_ONLINE_PREFIX + uavId + DRONE_STATE_SUFFIX;
    }

    public static String dronePartitionsKey(String uavId) {
        return DRONE_ONLINE_PREFIX + uavId + DRONE_PARTITIONS_SUFFIX;
    }

    public static String partitionDronesKey(String partitionName) {
        return PARTITION_DRONES_PREFIX + partitionName + PARTITION_DRONES_SUFFIX;
    }

    public static String geohashKey(String hash) {
        return GEOHASH_PREFIX + hash;
    }

    /** T-64: Drone controller key */
    public static String droneControllerKey(String uavId) {
        return DRONE_ONLINE_PREFIX + uavId + DRONE_CONTROLLER_SUFFIX;
    }

    /** T-64: Drone home position key */
    public static String droneHomeKey(String uavId) {
        return DRONE_ONLINE_PREFIX + uavId + DRONE_HOME_SUFFIX;
    }

    /** T-64: Drone distributed lock key */
    public static String droneLockKey(String uavId) {
        return LOCK_DRONE_PREFIX + uavId;
    }

    /** T-65: Epoch key for a drone */
    public static String epochKey(String uavId) {
        return EPOCH_PREFIX + uavId;
    }

    /** T-65: Epoch last-update key for a drone */
    public static String epochLastUpdateKey(String uavId) {
        return EPOCH_PREFIX + uavId + EPOCH_LAST_UPDATE_SUFFIX;
    }

    private RedisKeyConstants() {}
}
