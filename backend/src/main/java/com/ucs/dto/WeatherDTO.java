package com.ucs.dto;

import lombok.Data;

@Data
public class WeatherDTO {
    private Float temperature;
    private Float humidity;
    private Float windSpeed;
    private Float windDirection;
    private String riskLevel;
    private String location;
}
