package com.ucs.business.service;

import com.ucs.business.dto.WeatherDTO;

/**
 * Weather Service Interface
 * Following MyBatis-Plus convention with I prefix for interfaces
 */
public interface IWeatherService {
    
    /**
     * Get weather data for location
     */
    WeatherDTO getWeather(Double lat, Double lng);
    
    /**
     * Get weather data for default location (Beijing)
     */
    WeatherDTO getDefaultWeather();
}
