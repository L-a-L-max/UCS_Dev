package com.ucs.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class HeatmapPointDTO {
    private Double lat;
    private Double lng;
    private Double intensity;
}
