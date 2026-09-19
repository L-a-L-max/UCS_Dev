package com.ucs.dto;

import lombok.Data;

import java.math.BigDecimal;

/**
 * 航点传输对象。创建任务时前端只需给出 displayLabel 与坐标，
 * seq 由后端按 displayLabel 升序重新编排。
 */
@Data
public class WaypointDTO {

    private Long id;

    /** 执行序号，响应时由后端填充；请求时可省略 */
    private Integer seq;

    /** 展示编号，支持一位小数（如 4.1） */
    private BigDecimal displayLabel;

    /** NAV / ACTION，默认 NAV */
    private String itemType;

    private Double latitude;

    private Double longitude;

    /** 相对 Home 点高度，单位米 */
    private Double altitude;

    /** 到点悬停时长（秒） */
    private Integer holdTime;

    private String actionCommand;

    /** JSON 字符串 */
    private String actionParams;
}
