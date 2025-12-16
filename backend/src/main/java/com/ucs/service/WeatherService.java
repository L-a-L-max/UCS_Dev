package com.ucs.service;

import com.ucs.dto.WeatherDTO;
import com.ucs.entity.WeatherSnapshot;
import com.ucs.repository.WeatherSnapshotRepository;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.Random;

@Service
public class WeatherService {
    
    private final WeatherSnapshotRepository weatherSnapshotRepository;
    private final Random random = new Random();
    
    public WeatherService(WeatherSnapshotRepository weatherSnapshotRepository) {
        this.weatherSnapshotRepository = weatherSnapshotRepository;
    }
    
    public WeatherDTO getCurrentWeather() {
        return weatherSnapshotRepository.findLatest()
                .map(this::convertToDTO)
                .orElseGet(this::generateDefaultWeather);
    }
    
    public WeatherDTO getWeatherByLocation(String location) {
        return weatherSnapshotRepository.findLatestByLocation(location)
                .map(this::convertToDTO)
                .orElseGet(this::generateDefaultWeather);
    }
    
    private WeatherDTO convertToDTO(WeatherSnapshot snapshot) {
        WeatherDTO dto = new WeatherDTO();
        dto.setTemperature(snapshot.getTemperature());
        dto.setHumidity(snapshot.getHumidity());
        dto.setWindSpeed(snapshot.getWindSpeed());
        dto.setWindDirection(snapshot.getWindDirection());
        dto.setRiskLevel(snapshot.getRiskLevel());
        dto.setLocation(snapshot.getLocation());
        return dto;
    }
    
    private WeatherDTO generateDefaultWeather() {
        WeatherDTO dto = new WeatherDTO();
        dto.setTemperature(25.0f);
        dto.setHumidity(60.0f);
        dto.setWindSpeed(5.0f);
        dto.setWindDirection(180.0f);
        dto.setRiskLevel("LOW");
        dto.setLocation("Default");
        return dto;
    }
    
    @Scheduled(fixedRate = 600000)
    public void updateWeather() {
        WeatherSnapshot snapshot = new WeatherSnapshot();
        snapshot.setTemperature(20 + random.nextFloat() * 15);
        snapshot.setHumidity(40 + random.nextFloat() * 40);
        snapshot.setWindSpeed(random.nextFloat() * 15);
        snapshot.setWindDirection(random.nextFloat() * 360);
        snapshot.setLocation("Shanghai");
        
        if (snapshot.getWindSpeed() > 10) {
            snapshot.setRiskLevel("HIGH");
        } else if (snapshot.getWindSpeed() > 5) {
            snapshot.setRiskLevel("MEDIUM");
        } else {
            snapshot.setRiskLevel("LOW");
        }
        
        weatherSnapshotRepository.save(snapshot);
    }
}
