import type { RegionData } from '@/types/observer';

/** China administrative regions data with center coordinates and zoom levels */
export const CHINA_REGIONS: Record<string, RegionData> = {
  '中国': {
    name: '中国',
    center: [105, 35],
    zoom: 3,
    children: {
      '北京市': { name: '北京市', center: [116.4074, 39.9042], zoom: 8 },
      '上海市': { name: '上海市', center: [121.4737, 31.2304], zoom: 8 },
      '天津市': { name: '天津市', center: [117.1901, 39.1256], zoom: 8 },
      '重庆市': { name: '重庆市', center: [106.5516, 29.5630], zoom: 6 },
      '河北省': { name: '河北省', center: [114.5149, 38.0428], zoom: 5, children: {
        '石家庄市': { name: '石家庄市', center: [114.5149, 38.0428], zoom: 8 },
        '唐山市': { name: '唐山市', center: [118.1802, 39.6306], zoom: 8 },
        '保定市': { name: '保定市', center: [115.4646, 38.8737], zoom: 8 },
      }},
      '山西省': { name: '山西省', center: [112.5489, 37.8706], zoom: 5, children: {
        '太原市': { name: '太原市', center: [112.5489, 37.8706], zoom: 8 },
        '大同市': { name: '大同市', center: [113.2951, 40.0903], zoom: 8 },
      }},
      '内蒙古': { name: '内蒙古自治区', center: [111.7656, 40.8175], zoom: 4 },
      '辽宁省': { name: '辽宁省', center: [123.4291, 41.7968], zoom: 5, children: {
        '沈阳市': { name: '沈阳市', center: [123.4291, 41.7968], zoom: 8 },
        '大连市': { name: '大连市', center: [121.6147, 38.9140], zoom: 8 },
      }},
      '吉林省': { name: '吉林省', center: [125.3245, 43.8868], zoom: 5 },
      '黑龙江省': { name: '黑龙江省', center: [126.6424, 45.7570], zoom: 4 },
      '江苏省': { name: '江苏省', center: [118.7969, 32.0603], zoom: 5, children: {
        '南京市': { name: '南京市', center: [118.7969, 32.0603], zoom: 8 },
        '苏州市': { name: '苏州市', center: [120.6195, 31.2990], zoom: 8 },
        '无锡市': { name: '无锡市', center: [120.3119, 31.4912], zoom: 8 },
      }},
      '浙江省': { name: '浙江省', center: [120.1536, 30.2875], zoom: 5, children: {
        '杭州市': { name: '杭州市', center: [120.1536, 30.2875], zoom: 8 },
        '宁波市': { name: '宁波市', center: [121.5440, 29.8683], zoom: 8 },
        '温州市': { name: '温州市', center: [120.6994, 28.0003], zoom: 8 },
      }},
      '安徽省': { name: '安徽省', center: [117.2830, 31.8612], zoom: 5 },
      '福建省': { name: '福建省', center: [119.2965, 26.0789], zoom: 5 },
      '江西省': { name: '江西省', center: [115.8922, 28.6765], zoom: 5 },
      '山东省': { name: '山东省', center: [117.0009, 36.6758], zoom: 5, children: {
        '济南市': { name: '济南市', center: [117.0009, 36.6758], zoom: 8 },
        '青岛市': { name: '青岛市', center: [120.3826, 36.0671], zoom: 8 },
      }},
      '河南省': { name: '河南省', center: [113.6254, 34.7466], zoom: 5 },
      '湖北省': { name: '湖北省', center: [114.3055, 30.5928], zoom: 5, children: {
        '武汉市': { name: '武汉市', center: [114.3055, 30.5928], zoom: 8 },
      }},
      '湖南省': { name: '湖南省', center: [112.9823, 28.1941], zoom: 5 },
      '广东省': { name: '广东省', center: [113.2644, 23.1291], zoom: 5, children: {
        '广州市': { name: '广州市', center: [113.2644, 23.1291], zoom: 8 },
        '深圳市': { name: '深圳市', center: [114.0579, 22.5431], zoom: 8 },
        '东莞市': { name: '东莞市', center: [113.7518, 23.0207], zoom: 8 },
      }},
      '广西': { name: '广西壮族自治区', center: [108.3200, 22.8240], zoom: 5 },
      '海南省': { name: '海南省', center: [110.3312, 20.0310], zoom: 6 },
      '四川省': { name: '四川省', center: [104.0657, 30.6595], zoom: 5, children: {
        '成都市': { name: '成都市', center: [104.0657, 30.6595], zoom: 8 },
      }},
      '贵州省': { name: '贵州省', center: [106.7135, 26.5783], zoom: 5 },
      '云南省': { name: '云南省', center: [102.7123, 25.0406], zoom: 5 },
      '西藏': { name: '西藏自治区', center: [91.1322, 29.6604], zoom: 4 },
      '陕西省': { name: '陕西省', center: [108.9540, 34.2658], zoom: 5, children: {
        '西安市': { name: '西安市', center: [108.9540, 34.2658], zoom: 8 },
      }},
      '甘肃省': { name: '甘肃省', center: [103.8236, 36.0594], zoom: 5 },
      '青海省': { name: '青海省', center: [101.7782, 36.6171], zoom: 5 },
      '宁夏': { name: '宁夏回族自治区', center: [106.2782, 38.4664], zoom: 5 },
      '新疆': { name: '新疆维吾尔自治区', center: [87.6177, 43.7928], zoom: 4 },
      '香港': { name: '香港特别行政区', center: [114.1694, 22.3193], zoom: 9 },
      '澳门': { name: '澳门特别行政区', center: [113.5439, 22.1987], zoom: 11 },
      '台湾省': { name: '台湾省', center: [121.5654, 25.0330], zoom: 6 },
    }
  }
};
