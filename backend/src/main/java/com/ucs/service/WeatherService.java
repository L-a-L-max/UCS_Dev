package com.ucs.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ucs.dto.WeatherDTO;
import com.ucs.entity.WeatherSnapshot;
import com.ucs.repository.WeatherSnapshotRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

@Service
public class WeatherService {
    
    private static final Logger log = LoggerFactory.getLogger(WeatherService.class);
    
    private final WeatherSnapshotRepository weatherSnapshotRepository;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    
    private static final double BEIJING_LAT = 39.9042;
    private static final double BEIJING_LNG = 116.4074;
    private static final String OPEN_METEO_URL = 
        "https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f" +
        "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m" +
        "&timezone=Asia%%2FShanghai";
    
    public WeatherService(WeatherSnapshotRepository weatherSnapshotRepository) {
        this.weatherSnapshotRepository = weatherSnapshotRepository;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
        this.objectMapper = new ObjectMapper();
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
        dto.setTemperature(-2.0f);
        dto.setHumidity(40.0f);
        dto.setWindSpeed(3.0f);
        dto.setWindDirection(315.0f);
        dto.setRiskLevel("LOW");
        dto.setLocation("Beijing");
        return dto;
    }
    
    @Scheduled(fixedRate = 600000)
    public void updateWeather() {
        fetchRealWeather(BEIJING_LAT, BEIJING_LNG, "Beijing");
    }
    
    public void fetchRealWeather(double lat, double lng, String locationName) {
        try {
            String url = String.format(OPEN_METEO_URL, lat, lng);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(10))
                    .GET()
                    .build();
            
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            
            if (response.statusCode() == 200) {
                JsonNode root = objectMapper.readTree(response.body());
                JsonNode current = root.get("current");
                
                if (current != null) {
                    WeatherSnapshot snapshot = new WeatherSnapshot();
                    snapshot.setTemperature((float) current.get("temperature_2m").asDouble());
                    snapshot.setHumidity((float) current.get("relative_humidity_2m").asDouble());
                    snapshot.setWindSpeed((float) current.get("wind_speed_10m").asDouble());
                    snapshot.setWindDirection((float) current.get("wind_direction_10m").asDouble());
                    snapshot.setLocation(locationName);
                    
                    float windSpeed = snapshot.getWindSpeed();
                    float temp = snapshot.getTemperature();
                    if (windSpeed > 15 || temp < -10 || temp > 40) {
                        snapshot.setRiskLevel("HIGH");
                    } else if (windSpeed > 8 || temp < 0 || temp > 35) {
                        snapshot.setRiskLevel("MEDIUM");
                    } else {
                        snapshot.setRiskLevel("LOW");
                    }
                    
                    weatherSnapshotRepository.save(snapshot);
                    log.info("Weather updated from Open-Meteo: {}°C, {}% humidity, {} m/s wind at {}", 
                            snapshot.getTemperature(), snapshot.getHumidity(), 
                            snapshot.getWindSpeed(), locationName);
                }
            } else {
                log.warn("Failed to fetch weather from Open-Meteo: HTTP {}", response.statusCode());
            }
        } catch (Exception e) {
            log.error("Error fetching weather from Open-Meteo: {}", e.getMessage());
        }
    }
}
