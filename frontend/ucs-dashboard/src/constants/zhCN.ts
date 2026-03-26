/** Chinese localization dictionary for the platform */
export const zhCN = {
  // Login page
  platformTitle: '无人机综合业务平台',
  username: '用户名',
  password: '密码',
  login: '登录',
  loginHint: '测试账号: commander/observer/zhangsan/lisi 密码: 123456',
  loginFailed: '登录失败',
  connectionFailed: '连接失败',
  observerOnly: '仅观察员角色可访问大屏',
  accessDenied: '访问被拒绝：需要观察员角色',
  
  // Header
  dashboardTitle: '无人机综合业务平台',
  refresh: '刷新',
  logout: '退出',
  
  // Task card
  tasks: '任务态势',
  total: '总计',
  active: '执行中',
  done: '已完成',
  error: '异常',
  pending: '待执行',
  
  // Weather card
  weather: '天气信息',
  location: '位置',
  defaultLocation: '(默认)',
  temperature: '温度',
  humidity: '湿度',
  wind: '风速',
  risk: '飞行风险',
  riskLow: '低',
  riskMedium: '中',
  riskHigh: '高',
  
  // Teams card
  teams: '任务小队',
  leader: '队长',
  
  // Stats card
  stats: '实时统计',
  flying: '飞行中',
  totalUavs: '无人机总数',
  lowBattery: '低电量',
  errors: '异常状态',
  
  // Map controls
  heatmapMode: '热力图',
  heatmapDrone: '无人机',
  heatmapTask: '任务',
  heatmapMember: '成员',
  myLocation: '我的位置',
  focusUavs: '聚焦无人机',
  showWeather: '天气信息',
  
  // Map legend
  flightStatusFilter: '飞行状态',
  flyingStatus: '飞行中',
  idleStatus: '待机',
  clickForDetails: '点击标记查看详情',
  
  // UAV list
  uavList: '无人机列表',
  
  // Events
  events: '事件日志',
  noEvents: '暂无事件',
  
  // Footer
  footerInfo: 'UCS 平台 v1.2',
  locationInfo: '当前位置',
  
  // Drone popup
  model: '型号',
  battery: '电量',
  altitude: '高度',
  status: '状态',
  operator: '操作员',
  task: '当前任务',
  team: '所属小队',
  position: '位置',
  noTask: '无任务',
  
  // Map error
  mapLoadFailed: '地图加载失败',
  mapErrorHint: '请检查网络连接或尝试切换地图源',
  webglNotSupported: '您的浏览器不支持 WebGL，无法显示地图',
  tileLoadFailed: '地图瓦片加载失败',
  networkError: '网络连接异常',
  tryRefresh: '请尝试刷新页面',
  apiKeyNotConfigured: '高德地图 API 密钥未配置',
  apiKeyConfigHint: '请设置环境变量后重启后端服务',
  backendNotReachable: '无法连接后端服务',
  checkBackendHint: '请确保后端服务已启动 (端口 8080)',
  
  // Tile source selector
  tileSource: '地图源',
  tileSourceGaode: '高德地图',
  tileSourceOSM: 'OpenStreetMap',
  tileSourceCarto: 'CartoDB',
  
  // Chart types
  chartList: '列表',
  chartPie: '饼图',
  chartBar: '柱状图',
  
  // Sidebar
  collapseSidebar: '收起侧边栏',
  expandSidebar: '展开侧边栏',
  
  // Team members
  teamMembers: '队员',
  memberName: '姓名',
  memberRole: '角色',
  locating: '定位中...',
  
  // Team visibility filter
  teamMemberFilter: '小队成员显示',
  
  // Chart view types
  listView: '列表',
  pieChart: '饼图',
  barChart: '柱状图',
  
  // Location error
  locationFailed: '无法获取您的位置',
  locationDenied: '定位权限被拒绝，请在浏览器设置中允许定位',
  locationUnsupported: '您的浏览器不支持定位功能',
  retryLocation: '重新获取',
};
