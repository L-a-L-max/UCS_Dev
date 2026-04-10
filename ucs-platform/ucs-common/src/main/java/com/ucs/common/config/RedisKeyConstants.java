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

    private RedisKeyConstants() {}
}
