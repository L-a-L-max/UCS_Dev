package com.ucs.dto;

import lombok.Data;

@Data
public class DroneStatusDTO {
    private String uavId;
    private String droneSn;
    private Double lat;
    private Double lng;
    private Double altitude;
    private Float battery;
    private String hardwareStatus;
    private String flightStatus;
    private String taskStatus;
    private String color;
    private String model;
    private String owner;
    private Float velocity;
    private Float heading;
    private String networkType;
    private Float signalStrength;
}
